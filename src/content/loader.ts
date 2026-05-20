import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import slugify from 'slugify';
import { assignPostUrls } from '~/build/permalinks.ts';
import {
  type ResolvedTaxonomies,
  type RoutesYaml,
  applyTaxonomyTemplate,
  emptyRoutesYaml,
  resolveCollections,
  resolveTaxonomies,
} from '~/build/routes-yaml.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { NectarError, toNectarError } from '~/util/errors.ts';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { readImageDimensions } from '~/util/image-size.ts';
import { directionForLocale } from '~/util/locale.ts';
import { logger } from '~/util/logger.ts';
import {
  asBool,
  asDateISO,
  asPositiveInt,
  asString,
  asStringArray,
  parseFrontmatter,
} from './frontmatter.ts';
import { type MarkdownPool, createMarkdownPool } from './markdown-pool.ts';
import { sanitizeInlineCaptionHtml, truncateByWords } from './markdown.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag, Tier } from './model.ts';
import { type PaywallVisibility, buildPaywallStub, truncateMarkdownForPaywall } from './paywall.ts';

// Plugin-supplied transform applied to the raw markdown body (after
// frontmatter is stripped) before `marked.parse` runs. The pipeline composes
// hooks in registration order, so each transform sees the previous one's
// output. `kind` lets a hook opt into transforming only posts or pages;
// `frontmatter` is the parsed YAML so transforms can branch on custom keys.
export type MarkdownTransformHook = (
  input: string,
  ctx: {
    readonly kind: 'post' | 'page';
    readonly path: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
  },
) => string | Promise<string>;

export interface LoadContentOptions {
  cwd: string;
  config: NectarConfig;
  // Resolved `routes.yaml`, when available. Used to pick the URL template for
  // tag/author archives so `tag.url` / `author.url` reflect any custom paths
  // (and become `''` when the taxonomy is disabled via routes.yaml).
  routesYaml?: RoutesYaml;
  // When true, posts and pages with `status: draft` are kept in the content
  // graph instead of being filtered out. Default-excluded so a forgotten WIP
  // can't accidentally ship; the CLI's `--include-drafts` opts in for preview
  // builds. Scheduled posts continue to be gated on their `published_at`
  // timestamp regardless of this flag.
  includeDrafts?: boolean;
  // When true, posts whose `published_at` is in the future, and posts with
  // `status: scheduled` regardless of date, are kept in the content graph
  // instead of being filtered out. Default-excluded so embargoed announcements
  // can't ship before their wall-clock release time. Surfaced through
  // `[build].include_future_posts` for preview deploys that want to see
  // scheduled content. Independent of `includeDrafts`: a future-dated
  // `status: draft` still needs `includeDrafts: true` as well.
  includeFuturePosts?: boolean;
  // Plugin-supplied markdown transforms applied to each post/page body before
  // `marked.parse`. Empty by default; the build pipeline collects these from
  // `Plugin.transformMarkdown` declarations and passes them through. Compose
  // in registration order so each transform sees the previous output.
  markdownTransforms?: readonly MarkdownTransformHook[];
}

// Build `tag.url` / `author.url` from the resolved taxonomies. Returns `''`
// when the taxonomy is disabled so template guards like
// `typeof tag.url === 'string' && tag.url.length > 0` keep skipping the link.
// `basePath` is the normalised `build.base_path` so subpath deploys (e.g.
// hosting under `/blog/`) produce browser-resolvable archive URLs instead of
// `https://host/tag/foo/`.
function taxonomyArchiveUrl(
  siteUrl: string,
  basePath: string,
  taxonomies: ResolvedTaxonomies,
  kind: 'tag' | 'author',
  slug: string,
): string {
  const template = taxonomies[kind];
  if (template === undefined) return '';
  return joinUrl(siteUrl, basePath, applyTaxonomyTemplate(template, slug));
}

export async function loadContent({
  cwd,
  config,
  routesYaml,
  includeDrafts,
  includeFuturePosts,
  markdownTransforms,
}: LoadContentOptions): Promise<ContentGraph> {
  resetAutoCreationWarnings();
  const site = buildSite(config);
  const taxonomies = resolveTaxonomies(routesYaml ?? emptyRoutesYaml());

  // Pre-count post/page files so the pool can skip spawning Bun Workers on
  // small sites where the spawn cost would exceed the parsing cost. Tags and
  // authors don't push markdown through `renderMarkdown`, so they're excluded.
  const postsDir = resolve(cwd, config.content.posts_dir);
  const pagesDir = resolve(cwd, config.content.pages_dir);
  const [postCount, pageCount] = await Promise.all([
    countMarkdownFiles(postsDir),
    countMarkdownFiles(pagesDir),
  ]);
  // Paywalled posts render twice (full + truncated for feed), so each post
  // contributes a worst-case 2 jobs. Estimating at 2x ensures borderline sites
  // (e.g. 30 posts but all members-only) still benefit from workers.
  const pool = createMarkdownPool({ estimatedJobs: postCount * 2 + pageCount });

  // Explicit option wins; otherwise fall back to the config flag so a
  // `nectar.toml` opt-in propagates without every caller having to plumb it.
  const futureFromConfig = config.build.include_future_posts === true;
  const includeFuture = includeFuturePosts === true || futureFromConfig;

  try {
    return await loadContentWithPool({
      cwd,
      config,
      site,
      pool,
      taxonomies,
      routesYaml: routesYaml ?? emptyRoutesYaml(),
      includeDrafts: includeDrafts === true,
      includeFuturePosts: includeFuture,
      markdownTransforms: markdownTransforms ?? [],
    });
  } finally {
    await pool.close();
  }
}

