import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import slugify from 'slugify';
import type { NectarConfig } from '~/config/schema.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import type { ContentGraph } from '~/content/model.ts';
import { pathContainsSymlink } from '~/util/fs.ts';

export type LintLevel = 'error' | 'warning';

export interface LintIssue {
  level: LintLevel;
  code: string;
  message: string;
  file?: string;
}

export interface LintReport {
  errors: LintIssue[];
  warnings: LintIssue[];
}

export interface LintContentOptions {
  cwd: string;
  config: NectarConfig;
  content: ContentGraph;
}

// Known frontmatter keys per content kind, mirroring everything the loader reads
// in `normalizePost` / `normalizePage` / `normalizeAuthor` / `normalizeTag`.
// Anything outside these sets is flagged as an unknown key so typos like
// `tittle` or `feature-image` surface during `nectar check` instead of silently
// being ignored at render time.
const POST_KEYS: ReadonlySet<string> = new Set([
  'slug',
  'title',
  'date',
  'published_at',
  'updated_at',
  'created_at',
  'status',
  'visibility',
  'custom_excerpt',
  'excerpt',
  'unsafe_html',
  'feature_image',
  'feature_image_alt',
  'feature_image_caption',
  'feature_image_width',
  'feature_image_height',
  'featured',
  'tags',
  'authors',
  'author',
  'primary_tag',
  'primary_author',
  'canonical_url',
  'meta_title',
  'meta_description',
  'og_title',
  'og_description',
  'og_image',
  'twitter_title',
  'twitter_description',
  'twitter_image',
  'codeinjection_head',
  'codeinjection_foot',
]);

const PAGE_KEYS: ReadonlySet<string> = new Set([
  ...POST_KEYS,
  'show_title_and_feature_image',
  'template',
  'custom_template',
]);

const AUTHOR_KEYS: ReadonlySet<string> = new Set([
  'slug',
  'name',
  'bio',
  'profile_image',
  'cover_image',
  'website',
  'location',
  'twitter',
  'facebook',
  'linkedin',
  'bluesky',
  'mastodon',
  'threads',
  'tiktok',
  'youtube',
  'instagram',
  'meta_title',
  'meta_description',
]);

const TAG_KEYS: ReadonlySet<string> = new Set([
  'slug',
  'name',
  'description',
  'feature_image',
  'meta_title',
  'meta_description',
]);

const DATE_KEYS: ReadonlyArray<string> = ['date', 'published_at', 'updated_at', 'created_at'];

interface FrontmatterFile {
  file: string;
  rawSlug: string | undefined;
  slug: string;
  data: Record<string, unknown>;
}

export async function lintContent(opts: LintContentOptions): Promise<LintReport> {
  const issues: LintIssue[] = [];

  const postFiles = await collectFrontmatter(opts.cwd, opts.config.content.posts_dir);
  const pageFiles = await collectFrontmatter(opts.cwd, opts.config.content.pages_dir);
  const authorFiles = await collectFrontmatter(opts.cwd, opts.config.content.authors_dir);
  const tagFiles = await collectFrontmatter(opts.cwd, opts.config.content.tags_dir);

  for (const f of postFiles) issues.push(...lintFrontmatter(f, POST_KEYS, 'title'));
  for (const f of pageFiles) issues.push(...lintFrontmatter(f, PAGE_KEYS, 'title'));
  for (const f of authorFiles) issues.push(...lintFrontmatter(f, AUTHOR_KEYS, 'name'));
  for (const f of tagFiles) issues.push(...lintFrontmatter(f, TAG_KEYS, 'name'));

  issues.push(...checkDuplicateSlugs(postFiles, 'post'));
  issues.push(...checkDuplicateSlugs(pageFiles, 'page'));
  issues.push(...checkDuplicateSlugs(authorFiles, 'author'));
  issues.push(...checkDuplicateSlugs(tagFiles, 'tag'));

  issues.push(...checkAssetReferences(opts.cwd, opts.config, opts.content));
  issues.push(...checkNavigation(opts.config, opts.content));

  return splitIssues(issues);
}

function splitIssues(issues: LintIssue[]): LintReport {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  for (const i of issues) {
    if (i.level === 'error') errors.push(i);
    else warnings.push(i);
  }
  return { errors, warnings };
}

