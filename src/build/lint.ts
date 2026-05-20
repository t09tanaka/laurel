import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import slugify from 'slugify';
import type { NectarConfig } from '~/config/schema.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import type { ContentGraph } from '~/content/model.ts';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { findMissingAssetReferences, formatMissingAssetReference } from './asset-references.ts';

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
  // Opt-in: scan markdown bodies for relative `.md` cross-links and
  // relative image references; flag any that don't resolve on disk.
  // Off by default because it re-reads every post/page body during `check`.
  checkLinks?: boolean;
  // Opt-in: probe every external http/https URL (navigation, plus body links
  // when checkLinks is also on) with a HEAD request; flag non-2xx/timeouts.
  // Off by default because it requires the network and is slow.
  checkExternal?: boolean;
  // Internal seam so tests can stub fetch without hitting the network.
  externalFetch?: ExternalFetch;
  // Per-URL timeout for external probes; defaults to 5s.
  externalTimeoutMs?: number;
}

export type ExternalFetch = (
  url: string,
  signal: AbortSignal,
) => Promise<{ ok: boolean; status: number }>;

// Known frontmatter keys per content kind, mirroring everything the loader reads
// in `normalizePost` / `normalizePage` / `normalizeAuthor` / `normalizeTag`.
// Anything outside these sets is flagged as an unknown key so typos like
// `tittle` or `feature-image` surface during `nectar check` instead of silently
// being ignored at render time.
const POST_KEYS: ReadonlySet<string> = new Set([
  'uuid',
  'slug',
  'title',
  'date',
  'published_at',
  'updated_at',
  'created_at',
  'status',
  'visibility',
  'tiers',
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
  'accent_color',
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

const DATE_KEYS: ReadonlyArray<string> = ['date', 'published_at', 'updated_at', 'created_at'];

interface FrontmatterFile {
  file: string;
  rawSlug: string | undefined;
  slug: string;
  data: Record<string, unknown>;
  body: string;
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

  const externalUrls: string[] = collectExternalNavUrls(opts.config);
  if (opts.checkLinks) {
    const internal = checkInternalLinks(opts.cwd, opts.config, [...postFiles, ...pageFiles]);
    issues.push(...internal.issues);
    externalUrls.push(...internal.externalUrls);
  }
  if (opts.checkExternal) {
    issues.push(
      ...(await checkExternalLinks(externalUrls, opts.externalFetch, opts.externalTimeoutMs)),
    );
  }

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
  const absDir = resolve(cwd, dir);
  if (!existsSync(absDir)) return [];
  const allRels = await scanGlob('**/*.md', { cwd: absDir });
  const files = allRels
    .filter((rel) => !pathContainsSymlink(absDir, rel))
    .map((rel) => join(absDir, rel));
  // Read every markdown body in parallel; lint runs alongside the loader on the
  // same content tree so matching the loader's batching keeps the CLI's lint
  // command from being I/O-bound on large sites.
  const raws = await Promise.all(
    files.map(async (file) => {
      try {
        return await readFile(file, 'utf8');
      } catch {
        return null;
      }
    }),
  );
  const out: FrontmatterFile[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const raw = raws[i];
    if (file === undefined || raw === null || raw === undefined) continue;
    let data: Record<string, unknown>;
    let body: string;
    try {
      ({ data, body } = parseFrontmatter(raw, { filePath: file }));
    } catch {
      // parseFrontmatter throws on malformed YAML; the loader surfaces that
      // before lint runs, so skip here instead of double-reporting.
      continue;
    }
    const rawSlug = typeof data.slug === 'string' ? data.slug : undefined;
    const slug = resolveSlug(rawSlug, file, absDir);
    out.push({ file, rawSlug, slug, data, body });
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
  return findMissingAssetReferences({ cwd, config, content }).map((ref) => ({
    level: 'warning',
    code: 'missing-asset',
    message: formatMissingAssetReference(ref),
  }));
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
  // Ghost splits its sitemap into per-kind sub-files (and `-2.xml` overflows
  // beyond 50k URLs). Whitelist the bare names so the dead-link checker
  // doesn't flag any literal/relative reference to them from theme markup.
  'sitemap-posts.xml',
  'sitemap-pages.xml',
  'sitemap-tags.xml',
  'sitemap-authors.xml',
  'feed',
  'feed.xml',
  'recommendations',
  'search',
  '404',
  'page',
]);

interface InternalLinkScan {
  issues: LintIssue[];
  externalUrls: string[];
}

// Walks every post / page body once, surfaces broken `[text](./foo.md)` style
// cross-links plus broken relative image references, and as a side effect
// hands back the http/https URLs so `--check-external` doesn't need a second pass.
function checkInternalLinks(
  cwd: string,
  config: NectarConfig,
  files: FrontmatterFile[],
): InternalLinkScan {
  const issues: LintIssue[] = [];
  const externalUrls: string[] = [];

  const knownMd = new Set<string>();
  for (const f of files) knownMd.add(resolve(f.file));

  const assetsRoot = resolve(cwd, config.content.assets_dir);
  const projectRoot = resolve(cwd);

  for (const f of files) {
    const bodyNoCode = stripCodeBlocks(f.body);
    const dir = dirname(f.file);
    for (const link of extractMarkdownLinks(bodyNoCode)) {
      const { url, isImage } = link;
      if (!url) continue;
      if (url.startsWith('#')) continue;
      if (url.startsWith('mailto:') || url.startsWith('tel:')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
        if (/^https?:/i.test(url)) externalUrls.push(url);
        continue;
      }

      const pathPart = url.split(/[?#]/)[0] ?? '';
      if (!pathPart) continue;

      const target = url.startsWith('/')
        ? resolve(projectRoot, `.${pathPart}`)
        : resolve(dir, pathPart);

      if (/\.md$/i.test(pathPart)) {
        if (!knownMd.has(target)) {
          issues.push({
            level: 'warning',
            code: 'broken-link',
            message: `Markdown link '${url}' in ${f.file} does not resolve to a known post or page (looked for ${target}).`,
            file: f.file,
          });
        }
        continue;
      }

      if (isImage || isImageExtension(pathPart)) {
        const candidates = [target];
        if (url.startsWith('/')) candidates.push(resolve(assetsRoot, pathPart.replace(/^\/+/, '')));
        if (!candidates.some((c) => existsSync(c))) {
          issues.push({
            level: 'warning',
            code: 'broken-image-link',
            message: `Image reference '${url}' in ${f.file} does not exist on disk.`,
            file: f.file,
          });
        }
      }
    }
  }

  return { issues, externalUrls };
}

function collectExternalNavUrls(config: NectarConfig): string[] {
  const urls: string[] = [];
  for (const item of [...config.navigation, ...config.secondary_navigation]) {
    if (/^https?:/i.test(item.url)) urls.push(item.url);
  }
  return urls;
}

async function checkExternalLinks(
  rawUrls: string[],
  fetcher: ExternalFetch | undefined,
  timeoutMs: number | undefined,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];
  const unique = [...new Set(rawUrls)];
  if (unique.length === 0) return issues;

  const timeout = timeoutMs ?? 5000;
  const probe = fetcher ?? defaultHeadProbe;

  const results = await Promise.allSettled(
    unique.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await probe(url, controller.signal);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && r.status === 'rejected') {
      const url = unique[i] ?? '';
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      issues.push({
        level: 'warning',
        code: 'external-link-broken',
        message: `External URL '${url}' failed: ${reason}.`,
      });
    }
  }

  return issues;
}

async function defaultHeadProbe(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number }> {
  // HEAD first; some hosts reject it, so fall back to GET on 405 / 501.
  let res = await fetch(url, { method: 'HEAD', signal, redirect: 'follow' });
  if (res.status === 405 || res.status === 501) {
    res = await fetch(url, { method: 'GET', signal, redirect: 'follow' });
  }
  return { ok: res.ok, status: res.status };
}

interface ExtractedLink {
  url: string;
  isImage: boolean;
}

// Minimal markdown link extractor — handles `[text](url)`, `![alt](url)`, and
// `<https://…>` autolinks. Title attributes (`"…"`) are stripped from the URL.
function extractMarkdownLinks(body: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const re = /(!?)\[(?:[^\]]|\\.)*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  for (const m of body.matchAll(re)) {
    const url = m[2];
    if (!url) continue;
    out.push({ url, isImage: m[1] === '!' });
  }
  const auto = /<(https?:[^>\s]+)>/g;
  for (const m of body.matchAll(auto)) {
    const url = m[1];
    if (url) out.push({ url, isImage: false });
  }
  return out;
}

// Drop fenced and inline code so links living inside code samples aren't
// reported. We also drop indented code blocks (4-space) to keep noise down.
function stripCodeBlocks(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function isImageExtension(pathPart: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)$/i.test(pathPart);
}