async function loadContentWithPool({
  cwd,
  config,
  site,
  pool,
  taxonomies,
  routesYaml,
  includeDrafts,
  includeFuturePosts,
  markdownTransforms,
}: LoadContentOptions & {
  site: SiteData;
  pool: MarkdownPool;
  taxonomies: ResolvedTaxonomies;
  routesYaml: RoutesYaml;
  includeDrafts: boolean;
  includeFuturePosts: boolean;
  markdownTransforms: readonly MarkdownTransformHook[];
}): Promise<ContentGraph> {
  // Normalised `build.base_path` is set by the pipeline before `loadContent`
  // runs; defaulting here keeps unit tests that hand-roll a partial config
  // (and skip the pipeline) from blowing up with `undefined`.
  const basePath = config.build.base_path || '/';
  const [authors, tags, posts, pages] = await Promise.all([
    loadAuthors(cwd, config, taxonomies, basePath),
    loadTags(cwd, config, taxonomies, basePath),
    loadPosts(cwd, config, pool, markdownTransforms),
    loadPages(cwd, config, pool, markdownTransforms),
  ]);

  const authorMap = new Map(authors.map((a) => [a.slug, a]));
  const tagMap = new Map(tags.map((t) => [t.slug, t]));

  // Scheduled posts and posts with a future `published_at` must stay hidden
  // until the wall-clock release time has passed. Two distinct gates fold into
  // the same filter:
  //   1. `status: scheduled` — Ghost's embargo workflow. A post staged for
  //      future release that ships on the next build would leak the
  //      announcement via HTML, RSS, and sitemap. Match Ghost by excluding
  //      every scheduled post outright; the author flips it to `published`
  //      when the embargo lifts.
  //   2. `published_at > now()` regardless of status — covers the case where
  //      a contributor sets `status: published` but post-dates the entry to
  //      stagger a launch. Ghost waits for the timestamp; we should too.
  // `include_future_posts` (config) / `includeFuturePosts` (option) is the
  // explicit opt-in for preview deploys that *want* to see embargoed content.
  // Captured once so every post is judged against the same wall-clock instant
  // within a build.
  const nowMs = Date.now();
  const resolvedPosts: Post[] = [];
  const emailOnlyPosts: Post[] = [];
  for (const raw of posts) {
    if (raw.status === 'draft' && !includeDrafts) continue;
    if (!includeFuturePosts) {
      if (raw.status === 'scheduled') continue;
      if (new Date(raw.published_at).getTime() > nowMs) continue;
    }
    const resolved = resolvePostRelations(raw, authorMap, tagMap, site, basePath, taxonomies);
    // Posts with `email_only: true` ship via newsletter only and must not
    // appear in any public aggregate (home, archives, RSS, sitemap, search
    // index, OG generation). Partition them into a separate list here so
    // every downstream consumer of `content.posts` automatically skips them,
    // and the route planner can opt them into `/email-only/<slug>/` stubs
    // via `[build].emit_email_only_stub`. Their permalink is rewritten to
    // the stub URL so theme `<a href="...">` references work whether or not
    // stub emission is on (a missing href would lead to a 404; an
    // `/email-only/<slug>/` href just 404s when stubs are off, matching).
    if (resolved.email_only) {
      resolved.url = joinUrl(site.url, basePath, `/email-only/${resolved.slug}/`);
      emailOnlyPosts.push(resolved);
    } else {
      resolvedPosts.push(resolved);
    }
  }
  resolvedPosts.sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );
  emailOnlyPosts.sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );
  for (let i = 0; i < resolvedPosts.length; i += 1) {
    const current = resolvedPosts[i];
    if (!current) continue;
    current.next = resolvedPosts[i - 1];
    current.prev = resolvedPosts[i + 1];
  }

  // Rewrite `post.url` to honour any `collections:` permalinks declared in
  // routes.yaml. Posts that match no collection keep their slug-based URL,
  // so omitting the section is back-compat. The matching strategy lives in
  // `assignPostUrls` (filter parsing + first-match-wins by descending URL).
  const collections = resolveCollections(routesYaml);
  if (collections.length > 0) {
    const assignments = assignPostUrls(resolvedPosts, collections);
    for (const post of resolvedPosts) {
      const a = assignments.get(post.id);
      if (!a) continue;
      post.url = joinUrl(site.url, basePath, a.urlPath);
    }
  }

  const resolvedPages: Page[] = [];
  for (const raw of pages) {
    if (raw.status === 'draft' && !includeDrafts) continue;
    const resolved = resolvePageRelations(raw, authorMap, tagMap, site, basePath, taxonomies);
    resolvedPages.push(resolved);
  }
  resolvedPages.sort((a, b) => a.title.localeCompare(b.title));

  const allTags = Array.from(tagMap.values());
  const allAuthors = Array.from(authorMap.values());
  // Single pass: iterate posts once and (a) bump per-tag counters via the
  // shared Tag references stored on each post, (b) populate the inverse
  // slug -> Post[] indices used by the route planner. The previous O(T·P)
  // filter blew up on sites with many tags (100k tags x 10k posts ~= 10^9
  // ops just to count). Dedupe slugs per post so duplicate frontmatter
  // entries don't inflate the count or push the same post twice into a
  // bucket, matching the original `some(...)` boolean semantics.
  for (const tag of allTags) {
    tag.count.posts = 0;
  }
  const postsByTag = new Map<string, Post[]>();
  const postsByAuthor = new Map<string, Post[]>();
  for (const tag of allTags) postsByTag.set(tag.slug, []);
  for (const author of allAuthors) postsByAuthor.set(author.slug, []);
  for (const post of resolvedPosts) {
    const seenTags = new Set<string>();
    for (const t of post.tags) {
      if (seenTags.has(t.slug)) continue;
      seenTags.add(t.slug);
      t.count.posts += 1;
      const bucket = postsByTag.get(t.slug);
      if (bucket) bucket.push(post);
    }
    const seenAuthors = new Set<string>();
    for (const a of post.authors) {
      if (seenAuthors.has(a.slug)) continue;
      seenAuthors.add(a.slug);
      const bucket = postsByAuthor.get(a.slug);
      if (bucket) bucket.push(post);
    }
  }

  const tiers = buildTiers(config);

  return {
    posts: resolvedPosts,
    pages: resolvedPages,
    tags: allTags,
    authors: allAuthors,
    tiers,
    bySlug: {
      posts: new Map(resolvedPosts.map((p) => [p.slug, p])),
      pages: new Map(resolvedPages.map((p) => [p.slug, p])),
      tags: tagMap,
      authors: authorMap,
    },
    postsByTag,
    postsByAuthor,
    emailOnlyPosts,
    site,
  };
}