async function collectFrontmatter(cwd: string, dir: string): Promise<FrontmatterFile[]> {
  const absDir = join(cwd, dir);
  if (!existsSync(absDir)) return [];
  const glob = new Bun.Glob('**/*.md');
  const out: FrontmatterFile[] = [];
  for await (const rel of glob.scan({ cwd: absDir })) {
    if (pathContainsSymlink(absDir, rel)) continue;
    const file = join(absDir, rel);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    let data: Record<string, unknown>;
    try {
      ({ data } = parseFrontmatter(raw, { filePath: file }));
    } catch {
      // parseFrontmatter throws on malformed YAML; the loader surfaces that
      // before lint runs, so skip here instead of double-reporting.
      continue;
    }
    const rawSlug = typeof data.slug === 'string' ? data.slug : undefined;
    const slug = resolveSlug(rawSlug, file, absDir);
    out.push({ file, rawSlug, slug, data });
  }
  return out;
}

// Mirrors how `loader.ts` derives the slug after sanitization. We replicate it
// here so duplicate detection lines up with what actually lands in the
// content graph (where the second slug-collision silently overwrites the first).
function resolveSlug(rawSlug: string | undefined, file: string, rootDir: string): string {
  if (rawSlug !== undefined) {
    const sanitized = slugify(rawSlug, { lower: true, strict: true });
    if (sanitized.length > 0) return sanitized;
  }
  const rel = relative(rootDir, file);
  const withoutExt = rel.slice(0, rel.length - extname(rel).length);
  const candidate = withoutExt.replaceAll('\\', '/');
  return slugify(candidate.split('/').pop() ?? basename(file), { lower: true, strict: true });
}

function lintFrontmatter(
  f: FrontmatterFile,
  knownKeys: ReadonlySet<string>,
  requiredKey: 'title' | 'name',
): LintIssue[] {
  const issues: LintIssue[] = [];

  const requiredValue = f.data[requiredKey];
  if (typeof requiredValue !== 'string' || requiredValue.trim() === '') {
    issues.push({
      level: 'warning',
      code: `missing-${requiredKey}`,
      message: `Missing or empty required frontmatter '${requiredKey}'; loader will derive a fallback from the slug.`,
      file: f.file,
    });
  }

  for (const key of Object.keys(f.data)) {
    if (!knownKeys.has(key)) {
      issues.push({
        level: 'warning',
        code: 'unknown-frontmatter',
        message: `Unknown frontmatter key '${key}'; this field is ignored. Check for a typo or move it under a known key.`,
        file: f.file,
      });
    }
  }

  for (const key of DATE_KEYS) {
    if (!knownKeys.has(key)) continue;
    const value = f.data[key];
    if (value === undefined || value === null) continue;
    if (value instanceof Date) continue;
    if (typeof value !== 'string') {
      issues.push({
        level: 'warning',
        code: 'malformed-date',
        message: `Frontmatter '${key}' is a ${typeof value}; expected an ISO date string or YAML date.`,
        file: f.file,
      });
      continue;
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      issues.push({
        level: 'warning',
        code: 'malformed-date',
        message: `Frontmatter '${key}'=${JSON.stringify(value)} is not a parseable date.`,
        file: f.file,
      });
    }
  }

  return issues;
}

function checkDuplicateSlugs(files: FrontmatterFile[], kind: string): LintIssue[] {
  const bySlug = new Map<string, FrontmatterFile[]>();
  for (const f of files) {
    const bucket = bySlug.get(f.slug);
    if (bucket) bucket.push(f);
    else bySlug.set(f.slug, [f]);
  }
  const issues: LintIssue[] = [];
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    const paths = group.map((g) => g.file).join(', ');
    for (const g of group) {
      issues.push({
        level: 'error',
        code: 'duplicate-slug',
        message: `Duplicate ${kind} slug '${slug}' shared by: ${paths}. Only one entry will ship; set distinct 'slug:' frontmatter to keep the rest.`,
        file: g.file,
      });
    }
  }
  return issues;
}

