import { createHash } from 'node:crypto';
import { type Stats, existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import slugify from 'slugify';
import { assignPostUrls } from '~/build/permalinks.ts';
import {
  type ResolvedTaxonomies,
  type RoutesYaml,
  type TrailingSlashPolicy,
  applyTaxonomyTemplate,
  canonicalRouteUrl,
  emptyRoutesYaml,
  resolveCollections,
  resolveTaxonomies,
} from '~/build/routes-yaml.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { NectarError, formatNectarError, toNectarError } from '~/util/errors.ts';
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
import {
  findInvalidKoenigShortcode,
  findMalformedKoenigShortcode,
  invalidKoenigShortcodeMessage,
  malformedKoenigShortcodeMessage,
  sanitizeInlineCaptionHtml,
  truncateByWords,
} from './markdown.ts';
import type {
  Author,
  ContentGraph,
  ContentSourceFingerprint,
  Page,
  Post,
  SiteData,
  Tag,
  Tier,
} from './model.ts';
import { type PaywallVisibility, buildPaywallStub, truncateMarkdownForPaywall } from './paywall.ts';
import { renderMarkdownWithCache } from './render-cache.ts';

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

interface ContentDir {
  dir: string;
  locale: string | undefined;
  localized: boolean;
}

interface LocaleFields {
  locale: string;
  localeSource: 'frontmatter' | 'path' | 'site';
}

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
// Model URLs stay path-only so `{{url}}` can render relative links by default
// and `{{url absolute=true}}` can choose when to resolve against `site.url`.
function taxonomyArchiveUrl(
  basePath: string,
  taxonomies: ResolvedTaxonomies,
  kind: 'tag' | 'author',
  slug: string,
  trailingSlash: TrailingSlashPolicy,
  routePrefix = '/',
): string {
  const template = taxonomies[kind];
  if (template === undefined) return '';
  return joinRoutePath(
    basePath,
    joinRouteSegments(routePrefix, applyTaxonomyTemplate(template, slug)),
    trailingSlash,
  );
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
  const [postDirs, pageDirs] = await Promise.all([
    discoverContentDirs(cwd, config.content.posts_dir),
    discoverContentDirs(cwd, config.content.pages_dir),
  ]);
  const [postCount, pageCount] = await Promise.all([
    countMarkdownFilesInDirs(postDirs),
    countMarkdownFilesInDirs(pageDirs),
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
  const [rawAuthors, rawTags, posts, pages] = await Promise.all([
    loadAuthors(cwd, config),
    loadTags(cwd, config),
    loadPosts(cwd, config, pool, markdownTransforms),
    loadPages(cwd, config, pool, markdownTransforms),
  ]);

  const localeInfo = resolveLocaleRouting(config.site.locale, [
    ...rawAuthors,
    ...rawTags,
    ...posts,
    ...pages,
  ]);
  const localePrefix = (locale: string): string =>
    localeInfo.routing ? canonicalRouteUrl(`/${locale}/`, config.build.trailing_slash) : '/';
  const authors = rawAuthors.map((raw) =>
    normalizeAuthor(raw, config, taxonomies, basePath, localePrefix(raw.locale)),
  );
  const tags = rawTags.map((raw) =>
    normalizeTag(raw, config, taxonomies, basePath, localePrefix(raw.locale)),
  );

  const authorMap = new Map(authors.map((a) => [localizedKey(a.locale, a.slug), a]));
  const tagMap = new Map(tags.map((t) => [localizedKey(t.locale, t.slug), t]));
  const tiers = buildTiers(config);

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
    const resolved = resolvePostRelations(
      raw,
      authorMap,
      tagMap,
      config.site.url,
      basePath,
      localePrefix(raw.locale),
      config.site.locale,
      taxonomies,
      config.build.trailing_slash,
      tiers,
    );
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
      resolved.url = joinRoutePath(
        basePath,
        joinRouteSegments(
          localePrefix(resolved.locale ?? config.site.locale),
          `/email-only/${resolved.slug}/`,
        ),
        config.build.trailing_slash,
      );
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
      const prefix = localePrefix(post.locale ?? config.site.locale);
      post.url = joinRoutePath(
        basePath,
        localeInfo.routing ? joinRouteSegments(prefix, a.urlPath) : a.urlPath,
        config.build.trailing_slash,
      );
    }
  }

  const resolvedPages: Page[] = [];
  for (const raw of pages) {
    if (raw.status === 'draft' && !includeDrafts) continue;
    const resolved = resolvePageRelations(
      raw,
      authorMap,
      tagMap,
      config.site.url,
      basePath,
      localePrefix(raw.locale),
      config.site.locale,
      taxonomies,
      config.build.trailing_slash,
    );
    resolvedPages.push(resolved);
  }
  resolvedPages.sort((a, b) => a.title.localeCompare(b.title));

  const allTags = Array.from(tagMap.values());
  const allAuthors = Array.from(authorMap.values());
  // Single pass: iterate posts once and (a) bump per-tag/per-author counters
  // via the shared references stored on each post, (b) populate the inverse
  // slug -> Post[] indices used by the route planner. The previous O(T·P)
  // filter blew up on sites with many tags (100k tags x 10k posts ~= 10^9
  // ops just to count). Dedupe slugs per post so duplicate frontmatter
  // entries don't inflate the count or push the same post twice into a
  // bucket, matching the original `some(...)` boolean semantics.
  for (const tag of allTags) {
    tag.count.posts = 0;
  }
  for (const author of allAuthors) {
    author.count.posts = 0;
  }
  const postsByTag = new Map<string, Post[]>();
  const postsByAuthor = new Map<string, Post[]>();
  for (const tag of allTags) {
    postsByTag.set(localizedKey(localeInfo.routing ? tag.locale : undefined, tag.slug), []);
  }
  for (const author of allAuthors) {
    postsByAuthor.set(
      localizedKey(localeInfo.routing ? author.locale : undefined, author.slug),
      [],
    );
  }
  for (const post of resolvedPosts) {
    const seenTags = new Set<string>();
    for (const t of post.tags) {
      const key = localizedKey(localeInfo.routing ? t.locale : undefined, t.slug);
      if (seenTags.has(key)) continue;
      seenTags.add(key);
      t.count.posts += 1;
      const bucket = postsByTag.get(key);
      if (bucket) bucket.push(post);
    }
    const seenAuthors = new Set<string>();
    for (const a of post.authors) {
      const key = localizedKey(localeInfo.routing ? a.locale : undefined, a.slug);
      if (seenAuthors.has(key)) continue;
      seenAuthors.add(key);
      a.count.posts += 1;
      const bucket = postsByAuthor.get(key);
      if (bucket) bucket.push(post);
    }
  }

  const rawPostsById = new Map(posts.map((post) => [post.id, post]));
  const rawPagesById = new Map(pages.map((page) => [page.id, page]));
  const rawTagsById = new Map(rawTags.map((tag) => [tag.id, tag]));
  const rawAuthorsById = new Map(rawAuthors.map((author) => [author.id, author]));

  return {
    posts: resolvedPosts,
    pages: resolvedPages,
    tags: allTags,
    authors: allAuthors,
    tiers,
    bySlug: {
      posts: new Map(resolvedPosts.map((p) => [p.slug, p])),
      pages: new Map(resolvedPages.map((p) => [p.slug, p])),
      tags: publicBySlugMap(tags),
      authors: publicBySlugMap(authors),
    },
    postsByTag,
    postsByAuthor,
    sources: {
      posts: new Map(
        [...resolvedPosts, ...emailOnlyPosts]
          .map((post) => [post.id, rawPostsById.get(post.id)?.source] as const)
          .filter(
            (entry): entry is readonly [string, ContentSourceFingerprint] => entry[1] !== undefined,
          ),
      ),
      pages: new Map(
        resolvedPages
          .map((page) => [page.id, rawPagesById.get(page.id)?.source] as const)
          .filter(
            (entry): entry is readonly [string, ContentSourceFingerprint] => entry[1] !== undefined,
          ),
      ),
      tags: new Map(
        tags
          .map((tag) => [tag.id, rawTagsById.get(tag.id)?.source] as const)
          .filter(
            (entry): entry is readonly [string, ContentSourceFingerprint] => entry[1] !== undefined,
          ),
      ),
      authors: new Map(
        authors
          .map((author) => [author.id, rawAuthorsById.get(author.id)?.source] as const)
          .filter(
            (entry): entry is readonly [string, ContentSourceFingerprint] => entry[1] !== undefined,
          ),
      ),
    },
    emailOnlyPosts,
    site: { ...site, locales: localeInfo.locales, localeRouting: localeInfo.routing },
    locales: localeInfo.locales,
    localeRouting: localeInfo.routing,
  };
}

function localizedKey(locale: string | undefined, slug: string): string {
  return locale ? `${locale}\u0000${slug}` : slug;
}

function deterministicObjectId(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);
}