// Derive Ghost-shaped Tier objects from the flat `[[tiers]]` config so themes
// that iterate `{{#get "tiers"}}` see the same `type` / `active` / `visibility`
// fields they expect from Ghost. Slug derivation falls back to a positional
// `tier-N` so two entries with the same display name still get unique ids.
function buildTiers(config: NectarConfig): Tier[] {
  if (config.tiers.length === 0) return [];
  const usedSlugs = new Set<string>();
  return config.tiers.map((entry, index) => {
    const baseSlug = slugify(entry.name, { lower: true, strict: true }) || `tier-${index + 1}`;
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    const monthly = entry.monthly_price;
    const yearly = entry.yearly_price;
    const hasPrice =
      (typeof monthly === 'number' && monthly > 0) || (typeof yearly === 'number' && yearly > 0);
    return {
      id: slug,
      slug,
      name: entry.name,
      description: entry.description,
      type: hasPrice ? 'paid' : 'free',
      active: true,
      visibility: 'public',
      trial_days: 0,
      monthly_price: monthly,
      yearly_price: yearly,
      currency: hasPrice ? entry.currency : undefined,
      welcome_page_url: entry.welcome_page_url,
      benefits: entry.benefits,
    };
  });
}

function buildSite(config: NectarConfig): SiteData {
  // Ghost's Source theme branches sidebar/footer/CTA/navigation on these flags.
  // They drive UI rendering only — Nectar is static-only, so the actual
  // sign-in/signup/account hrefs (#/portal/*) are inert without a Portal
  // script. Tying `members_enabled` to `[components.portal].provider != "none"`
  // lets operators opt-in to the UI shell when they wire their own
  // Portal-compatible backend, while keeping the default config quiet for
  // plain blogs. The `[site].members_*` overrides win when set explicitly so
  // operators can decouple the UI surface from the Portal provider knob.
  const portalEnabled = config.components.portal.provider !== 'none';
  const membersEnabled = config.site.members_enabled ?? portalEnabled;
  const paidEnabled =
    config.site.paid_members_enabled ?? (portalEnabled && config.components.portal.paid);
  const inviteOnly =
    config.site.members_invite_only ?? (portalEnabled && config.components.portal.invite_only);
  // Site-wide code injection mirrors Ghost's site setting. Same opt-in gate as
  // per-post / per-page injection: `build.allow_code_injection` must be true,
  // otherwise we silently drop the value so a copied-in `[site]` block from an
  // untrusted source cannot ship arbitrary script tags through {{ghost_head}}.
  const allowInjection = config.build.allow_code_injection === true;
  const siteCodeHead = allowInjection ? config.site.codeinjection_head : undefined;
  const siteCodeFoot = allowInjection ? config.site.codeinjection_foot : undefined;
  if (!allowInjection && (config.site.codeinjection_head || config.site.codeinjection_foot)) {
    logger.warn(
      'Ignoring [site].codeinjection_head / [site].codeinjection_foot: set build.allow_code_injection = true in nectar.toml to enable site-wide raw HTML/JS injection.',
    );
  }
  return {
    title: config.site.title,
    description: config.site.description,
    url: config.site.url,
    locale: config.site.locale,
    lang: config.site.locale,
    direction: directionForLocale(config.site.locale),
    timezone: config.site.timezone,
    cover_image: config.site.cover_image,
    logo: config.site.logo,
    logo_width: config.site.logo_width,
    logo_height: config.site.logo_height,
    icon: config.site.icon,
    accent_color: config.site.accent_color,
    navigation: config.navigation,
    // Coerce an empty `secondary_navigation` array to `undefined` so theme
    // guards like `{{#unless @site.secondary_navigation}}` (Wave / Alto /
    // London) treat "no secondary nav configured" as falsy. Handlebars treats
    // `[]` as truthy because it's an object — keeping the empty array would
    // make those `unless` blocks silently never render. See issue #324.
    secondary_navigation:
      config.secondary_navigation.length > 0 ? config.secondary_navigation : undefined,
    twitter: config.site.twitter,
    facebook: config.site.facebook,
    members_enabled: membersEnabled,
    paid_members_enabled: paidEnabled,
    members_invite_only: inviteOnly,
    comments_enabled: config.site.comments_enabled,
    // Drives the Source theme's `{{#if @site.recommendations_enabled}}` block
    // that renders the sidebar list and the "See all" portal button. Only flip
    // it on once the user has populated `[[recommendations]]` so empty configs
    // don't ship a dead `/recommendations/` link.
    recommendations_enabled: config.recommendations.length > 0,
    meta_title: config.site.meta_title,
    meta_description: config.site.meta_description,
    og_image: config.site.og_image,
    og_title: config.site.og_title,
    og_description: config.site.og_description,
    twitter_image: config.site.twitter_image,
    twitter_title: config.site.twitter_title,
    twitter_description: config.site.twitter_description,
    codeinjection_head: siteCodeHead,
    codeinjection_foot: siteCodeFoot,
  };
}

interface RawPost {
  id: string;
  slug: string;
  title: string;
  html: string;
  plaintext: string;
  word_count: number;
  reading_time: number;
  excerpt: string;
  custom_excerpt: string | undefined;
  feed_html: string;
  feed_excerpt: string;
  feature_image: string | undefined;
  feature_image_alt: string | undefined;
  feature_image_caption: string | undefined;
  feature_image_width: number | undefined;
  feature_image_height: number | undefined;
  featured: boolean;
  published_at: string;
  updated_at: string;
  created_at: string;
  visibility: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
  status: 'published' | 'draft' | 'scheduled';
  tagSlugs: string[];
  authorSlugs: string[];
  primaryTag: string | undefined;
  primaryAuthor: string | undefined;
  canonical_url: string | undefined;
  meta_title: string | undefined;
  meta_description: string | undefined;
  og_title: string | undefined;
  og_description: string | undefined;
  og_image: string | undefined;
  twitter_title: string | undefined;
  twitter_description: string | undefined;
  twitter_image: string | undefined;
  codeinjection_head: string | undefined;
  codeinjection_foot: string | undefined;
  email_only: boolean;
}