// Asset references we surface as warnings when the underlying file is missing
// from `content.assets_dir`. Only checks site-relative `/content/images/...`
// URLs — remote URLs and other absolute paths are skipped because Nectar
// neither owns nor can verify them at build time.
function checkAssetReferences(
  cwd: string,
  config: NectarConfig,
  content: ContentGraph,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const assetsRoot = join(cwd, config.content.assets_dir);

  const report = (url: string | undefined, owner: string): void => {
    if (!isLocalContentImage(url)) return;
    const rel = stripImageMarker(url);
    if (rel === undefined) return;
    const file = join(assetsRoot, rel);
    if (existsSync(file)) return;
    issues.push({
      level: 'warning',
      code: 'missing-asset',
      message: `${owner} references image '${url}' but ${file} is missing on disk.`,
    });
  };

  for (const post of content.posts) {
    report(post.feature_image, `Post '${post.slug}'`);
    report(post.og_image, `Post '${post.slug}' og_image`);
    report(post.twitter_image, `Post '${post.slug}' twitter_image`);
  }
  for (const page of content.pages) {
    report(page.feature_image, `Page '${page.slug}'`);
    report(page.og_image, `Page '${page.slug}' og_image`);
    report(page.twitter_image, `Page '${page.slug}' twitter_image`);
  }
  for (const author of content.authors) {
    report(author.profile_image, `Author '${author.slug}' profile_image`);
    report(author.cover_image, `Author '${author.slug}' cover_image`);
  }
  for (const tag of content.tags) {
    report(tag.feature_image, `Tag '${tag.slug}' feature_image`);
  }
  report(content.site.cover_image, "Site 'cover_image'");
  report(content.site.logo, "Site 'logo'");
  report(content.site.icon, "Site 'icon'");

  return issues;
}

function isLocalContentImage(url: string | undefined): boolean {
  if (!url) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  if (url.startsWith('//')) return false;
  return url.includes('/content/images/');
}

function stripImageMarker(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const marker = '/content/images/';
  const idx = url.indexOf(marker);
  if (idx < 0) return undefined;
  const rest = url.slice(idx + marker.length).split(/[?#]/)[0] ?? '';
  if (rest === '' || rest.includes('..')) return undefined;
  return rest;
}

// Navigation URLs that look like site-internal paths (start with `/`, not `//`,
// no protocol) but don't map to a known post / page / tag / author / homepage
// get reported. Anchors (`#foo`), query strings, and absolute URLs are skipped.
function checkNavigation(config: NectarConfig, content: ContentGraph): LintIssue[] {
  const issues: LintIssue[] = [];

  const check = (group: string, items: ReadonlyArray<{ label: string; url: string }>): void => {
    for (const item of items) {
      const reason = resolveInternalRoute(item.url, content);
      if (reason === undefined) continue;
      issues.push({
        level: 'warning',
        code: 'navigation-dead-link',
        message: `${group} item '${item.label}' (url='${item.url}') ${reason}`,
      });
    }
  };

  check('Primary navigation', config.navigation);
  check('Secondary navigation', config.secondary_navigation);
  return issues;
}

// Returns undefined when the URL is fine (external, anchor, or matches a known
// internal route), otherwise the human-readable reason why it's flagged.
function resolveInternalRoute(url: string, content: ContentGraph): string | undefined {
  if (!url) return 'is empty.';
  if (url.startsWith('#')) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  if (url.startsWith('//')) return undefined;
  if (!url.startsWith('/')) return undefined;

  const path = url.split(/[?#]/)[0] ?? '';
  if (path === '/' || path === '') return undefined;
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return undefined;
  const segments = trimmed.split('/');

  if (segments[0] === 'tag' && segments.length === 2 && segments[1]) {
    if (content.bySlug.tags.has(segments[1])) return undefined;
    return `points at /tag/${segments[1]}/ but no tag with that slug exists.`;
  }
  if (segments[0] === 'author' && segments.length === 2 && segments[1]) {
    if (content.bySlug.authors.has(segments[1])) return undefined;
    return `points at /author/${segments[1]}/ but no author with that slug exists.`;
  }
  if (segments.length === 1) {
    const slug = segments[0] ?? '';
    if (content.bySlug.posts.has(slug)) return undefined;
    if (content.bySlug.pages.has(slug)) return undefined;
    // Permissively skip well-known generated routes that aren't in the content
    // graph but are emitted by the build pipeline.
    if (KNOWN_GENERATED_ROUTES.has(slug)) return undefined;
    return `points at /${slug}/ but no post or page with that slug exists.`;
  }
  // Deeper paths (custom archives, RSS, etc.) aren't worth dead-link-checking
  // statically — the user owns the routing config there. Stay quiet.
  return undefined;
}

const KNOWN_GENERATED_ROUTES: ReadonlySet<string> = new Set([
  'rss',
  'rss.xml',
  'sitemap',
  'sitemap.xml',
  'feed',
  'feed.xml',
  'recommendations',
  'search',
  '404',
  'page',
]);