function deterministicUuidV5(namespace: string, name: string): string {
  const digest = createHash('sha1').update(`${namespace}\u0000${name}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicContentUuid(siteUrl: string, kind: 'post' | 'page', path: string): string {
  const namespace = deterministicUuidV5('nectar:site', siteUrl.replace(/\/+$/, ''));
  return deterministicUuidV5(namespace, `${kind}:${path}`);
}

function publicBySlugMap<T extends { slug: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.slug, item]));
}

function resolveLocaleRouting(
  siteLocale: string,
  items: readonly LocaleFields[],
): { locales: string[]; routing: boolean } {
  const seen = new Set<string>();
  const locales: string[] = [];
  const add = (locale: string) => {
    if (seen.has(locale)) return;
    seen.add(locale);
    locales.push(locale);
  };
  add(siteLocale);
  let explicitLocale = false;
  for (const item of items) {
    add(item.locale);
    if (item.localeSource !== 'site') explicitLocale = true;
  }
  const rest = locales.slice(1).sort((a, b) => a.localeCompare(b));
  const ordered = [locales[0] ?? siteLocale, ...rest];
  return { locales: ordered, routing: explicitLocale || ordered.length > 1 };
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

function resolvePostTiers(tierSlugs: readonly string[], tiers: readonly Tier[]): Tier[] {
  if (tierSlugs.length === 0) return [];
  const bySlug = new Map(tiers.map((tier) => [tier.slug, tier]));
  const out: Tier[] = [];
  const seen = new Set<string>();
  for (const slug of tierSlugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(bySlug.get(slug) ?? tierStub(slug));
  }
  return out;
}

function tierStub(slug: string): Tier {
  return {
    id: slug,
    slug,
    name: slug
      .split('-')
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' '),
    description: '',
    type: 'free',
    active: true,
    visibility: 'public',
    trial_days: 0,
    monthly_price: undefined,
    yearly_price: undefined,
    currency: undefined,
    welcome_page_url: undefined,
    benefits: [],
  };
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
  const buildMetadata =
    Object.keys(config.build.metadata).length > 0 ? config.build.metadata : undefined;
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
    referrer_policy: config.site.referrer_policy,
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
    comments_access: config.site.comments_access,
    stripe_publishable_key: config.site.stripe_publishable_key,
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
    build: buildMetadata,
  };
}

interface RawPost {
  id: string;
  slug: string;
  locale: string;
  localeSource: 'frontmatter' | 'path' | 'site';
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
  tierSlugs: string[];
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
  custom_template: string | undefined;
  email_only: boolean;
  source: ContentSourceFingerprint;
}

interface RawPage extends Omit<RawPost, 'featured' | 'visibility' | 'email_only'> {
  show_title_and_feature_image: boolean;
  status: 'published' | 'draft';
  custom_template: string | undefined;
}

interface RawAuthor extends LocaleFields {
  id: string;
  slug: string;
  name: string;
  bio: string;
  profile_image: string | undefined;
  cover_image: string | undefined;
  website: string | undefined;
  location: string | undefined;
  twitter: string | undefined;
  facebook: string | undefined;
  linkedin: string | undefined;
  bluesky: string | undefined;
  mastodon: string | undefined;
  threads: string | undefined;
  tiktok: string | undefined;
  youtube: string | undefined;
  instagram: string | undefined;
  meta_title: string | undefined;
  meta_description: string | undefined;
  source: ContentSourceFingerprint;
}

interface RawTag extends LocaleFields {
  id: string;
  slug: string;
  name: string;
  description: string;
  feature_image: string | undefined;
  accent_color: string | undefined;
  visibility: 'public' | 'internal';
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
  source: ContentSourceFingerprint;
}

async function loadPosts(
  cwd: string,
  config: NectarConfig,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
): Promise<RawPost[]> {
  const dirs = await discoverContentDirs(cwd, config.content.posts_dir);
  const posts = await loadMarkdownDirs(
    dirs,
    async (file, raw, dir, sourceStat, source) =>
      normalizePost(
        file,
        raw,
        sourceStat,
        cwd,
        dir.dir,
        config,
        pool,
        transforms,
        'post',
        dir.locale,
        source,
      ),
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
  const dirs = await discoverContentDirs(cwd, config.content.pages_dir);
  return loadMarkdownDirs(
    dirs,
    async (file, raw, dir, sourceStat, source) =>
      normalizePage(
        file,
        raw,
        sourceStat,
        cwd,
        dir.dir,
        config,
        pool,
        transforms,
        dir.locale,
        source,
      ),
    config.content.max_markdown_bytes,
  );
}

async function loadAuthors(cwd: string, config: NectarConfig): Promise<RawAuthor[]> {
  const dirs = await discoverContentDirs(cwd, config.content.authors_dir);
  return loadMarkdownDirs(
    dirs,
    async (file, raw, dir, _sourceStat, source) =>
      normalizeRawAuthor(file, raw, config, dir.locale, source),
    config.content.max_markdown_bytes,
  );
}

async function loadTags(cwd: string, config: NectarConfig): Promise<RawTag[]> {
  const dirs = await discoverContentDirs(cwd, config.content.tags_dir);
  return loadMarkdownDirs(
    dirs,
    async (file, raw, dir, _sourceStat, source) =>
      normalizeRawTag(file, raw, config, dir.locale, source),
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

async function countMarkdownFilesInDirs(dirs: readonly ContentDir[]): Promise<number> {
  const counts = await Promise.all(dirs.map((dir) => countMarkdownFiles(dir.dir)));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function discoverContentDirs(cwd: string, configuredDir: string): Promise<ContentDir[]> {
  const legacyDir = resolve(cwd, configuredDir);
  const parent = dirname(legacyDir);
  const leaf = basename(legacyDir);
  const dirs: ContentDir[] = [{ dir: legacyDir, locale: undefined, localized: false }];
  const seen = new Set([legacyDir]);
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isLocaleTag(entry.name)) continue;
    const localizedDir = join(parent, entry.name, leaf);
    if (seen.has(localizedDir)) continue;
    seen.add(localizedDir);
    dirs.push({ dir: localizedDir, locale: entry.name, localized: true });
  }
  return dirs;
}

async function loadMarkdownDirs<T>(
  dirs: readonly ContentDir[],
  normalize: (
    filePath: string,
    raw: string,
    dir: ContentDir,
    sourceStat: Stats,
    source: ContentSourceFingerprint,
  ) => Promise<T | undefined>,
  maxBytes: number,
): Promise<T[]> {
  const chunks = await Promise.all(
    dirs.map((dir) =>
      loadMarkdownDir(
        dir.dir,
        (file, raw, sourceStat, source) => normalize(file, raw, dir, sourceStat, source),
        maxBytes,
      ),
    ),
  );
  return chunks.flat();
}

async function loadMarkdownDir<T>(
  dir: string,
  normalize: (
    filePath: string,
    raw: string,
    sourceStat: Stats,
    source: ContentSourceFingerprint,
  ) => Promise<T | undefined>,
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

  const results: T[] = [];
  for (let i = 0; i < files.length; i += MARKDOWN_LOAD_CONCURRENCY) {
    const chunk = files.slice(i, i + MARKDOWN_LOAD_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (file) => {
        const sourceStat = await enforceMarkdownSizeLimit(file, maxBytes);
        const raw = await readFile(file, 'utf8');
        const source = contentSourceFingerprint(file, dir, sourceStat);
        try {
          return await normalize(file, raw, sourceStat, source);
        } catch (err) {
          throw toNectarError(err, { file });
        }
      }),
    );
    for (const result of chunkResults) {
      if (result !== undefined) results.push(result);
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
async function enforceMarkdownSizeLimit(file: string, maxBytes: number): Promise<Stats> {
  const info = await stat(file);
  if (maxBytes <= 0) return info;
  if (info.size <= maxBytes) return info;
  throw new NectarError({
    file,
    message: `Markdown file is ${formatBytes(info.size)}, exceeding the configured limit of ${formatBytes(maxBytes)}.`,
    hint: 'Split the file into smaller documents, raise `content.max_markdown_bytes` in nectar.toml, or set it to 0 to disable the cap.',
    code: 'content',
  });
}

function contentSourceFingerprint(
  filePath: string,
  rootDir: string,
  info: Stats,
): ContentSourceFingerprint {
  return {
    path: relative(rootDir, filePath).replaceAll('\\', '/'),
    mtimeMs: Math.round(info.mtimeMs * 1000) / 1000,
    size: info.size,
  };
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

function isLocaleTag(value: string | undefined): value is string {
  return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(value ?? '');
}

function resolveContentLocale(
  data: Record<string, unknown>,
  filePath: string,
  pathLocale: string | undefined,
  siteLocale: string,
): LocaleFields {
  const frontmatterLocale = asString(data.locale);
  if (frontmatterLocale !== undefined) {
    if (!isLocaleTag(frontmatterLocale)) {
      logger.warn(
        `Ignoring invalid locale ${JSON.stringify(frontmatterLocale)} in ${filePath}; expected a BCP 47 language tag.`,
      );
    } else {
      if (pathLocale !== undefined && pathLocale !== frontmatterLocale) {
        logger.warn(
          `Locale mismatch in ${filePath}: path locale ${JSON.stringify(pathLocale)} differs from frontmatter locale ${JSON.stringify(frontmatterLocale)}; using frontmatter locale.`,
        );
      }
      return { locale: frontmatterLocale, localeSource: 'frontmatter' };
    }
  }
  if (pathLocale !== undefined) return { locale: pathLocale, localeSource: 'path' };
  return { locale: siteLocale, localeSource: 'site' };
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
  sourceStat: Stats,
  cwd: string,
  rootDir: string,
  config: NectarConfig | undefined,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
  kind: 'post' | 'page' = 'post',
  pathLocale?: string,
  source?: ContentSourceFingerprint,
): Promise<RawPost | undefined> {
  const { data, body: rawBody } = parseFrontmatter(raw, { filePath });
  const unsafeHtml = asBool(data.unsafe_html, false);
  const locale = config?.site.locale;
  const contentLocale = resolveContentLocale(data, filePath, pathLocale, locale ?? 'en');
  const body = await applyMarkdownTransforms(rawBody, kind, filePath, data, transforms);
  if (
    warnAndSkipInvalidKoenigShortcode({
      body,
      bodyStartLine: sourceBodyStartLine(raw, rawBody),
      cwd,
      filePath,
    })
  ) {
    return undefined;
  }
  const featureImage = asString(data.feature_image);
  const renderOptions = {
    unsafe: unsafeHtml,
    locale: contentLocale.locale,
    additionalImages: featureImage ? 1 : 0,
    prioritizeFirstImage: !featureImage,
  };
  const rendered = await renderMarkdownWithCache({
    cwd,
    sourcePath: filePath,
    sourceStat,
    body,
    options: renderOptions,
    render: () => pool.render(body, renderOptions),
  });
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
  // Match Ghost Content API semantics: `custom_excerpt` is the editor-managed
  // field, while `excerpt` is generated below from it or from plaintext.
  const customExcerpt = asString(data.custom_excerpt);

  let html = rendered.html;
  let plaintext = rendered.plaintext;
  let word_count = rendered.word_count;
  let reading_time = rendered.reading_time;
  let feedHtml = html;
  let feedPlaintext = plaintext;
  if (config && isPaywallVisibility(visibility)) {
    const truncated = truncateMarkdownForPaywall(body, config.content.paywall_word_count);
    const reRenderOptions = {
      unsafe: unsafeHtml,
      locale: contentLocale.locale,
      prioritizeFirstImage: !featureImage,
    };
    const reRendered = await renderMarkdownWithCache({
      cwd,
      sourcePath: filePath,
      sourceStat,
      body: truncated,
      options: reRenderOptions,
      render: () => pool.render(truncated, reRenderOptions),
    });
    feedHtml = `${reRendered.html}${buildPaywallStub(visibility)}`;
    feedPlaintext = reRendered.plaintext;
    if (config.content.visibility_policy === 'truncate') {
      html = feedHtml;
      plaintext = feedPlaintext;
      word_count = reRendered.word_count;
      reading_time = reRendered.reading_time;
    }
  }

  const explicitWidth = asPositiveInt(data.feature_image_width);
  const explicitHeight = asPositiveInt(data.feature_image_height);
  const dims =
    explicitWidth && explicitHeight
      ? { width: explicitWidth, height: explicitHeight }
      : resolveLocalImageDimensions(featureImage, cwd, config);

  return {
    id: deterministicObjectId(kind, contentLocale.locale, slug, published),
    slug,
    locale: contentLocale.locale,
    localeSource: contentLocale.localeSource,
    title,
    html,
    plaintext,
    word_count,
    reading_time,
    excerpt: customExcerpt ?? buildDefaultExcerpt(plaintext, contentLocale.locale),
    custom_excerpt: customExcerpt,
    feed_html: feedHtml,
    feed_excerpt: customExcerpt ?? buildDefaultExcerpt(feedPlaintext, contentLocale.locale),
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
    tierSlugs: sanitizeUserSlugList(asStringArray(data.tiers), `${filePath} frontmatter tiers`),
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
    custom_template: sanitizeCustomTemplate(
      asString(data.template ?? data.custom_template),
      filePath,
    ),
    email_only: asBool(data.email_only, false),
    source: source ?? contentSourceFingerprint(filePath, rootDir, await stat(filePath)),
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
  sourceStat: Stats,
  cwd: string,
  rootDir: string,
  config: NectarConfig | undefined,
  pool: MarkdownPool,
  transforms: readonly MarkdownTransformHook[],
  pathLocale?: string,
  source?: ContentSourceFingerprint,
): Promise<RawPage | undefined> {
  const base = await normalizePost(
    filePath,
    raw,
    sourceStat,
    cwd,
    rootDir,
    config,
    pool,
    transforms,
    'page',
    pathLocale,
    source,
  );
  if (!base) return undefined;
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

function warnAndSkipInvalidKoenigShortcode(opts: {
  body: string;
  bodyStartLine: number;
  cwd: string;
  filePath: string;
}): boolean {
  try {
    const malformed = findMalformedKoenigShortcode(opts.body);
    if (malformed) {
      logger.warn(
        formatNectarError(
          new NectarError({
            file: opts.filePath,
            line: opts.bodyStartLine + malformed.line - 1,
            col: malformed.col,
            message: malformedKoenigShortcodeMessage(malformed),
            hint: 'Close the shortcode or remove the malformed card block. This entry was skipped so the rest of the site can continue building.',
            code: 'content',
          }),
          { cwd: opts.cwd },
        ),
      );
      return true;
    }

    const invalid = findInvalidKoenigShortcode(opts.body);
    if (invalid) {
      logger.warn(
        formatNectarError(
          new NectarError({
            file: opts.filePath,
            line: opts.bodyStartLine + invalid.line - 1,
            col: invalid.col,
            message: invalidKoenigShortcodeMessage(invalid),
            hint: `${invalid.hint ?? 'Fix the shortcode schema issue.'} This entry was skipped so the rest of the site can continue building.`,
            code: 'content',
          }),
          { cwd: opts.cwd },
        ),
      );
      return true;
    }

    return false;
  } catch (err) {
    throw toNectarError(err, { file: opts.filePath });
  }
}

function sourceBodyStartLine(raw: string, body: string): number {
  const index = raw.indexOf(body);
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (raw.charCodeAt(i) === 10) line += 1;
  }
  return line;
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

async function normalizeRawAuthor(
  filePath: string,
  raw: string,
  config: NectarConfig,
  pathLocale: string | undefined,
  source?: ContentSourceFingerprint,
): Promise<RawAuthor> {
  const { data, body } = parseFrontmatter(raw, { filePath });
  const locale = resolveContentLocale(data, filePath, pathLocale, config.site.locale);
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} author slug`) ??
    slugify(basename(filePath, extname(filePath)), { lower: true, strict: true });
  const name = asString(data.name) ?? slug;
  const bio = asString(data.bio) ?? body.trim();
  return {
    id: deterministicObjectId('author', locale.locale, slug),
    slug,
    locale: locale.locale,
    localeSource: locale.localeSource,
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
    source: source ?? contentSourceFingerprint(filePath, dirname(filePath), await stat(filePath)),
  };
}