interface RawPage extends Omit<RawPost, 'featured' | 'visibility' | 'email_only'> {
  show_title_and_feature_image: boolean;
  status: 'published' | 'draft';
  custom_template: string | undefined;
}

async function loadPosts(
  cwd: string,
  config: NectarConfig,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
): Promise<RawPost[]> {
  const dir = resolve(cwd, config.content.posts_dir);
  const posts = await loadMarkdownDir(
    dir,
    async (file, raw) => normalizePost(file, raw, cwd, dir, config, pool, transforms),
    config.content.max_markdown_bytes,
  );
  if (config.content.visibility_policy === 'skip') {
    return posts.filter((p) => p.visibility === 'public');
  }
  return posts;
}

async function loadPages(
  cwd: string,
  config: NectarConfig,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
): Promise<RawPage[]> {
  const dir = resolve(cwd, config.content.pages_dir);
  return loadMarkdownDir(
    dir,
    async (file, raw) => normalizePage(file, raw, cwd, dir, config, pool, transforms),
    config.content.max_markdown_bytes,
  );
}

async function loadAuthors(
  cwd: string,
  config: NectarConfig,
  taxonomies: ResolvedTaxonomies,
  basePath: string,
): Promise<Author[]> {
  const dir = resolve(cwd, config.content.authors_dir);
  return loadMarkdownDir(
    dir,
    async (file, raw) => normalizeAuthor(file, raw, config, taxonomies, basePath),
    config.content.max_markdown_bytes,
  );
}

async function loadTags(
  cwd: string,
  config: NectarConfig,
  taxonomies: ResolvedTaxonomies,
  basePath: string,
): Promise<Tag[]> {
  const dir = resolve(cwd, config.content.tags_dir);
  return loadMarkdownDir(
    dir,
    async (file, raw) => normalizeTag(file, raw, config, taxonomies, basePath),
    config.content.max_markdown_bytes,
  );
}

// Cap how many files we read+normalize concurrently. The previous serial loop
// awaited renderMarkdown per post on the main thread (marked.parse is CPU-bound
// and yields a microtask via the async API, sanitize-html runs sync), making a
// 10k-post site spend ~30s+ in this loader alone. Batching with Promise.all
// lets readFile I/O overlap with parsing/sanitising work and keeps the event
// loop saturated. We chunk instead of unbounded Promise.all to avoid exhausting
// file descriptors on very large repos (macOS default ulimit is 256).
const MARKDOWN_LOAD_CONCURRENCY = 32;

// Walks a directory tree for `*.md` files without reading or parsing them.
// Used by `loadContent` to estimate the markdown rendering workload up front so
// the pool can pick between worker and in-process modes. The extra scan is
// cheap compared to a full read+normalize and keeps the pool from spawning
// workers for sites that wouldn't amortise the spawn cost.
async function countMarkdownFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const rels = await scanGlob('**/*.md', { cwd: dir });
  let count = 0;
  for (const rel of rels) {
    if (pathContainsSymlink(dir, rel)) continue;
    count += 1;
  }
  return count;
}

async function loadMarkdownDir<T>(
  dir: string,
  normalize: (filePath: string, raw: string) => Promise<T>,
  maxBytes: number,
): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const rels = await scanGlob('**/*.md', { cwd: dir });
  const files: string[] = [];
  for (const rel of rels) {
    if (pathContainsSymlink(dir, rel)) {
      logger.warn(`Skipping symlinked content path: ${join(dir, rel)}`);
      continue;
    }
    files.push(join(dir, rel));
  }

  const results: T[] = new Array(files.length);
  for (let i = 0; i < files.length; i += MARKDOWN_LOAD_CONCURRENCY) {
    const chunk = files.slice(i, i + MARKDOWN_LOAD_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (file) => {
        await enforceMarkdownSizeLimit(file, maxBytes);
        const raw = await readFile(file, 'utf8');
        try {
          return await normalize(file, raw);
        } catch (err) {
          throw toNectarError(err, { file });
        }
      }),
    );
    for (let j = 0; j < chunkResults.length; j += 1) {
      results[i + j] = chunkResults[j] as T;
    }
  }
  return results;
}

// Stat each `.md` file before `readFile` and refuse to load anything larger
// than `content.max_markdown_bytes`. `marked.parse` is CPU-bound and quadratic
// on some pathological inputs (deeply nested lists / blockquotes), so a
// contributor PR with a 500 MB Markdown body — or a much smaller adversarial
// one — can OOM or hang the build runner. Bun strings cap at 2 GB, and even
// approaching that bound stalls the tokenizer for tens of seconds. Failing fast
// at stat() avoids loading the body into memory at all and gives a useful
// error pointer at the offending path.
async function enforceMarkdownSizeLimit(file: string, maxBytes: number): Promise<void> {
  if (maxBytes <= 0) return;
  const info = await stat(file);
  if (info.size <= maxBytes) return;
  throw new NectarError({
    file,
    message: `Markdown file is ${formatBytes(info.size)}, exceeding the configured limit of ${formatBytes(maxBytes)}.`,
    hint: 'Split the file into smaller documents, raise `content.max_markdown_bytes` in nectar.toml, or set it to 0 to disable the cap.',
    code: 'content',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[i]}`;
}

function slugFromPath(filePath: string, rootDir: string): string {
  const rel = relative(rootDir, filePath);
  const withoutExt = rel.slice(0, rel.length - extname(rel).length);
  const candidate = withoutExt.replaceAll('\\', '/');
  const segment = candidate.split('/').pop() ?? basename(filePath);
  // `slugify` (with `strict: true`) drops underscores, so a file named
  // `_index.md` collapses to an empty slug, making the post unreachable via
  // any generated route (#859). Refuse the file at load time with a clear
  // pointer to the source path so the contributor either renames the file
  // or supplies an explicit `slug:` in frontmatter.
  const slug = slugify(segment, { lower: true, strict: true });
  if (slug.length === 0) {
    throw new NectarError({
      file: filePath,
      message: `Cannot derive a slug from filename ${JSON.stringify(segment)}: produces empty value after sanitization.`,
      hint: 'Rename the file to use ASCII letters/digits (e.g. `my-draft.md`) or add an explicit `slug:` in the frontmatter.',
      code: 'content',
    });
  }
  return slug;
}

// `feature_image_caption` is rendered raw by typical Ghost themes via
// `{{{feature_image_caption}}}`. Strip anything beyond inline formatting at
// load time so unsafe markup in frontmatter cannot reach readers as XSS, even
// if the active theme uses triple-stash. Keep undefined as undefined so the
// "no caption" path stays distinguishable from an empty caption.
function sanitizeFeatureImageCaption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return sanitizeInlineCaptionHtml(value);
}

function sanitizeUserSlug(input: string | undefined, context: string): string | undefined {
  if (input === undefined) return undefined;
  const sanitized = slugify(input, { lower: true, strict: true });
  if (sanitized.length === 0) {
    throw new Error(
      `Invalid slug ${JSON.stringify(input)} in ${context}: produces empty value after sanitization`,
    );
  }
  return sanitized;
}

function sanitizeUserSlugList(values: string[], _context: string): string[] {
  const out: string[] = [];
  for (const v of values) {
    const sanitized = slugify(v, { lower: true, strict: true });
    if (sanitized.length === 0) continue;
    out.push(sanitized);
  }
  return out;
}

async function applyMarkdownTransforms(
  body: string,
  kind: 'post' | 'page',
  filePath: string,
  frontmatter: Record<string, unknown>,
  transforms: readonly MarkdownTransformHook[],
): Promise<string> {
  if (transforms.length === 0) return body;
  let current = body;
  for (const transform of transforms) {
    try {
      const next = await transform(current, { kind, path: filePath, frontmatter });
      // Defensive: a plugin returning `undefined` (or non-string) should not
      // wipe the post body. Treat anything non-string as "leave unchanged" so
      // a buggy transform produces visible-but-recoverable output.
      if (typeof next === 'string') current = next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`markdown transform failed for ${filePath}: ${msg}`);
    }
  }
  return current;
}

async function normalizePost(
  filePath: string,
  raw: string,
  cwd: string,
  rootDir: string,
  config: NectarConfig | undefined,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
  kind: 'post' | 'page' = 'post',
): Promise<RawPost> {
  const { data, body: rawBody } = parseFrontmatter(raw, { filePath });
  const unsafeHtml = asBool(data.unsafe_html, false);
  const locale = config?.site.locale;
  const body = await applyMarkdownTransforms(rawBody, kind, filePath, data, transforms);
  const rendered = await pool.render(body, { unsafe: unsafeHtml, locale });
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} frontmatter slug`) ??
    slugFromPath(filePath, rootDir);
  // Frontmatter `title:` is optional, but a post with no title still has to
  // render something in `<h1>`, `<title>`, and sidebar lists. Fall back to
  // the slug (Ghost does the same) and warn so the contributor sees the
  // synthesised title at build time instead of silently shipping
  // `hello-world` as the visible headline (#857). Also catches `title: ""`
  // and `title:` (yaml null/blank) because `asString('')` returns `''`,
  // which we treat as "missing" here.
  const rawTitle = asString(data.title);
  const title = rawTitle && rawTitle.trim().length > 0 ? rawTitle : slug;
  if (title === slug && (rawTitle === undefined || rawTitle.trim().length === 0)) {
    logger.warn(
      `Missing or empty \`title\` in ${filePath}; using slug ${JSON.stringify(slug)} as the title. Set \`title:\` in frontmatter to silence this warning.`,
    );
  }
  const dateContext = `${filePath}`;
  const published = asDateISO(
    data.date ?? data.published_at,
    new Date().toISOString(),
    `${dateContext} date`,
  );
  const updated = asDateISO(data.updated_at ?? data.date, published, `${dateContext} updated_at`);
  const created = asDateISO(data.created_at ?? data.date, published, `${dateContext} created_at`);
  const status = (asString(data.status) ?? 'published') as RawPost['status'];
  const visibility = parsePostVisibility(asString(data.visibility), filePath);
  const customExcerpt = asString(data.custom_excerpt ?? data.excerpt);

  let html = rendered.html;
  let plaintext = rendered.plaintext;
  let word_count = rendered.word_count;
  let reading_time = rendered.reading_time;
  let feedHtml = html;
  let feedPlaintext = plaintext;
  if (config && isPaywallVisibility(visibility)) {
    const truncated = truncateMarkdownForPaywall(body, config.content.paywall_word_count);
    const reRendered = await pool.render(truncated, { unsafe: unsafeHtml, locale });
    feedHtml = `${reRendered.html}${buildPaywallStub(visibility)}`;
    feedPlaintext = reRendered.plaintext;
    if (config.content.visibility_policy === 'truncate') {
      html = feedHtml;
      plaintext = feedPlaintext;
      word_count = reRendered.word_count;
      reading_time = reRendered.reading_time;
    }
  }

  const featureImage = asString(data.feature_image);
  const explicitWidth = asPositiveInt(data.feature_image_width);
  const explicitHeight = asPositiveInt(data.feature_image_height);
  const dims =
    explicitWidth && explicitHeight
      ? { width: explicitWidth, height: explicitHeight }
      : resolveLocalImageDimensions(featureImage, cwd, config);

  return {
    id: `post-${slug}`,
    slug,
    title,
    html,
    plaintext,
    word_count,
    reading_time,
    excerpt: customExcerpt ?? buildDefaultExcerpt(plaintext, locale),
    custom_excerpt: customExcerpt,
    feed_html: feedHtml,
    feed_excerpt: customExcerpt ?? buildDefaultExcerpt(feedPlaintext, locale),
    feature_image: featureImage,
    feature_image_alt: asString(data.feature_image_alt),
    feature_image_caption: sanitizeFeatureImageCaption(asString(data.feature_image_caption)),
    feature_image_width: explicitWidth ?? dims?.width,
    feature_image_height: explicitHeight ?? dims?.height,
    featured: asBool(data.featured, false),
    published_at: published,
    updated_at: updated,
    created_at: created,
    visibility,
    status,
    tagSlugs: sanitizeUserSlugList(asStringArray(data.tags), `${filePath} frontmatter tags`),
    authorSlugs: sanitizeUserSlugList(
      asStringArray(data.authors ?? data.author),
      `${filePath} frontmatter authors`,
    ),
    primaryTag: sanitizeUserSlug(asString(data.primary_tag), `${filePath} frontmatter primary_tag`),
    primaryAuthor: sanitizeUserSlug(
      asString(data.primary_author),
      `${filePath} frontmatter primary_author`,
    ),
    canonical_url: asString(data.canonical_url),
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    og_title: asString(data.og_title),
    og_description: asString(data.og_description),
    og_image: asString(data.og_image),
    twitter_title: asString(data.twitter_title),
    twitter_description: asString(data.twitter_description),
    twitter_image: asString(data.twitter_image),
    email_only: asBool(data.email_only, false),
    ...resolveCodeInjection(data, filePath, config),
  };
}