function normalizeAuthor(
  raw: RawAuthor,
  config: NectarConfig,
  taxonomies: ResolvedTaxonomies,
  basePath: string,
  routePrefix: string,
): Author {
  return {
    id: raw.id,
    slug: raw.slug,
    locale: raw.locale,
    name: raw.name,
    bio: raw.bio,
    profile_image: raw.profile_image,
    cover_image: raw.cover_image,
    website: raw.website,
    location: raw.location,
    twitter: raw.twitter,
    facebook: raw.facebook,
    linkedin: raw.linkedin,
    bluesky: raw.bluesky,
    mastodon: raw.mastodon,
    threads: raw.threads,
    tiktok: raw.tiktok,
    youtube: raw.youtube,
    instagram: raw.instagram,
    meta_title: raw.meta_title,
    meta_description: raw.meta_description,
    url: taxonomyArchiveUrl(
      basePath,
      taxonomies,
      'author',
      raw.slug,
      config.build.trailing_slash,
      routePrefix,
    ),
    count: { posts: 0 },
  };
}

async function normalizeRawTag(
  filePath: string,
  raw: string,
  config: NectarConfig,
  pathLocale: string | undefined,
  source?: ContentSourceFingerprint,
): Promise<RawTag> {
  const { data } = parseFrontmatter(raw, { filePath });
  const locale = resolveContentLocale(data, filePath, pathLocale, config.site.locale);
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} tag slug`) ??
    slugify(basename(filePath, extname(filePath)), { lower: true, strict: true });
  const name = asString(data.name) ?? slug;
  return {
    id: deterministicObjectId('tag', locale.locale, slug),
    slug,
    locale: locale.locale,
    localeSource: locale.localeSource,
    name,
    description: asString(data.description) ?? '',
    feature_image: asString(data.feature_image),
    accent_color: asString(data.accent_color),
    visibility: slug.startsWith('hash-') ? 'internal' : 'public',
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    og_title: asString(data.og_title),
    og_description: asString(data.og_description),
    og_image: asString(data.og_image),
    twitter_title: asString(data.twitter_title),
    twitter_description: asString(data.twitter_description),
    twitter_image: asString(data.twitter_image),
    ...resolveCodeInjection(data, filePath, config),
    source: source ?? contentSourceFingerprint(filePath, dirname(filePath), await stat(filePath)),
  };
}

function normalizeTag(
  raw: RawTag,
  config: NectarConfig,
  taxonomies: ResolvedTaxonomies,
  basePath: string,
  routePrefix: string,
): Tag {
  return {
    id: raw.id,
    slug: raw.slug,
    locale: raw.locale,
    name: raw.name,
    description: raw.description,
    feature_image: raw.feature_image,
    accent_color: raw.accent_color,
    visibility: raw.visibility,
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
    url: taxonomyArchiveUrl(
      basePath,
      taxonomies,
      'tag',
      raw.slug,
      config.build.trailing_slash,
      routePrefix,
    ),
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
  siteUrl: string,
  basePath: string,
  routePrefix: string,
  siteLocale: string,
  taxonomies: ResolvedTaxonomies,
  trailingSlash: TrailingSlashPolicy,
  tiers: readonly Tier[],
): Post {
  const tagList = resolveTagSlugs(
    raw.tagSlugs,
    tags,
    basePath,
    routePrefix,
    raw.locale,
    siteLocale,
    taxonomies,
    trailingSlash,
  );
  const authorList = resolveAuthorSlugs(
    raw.authorSlugs,
    authors,
    basePath,
    routePrefix,
    raw.locale,
    siteLocale,
    taxonomies,
    trailingSlash,
  );
  const primary_tag = raw.primaryTag ? tagList.find((t) => t.slug === raw.primaryTag) : tagList[0];
  const primary_author = raw.primaryAuthor
    ? authorList.find((a) => a.slug === raw.primaryAuthor)
    : authorList[0];
  const url = joinRoutePath(
    basePath,
    joinRouteSegments(routePrefix, `/${raw.slug}/`),
    trailingSlash,
  );

  return {
    id: raw.id,
    uuid: deterministicContentUuid(siteUrl, 'post', url),
    slug: raw.slug,
    locale: raw.locale,
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
    tiers: resolvePostTiers(raw.tierSlugs, tiers),
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
    custom_template: raw.custom_template,
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
  siteUrl: string,
  basePath: string,
  routePrefix: string,
  siteLocale: string,
  taxonomies: ResolvedTaxonomies,
  trailingSlash: TrailingSlashPolicy,
): Page {
  const tagList = resolveTagSlugs(
    raw.tagSlugs,
    tags,
    basePath,
    routePrefix,
    raw.locale,
    siteLocale,
    taxonomies,
    trailingSlash,
  );
  const authorList = resolveAuthorSlugs(
    raw.authorSlugs,
    authors,
    basePath,
    routePrefix,
    raw.locale,
    siteLocale,
    taxonomies,
    trailingSlash,
  );
  const primary_tag = raw.primaryTag ? tagList.find((t) => t.slug === raw.primaryTag) : tagList[0];
  const primary_author = raw.primaryAuthor
    ? authorList.find((a) => a.slug === raw.primaryAuthor)
    : authorList[0];
  const url = joinRoutePath(
    basePath,
    joinRouteSegments(routePrefix, `/${raw.slug}/`),
    trailingSlash,
  );

  return {
    id: raw.id,
    uuid: deterministicContentUuid(siteUrl, 'page', url),
    slug: raw.slug,
    locale: raw.locale,
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
  basePath: string,
  routePrefix: string,
  locale: string,
  siteLocale: string,
  taxonomies: ResolvedTaxonomies,
  trailingSlash: TrailingSlashPolicy,
): Tag[] {
  return slugs.map((slug) => {
    const key = localizedKey(locale, slug);
    const existing = tags.get(key) ?? tags.get(localizedKey(siteLocale, slug));
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
      id: deterministicObjectId('tag', locale, slug),
      slug,
      locale,
      name: titleCase(slug),
      description: '',
      feature_image: undefined,
      accent_color: undefined,
      visibility: slug.startsWith('hash-') ? 'internal' : 'public',
      meta_title: undefined,
      meta_description: undefined,
      og_title: undefined,
      og_description: undefined,
      og_image: undefined,
      twitter_title: undefined,
      twitter_description: undefined,
      twitter_image: undefined,
      codeinjection_head: undefined,
      codeinjection_foot: undefined,
      url: taxonomyArchiveUrl(basePath, taxonomies, 'tag', slug, trailingSlash, routePrefix),
      count: { posts: 0 },
    };
    tags.set(key, created);
    return created;
  });
}

function resolveAuthorSlugs(
  slugs: string[],
  authors: Map<string, Author>,
  basePath: string,
  routePrefix: string,
  locale: string,
  siteLocale: string,
  taxonomies: ResolvedTaxonomies,
  trailingSlash: TrailingSlashPolicy,
): Author[] {
  return slugs.map((slug) => {
    const key = localizedKey(locale, slug);
    const existing = authors.get(key) ?? authors.get(localizedKey(siteLocale, slug));
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
      id: deterministicObjectId('author', locale, slug),
      slug,
      locale,
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
      url: taxonomyArchiveUrl(basePath, taxonomies, 'author', slug, trailingSlash, routePrefix),
      count: { posts: 0 },
    };
    authors.set(key, created);
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

// Compose a path by inserting `basePath` before the route-relative `path`.
// Centralised here so every `*.url` on the content graph (post, page, tag,
// author) reflects the normalised `build.base_path` without committing to an
// absolute origin.
// Inputs:
//  - `basePath` is the normalised `'/'` or `'/segment/.../'` shape.
//  - `path` is root-relative (e.g. `'/post-slug/'`) -- the leading slash is
//    optional; we tolerate both shapes so callers stay free of base_path
//    hygiene.
function joinPathWithBase(basePath: string, path: string): string {
  const prefix = basePath && basePath !== '/' ? basePath : '/';
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return prefix === '/' ? `/${clean}` : `${prefix}${clean}`;
}

function joinRouteSegments(prefix: string, path: string): string {
  const cleanPrefix = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanPrefix}${cleanPath}` || '/';
}

function joinRoutePath(basePath: string, path: string, trailingSlash: TrailingSlashPolicy): string {
  return joinPathWithBase(basePath, canonicalRouteUrl(path, trailingSlash));
}

// `plaintext.slice(0, 200)` cut by code-unit count, which means 200 Japanese
// characters (a much denser unit than 200 English characters) for CJK posts and
// inconsistent excerpt length across scripts. Take the first 50 word-like
// segments instead so excerpts are roughly comparable regardless of language.
const DEFAULT_EXCERPT_WORDS = 50;
function buildDefaultExcerpt(plaintext: string, locale: string | undefined): string {
  return truncateByWords(plaintext, DEFAULT_EXCERPT_WORDS, locale);
}