// Frontmatter `visibility:` accepts Ghost's full vocabulary, not just the
// public/members/paid tri-state. Ghost also gates a post to specific tiers
// (`tiers`) or via a NQL filter expression (`filter`). Nectar's static runtime
// has no tier-aware viewer, so `tiers` and `filter` render identically to
// `members` (paywall stub in feeds, optional truncation in body) — but we keep
// the exact value on `post.visibility` so themes that branch on it see the
// upstream string. Unknown values fall back to `public` with a warning so a
// typo doesn't silently gate a post. See #325.
const POST_VISIBILITY_VALUES = ['public', 'members', 'paid', 'tiers', 'filter'] as const;
type PostVisibility = (typeof POST_VISIBILITY_VALUES)[number];

function parsePostVisibility(raw: string | undefined, filePath: string): PostVisibility {
  if (raw === undefined) return 'public';
  const value = raw.trim().toLowerCase();
  if ((POST_VISIBILITY_VALUES as readonly string[]).includes(value)) {
    return value as PostVisibility;
  }
  logger.warn(
    `Unknown visibility '${raw}' in ${filePath}; falling back to 'public'. Allowed values: ${POST_VISIBILITY_VALUES.join(', ')}.`,
  );
  return 'public';
}

function isPaywallVisibility(visibility: PostVisibility): visibility is PaywallVisibility {
  return (
    visibility === 'members' ||
    visibility === 'paid' ||
    visibility === 'tiers' ||
    visibility === 'filter'
  );
}

// `codeinjection_head` / `codeinjection_foot` get spliced verbatim into every
// rendered page via `{{ghost_head}}` / `{{ghost_foot}}`. Treat them as raw HTML
// injection and gate behind `build.allow_code_injection` (default false) so a
// contributor PR cannot ship site-wide `<script>` by adding a single frontmatter
// field. When disallowed, drop the value and warn so the misconfiguration is
// visible at build time instead of silently shipping unsanitized markup.
function resolveCodeInjection(
  data: Record<string, unknown>,
  filePath: string,
  config: NectarConfig | undefined,
): { codeinjection_head: string | undefined; codeinjection_foot: string | undefined } {
  const head = asString(data.codeinjection_head);
  const foot = asString(data.codeinjection_foot);
  const allow = config?.build?.allow_code_injection ?? false;
  if (!allow && (head !== undefined || foot !== undefined)) {
    logger.warn(
      `Ignoring codeinjection_head/codeinjection_foot in ${filePath}: set build.allow_code_injection = true in nectar.toml to enable raw HTML/JS injection from frontmatter.`,
    );
    return { codeinjection_head: undefined, codeinjection_foot: undefined };
  }
  return { codeinjection_head: head, codeinjection_foot: foot };
}

async function normalizePage(
  filePath: string,
  raw: string,
  cwd: string,
  rootDir: string,
  config: NectarConfig | undefined,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
): Promise<RawPage> {
  const base = await normalizePost(filePath, raw, cwd, rootDir, config, pool, transforms, 'page');
  const { data } = parseFrontmatter(raw, { filePath });
  return {
    ...base,
    show_title_and_feature_image: asBool(data.show_title_and_feature_image, true),
    status: base.status === 'draft' ? 'draft' : 'published',
    custom_template: sanitizeCustomTemplate(
      asString(data.template ?? data.custom_template),
      filePath,
    ),
  };
}

// Ghost admins select a `custom-{slug}.hbs` per page from a dropdown. We accept
// the slug via frontmatter `template:` (or `custom_template:`), normalize to the
// canonical `custom-<slug>` form, and reject anything that could escape the
// theme's template namespace (path separators, traversal, leading dots). The
// final theme lookup happens in `planRoutes`, which falls back to `page.hbs`
// when the resolved template doesn't exist.
function sanitizeCustomTemplate(value: string | undefined, filePath: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const base = trimmed.startsWith('custom-') ? trimmed.slice('custom-'.length) : trimmed;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) {
    logger.warn(
      `Ignoring custom template ${JSON.stringify(value)} in ${filePath}: must match [a-z0-9][a-z0-9-]*`,
    );
    return undefined;
  }
  return `custom-${base}`;
}

async function normalizeAuthor(
  filePath: string,
  raw: string,
  config: NectarConfig,
  taxonomies: ResolvedTaxonomies,
  basePath: string,
): Promise<Author> {
  const { data, body } = parseFrontmatter(raw, { filePath });
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} author slug`) ??
    slugify(basename(filePath, extname(filePath)), { lower: true, strict: true });
  const name = asString(data.name) ?? slug;
  const bio = asString(data.bio) ?? body.trim();
  return {
    id: `author-${slug}`,
    slug,
    name,
    bio,
    profile_image: asString(data.profile_image),
    cover_image: asString(data.cover_image),
    website: asString(data.website),
    location: asString(data.location),
    twitter: asString(data.twitter),
    facebook: asString(data.facebook),
    linkedin: asString(data.linkedin),
    bluesky: asString(data.bluesky),
    mastodon: asString(data.mastodon),
    threads: asString(data.threads),
    tiktok: asString(data.tiktok),
    youtube: asString(data.youtube),
    instagram: asString(data.instagram),
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    url: taxonomyArchiveUrl(config.site.url, basePath, taxonomies, 'author', slug),
  };
}

async function normalizeTag(
  filePath: string,
  raw: string,
  config: NectarConfig,
  taxonomies: ResolvedTaxonomies,
  basePath: string,
): Promise<Tag> {
  const { data } = parseFrontmatter(raw, { filePath });
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} tag slug`) ??
    slugify(basename(filePath, extname(filePath)), { lower: true, strict: true });
  const name = asString(data.name) ?? slug;
  return {
    id: `tag-${slug}`,
    slug,
    name,
    description: asString(data.description) ?? '',
    feature_image: asString(data.feature_image),
    visibility: slug.startsWith('hash-') ? 'internal' : 'public',
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    url: taxonomyArchiveUrl(config.site.url, basePath, taxonomies, 'tag', slug),
    count: { posts: 0 },
  };
}

// Resolves an in-repo image URL (e.g. `/content/images/foo.svg`) to a file
// path under the configured assets_dir and reads its intrinsic dimensions.
// Returns undefined for remote URLs, absolute filesystem references, or any
// path that escapes the assets root.
function resolveLocalImageDimensions(
  featureImage: string | undefined,
  cwd: string,
  config: NectarConfig | undefined,
): { width: number; height: number } | undefined {
  if (!featureImage || !config) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(featureImage)) return undefined;
  const marker = '/content/images/';
  const idx = featureImage.indexOf(marker);
  if (idx < 0) return undefined;
  const rest = featureImage.slice(idx + marker.length).split(/[?#]/)[0] ?? '';
  if (rest === '' || rest.includes('..')) return undefined;
  const assetsRoot = resolve(cwd, config.content.assets_dir);
  const filePath = join(assetsRoot, rest);
  const rel = relative(assetsRoot, filePath);
  if (rel.startsWith('..') || rel.includes(`..${'/'}`)) return undefined;
  if (!existsSync(filePath)) return undefined;
  const dims = readImageDimensions(filePath);
  if (!dims) {
    logger.warn(`Could not determine image dimensions for ${filePath}`);
  }
  return dims;
}

function resolvePostRelations(
  raw: RawPost,
  authors: Map<string, Author>,
  tags: Map<string, Tag>,
  site: SiteData,
  basePath: string,
  taxonomies: ResolvedTaxonomies,
): Post {
  const tagList = resolveTagSlugs(raw.tagSlugs, tags, site, basePath, taxonomies);
  const authorList = resolveAuthorSlugs(raw.authorSlugs, authors, site, basePath, taxonomies);
  const primary_tag = raw.primaryTag ? tagList.find((t) => t.slug === raw.primaryTag) : tagList[0];
  const primary_author = raw.primaryAuthor
    ? authorList.find((a) => a.slug === raw.primaryAuthor)
    : authorList[0];
  const url = joinUrl(site.url, basePath, `/${raw.slug}/`);

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    html: raw.html,
    plaintext: raw.plaintext,
    excerpt: raw.excerpt,
    custom_excerpt: raw.custom_excerpt,
    feature_image: raw.feature_image,
    feature_image_alt: raw.feature_image_alt,
    feature_image_caption: raw.feature_image_caption,
    feature_image_width: raw.feature_image_width,
    feature_image_height: raw.feature_image_height,
    featured: raw.featured,
    page: false,
    published_at: raw.published_at,
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    reading_time: raw.reading_time,
    word_count: raw.word_count,
    visibility: raw.visibility,
    status: raw.status,
    email_only: raw.email_only,
    tags: tagList,
    primary_tag,
    authors: authorList,
    primary_author,
    url,
    canonical_url: raw.canonical_url,
    meta_title: raw.meta_title,
    meta_description: raw.meta_description,
    og_title: raw.og_title,
    og_description: raw.og_description,
    og_image: raw.og_image,
    twitter_title: raw.twitter_title,
    twitter_description: raw.twitter_description,
    twitter_image: raw.twitter_image,
    codeinjection_head: raw.codeinjection_head,
    codeinjection_foot: raw.codeinjection_foot,
    comments: true,
    // Anonymous viewer in a static build: the current reader never has access
    // to gated content, so themes branching on `{{#unless this.access}}` take
    // the locked branch. See `Post.access` doc comment for the helper /
    // `ctx.access` split.
    access: false,
    prev: undefined,
    next: undefined,
    feed_html: raw.feed_html,
    feed_excerpt: raw.feed_excerpt,
  };
}

function resolvePageRelations(
  raw: RawPage,
  authors: Map<string, Author>,
  tags: Map<string, Tag>,
  site: SiteData,
  basePath: string,
  taxonomies: ResolvedTaxonomies,
): Page {
  const tagList = resolveTagSlugs(raw.tagSlugs, tags, site, basePath, taxonomies);
  const authorList = resolveAuthorSlugs(raw.authorSlugs, authors, site, basePath, taxonomies);
  const primary_tag = raw.primaryTag ? tagList.find((t) => t.slug === raw.primaryTag) : tagList[0];
  const primary_author = raw.primaryAuthor
    ? authorList.find((a) => a.slug === raw.primaryAuthor)
    : authorList[0];
  const url = joinUrl(site.url, basePath, `/${raw.slug}/`);

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    html: raw.html,
    plaintext: raw.plaintext,
    excerpt: raw.excerpt,
    custom_excerpt: raw.custom_excerpt,
    feature_image: raw.feature_image,
    feature_image_alt: raw.feature_image_alt,
    feature_image_caption: raw.feature_image_caption,
    feature_image_width: raw.feature_image_width,
    feature_image_height: raw.feature_image_height,
    page: true,
    published_at: raw.published_at,
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    reading_time: raw.reading_time,
    word_count: raw.word_count,
    visibility: 'public',
    status: raw.status,
    tags: tagList,
    primary_tag,
    authors: authorList,
    primary_author,
    url,
    canonical_url: raw.canonical_url,
    meta_title: raw.meta_title,
    meta_description: raw.meta_description,
    og_title: raw.og_title,
    og_description: raw.og_description,
    og_image: raw.og_image,
    twitter_title: raw.twitter_title,
    twitter_description: raw.twitter_description,
    twitter_image: raw.twitter_image,
    codeinjection_head: raw.codeinjection_head,
    codeinjection_foot: raw.codeinjection_foot,
    show_title_and_feature_image: raw.show_title_and_feature_image,
    custom_template: raw.custom_template,
    access: false,
  };
}

// Module-level dedupe sets so a tag/author referenced by ten posts only
// produces one warning per build (#860). Cleared at the start of every
// `loadContent` call so back-to-back builds (e.g. `nectar dev` watch mode)
// re-emit the warning if the offending content is still present.
const warnedAutoTagSlugs = new Set<string>();
const warnedAutoAuthorSlugs = new Set<string>();

export function resetAutoCreationWarnings(): void {
  warnedAutoTagSlugs.clear();
  warnedAutoAuthorSlugs.clear();
}

function resolveTagSlugs(
  slugs: string[],
  tags: Map<string, Tag>,
  site: SiteData,
  basePath: string,
  taxonomies: ResolvedTaxonomies,
): Tag[] {
  return slugs.map((slug) => {
    const existing = tags.get(slug);
    if (existing) return existing;
    // A post references a tag slug that has no `content/tags/<slug>.md`
    // file. Auto-create a stub so the post still renders, but warn once
    // per build so a typo (`neews` vs `news`) doesn't silently ship a
    // phantom tag archive with one post. Internal tags (`hash-*`) are
    // legitimate stubs in Ghost workflows, so they're auto-created
    // without a warning.
    if (!warnedAutoTagSlugs.has(slug) && !slug.startsWith('hash-')) {
      warnedAutoTagSlugs.add(slug);
      logger.warn(
        `Auto-creating tag ${JSON.stringify(slug)} referenced by post frontmatter but missing a content/tags/${slug}.md file. Add the file (or fix the typo) to silence this warning.`,
      );
    }
    const created: Tag = {
      id: `tag-${slug}`,
      slug,
      name: titleCase(slug),
      description: '',
      feature_image: undefined,
      visibility: slug.startsWith('hash-') ? 'internal' : 'public',
      meta_title: undefined,
      meta_description: undefined,
      url: taxonomyArchiveUrl(site.url, basePath, taxonomies, 'tag', slug),
      count: { posts: 0 },
    };
    tags.set(slug, created);
    return created;
  });
}

function resolveAuthorSlugs(
  slugs: string[],
  authors: Map<string, Author>,
  site: SiteData,
  basePath: string,
  taxonomies: ResolvedTaxonomies,
): Author[] {
  return slugs.map((slug) => {
    const existing = authors.get(slug);
    if (existing) return existing;
    // Mirror of the tag path above: warn once per build when an author
    // slug appears in frontmatter without a backing `content/authors/<slug>.md`.
    // Without the warning a misspelled byline silently grows an entire
    // phantom `/author/<slug>/` archive route.
    if (!warnedAutoAuthorSlugs.has(slug)) {
      warnedAutoAuthorSlugs.add(slug);
      logger.warn(
        `Auto-creating author ${JSON.stringify(slug)} referenced by post frontmatter but missing a content/authors/${slug}.md file. Add the file (or fix the typo) to silence this warning.`,
      );
    }
    const created: Author = {
      id: `author-${slug}`,
      slug,
      name: titleCase(slug),
      bio: '',
      profile_image: undefined,
      cover_image: undefined,
      website: undefined,
      location: undefined,
      twitter: undefined,
      facebook: undefined,
      linkedin: undefined,
      bluesky: undefined,
      mastodon: undefined,
      threads: undefined,
      tiktok: undefined,
      youtube: undefined,
      instagram: undefined,
      meta_title: undefined,
      meta_description: undefined,
      url: taxonomyArchiveUrl(site.url, basePath, taxonomies, 'author', slug),
    };
    authors.set(slug, created);
    return created;
  });
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// Compose an external URL by inserting `basePath` between the host and the
// route-relative `path`. Centralised here so every `*.url` on the content
// graph (post, page, tag, author) reflects the normalised `build.base_path`.
// Inputs:
//  - `base` is `site.url`, with or without a trailing slash.
//  - `basePath` is the normalised `'/'` or `'/segment/.../'` shape.
//  - `path` is root-relative (e.g. `'/post-slug/'`) -- the leading slash is
//    optional; we tolerate both shapes so callers stay free of base_path
//    hygiene.
function joinUrl(base: string, basePath: string, path: string): string {
  if (!base) return path;
  const prefix = basePath && basePath !== '/' ? basePath : '/';
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const composed = prefix === '/' ? `/${clean}` : `${prefix}${clean}`;
  return new URL(composed, base.endsWith('/') ? base : `${base}/`).toString();
}

// `plaintext.slice(0, 200)` cut by code-unit count, which means 200 Japanese
// characters (a much denser unit than 200 English characters) for CJK posts and
// inconsistent excerpt length across scripts. Take the first 50 word-like
// segments instead so excerpts are roughly comparable regardless of language.
const DEFAULT_EXCERPT_WORDS = 50;
function buildDefaultExcerpt(plaintext: string, locale: string | undefined): string {
  return truncateByWords(plaintext, DEFAULT_EXCERPT_WORDS, locale);
}
