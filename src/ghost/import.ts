import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import TOML from '@iarna/toml';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import slugify from 'slugify';
import { pLimit } from '~/util/concurrency.ts';
import { ensureDir, pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { sanitizeImageAssetBytes } from '~/util/image-sanitization.ts';
import { logger } from '~/util/logger.ts';
import { GhostImageDownloader, isRootRelativeGhostContentAssetPath } from './image-downloader.ts';
import { renderLexicalToHtml } from './lexical-renderer.ts';
import { renderMobiledocToHtml } from './mobiledoc-renderer.ts';
import { type SlugChange, loadRedirectsJson, writeRedirectMaps } from './redirects.ts';
import { createGhostTurndown, preprocessKoenigCardFences } from './turndown-rules.ts';
import { stripGhostUrlPlaceholder } from './url-placeholder.ts';
import { GhostUrlRewriter } from './url-rewriter.ts';

export type OnConflict = 'skip' | 'overwrite' | 'rename';

export const ON_CONFLICT_VALUES: readonly OnConflict[] = ['skip', 'overwrite', 'rename'];

// Default cap on Ghost export JSON size to avoid OOM during JSON.parse. JSON.parse
// loads the whole document into memory (worst case ~2-3x the file size in V8 due
// to UTF-16 string + parsed-object overhead), so a multi-GB legit-or-malicious
// export can crash the host. 256 MiB covers normal blogs comfortably and keeps
// peak memory bounded; raise via maxFileSizeBytes / --max-size for huge sites.
export const DEFAULT_MAX_IMPORT_JSON_BYTES = 256 * 1024 * 1024;

// Per-post rendered HTML cap before feeding Ghost bodies into Turndown.
// Typical Ghost posts are KB-scale; 5 MiB leaves room for unusually large
// long-form or code-heavy posts while bounding Turndown's synchronous DOM /
// regex work on malicious exports.
export const DEFAULT_MAX_POST_HTML_BYTES = 5 * 1024 * 1024;

const MARKDOWN_CARD_FENCE_RE =
  /<!--\s*kg-card-begin:\s*markdown\s*-->([\s\S]*?)<!--\s*kg-card-end:\s*markdown\s*-->/g;

// Fan-out for the per-post render/write phases in importFromResolvedInput.
// Turndown is CPU-bound and synchronous, so the parallelism doesn't get us
// multi-core (JS is single-threaded without worker_threads), but it does
// interleave the per-post network rewrites (image downloader) with turndown
// work in the next post. The write phase benefits more concretely: 32 inflight
// stat/writeFile calls turn a 50k-post serial walk (~150s) into an IO-bounded
// one. See backlog #522 / #523. Bumping above ~64 risks fd exhaustion when
// users also run with --download-images (which opens its own fds per fetch).
const IMPORT_CONCURRENCY = 32;

interface GhostExportDbEntry {
  data?: {
    posts?: GhostPost[];
    tags?: GhostTag[];
    users?: GhostUser[];
    tiers?: GhostTier[];
    settings?: GhostSetting[];
    posts_tags?: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
    posts_authors?: GhostPostsAuthor[];
    posts_tiers?: Array<{ post_id: string; tier_id: string; sort_order?: number }>;
    posts_meta?: GhostPostMeta[];
  };
}

interface GhostExport {
  db: GhostExportDbEntry[];
}

const GHOST_EXPORT_TABLE_KEYS = [
  'posts',
  'tags',
  'users',
  'tiers',
  'settings',
  'posts_tags',
  'posts_authors',
  'posts_tiers',
  'posts_meta',
] as const;

interface MergedGhostData {
  posts: GhostPost[];
  tags: GhostTag[];
  users: GhostUser[];
  tiers: GhostTier[];
  settings: GhostSetting[];
  postsTags: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
  postsAuthors: GhostPostsAuthor[];
  postsTiers: Array<{ post_id: string; tier_id: string; sort_order?: number }>;
  postsMeta: GhostPostMeta[];
}

interface GhostPost {
  id: string;
  uuid?: string;
  title: string;
  slug: string;
  created_by?: string | null;
  published_by?: string | null;
  updated_by?: string | null;
  html?: string | null;
  mobiledoc?: string | null;
  lexical?: string | null;
  frontmatter?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  featured?: boolean | 0 | 1;
  type?: 'post' | 'page';
  status?: string;
  visibility?: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
  tiers?: GhostTier[] | null;
  email_subject?: string | null;
  email_only?: boolean | 0 | 1 | null;
  send_email_when_published?: boolean | 0 | 1 | null;
  show_title_and_feature_image?: boolean | 0 | 1 | null;
  custom_excerpt?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;
  canonical_url?: string | null;
  codeinjection_head?: string | null;
  codeinjection_foot?: string | null;
}

interface GhostPostsAuthor {
  post_id: string;
  user_id?: string;
  author_id?: string;
  sort_order?: number;
}

interface GhostPostMeta {
  post_id?: string | null;
  email_subject?: string | null;
  email_only?: boolean | 0 | 1 | null;
  send_email_when_published?: boolean | 0 | 1 | null;
  signups?: number | string | null;
  clicks?: number | string | null;
  comments?: number | string | null;
  conversions?: number | string | null;
  positive_feedback?: number | string | null;
  negative_feedback?: number | string | null;
}

interface ImportedEmailCardSegment {
  type: 'email' | 'email-cta';
  html?: string;
  visibility?: Record<string, unknown>;
}

interface GhostTier {
  id: string;
  slug?: string | null;
  name?: string | null;
  monthly_price?: number | null;
  yearly_price?: number | null;
}

interface GhostSetting {
  key?: string | null;
  value?: string | number | boolean | null;
  group?: string | null;
}

interface GhostTag {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  feature_image?: string | null;
  accent_color?: string | null;
  visibility?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;
  codeinjection_head?: string | null;
  codeinjection_foot?: string | null;
}

interface GhostUser {
  id: string;
  slug: string;
  name: string;
  bio?: string | null;
  profile_image?: string | null;
  cover_image?: string | null;
  website?: string | null;
  location?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  accent_color?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;
  codeinjection_head?: string | null;
  codeinjection_foot?: string | null;
}

export interface ImportSummary {
  posts: number;
  pages: number;
  tags: number;
  authors: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  assetsCopied: number;
  imagesDownloaded: number;
  imagesFailed: number;
  // Subset of imagesDownloaded / imagesFailed attributable to Ghost
  // settings-level images (icon, logo, cover_image, og_image, twitter_image)
  // that feed laurel.toml. Surfaced separately because a fresh import that
  // skips these leaves favicon + og:image/JSON-LD pointing at files that were
  // never written (404). Counters mirror the body-image semantics exactly:
  // `settingsImagesFailed` is genuine fetch failures only, not third-party URLs
  // left external or re-import fast-path hits.
  settingsImagesDownloaded: number;
  settingsImagesFailed: number;
  // True when the import was a `--dry-run`: no files were written and no
  // images were downloaded. The other counters reflect what *would* have
  // happened (#502).
  dryRun: boolean;
  // Posts/pages with status === 'draft'. These are imported with the same
  // policy as published content; the count is split out so dry-run callers
  // can see how many drafts would land before committing to the write.
  drafts: number;
  // Posts/pages whose status is neither 'published' nor 'draft' (e.g.
  // 'scheduled', 'sent'). These are filtered out and not imported.
  statusFiltered: number;
  // Draft posts/pages excluded by partial-import filters. Legacy full imports
  // include drafts by default; this only increments when --only-tags / --since
  // narrow the import and --include-drafts was not passed.
  draftsFiltered: number;
  // Pages excluded by partial-import filters. Legacy full imports include pages
  // by default; this only increments when --only-tags / --since narrow the
  // import and --include-pages was not passed.
  pagesFiltered: number;
  // Posts excluded because none of their public tag slugs matched --only-tags.
  tagFiltered: number;
  // Posts/pages excluded because their publish/create date is before --since,
  // or missing/invalid when a since boundary was requested.
  dateFiltered: number;
  // Posts whose body would be written as empty markdown because structured
  // content rendered empty, Turndown was skipped by safety caps, or Turndown
  // failed and the post fell back safely. Surfaced separately so users with
  // large exports can spot body loss before importing.
  bodiesEmpty: number;
  // Custom redirect rules read from <export>/content/data/redirects.json. Each
  // one becomes a line in the emitted _redirects / vercel.json / nginx.conf
  // snippets so links to the source Ghost site survive migration (#503).
  redirectsImported: number;
  // Slug rewrites the import had to perform (e.g. uppercase or unsafe chars
  // stripped by safeSlug). Each one produces an additional redirect entry so
  // the old Ghost URL still resolves after deployment (#503).
  slugRedirects: number;
  // Posts whose `codeinjection_head` / `codeinjection_foot` were present in
  // the export but omitted from the written frontmatter because
  // `keepCodeInjection` was not set. Surfaced so the operator can audit the
  // source and re-run with `--keep-code-injection` if they trust it (#561).
  codeInjectionSkipped: number;
  // Rendered Ghost HTML bodies preserved next to imported Markdown as
  // `<slug>.md.html` sibling files when `--keep-html` is set (#808).
  htmlPreserved: number;
  // Entries (posts/pages/tags/authors) that resolved to the same destination
  // path as another entry already written in THIS import run. Ghost rejects
  // duplicate slugs in normal admin flows, so an intra-export collision
  // indicates a malformed or tampered export trying to mask one entity with
  // another. Refused regardless of `onConflict` (first-write wins); the count
  // is surfaced so operators can audit the source export (#1138).
  slugCollisions: number;
  // Absolute paths the import wrote, or would write in dry-run mode. This is
  // primarily surfaced by `laurel import-ghost --dry-run` so operators can
  // review the exact files before committing an import.
  plannedPaths: string[];
}

export type ImportProgressEvent =
  | {
      type: 'posts';
      processedPosts: number;
      totalPosts: number;
    }
  | {
      // Per-image lifecycle event from the downloader. `status: 'fetching'`
      // fires before each network call; the same URL follows up with one of
      // `done` / `skipped` / `failed`. Counters are cumulative across the
      // import so a UI can render running totals without keeping state.
      type: 'image';
      url: string;
      status: 'fetching' | 'done' | 'skipped' | 'failed';
      downloaded: number;
      skipped: number;
      failed: number;
    };

interface ImportGhostOptions {
  cwd: string;
  // Path to either a Ghost export JSON file or a directory containing one.
  // When a directory is given, `<dir>/content/` is used as the default asset
  // source (images/, files/, media/ subdirs) unless `assetsDir` is set.
  file: string;
  onConflict?: OnConflict;
  // Override the asset source directory. Should contain images/, files/,
  // and/or media/ subdirs that will be copied into <cwd>/content/.
  assetsDir?: string;
  // When true, walk every image URL in post bodies and frontmatter image
  // fields, fetch them to <cwd>/content/images/, and rewrite the references
  // to site-relative paths. Defaults to false (URLs are written verbatim).
  downloadImages?: boolean;
  // When `downloadImages` is true, also fetch Ghost settings-level images
  // (icon, logo, cover_image, og_image, twitter_image) into content/images/
  // and rewrite the laurel.toml keys to local paths. Defaults to true so a
  // fresh import builds with a working favicon and og:image; set false (CLI
  // `--no-download-settings-images`) to keep only body/feature images local.
  downloadSettingsImages?: boolean;
  // Maximum per-image size in bytes when `downloadImages` is true. Defaults
  // to DEFAULT_MAX_IMAGE_SIZE_BYTES (10 MiB). 0 disables the cap. The CLI
  // surface flag is `--max-image-size` and accepts the same size-spec syntax
  // as `--max-size` (e.g. `20MB`, `1GB`, `0`).
  maxImageSizeBytes?: number;
  // Absolute URL of the source Ghost site (e.g. https://oldblog.com). When
  // set, any link in post bodies whose hostname matches is rewritten to a
  // site-relative path. Internal hyperlinks (`<a href>` / `[text](url)`) keep
  // pointing at the migrated content instead of 404ing on the old domain.
  sourceUrl?: string;
  // Test seam: override the fetch implementation used by the downloader.
  // Defaults to globalThis.fetch.
  fetcher?: typeof fetch;
  // When true, walk the export and count what would happen without writing
  // markdown, copying assets, or downloading images. Used by the CLI's
  // `--dry-run` flag so users with large exports can preview before
  // committing (#502).
  dryRun?: boolean;
  // Maximum JSON file size (bytes) accepted before refusing to parse. Guards
  // against multi-GB legit-or-malicious exports OOM-ing the host since
  // JSON.parse loads the whole document into memory. Defaults to
  // DEFAULT_MAX_IMPORT_JSON_BYTES (256 MiB). For .zip exports the cap is
  // applied to the JSON inside after extraction, not the compressed archive.
  maxFileSizeBytes?: number;
  // Maximum rendered HTML body size (bytes) to send through Turndown per
  // post/page. Defaults to DEFAULT_MAX_POST_HTML_BYTES (5 MiB). 0 disables the
  // cap. Over-cap posts are still imported with frontmatter, but their Markdown
  // body falls back to empty and a warning is emitted.
  maxPostHtmlSizeBytes?: number;
  // When true, preserve `codeinjection_head` / `codeinjection_foot` from the
  // Ghost export verbatim in post frontmatter. Defaults to false: a user
  // importing an export from a site they no longer control (sold, taken
  // over, leaked) would otherwise silently inherit attacker scripts that
  // get re-injected into <head> / before </body> by `{{ghost_head}}` /
  // `{{ghost_foot}}`. The CLI surface flag is `--keep-code-injection`
  // (#561).
  keepCodeInjection?: boolean;
  // When true, preserve the rendered Ghost HTML body next to the imported
  // Markdown as a sibling `<slug>.md.html` file. Defaults to false because the
  // Markdown output remains the canonical import artifact (#808).
  keepHtml?: boolean;
  // Optional content-output root. When omitted, imported Markdown and assets
  // land in <cwd>/content as before. When set, posts/pages/tags/authors and
  // copied assets land under this directory for review-first imports.
  outputDir?: string;
  // Optional human-facing progress hook. Library callers opt in explicitly so
  // JSON and dry-run CLI modes can stay quiet while normal imports still stream
  // coarse progress for large exports.
  onProgress?: (event: ImportProgressEvent) => void;
  // Include draft posts/pages when a partial import filter (--only-tags or
  // --since) is active. Full imports keep the historical behavior and include
  // drafts even when this is unset.
  includeDrafts?: boolean;
  // Include pages when a partial import filter (--only-tags or --since) is
  // active. Full imports keep the historical behavior and include pages even
  // when this is unset.
  includePages?: boolean;
  // Restrict imported posts to these tag slugs/names. Values are normalized
  // through the same safe slugger used for Ghost tags, so "News, My Blog"
  // matches `news` and `my-blog`.
  onlyTags?: readonly string[];
  // Restrict imported posts/pages to entries whose published_at (or created_at
  // fallback) is on/after this date. Date-only values are interpreted as UTC
  // midnight.
  since?: string;
}

interface ImportFilterSettings {
  active: boolean;
  includeDrafts: boolean;
  includePages: boolean;
  onlyTagSlugs: ReadonlySet<string>;
  sinceTimestamp: number | undefined;
}

// Ghost subfolder names whose contents should be copied verbatim into
// <cwd>/content/<name>/ so that imported markdown's /content/<name>/... URLs
// resolve at build time.
const GHOST_ASSET_SUBDIRS = ['images', 'files', 'media'] as const;
const GHOST_PROJECT_FILE_FAMILIES = [
  {
    names: ['routes.yaml', 'routes.yml'],
    candidates: [
      'routes.yaml',
      'routes.yml',
      'settings/routes.yaml',
      'settings/routes.yml',
      'data/routes.yaml',
      'data/routes.yml',
    ],
  },
  {
    names: ['redirects.yaml', 'redirects.yml'],
    candidates: [
      'redirects.yaml',
      'redirects.yml',
      'data/redirects.yaml',
      'data/redirects.yml',
      'settings/redirects.yaml',
      'settings/redirects.yml',
    ],
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateGhostExportShape(value: unknown): GhostExport {
  if (!isRecord(value)) {
    throw new Error('Invalid Ghost export: top-level JSON must be an object');
  }

  const db = value.db;
  if (!Array.isArray(db) || db.length === 0) {
    throw new Error('Invalid Ghost export: db array missing or empty');
  }

  let sawData = false;
  for (const [index, entry] of db.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Invalid Ghost export: db[${index}] must be an object`);
    }
    if (!hasOwn(entry, 'data')) continue;

    const data = entry.data;
    if (!isRecord(data)) {
      throw new Error(`Invalid Ghost export: db[${index}].data must be an object`);
    }

    sawData = true;
    for (const key of GHOST_EXPORT_TABLE_KEYS) {
      if (!hasOwn(data, key)) continue;
      if (!Array.isArray(data[key])) {
        throw new Error(`Invalid Ghost export: db[${index}].data.${key} must be an array`);
      }
    }
  }

  if (!sawData) {
    throw new Error('Invalid Ghost export: no db[i].data block present');
  }

  return value as unknown as GhostExport;
}

// Newer Ghost admin exports split tables across multiple `db[i]` blocks (e.g.
// posts in db[0], posts_meta/members/snippets in db[1]). Reading only db[0]
// would silently drop content from any subsequent block, so concatenate the
// known arrays across every entry that carries a `data` field.
function mergeGhostDbEntries(db: GhostExportDbEntry[] | undefined): MergedGhostData {
  if (!Array.isArray(db) || db.length === 0) {
    throw new Error('Invalid Ghost export: db array missing or empty');
  }

  const merged: MergedGhostData = {
    posts: [],
    tags: [],
    users: [],
    tiers: [],
    settings: [],
    postsTags: [],
    postsAuthors: [],
    postsTiers: [],
    postsMeta: [],
  };

  let sawData = false;
  for (const entry of db) {
    const d = entry?.data;
    if (!d) continue;
    sawData = true;
    if (d.posts) merged.posts.push(...d.posts);
    if (d.tags) merged.tags.push(...d.tags);
    if (d.users) merged.users.push(...d.users);
    if (d.tiers) merged.tiers.push(...d.tiers);
    if (d.settings) merged.settings.push(...d.settings);
    if (d.posts_tags) merged.postsTags.push(...d.posts_tags);
    if (d.posts_authors) merged.postsAuthors.push(...d.posts_authors);
    if (d.posts_tiers) merged.postsTiers.push(...d.posts_tiers);
    if (d.posts_meta) merged.postsMeta.push(...d.posts_meta);
  }

  if (!sawData) {
    throw new Error('Invalid Ghost export: no db[i].data block present');
  }
  return merged;
}

export async function importGhostExport(opts: ImportGhostOptions): Promise<ImportSummary> {
  const onConflict: OnConflict = opts.onConflict ?? 'skip';
  const counters = {
    skipped: 0,
    overwritten: 0,
    renamed: 0,
    drafts: 0,
    statusFiltered: 0,
    draftsFiltered: 0,
    pagesFiltered: 0,
    tagFiltered: 0,
    dateFiltered: 0,
    bodiesEmpty: 0,
    codeInjectionSkipped: 0,
    slugCollisions: 0,
  };

  let extractedZipRoot: string | undefined;
  let inputFile = opts.file;
  const detected = await detectGhostExportFormat(opts.file);
  if (detected === 'wordpress-xml') {
    // WordPress WXR is a real format we ship a separate importer for; spotting
    // it here saves the user from staring at a "no .json found" failure.
    throw new Error(
      `${opts.file} looks like a WordPress WXR XML export. Use \`laurel import-wordpress ${opts.file}\` instead.`,
    );
  }
  const hasZipExt = opts.file.toLowerCase().endsWith('.zip');
  if (detected === 'zip' || (hasZipExt && detected === 'unknown')) {
    // Honour an explicit `.zip` extension even when the magic bytes are
    // wrong: the user said zip, so attempt extraction and let `unzip` produce
    // the canonical "not a valid archive" failure. This preserves the
    // pre-detection behaviour for hand-crafted / corrupt zips that exercise
    // the error path in tests, while still letting magic-bytes redirect
    // extension-less archives.
    const extracted = await extractZipExport(opts.file);
    extractedZipRoot = extracted.cleanupRoot;
    inputFile = extracted.contentRoot;
  }
  // For `json` / `directory` / `unknown` we fall through to `resolveInput`
  // which already handles bare paths and directories. `unknown` covers
  // extension-less JSON whose first byte isn't `{` (rare; for example a
  // Ghost export wrapped in a single-line minified file with a leading
  // whitespace stripped); the downstream JSON.parse error has the location
  // info we need.

  try {
    return await importFromResolvedInput(inputFile, opts, onConflict, counters);
  } finally {
    if (extractedZipRoot) {
      await rm(extractedZipRoot, { recursive: true, force: true });
    }
  }
}

type GhostExportFormat = 'json' | 'zip' | 'directory' | 'wordpress-xml' | 'unknown';

// Sniff the export type without trusting the file extension. Order: stat
// (directory shortcut), then magic-bytes from the first few bytes. Magic
// bytes used:
//   - 50 4B 03 04   PK\x03\x04   → ZIP local file header
//   - leading `{` or `[`         → JSON
//   - leading `<`                → XML; treated as WordPress WXR so we can
//                                  redirect the user to import-wordpress
// Everything else falls back to `unknown` and the caller passes the path
// through unchanged (matching the pre-detection behaviour for bare JSON).
export async function detectGhostExportFormat(file: string): Promise<GhostExportFormat> {
  try {
    const st = await stat(file);
    if (st.isDirectory()) return 'directory';
  } catch {
    // Let resolveInput surface the ENOENT with a useful message.
    return 'unknown';
  }
  // 8 bytes is enough for the ZIP signature + a BOM + the first JSON / XML
  // glyph; reading more would just slow down the sniff for huge files.
  const fh = Bun.file(file);
  const head = new Uint8Array(await fh.slice(0, 8).arrayBuffer());
  if (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07) &&
    (head[3] === 0x04 || head[3] === 0x06 || head[3] === 0x08)
  ) {
    return 'zip';
  }
  // Skip UTF-8 BOM (EF BB BF) before looking at the first printable byte so
  // editor-saved exports with a BOM still get classified correctly.
  let i = 0;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3;
  // Then skip ASCII whitespace.
  while (
    i < head.length &&
    (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)
  ) {
    i += 1;
  }
  const first = head[i];
  if (first === 0x7b /* { */ || first === 0x5b /* [ */) return 'json';
  if (first === 0x3c /* < */) return 'wordpress-xml';
  return 'unknown';
}

async function importFromResolvedInput(
  inputFile: string,
  opts: ImportGhostOptions,
  onConflict: OnConflict,
  counters: {
    skipped: number;
    overwritten: number;
    renamed: number;
    drafts: number;
    statusFiltered: number;
    draftsFiltered: number;
    pagesFiltered: number;
    tagFiltered: number;
    dateFiltered: number;
    bodiesEmpty: number;
    codeInjectionSkipped: number;
    slugCollisions: number;
  },
): Promise<ImportSummary> {
  const keepCodeInjection = opts.keepCodeInjection === true;
  const keepHtml = opts.keepHtml === true;
  const dryRun = opts.dryRun === true;
  const outputRoot = resolve(opts.outputDir ?? join(opts.cwd, 'content'));
  const redirectRoot = opts.outputDir
    ? join(outputRoot, 'migration', 'redirects')
    : join(opts.cwd, 'migration', 'redirects');
  const resolved = await resolveInput(inputFile, opts.assetsDir);
  const parsedExports = await Promise.all(
    resolved.jsonFiles.map(async (jsonFile) => {
      await assertJsonWithinSizeCap(jsonFile, opts.maxFileSizeBytes);
      const raw = await readFile(jsonFile, 'utf8');
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw) as unknown;
      } catch (err) {
        const reason = err instanceof Error ? `: ${err.message}` : '';
        throw new Error(`Invalid JSON in Ghost export: ${jsonFile}${reason}`);
      }
      return validateGhostExportShape(stripGhostUrlPlaceholder(parsedJson));
    }),
  );
  const parsed: GhostExport = { db: parsedExports.flatMap((entry) => entry.db) };
  const { posts, tags, users, tiers, settings, postsTags, postsAuthors, postsTiers, postsMeta } =
    mergeGhostDbEntries(parsed.db);
  const filters = resolveImportFilters(opts);
  const turndown = createGhostTurndown();

  // Image download requires network and writes to content/images. In dry-run
  // mode we skip the downloader entirely; the dry-run summary should preview
  // local-only side effects rather than perform fetches.
  const downloader =
    opts.downloadImages && !dryRun
      ? new GhostImageDownloader({
          cwd: opts.cwd,
          outputRoot,
          fetcher: opts.fetcher,
          maxImageSizeBytes: opts.maxImageSizeBytes,
          // Lets the downloader fetch `/content/images/...` paths that
          // `stripGhostUrlPlaceholder` already rewrote to leading-slash form.
          sourceUrl: opts.sourceUrl,
          // Forward per-image events into the import-level progress hook so
          // dashboard consumers can stream them out to a UI overlay.
          onEvent: opts.onProgress
            ? (event) => opts.onProgress?.({ type: 'image', ...event })
            : undefined,
        })
      : undefined;
  const urlRewriter = opts.sourceUrl ? new GhostUrlRewriter(opts.sourceUrl) : undefined;

  const tagById = new Map(tags.map((t) => [t.id, t]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const tierById = new Map(tiers.map((t) => [t.id, t]));

  // Destinations successfully claimed (written, overwritten, or renamed-into)
  // during this import run. Used to detect intra-export slug collisions, which
  // are distinct from re-import conflicts and refused regardless of
  // `onConflict` so a tampered export cannot silently substitute one entity
  // for another (#1138).
  const writtenThisRun = new Set<string>();

  const slugChanges: SlugChange[] = [];
  const recordSlugChange = (
    kind: SlugChange['kind'],
    originalSlug: unknown,
    newSlug: string,
  ): void => {
    if (typeof originalSlug !== 'string' || originalSlug.length === 0) return;
    if (newSlug.length === 0 || originalSlug === newSlug) return;
    // Only emit a redirect when the original slug was something Ghost could
    // realistically have served as a URL. Slugs with traversal or path
    // separators wouldn't have been valid Ghost URLs to redirect from, so we
    // skip them rather than emit a junk rule.
    if (
      originalSlug.includes('/') ||
      originalSlug.includes('\\') ||
      originalSlug === '.' ||
      originalSlug === '..'
    ) {
      return;
    }
    slugChanges.push({ kind, oldSlug: originalSlug, newSlug });
  };

  // Bucket postsTags / postsAuthors by post_id once so per-post lookups are O(k)
  // (k = tags/authors on that post) instead of O(M) (scan the entire join table).
  // Without this, a 50k-post export with 200k posts_tags rows is ~10^10 ops.
  const postsTagsByPost = groupBySortedByOrder(postsTags, (r) => r.post_id);
  const postsAuthorsByPost = groupBySortedByOrder(postsAuthors, (r) => r.post_id);
  const postsTiersByPost = groupBySortedByOrder(postsTiers, (r) => r.post_id);
  const postMetaByPost = new Map(
    postsMeta
      .filter((row) => typeof row.post_id === 'string' && row.post_id.length > 0)
      .map((row) => [row.post_id as string, row] as const),
  );

  const tagSlugsForPost = (postId: string): string[] =>
    (postsTagsByPost.get(postId) ?? [])
      .map((r) => {
        const t = tagById.get(r.tag_id);
        if (!t) return '';
        return safeSlug(t.slug) || safeSlug(t.name);
      })
      .filter((slug): slug is string => slug.length > 0);

  const userSlugForId = (userId: string | null | undefined): string => {
    if (!userId) return '';
    const user = userById.get(userId);
    if (!user) return '';
    return safeSlug(user.slug) || safeSlug(user.name);
  };

  const authorSlugsForPost = (post: GhostPost): string[] => {
    const joined = (postsAuthorsByPost.get(post.id) ?? [])
      .map((r) => {
        const u = userById.get(r.user_id ?? r.author_id ?? '');
        if (!u) return '';
        return safeSlug(u.slug) || safeSlug(u.name);
      })
      .filter((slug): slug is string => slug.length > 0);
    if (joined.length > 0) return joined;
    return uniqueStrings(
      [
        userSlugForId(post.published_by),
        userSlugForId(post.created_by),
        userSlugForId(post.updated_by),
      ].filter((slug) => slug.length > 0),
    );
  };

  const tierSlugsForPost = (postId: string): string[] =>
    (postsTiersByPost.get(postId) ?? [])
      .map((r) => tierSlug(tierById.get(r.tier_id)))
      .filter((slug): slug is string => slug.length > 0);

  // Track which base dirs we've already ensured so we don't pay ensureDir
  // per-post. We can't pre-create posts/pages/tags/authors upfront because
  // existing tests expect empty kinds to leave their dir uncreated (e.g.
  // "post with no recoverable slug or title is skipped" asserts that no
  // content/posts dir exists when zero posts pass through). Lazy init drops
  // ensureDir from O(N) to O(kinds-used).
  const ensuredDirs = new Set<string>();
  const ensureDirOnce = async (dir: string): Promise<void> => {
    if (ensuredDirs.has(dir)) return;
    ensuredDirs.add(dir);
    await ensureDir(dir);
  };

  // Phase A: render bodies and frontmatter in parallel. Each per-post task
  // runs the CPU-bound turndown step plus the per-post downloader rewrites
  // (each rewrite hits the network when --download-images is set). This is
  // the slice that #523 / #522 flagged as serial-bottlenecked. Slug-collision
  // detection still happens sequentially in Phase B so behavior is
  // deterministic regardless of which task finishes first here.
  const renderLimit = pLimit(IMPORT_CONCURRENCY);
  let processedPosts = 0;
  const reportPostProgress = (): void => {
    processedPosts += 1;
    if (processedPosts % 50 !== 0) return;
    opts.onProgress?.({ type: 'posts', processedPosts, totalPosts: posts.length });
  };
  const renderedPosts = await Promise.all(
    posts.map((post) =>
      renderLimit(() =>
        renderPostRecord(post, {
          opts,
          counters,
          filters,
          keepCodeInjection,
          keepHtml,
          downloader,
          urlRewriter,
          tagSlugsForPost,
          authorSlugsForPost,
          tierSlugsForPost,
          metaForPost: (postId) => postMetaByPost.get(postId),
          turndown,
        }).finally(reportPostProgress),
      ),
    ),
  );
  const reusableHtmlCardHashes = findReusableHtmlCardHashes(renderedPosts);

  let postCount = 0;
  let pageCount = 0;
  const importedTagSlugs = new Set<string>();
  const importedAuthorSlugs = new Set<string>();
  // Phase B: sequential conflict claim + parallel writes. The
  // `writtenThisRun.has`/`add` cycle has to be sync to give first-occurrence
  // wins (#1138), but once a destination is claimed the actual writeFile is
  // queued onto the same fan-out as the body renderer. Rename policy stays
  // serial because nextAvailablePath() needs an accurate view of
  // writtenThisRun + the live filesystem to pick the next numeric suffix.
  const writeLimit = pLimit(IMPORT_CONCURRENCY);
  const writeQueue: Array<Promise<void>> = [];
  const plannedPaths: string[] = [];
  const claimedPostPageSlugs = new Map<string, PostPageSlugClaim>();
  const writtenHtmlCardComponents = new Set<string>();
  let htmlPreserved = 0;
  for (const r of renderedPosts) {
    if (!r) continue;
    let resolved = await resolvePostPageSlugClaim(
      r,
      onConflict,
      counters,
      claimedPostPageSlugs,
      writtenThisRun,
    );
    if (!resolved) continue;
    const componentized = componentizeReusableHtmlCards(resolved.contents, reusableHtmlCardHashes);
    if (componentized.components.length > 0) {
      const componentsDir = join(outputRoot, 'components');
      for (const component of componentized.components) {
        const componentDest = join(componentsDir, `${component.slug}.md`);
        assertWithin(componentsDir, componentDest);
        if (writtenHtmlCardComponents.has(componentDest) || (await pathExists(componentDest))) {
          continue;
        }
        writtenHtmlCardComponents.add(componentDest);
        if (!dryRun) await ensureDirOnce(componentsDir);
        if (!dryRun) {
          writeQueue.push(writeLimit(() => writeFile(componentDest, component.contents, 'utf8')));
        }
        plannedPaths.push(componentDest);
      }
      resolved = { ...resolved, contents: componentized.contents };
    }
    recordSlugChange(resolved.isPage ? 'page' : 'post', resolved.originalSlug, resolved.slug);
    if (!dryRun) await ensureDirOnce(dirname(resolved.dest));
    const written = await dispatchWrite(
      resolved.dest,
      resolved.contents,
      onConflict,
      counters,
      dryRun,
      writtenThisRun,
      writeQueue,
      writeLimit,
    );
    if (!written) continue;
    if (!claimedPostPageSlugs.has(resolved.slug)) {
      claimedPostPageSlugs.set(resolved.slug, {
        kind: resolved.isPage ? 'page' : 'post',
        dest: written,
      });
    }
    plannedPaths.push(written);
    if (resolved.htmlContents !== undefined) {
      const htmlDest = `${written}.html`;
      const htmlWritten = await dispatchWrite(
        htmlDest,
        resolved.htmlContents,
        onConflict,
        counters,
        dryRun,
        writtenThisRun,
        writeQueue,
        writeLimit,
      );
      if (htmlWritten) {
        plannedPaths.push(htmlWritten);
        htmlPreserved += 1;
      }
    }
    for (const slug of resolved.tagSlugs) importedTagSlugs.add(slug);
    for (const slug of resolved.authorSlugs) importedAuthorSlugs.add(slug);
    if (resolved.isPage) pageCount += 1;
    else postCount += 1;
  }
  await Promise.all(writeQueue);

  // Tags and authors are much smaller than posts in any real Ghost export
  // (O(hundreds), not O(tens of thousands)), so we don't bother with a
  // separate render-fanout phase. We do still parallelize the writes via the
  // same writeLimit so a 500-tag export doesn't pay 500*roundtrip serially.
  let tagCount = 0;
  for (const tag of tags) {
    const hasTagCodeInjection =
      (typeof tag.codeinjection_head === 'string' && tag.codeinjection_head.length > 0) ||
      (typeof tag.codeinjection_foot === 'string' && tag.codeinjection_foot.length > 0);
    if (hasTagCodeInjection && !keepCodeInjection) {
      counters.codeInjectionSkipped += 1;
    }
    const tagSlug = safeSlug(tag.slug) || safeSlug(tag.name);
    if (!tagSlug) {
      logger.warn(
        `Skipping tag ${tag.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(tag.slug)} name=${JSON.stringify(tag.name)}`,
      );
      continue;
    }
    recordSlugChange('tag', tag.slug, tagSlug);
    if (filters.active && !importedTagSlugs.has(tagSlug)) continue;
    const baseDir = join(outputRoot, 'tags');
    const dest = join(baseDir, `${tagSlug}.md`);
    assertWithin(baseDir, dest);
    const tagFeatureImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(tag.feature_image ?? undefined)
        : (tag.feature_image ?? undefined),
      'feature_image',
      `tag ${JSON.stringify(tag.slug ?? tag.id ?? '')}`,
    );
    const tagLabel = `tag ${JSON.stringify(tag.slug ?? tag.id ?? '')}`;
    const ogImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(tag.og_image ?? undefined)
        : (tag.og_image ?? undefined),
      'og_image',
      tagLabel,
    );
    const twitterImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(tag.twitter_image ?? undefined)
        : (tag.twitter_image ?? undefined),
      'twitter_image',
      tagLabel,
    );
    const frontmatter = buildFrontmatter({
      slug: tagSlug,
      name: tag.name,
      description: tag.description ?? undefined,
      feature_image: tagFeatureImage,
      accent_color: tag.accent_color ?? undefined,
      meta_title: tag.meta_title ?? undefined,
      meta_description: tag.meta_description ?? undefined,
      og_title: tag.og_title ?? undefined,
      og_description: tag.og_description ?? undefined,
      og_image: ogImage,
      twitter_title: tag.twitter_title ?? undefined,
      twitter_description: tag.twitter_description ?? undefined,
      twitter_image: twitterImage,
      codeinjection_head: keepCodeInjection ? (tag.codeinjection_head ?? undefined) : undefined,
      codeinjection_foot: keepCodeInjection ? (tag.codeinjection_foot ?? undefined) : undefined,
    });
    if (!dryRun) await ensureDirOnce(baseDir);
    const written = await dispatchWrite(
      dest,
      `${frontmatter}\n`,
      onConflict,
      counters,
      dryRun,
      writtenThisRun,
      writeQueue,
      writeLimit,
    );
    if (written) {
      plannedPaths.push(written);
      tagCount += 1;
    }
  }

  let authorCount = 0;
  for (const user of users) {
    const hasAuthorCodeInjection =
      (typeof user.codeinjection_head === 'string' && user.codeinjection_head.length > 0) ||
      (typeof user.codeinjection_foot === 'string' && user.codeinjection_foot.length > 0);
    if (hasAuthorCodeInjection && !keepCodeInjection) {
      counters.codeInjectionSkipped += 1;
    }
    const userSlug = safeSlug(user.slug) || safeSlug(user.name);
    if (!userSlug) {
      logger.warn(
        `Skipping author ${user.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(user.slug)} name=${JSON.stringify(user.name)}`,
      );
      continue;
    }
    recordSlugChange('author', user.slug, userSlug);
    if (filters.active && !importedAuthorSlugs.has(userSlug)) continue;
    const baseDir = join(outputRoot, 'authors');
    const dest = join(baseDir, `${userSlug}.md`);
    assertWithin(baseDir, dest);
    const userLabel = `author ${JSON.stringify(user.slug ?? user.id ?? '')}`;
    const profileImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(user.profile_image ?? undefined)
        : (user.profile_image ?? undefined),
      'profile_image',
      userLabel,
    );
    const coverImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(user.cover_image ?? undefined)
        : (user.cover_image ?? undefined),
      'cover_image',
      userLabel,
    );
    const ogImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(user.og_image ?? undefined)
        : (user.og_image ?? undefined),
      'og_image',
      userLabel,
    );
    const twitterImage = sanitizeImageUrl(
      downloader
        ? await downloader.rewriteField(user.twitter_image ?? undefined)
        : (user.twitter_image ?? undefined),
      'twitter_image',
      userLabel,
    );
    const frontmatter = buildFrontmatter({
      slug: userSlug,
      name: user.name,
      bio: user.bio ?? undefined,
      profile_image: profileImage,
      cover_image: coverImage,
      website: user.website ?? undefined,
      location: user.location ?? undefined,
      twitter: user.twitter ?? undefined,
      facebook: user.facebook ?? undefined,
      accent_color: user.accent_color ?? undefined,
      meta_title: user.meta_title ?? undefined,
      meta_description: user.meta_description ?? undefined,
      og_title: user.og_title ?? undefined,
      og_description: user.og_description ?? undefined,
      og_image: ogImage,
      twitter_title: user.twitter_title ?? undefined,
      twitter_description: user.twitter_description ?? undefined,
      twitter_image: twitterImage,
      codeinjection_head: keepCodeInjection ? (user.codeinjection_head ?? undefined) : undefined,
      codeinjection_foot: keepCodeInjection ? (user.codeinjection_foot ?? undefined) : undefined,
    });
    if (!dryRun) await ensureDirOnce(baseDir);
    const written = await dispatchWrite(
      dest,
      `${frontmatter}\n`,
      onConflict,
      counters,
      dryRun,
      writtenThisRun,
      writeQueue,
      writeLimit,
    );
    if (written) {
      plannedPaths.push(written);
      authorCount += 1;
    }
  }
  // Drain queued writes before reading the resulting filesystem (asset copy,
  // redirect emission). Without this, copyGhostAssets or writeRedirectMaps
  // could race against still-pending Phase B writes.
  await Promise.all(writeQueue);

  const assetsCopied = resolved.assetsDir
    ? await copyGhostAssets(
        resolved.assetsDir,
        outputRoot,
        resolved.assetsDirIsExplicit,
        dryRun,
        plannedPaths,
      )
    : 0;
  if (resolved.assetsDir) {
    await copyGhostProjectFiles(
      resolved.assetsDir,
      opts.outputDir ? outputRoot : opts.cwd,
      dryRun,
      plannedPaths,
    );
  }
  const settingsImageResult = await writeGhostSettingsConfig({
    settings,
    targetRoot: opts.outputDir ? outputRoot : opts.cwd,
    onConflict,
    counters,
    dryRun,
    plannedPaths,
    downloader,
    downloadImages: opts.downloadImages === true,
    downloadSettingsImages: opts.downloadSettingsImages !== false,
    sourceUrl: opts.sourceUrl,
  });

  // Ghost stores custom redirects at content/data/redirects.json. The resolved
  // assetsDir points at the Ghost `content/` folder when the user passed a
  // directory or zip, so the lookup happens here. When the user passed only
  // the JSON file, we have no asset root to inspect and skip the load (#503).
  const customRedirects = resolved.assetsDir ? await loadRedirectsJson(resolved.assetsDir) : [];
  const redirectMaps = await writeRedirectMaps({
    cwd: opts.cwd,
    outDir: redirectRoot,
    customRedirects,
    slugChanges,
    dryRun,
  });
  plannedPaths.push(...redirectMaps.written);

  return {
    posts: postCount,
    pages: pageCount,
    tags: tagCount,
    authors: authorCount,
    skipped: counters.skipped,
    overwritten: counters.overwritten,
    renamed: counters.renamed,
    assetsCopied,
    imagesDownloaded: downloader?.downloaded ?? 0,
    imagesFailed: downloader?.failed ?? 0,
    settingsImagesDownloaded: settingsImageResult.settingsImagesDownloaded,
    settingsImagesFailed: settingsImageResult.settingsImagesFailed,
    dryRun,
    drafts: counters.drafts,
    statusFiltered: counters.statusFiltered,
    draftsFiltered: counters.draftsFiltered,
    pagesFiltered: counters.pagesFiltered,
    tagFiltered: counters.tagFiltered,
    dateFiltered: counters.dateFiltered,
    bodiesEmpty: counters.bodiesEmpty,
    redirectsImported: redirectMaps.customCount,
    slugRedirects: redirectMaps.slugCount,
    codeInjectionSkipped: counters.codeInjectionSkipped,
    htmlPreserved,
    slugCollisions: counters.slugCollisions,
    plannedPaths,
  };
}

interface ExtractedZip {
  // Always the temp directory itself, used for `rm` on cleanup. Never a nested
  // path — that would leak the parent temp dir.
  cleanupRoot: string;
  // The path to treat as the Ghost export folder. Equals `cleanupRoot` when the
  // archive was flat, or `cleanupRoot/<wrapper>` when it had a single top-level
  // wrapper directory (the common Ghost export shape).
  contentRoot: string;
}

// Extract a Ghost `.zip` export into a fresh temp directory and return both the
// cleanup root and the resolved content root. The caller is responsible for
// `rm`ing the cleanup root when done. We shell out to the `unzip` system
// command because Bun has no built-in ZIP archive reader and `unzip` is
// ubiquitous on macOS and Linux (the supported Bun platforms).
async function extractZipExport(zipPath: string): Promise<ExtractedZip> {
  try {
    const st = await stat(zipPath);
    if (!st.isFile()) {
      throw new Error(`Not a file: ${zipPath}`);
    }
  } catch (err) {
    throw new Error(
      `Cannot read Ghost export at ${zipPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'laurel-ghost-zip-'));
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['unzip', '-q', '-o', zipPath, '-d', dir], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(
      `Failed to invoke unzip while extracting ${zipPath}. Install unzip or pre-extract the archive. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderrText =
      proc.stderr instanceof ReadableStream ? await new Response(proc.stderr).text() : '';
    await rm(dir, { recursive: true, force: true });
    throw new Error(
      `Failed to extract ${zipPath}: unzip exited with code ${proc.exitCode}${stderrText ? `: ${stderrText.trim()}` : ''}`,
    );
  }
  const contentRoot = await unwrapSingleSubdir(dir);
  return { cleanupRoot: dir, contentRoot };
}

// Ghost's export ZIPs commonly contain a single top-level wrapper directory
// (e.g. `my-blog.ghost.2024-01-01/`) holding the JSON and `content/` folder.
// Unwrap that one level so downstream `resolveInput` finds the JSON and asset
// dirs without needing a recursive search. Falls back to the original dir when
// the archive was flat.
async function unwrapSingleSubdir(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length !== 1) return dir;
  const only = entries[0];
  if (!only) return dir;
  if (!only.isDirectory()) return dir;
  return join(dir, only.name);
}

interface ResolvedInput {
  jsonFiles: string[];
  assetsDir: string | undefined;
  // True when the user passed --assets explicitly; missing subdirs become a
  // warning rather than silent skip. When false (auto-detected from folder
  // input), absent subdirs are normal and quiet.
  assetsDirIsExplicit: boolean;
}

async function resolveInput(file: string, explicitAssetsDir?: string): Promise<ResolvedInput> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(file);
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new Error(`Ghost export file does not exist: ${file}`);
    }
    throw new Error(
      `Cannot read Ghost export at ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let jsonFiles: string[];
  let folderAssetsDir: string | undefined;

  if (st.isDirectory()) {
    jsonFiles = await findExportJsons(file);
    const candidateContent = join(file, 'content');
    if (await isDirectory(candidateContent)) {
      folderAssetsDir = candidateContent;
    } else if (await hasAnyAssetSubdir(file)) {
      folderAssetsDir = file;
    }
  } else {
    jsonFiles = [file];
    const fileDir = dirname(file);
    const candidateContent = join(fileDir, 'content');
    if (await isDirectory(candidateContent)) {
      folderAssetsDir = candidateContent;
    } else if (await hasAnyAssetSubdir(fileDir)) {
      folderAssetsDir = fileDir;
    }
  }

  if (explicitAssetsDir) {
    const resolvedExplicit = resolve(explicitAssetsDir);
    if (!(await isDirectory(resolvedExplicit))) {
      throw new Error(
        `--assets directory does not exist or is not a directory: ${resolvedExplicit}`,
      );
    }
    return { jsonFiles, assetsDir: resolvedExplicit, assetsDirIsExplicit: true };
  }

  return { jsonFiles, assetsDir: folderAssetsDir, assetsDirIsExplicit: false };
}

// Stat the resolved Ghost export JSON before loading it into memory and refuse
// to parse anything above the configured cap. JSON.parse on a multi-GB file
// (legit-large blog or an attacker-supplied deeply nested document) will spike
// process memory and may crash the host before any validation runs. Failing
// fast with a clear message lets the operator either split the export or raise
// the cap explicitly.
async function assertJsonWithinSizeCap(
  jsonFile: string,
  maxFileSizeBytes: number | undefined,
): Promise<void> {
  const cap = maxFileSizeBytes ?? DEFAULT_MAX_IMPORT_JSON_BYTES;
  if (!Number.isFinite(cap) || cap <= 0) {
    return;
  }
  const st = await stat(jsonFile);
  if (st.size > cap) {
    throw new Error(
      `Ghost export JSON at ${jsonFile} is ${formatImportBytes(st.size)} which exceeds the configured cap of ${formatImportBytes(cap)}. Re-run with --max-size to raise the limit, or split the export into smaller files.`,
    );
  }
}

function formatImportBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

async function findExportJsons(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  if (jsonFiles.length === 0) {
    throw new Error(`Ghost export directory does not contain a .json export file: ${dir}`);
  }
  const ghosty = jsonFiles.filter((n) => /ghost/i.test(n));
  return (ghosty.length > 0 ? ghosty : jsonFiles).map((name) => join(dir, name));
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function hasAnyAssetSubdir(dir: string): Promise<boolean> {
  for (const name of GHOST_ASSET_SUBDIRS) {
    if (await isDirectory(join(dir, name))) return true;
  }
  return false;
}

// Copy images/, files/, media/ from the Ghost export's content/ folder into
// <cwd>/content/<name>/, preserving relative paths. Existing files are not
// overwritten (the import is meant to be additive; rerunning shouldn't clobber
// edits). Symlinks are skipped to prevent the same "follow the link out of the
// project" risk that build-time asset copying already defends against.
async function copyGhostAssets(
  assetsRoot: string,
  outputRoot: string,
  isExplicit: boolean,
  dryRun: boolean,
  plannedPaths: string[],
): Promise<number> {
  let total = 0;
  for (const name of GHOST_ASSET_SUBDIRS) {
    const src = join(assetsRoot, name);
    if (!(await isDirectory(src))) {
      if (isExplicit) {
        logger.warn(`Assets subdir not found, skipping: ${src}`);
      }
      continue;
    }
    const dst = join(outputRoot, name);
    const rels = await scanGlob('**/*', { cwd: src, onlyFiles: true });
    for (const rel of rels) {
      if (pathContainsSymlink(src, rel)) {
        logger.warn(`Skipping symlinked Ghost asset: ${join(src, rel)}`);
        continue;
      }
      const from = join(src, rel);
      const to = join(dst, rel);
      if (await pathExists(to)) continue;
      if (!dryRun) {
        await ensureDir(dirname(to));
        const bytes = await readFile(from);
        await writeFile(to, sanitizeImageAssetBytes(bytes, rel));
      }
      plannedPaths.push(to);
      total += 1;
    }
  }
  return total;
}

// Ghost exports keep project-level routing files under the content directory
// (commonly content/settings/routes.yaml and content/data/redirects.yaml).
// Laurel reads these from the project root, so migrate the first supported
// variant in each family without clobbering an existing project file.
async function copyGhostProjectFiles(
  assetsRoot: string,
  targetRoot: string,
  dryRun: boolean,
  plannedPaths: string[],
): Promise<number> {
  let total = 0;
  for (const family of GHOST_PROJECT_FILE_FAMILIES) {
    if (await hasAnyTargetProjectFile(targetRoot, family.names)) continue;
    const rel = await findFirstProjectFile(assetsRoot, family.candidates);
    if (!rel) continue;
    if (pathContainsSymlink(assetsRoot, rel)) {
      logger.warn(`Skipping symlinked Ghost project file: ${join(assetsRoot, rel)}`);
      continue;
    }
    const destName = rel.endsWith('.yml') ? family.names[1] : family.names[0];
    const dest = join(targetRoot, destName);
    assertWithin(targetRoot, dest);
    if (!dryRun) {
      await ensureDir(targetRoot);
      await writeFile(dest, await readFile(join(assetsRoot, rel)));
    }
    plannedPaths.push(dest);
    total += 1;
  }
  return total;
}

async function hasAnyTargetProjectFile(
  targetRoot: string,
  names: readonly string[],
): Promise<boolean> {
  for (const name of names) {
    if (await pathExists(join(targetRoot, name))) return true;
  }
  return false;
}

async function findFirstProjectFile(
  assetsRoot: string,
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const rel of candidates) {
    if (await isFile(join(assetsRoot, rel))) return rel;
  }
  return undefined;
}

interface ImportedGhostSettings {
  site: Record<string, string>;
  navigation?: NavigationItem[];
  secondary_navigation?: NavigationItem[];
}

interface NavigationItem {
  label: string;
  url: string;
}

// Ghost settings keys that hold an image URL feeding laurel.toml. Kept in
// reference order (site identity first) so the warning/summary list reads
// predictably.
const SETTINGS_IMAGE_KEYS = ['icon', 'logo', 'cover_image', 'og_image', 'twitter_image'] as const;

interface SettingsImageResult {
  settingsImagesDownloaded: number;
  settingsImagesFailed: number;
}

async function writeGhostSettingsConfig(args: {
  settings: readonly GhostSetting[];
  targetRoot: string;
  onConflict: OnConflict;
  counters: { skipped: number; overwritten: number; renamed: number; slugCollisions: number };
  dryRun: boolean;
  plannedPaths: string[];
  downloader: GhostImageDownloader | undefined;
  downloadImages: boolean;
  downloadSettingsImages: boolean;
  sourceUrl: string | undefined;
}): Promise<SettingsImageResult> {
  const imported = collectGhostSettings(args.settings);
  if (!hasImportedSettings(imported)) {
    return { settingsImagesDownloaded: 0, settingsImagesFailed: 0 };
  }

  // Download settings images BEFORE the laurel.toml conflict gate. The
  // documented flow is `laurel init` (which writes laurel.toml) then
  // `import-ghost`, so the default --on-conflict skip leaves laurel.toml in
  // place. Gating the download on writing laurel.toml meant the standard flow
  // never fetched favicon/og:image, leaving them 404 after build. The download
  // is idempotent (existing files are skipped), so running it regardless of the
  // conflict outcome is safe; only the laurel.toml path rewrite stays gated on
  // actually (over)writing the file.
  const settingsImageResult = await downloadSettingsImages(imported, args);

  const dest = join(args.targetRoot, 'laurel.toml');
  assertWithin(args.targetRoot, dest);
  const exists = await pathExists(dest);
  let writePath = dest;
  let existingRaw: string | undefined;

  if (exists) {
    switch (args.onConflict) {
      case 'skip':
        // laurel.toml is left untouched, but the settings images were already
        // fetched above so the existing config's image paths resolve on build.
        process.stderr.write(`Skipped (already exists): ${dest}\n`);
        args.counters.skipped += 1;
        return settingsImageResult;
      case 'overwrite':
        process.stderr.write(`Overwrote: ${dest}\n`);
        args.counters.overwritten += 1;
        existingRaw = await readFile(dest, 'utf8');
        break;
      case 'rename':
        writePath = await nextAvailablePath(dest);
        process.stderr.write(`Renamed (conflict with ${dest}): ${writePath}\n`);
        args.counters.renamed += 1;
        break;
    }
  }

  const contents = renderImportedSettingsConfig(imported, existingRaw);
  if (!args.dryRun) {
    await ensureDir(dirname(writePath));
    await writeFile(writePath, contents, 'utf8');
  }
  args.plannedPaths.push(writePath);
  return settingsImageResult;
}

// Fetch the Ghost settings-level images (icon/logo/cover_image/og_image/
// twitter_image) through the same downloader the body and feature images use,
// then rewrite `imported.site[*]` to the local path. Reusing rewriteField means
// settings images inherit the body-image policy for free: Ghost content assets
// are localized, third-party URLs (e.g. static.ghost.org defaults) stay
// external, and `data:`/other schemes are left alone. Returns the count of
// settings images actually downloaded and the count left unlocalized
// (download failures + third-party URLs kept external).
async function downloadSettingsImages(
  imported: ImportedGhostSettings,
  args: {
    downloader: GhostImageDownloader | undefined;
    downloadImages: boolean;
    downloadSettingsImages: boolean;
    sourceUrl: string | undefined;
  },
): Promise<SettingsImageResult> {
  if (!args.downloadImages || !args.downloadSettingsImages) {
    return { settingsImagesDownloaded: 0, settingsImagesFailed: 0 };
  }

  // Without a source URL the downloader cannot expand `/content/images/...`
  // settings paths to a fetchable URL, so it would silently leave them pointing
  // at files this import never writes. Warn instead of breaking quietly.
  if (!args.sourceUrl) {
    const unresolved = SETTINGS_IMAGE_KEYS.filter((key) => {
      const value = imported.site[key];
      return typeof value === 'string' && isRootRelativeGhostContentAssetPath(value);
    });
    if (unresolved.length > 0) {
      logger.warn(
        `Skipping ${unresolved.length} Ghost settings image(s) (${unresolved.join(', ')}): pass --source-url <ghost-site-url> to download them, otherwise favicon/og:image will 404 after build.`,
      );
    }
    return { settingsImagesDownloaded: 0, settingsImagesFailed: 0 };
  }

  const downloader = args.downloader;
  if (!downloader) return { settingsImagesDownloaded: 0, settingsImagesFailed: 0 };

  const before = { downloaded: downloader.downloaded, failed: downloader.failed };
  for (const key of SETTINGS_IMAGE_KEYS) {
    const value = imported.site[key];
    if (typeof value !== 'string') continue;
    const rewritten = sanitizeImageUrl(await downloader.rewriteField(value), key, 'site settings');
    if (rewritten !== undefined) imported.site[key] = rewritten;
  }
  // Mirror the body-image counters exactly: `downloaded` counts bytes actually
  // fetched, `failed` counts genuine fetch failures only. Third-party URLs left
  // external and on-disk re-import fast-path hits both land in the downloader's
  // `skipped`, which we deliberately exclude here — counting them as "failed"
  // would mislabel a re-import of already-localized settings images.
  return {
    settingsImagesDownloaded: downloader.downloaded - before.downloaded,
    settingsImagesFailed: downloader.failed - before.failed,
  };
}

const SITE_SETTING_KEYS = new Set([
  'title',
  'description',
  'url',
  'locale',
  'timezone',
  'cover_image',
  'logo',
  'icon',
  'accent_color',
  'twitter',
  'facebook',
  'meta_title',
  'meta_description',
  'og_image',
  'og_title',
  'og_description',
  'twitter_image',
  'twitter_title',
  'twitter_description',
]);

function collectGhostSettings(settings: readonly GhostSetting[]): ImportedGhostSettings {
  const imported: ImportedGhostSettings = { site: {} };
  for (const setting of settings) {
    const key = normalizeSettingKey(setting.key);
    if (!key) continue;
    const value = setting.value;
    if (key === 'navigation' || key === 'secondary_navigation') {
      const navigation = parseGhostNavigation(value);
      if (navigation.length > 0) imported[key] = navigation;
      continue;
    }
    if (!SITE_SETTING_KEYS.has(key)) continue;
    const scalar = normalizeSettingScalar(value);
    if (scalar !== undefined) imported.site[key] = scalar;
  }
  return imported;
}

function normalizeSettingKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  return key.length > 0 ? key : undefined;
}

function normalizeSettingScalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return undefined;
}

function parseGhostNavigation(value: unknown): NavigationItem[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      logger.warn(`Skipping invalid Ghost navigation setting: ${JSON.stringify(value)}`);
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const items: NavigationItem[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = normalizeSettingScalar(record.label);
    const url = normalizeSettingScalar(record.url);
    if (!label || !url) continue;
    items.push({ label, url });
  }
  return items;
}

function hasImportedSettings(settings: ImportedGhostSettings): boolean {
  return (
    Object.keys(settings.site).length > 0 ||
    (settings.navigation?.length ?? 0) > 0 ||
    (settings.secondary_navigation?.length ?? 0) > 0
  );
}

function renderImportedSettingsConfig(
  imported: ImportedGhostSettings,
  existingRaw: string | undefined,
): string {
  const root = parseExistingTomlRoot(existingRaw);
  if (Object.keys(imported.site).length > 0) {
    const site = isPlainRecord(root.site) ? root.site : {};
    for (const [key, value] of Object.entries(imported.site)) site[key] = value;
    if (typeof site.title !== 'string' || site.title.trim() === '') site.title = 'Laurel Site';
    root.site = site;
  }
  if (imported.navigation) root.navigation = imported.navigation;
  if (imported.secondary_navigation) root.secondary_navigation = imported.secondary_navigation;
  return TOML.stringify(root as Parameters<typeof TOML.stringify>[0]);
}

function parseExistingTomlRoot(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === '') return {};
  const parsed = TOML.parse(raw);
  return isPlainRecord(parsed) ? deepCloneRecord(parsed) : {};
}

function deepCloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      out[key] = child.map((item) => (isPlainRecord(item) ? deepCloneRecord(item) : item));
    } else if (isPlainRecord(child)) {
      out[key] = deepCloneRecord(child);
    } else {
      out[key] = child;
    }
  }
  return out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Decide what to do for a given (dest, content) pair, then dispatch the
// resulting filesystem work to a bounded parallel queue. The caller awaits
// the *decision*; the actual writeFile resolves later via `writeQueue`. This
// is the split that lets a 50k-post import go IO-bound instead of being
// serialized on `await writeFile` round-trips. See backlog #522.
//
// Sequencing rules:
// 1. The `writtenThisRun` claim is performed synchronously (after the
//    `await pathExists` in the rename branch). Two posts in the same export
//    that resolve to the same dest will see the first claim before the
//    second runs its check — JS is single-threaded between awaits — which
//    preserves the "first occurrence wins" semantics (#1138).
// 2. Rename policy holds the loop iteration for the `nextAvailablePath`
//    scan because the next post may need the freshly-bumped suffix. Skip
//    and overwrite policies dispatch their writes async.
// 3. Counters and stderr messages are emitted by the caller before
//    dispatch so summary output stays deterministic.
async function dispatchWrite(
  dest: string,
  contents: string,
  onConflict: OnConflict,
  counters: { skipped: number; overwritten: number; renamed: number; slugCollisions: number },
  dryRun: boolean,
  writtenThisRun: Set<string>,
  writeQueue: Array<Promise<void>>,
  writeLimit: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<string | undefined> {
  // Intra-export slug collision: another entity in the same import run has
  // already claimed this destination. Ghost rejects duplicate slugs in normal
  // admin flows, so a duplicate inside a single export indicates a malformed
  // or tampered source that should not be allowed to silently substitute one
  // entity for another (#1138). For `skip` and `overwrite` policies we refuse
  // the second occurrence regardless of the user's choice; for `rename` we
  // honor the policy because it preserves both items in separately-named
  // files. The collision is surfaced via the `slugCollisions` counter so
  // operators can audit the source export.
  if (writtenThisRun.has(dest) && onConflict !== 'rename') {
    process.stderr.write(
      `Slug collision within Ghost export (refusing to overwrite item already written in this run): ${dest}\n`,
    );
    counters.slugCollisions += 1;
    return undefined;
  }
  // Treat "already claimed in this run" as equivalent to "already on disk".
  // Without this, a second post writing to the same dest can race past the
  // pathExists check (the queued first write hasn't flushed yet) and we'd
  // either double-write or skip rename's numeric-suffix branch. See #1138.
  const claimedInRun = writtenThisRun.has(dest);
  const existsOnDisk = claimedInRun ? true : await pathExists(dest);
  if (!existsOnDisk) {
    // Claim synchronously before dispatching the async write so a second
    // post with the same slug arriving on the next loop iteration sees the
    // claim and routes through the collision branch above.
    writtenThisRun.add(dest);
    if (!dryRun) writeQueue.push(writeLimit(() => writeFile(dest, contents, 'utf8')));
    return dest;
  }
  switch (onConflict) {
    case 'skip':
      process.stderr.write(`Skipped (already exists): ${dest}\n`);
      counters.skipped += 1;
      return undefined;
    case 'overwrite':
      process.stderr.write(`Overwrote: ${dest}\n`);
      counters.overwritten += 1;
      writtenThisRun.add(dest);
      if (!dryRun) writeQueue.push(writeLimit(() => writeFile(dest, contents, 'utf8')));
      return dest;
    case 'rename': {
      const renamed = await nextAvailablePath(dest, writtenThisRun);
      process.stderr.write(`Renamed (conflict with ${dest}): ${renamed}\n`);
      counters.renamed += 1;
      writtenThisRun.add(renamed);
      if (!dryRun) writeQueue.push(writeLimit(() => writeFile(renamed, contents, 'utf8')));
      return renamed;
    }
  }
}

interface RenderedPostRecord {
  isPage: boolean;
  slug: string;
  originalSlug: unknown;
  dest: string;
  contents: string;
  htmlContents?: string;
  tagSlugs: string[];
  authorSlugs: string[];
}

interface PostPageSlugClaim {
  kind: 'post' | 'page';
  dest: string;
}

interface RenderPostContext {
  opts: ImportGhostOptions;
  counters: {
    skipped: number;
    overwritten: number;
    renamed: number;
    drafts: number;
    statusFiltered: number;
    draftsFiltered: number;
    pagesFiltered: number;
    tagFiltered: number;
    dateFiltered: number;
    bodiesEmpty: number;
    codeInjectionSkipped: number;
    slugCollisions: number;
  };
  filters: ImportFilterSettings;
  keepCodeInjection: boolean;
  keepHtml: boolean;
  downloader: GhostImageDownloader | undefined;
  urlRewriter: GhostUrlRewriter | undefined;
  tagSlugsForPost: (postId: string) => string[];
  authorSlugsForPost: (post: GhostPost) => string[];
  tierSlugsForPost: (postId: string) => string[];
  metaForPost: (postId: string) => GhostPostMeta | undefined;
  turndown: ReturnType<typeof createGhostTurndown>;
}

async function resolvePostPageSlugClaim(
  record: RenderedPostRecord,
  onConflict: OnConflict,
  counters: { renamed: number; slugCollisions: number },
  claimedPostPageSlugs: Map<string, PostPageSlugClaim>,
  writtenThisRun: Set<string>,
): Promise<RenderedPostRecord | undefined> {
  const kind = record.isPage ? 'page' : 'post';
  const existing = claimedPostPageSlugs.get(record.slug);
  if (!existing || existing.kind === kind) return record;

  if (onConflict !== 'rename') {
    process.stderr.write(
      `Post/page slug collision within Ghost export (refusing to write ${kind} ${JSON.stringify(record.slug)} because ${existing.kind} ${JSON.stringify(record.slug)} already claimed the public URL): ${record.dest}\n`,
    );
    counters.slugCollisions += 1;
    return undefined;
  }

  const { slug, dest } = await nextAvailablePostPageSlug(
    record,
    claimedPostPageSlugs,
    writtenThisRun,
  );
  process.stderr.write(`Renamed (post/page slug collision with ${existing.dest}): ${dest}\n`);
  counters.renamed += 1;
  return {
    ...record,
    slug,
    dest,
    contents: replaceImportedSlug(record.contents, slug),
  };
}

async function nextAvailablePostPageSlug(
  record: RenderedPostRecord,
  claimedPostPageSlugs: Map<string, PostPageSlugClaim>,
  writtenThisRun: Set<string>,
): Promise<{ slug: string; dest: string }> {
  const baseDir = dirname(record.dest);
  for (let i = 2; ; i += 1) {
    const slug = `${record.slug}-${i}`;
    const dest = join(baseDir, `${slug}.md`);
    if (claimedPostPageSlugs.has(slug) || writtenThisRun.has(dest) || (await pathExists(dest))) {
      continue;
    }
    return { slug, dest };
  }
}

function replaceImportedSlug(contents: string, slug: string): string {
  return contents.replace(/^slug: .+$/m, `slug: ${JSON.stringify(slug)}`);
}

interface ImportedHtmlCardCandidate {
  start: number;
  end: number;
  html: string;
  hash: string;
}

interface ImportedHtmlCardComponent {
  slug: string;
  contents: string;
}

function findReusableHtmlCardHashes(
  records: ReadonlyArray<RenderedPostRecord | undefined>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record) continue;
    for (const candidate of collectStandaloneHtmlCards(importedMarkdownBody(record.contents))) {
      counts.set(candidate.hash, (counts.get(candidate.hash) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([hash]) => hash));
}

function componentizeReusableHtmlCards(
  contents: string,
  reusableHashes: ReadonlySet<string>,
): { contents: string; components: ImportedHtmlCardComponent[] } {
  if (reusableHashes.size === 0) return { contents, components: [] };
  const split = splitImportedMarkdown(contents);
  const candidates = collectStandaloneHtmlCards(split.body).filter((candidate) =>
    reusableHashes.has(candidate.hash),
  );
  if (candidates.length === 0) return { contents, components: [] };

  const componentsBySlug = new Map<string, ImportedHtmlCardComponent>();
  let body = split.body;
  for (const candidate of [...candidates].sort((a, b) => b.start - a.start)) {
    const slug = importedHtmlCardComponentSlug(candidate.hash);
    componentsBySlug.set(slug, {
      slug,
      contents: renderImportedHtmlCardComponent(slug, candidate.html),
    });
    body = replaceHtmlCardCandidate(body, candidate, `{${slug}}`);
  }
  return {
    contents: `${split.prefix}${body}`,
    components: [...componentsBySlug.values()],
  };
}

function collectStandaloneHtmlCards(markdown: string): ImportedHtmlCardCandidate[] {
  if (!markdown.includes('kg-html-card')) return [];
  const doc = parseDocument(markdown, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
    withEndIndices: true,
    withStartIndices: true,
  });
  const candidates: ImportedHtmlCardCandidate[] = [];
  const visit = (nodes: readonly ChildNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.name.toLowerCase() === 'div' && elementHasClass(node, 'kg-html-card')) {
        const start = node.startIndex;
        const end = node.endIndex;
        if (
          start !== null &&
          end !== null &&
          start >= 0 &&
          end >= start &&
          hasMarkdownBlockBoundary(markdown, start, end)
        ) {
          const html = markdown.slice(start, end + 1).trim();
          candidates.push({ start, end, html, hash: hashImportedHtmlCard(html) });
        }
        continue;
      }
      visit(node.children);
    }
  };
  visit(doc.children as ChildNode[]);
  return candidates;
}

function elementHasClass(node: Element, className: string): boolean {
  return (node.attribs.class ?? '').split(/\s+/).includes(className);
}

function hasMarkdownBlockBoundary(markdown: string, start: number, end: number): boolean {
  const before = markdown.slice(0, start);
  const after = markdown.slice(end + 1);
  const previousWhitespace = before.match(/\s*$/)?.[0] ?? '';
  const nextWhitespace = after.match(/^\s*/)?.[0] ?? '';
  return (
    (before.length === previousWhitespace.length || previousWhitespace.includes('\n')) &&
    (after.length === nextWhitespace.length || nextWhitespace.includes('\n'))
  );
}

function replaceHtmlCardCandidate(
  markdown: string,
  candidate: ImportedHtmlCardCandidate,
  shortcode: string,
): string {
  const before = markdown.slice(0, candidate.start).replace(/[ \t]*$/, '');
  const after = markdown.slice(candidate.end + 1).replace(/^[ \t]*/, '');
  return `${before}\n\n${shortcode}\n\n${after}`;
}

function splitImportedMarkdown(contents: string): { prefix: string; body: string } {
  const match = contents.match(/^---\n[\s\S]*?\n---\n\n?/);
  if (!match) return { prefix: '', body: contents };
  return { prefix: match[0], body: contents.slice(match[0].length) };
}

function importedMarkdownBody(contents: string): string {
  return splitImportedMarkdown(contents).body;
}

function importedHtmlCardComponentSlug(hash: string): string {
  return `ghost-html-card-${hash.slice(0, 12)}`;
}

function hashImportedHtmlCard(html: string): string {
  return createHash('sha256').update(html.trim()).digest('hex');
}

function renderImportedHtmlCardComponent(slug: string, html: string): string {
  const fence = codeFenceFor(html);
  return [
    '---',
    `slug: ${JSON.stringify(slug)}`,
    'description: "Imported Ghost HTML card"',
    '---',
    '',
    `${fence}html`,
    html.trim(),
    fence,
    '',
  ].join('\n');
}

function codeFenceFor(value: string): string {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

// Render a single Ghost post into a (dest, frontmatter+body) pair, or
// `undefined` if the post should be skipped (filtered status, missing slug).
// Designed to run in parallel via pLimit: the turndown call is sync but the
// downloader.rewrite{Text,Field} calls are async and benefit from interleave.
// Counters and slug-change records are mutated here; they are commutative
// across invocations (just integer accumulators / array appends) so parallel
// execution doesn't change the totals.
async function renderPostRecord(
  post: GhostPost,
  ctx: RenderPostContext,
): Promise<RenderedPostRecord | undefined> {
  const { opts, counters, filters, keepCodeInjection, keepHtml, downloader, urlRewriter } = ctx;
  if (post.status && post.status !== 'published' && post.status !== 'draft') {
    counters.statusFiltered += 1;
    return undefined;
  }
  const isPage = post.type === 'page';
  if (filters.active && isPage && !filters.includePages) {
    counters.pagesFiltered += 1;
    return undefined;
  }
  if (post.status === 'draft' && filters.active && !filters.includeDrafts) {
    counters.draftsFiltered += 1;
    return undefined;
  }
  const tagSlugs = ctx.tagSlugsForPost(post.id);
  if (
    !isPage &&
    filters.onlyTagSlugs.size > 0 &&
    !tagSlugs.some((s) => filters.onlyTagSlugs.has(s))
  ) {
    counters.tagFiltered += 1;
    return undefined;
  }
  if (filters.sinceTimestamp !== undefined && !isOnOrAfterSince(post, filters.sinceTimestamp)) {
    counters.dateFiltered += 1;
    return undefined;
  }
  const slug = safeSlug(post.slug) || safeSlug(post.title);
  if (!slug) {
    logger.warn(
      `Skipping post ${post.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(post.slug)} title=${JSON.stringify(post.title)}`,
    );
    return undefined;
  }
  if (post.status === 'draft') counters.drafts += 1;
  const dir = isPage ? 'pages' : 'posts';
  const renderedHtml = renderPostHtml(post);
  const rawBody = renderPostBody(post, ctx.turndown, renderedHtml, opts.maxPostHtmlSizeBytes);
  if (rawBody === '') counters.bodiesEmpty += 1;
  const bodyAfterDownload = downloader ? await downloader.rewriteText(rawBody) : rawBody;
  const body = urlRewriter ? urlRewriter.rewriteText(bodyAfterDownload) : bodyAfterDownload;
  const htmlAfterDownload =
    keepHtml && renderedHtml.trim()
      ? downloader
        ? await downloader.rewriteText(renderedHtml)
        : renderedHtml
      : undefined;
  const htmlContents =
    htmlAfterDownload !== undefined
      ? urlRewriter
        ? urlRewriter.rewriteText(htmlAfterDownload)
        : htmlAfterDownload
      : undefined;
  const postLabel = `post ${JSON.stringify(post.slug ?? post.id ?? '')}`;
  const feature_image = sanitizeImageUrl(
    downloader
      ? await downloader.rewriteField(post.feature_image ?? undefined)
      : (post.feature_image ?? undefined),
    'feature_image',
    postLabel,
  );
  const og_image = sanitizeImageUrl(
    downloader
      ? await downloader.rewriteField(post.og_image ?? undefined)
      : (post.og_image ?? undefined),
    'og_image',
    postLabel,
  );
  const twitter_image = sanitizeImageUrl(
    downloader
      ? await downloader.rewriteField(post.twitter_image ?? undefined)
      : (post.twitter_image ?? undefined),
    'twitter_image',
    postLabel,
  );
  const rawHead = post.codeinjection_head ?? undefined;
  const rawFoot = post.codeinjection_foot ?? undefined;
  const hasInjectedCode =
    (typeof rawHead === 'string' && rawHead.length > 0) ||
    (typeof rawFoot === 'string' && rawFoot.length > 0);
  if (hasInjectedCode && !keepCodeInjection) {
    counters.codeInjectionSkipped += 1;
  }
  const codeinjection_head = keepCodeInjection ? rawHead : undefined;
  const codeinjection_foot = keepCodeInjection ? rawFoot : undefined;
  const tiers = isPage
    ? undefined
    : uniqueStrings([...ctx.tierSlugsForPost(post.id), ...tierSlugsFromPost(post.tiers)]);
  const authorSlugs = ctx.authorSlugsForPost(post);
  const postMeta = ctx.metaForPost(post.id);
  const emailOnlyRaw = post.email_only ?? postMeta?.email_only;
  const sendEmailRaw = post.send_email_when_published ?? postMeta?.send_email_when_published;
  const showTitleRaw = post.show_title_and_feature_image;
  const emailSubject = post.email_subject ?? postMeta?.email_subject ?? undefined;
  const emailOnly = boolFromGhost(emailOnlyRaw, false);
  const sendEmailWhenPublished = boolFromGhost(sendEmailRaw, false);
  const count = postEngagementCount(postMeta);
  const frontmatter = buildFrontmatter({
    id: post.id,
    uuid: post.uuid ?? undefined,
    slug,
    title: post.title,
    date: post.published_at ?? post.created_at ?? undefined,
    created_at: post.created_at ?? undefined,
    updated_at: post.updated_at ?? undefined,
    featured: !!post.featured,
    feature_image,
    feature_image_alt: post.feature_image_alt ?? undefined,
    feature_image_caption: post.feature_image_caption ?? undefined,
    visibility: post.visibility ?? 'public',
    tiers,
    status: post.status ?? 'published',
    tags: tagSlugs,
    authors: authorSlugs,
    custom_excerpt: post.custom_excerpt ?? undefined,
    meta_title: post.meta_title ?? undefined,
    meta_description: post.meta_description ?? undefined,
    og_title: post.og_title ?? undefined,
    og_description: post.og_description ?? undefined,
    og_image,
    twitter_title: post.twitter_title ?? undefined,
    twitter_description: post.twitter_description ?? undefined,
    twitter_image,
    canonical_url: post.canonical_url ?? undefined,
    email_subject: isPage ? undefined : emailSubject,
    email_only:
      isPage || emailOnlyRaw === undefined || emailOnlyRaw === null ? undefined : emailOnly,
    send_email_when_published:
      isPage || sendEmailRaw === undefined || sendEmailRaw === null
        ? undefined
        : sendEmailWhenPublished,
    count: isPage ? undefined : count,
    email_card_segments: isPage ? undefined : extractEmailCardSegments(post),
    frontmatter: normalizeRawPostFrontmatter(post.frontmatter),
    show_title_and_feature_image: isPage
      ? showTitleRaw === undefined || showTitleRaw === null
        ? undefined
        : boolFromGhost(showTitleRaw, true)
      : undefined,
    codeinjection_head,
    codeinjection_foot,
  });
  const outputRoot = resolve(opts.outputDir ?? join(opts.cwd, 'content'));
  const baseDir = join(outputRoot, dir);
  const dest = join(baseDir, `${slug}.md`);
  assertWithin(baseDir, dest);
  return {
    isPage,
    slug,
    originalSlug: post.slug,
    dest,
    contents: renderImportedMarkdown(frontmatter, body),
    htmlContents,
    tagSlugs,
    authorSlugs,
  };
}

function renderImportedMarkdown(frontmatter: string, body: string): string {
  const trimmedBody = body.trim();
  return trimmedBody ? `${frontmatter}\n\n${trimmedBody}\n` : `${frontmatter}\n`;
}

function resolveImportFilters(opts: ImportGhostOptions): ImportFilterSettings {
  const onlyTagSlugs = new Set<string>();
  for (const tag of opts.onlyTags ?? []) {
    const slug = safeSlug(tag);
    if (slug) onlyTagSlugs.add(slug);
  }
  const sinceTimestamp = opts.since ? parseImportSinceTimestamp(opts.since) : undefined;
  const active = onlyTagSlugs.size > 0 || sinceTimestamp !== undefined;
  return {
    active,
    includeDrafts: active ? opts.includeDrafts === true : opts.includeDrafts !== false,
    includePages: active ? opts.includePages === true : opts.includePages !== false,
    onlyTagSlugs,
    sinceTimestamp,
  };
}

export function parseImportSinceTimestamp(input: string): number {
  const trimmed = input.trim();
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid --since value: ${input}. Expected a date like 2024-01-01.`);
  }
  return timestamp;
}

function isOnOrAfterSince(post: GhostPost, sinceTimestamp: number): boolean {
  const raw = post.published_at ?? post.created_at;
  if (!raw) return false;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp >= sinceTimestamp;
}

// Image URL fields (feature_image, og_image, twitter_image, profile_image,
// cover_image) flow from the untrusted Ghost export straight into frontmatter
// and from there into <img src> / <meta og:image> in the rendered HTML. A
// compromised export could set them to `javascript:alert(1)` or
// `data:text/html,<script>…</script>` to smuggle script into pages that
// surface the field (e.g. social card meta tags, lightboxes that echo the
// URL). Allow only http(s):// and relative paths; refuse everything else and
// log a warning so the operator can audit the source export (#562).
//
// Control characters and surrounding whitespace are stripped before scheme
// detection because browsers do the same when resolving URLs in attribute
// values, so `\tjavascript:alert(1)` would otherwise sneak past a naive
// startsWith check.
const URL_SCHEME_RE = /^([a-z][a-z0-9+.\-]*):/i;

function sanitizeImageUrl(
  value: string | null | undefined,
  fieldName: string,
  ownerLabel: string,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  // Strip C0 control chars (U+0000–U+001F) and DEL (U+007F) before scheme
  // detection: browsers remove these when resolving URLs in attribute values,
  // so `\tjavascript:alert(1)` would otherwise sneak past a startsWith check.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional sentinel for attacker-controlled bytes
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (normalized.length === 0) {
    logger.warn(
      `Refusing empty/control-only ${fieldName} URL on ${ownerLabel}: ${JSON.stringify(value)}`,
    );
    return undefined;
  }
  const match = normalized.match(URL_SCHEME_RE);
  if (match) {
    const rawScheme = match[1];
    if (!rawScheme) return undefined;
    const scheme = rawScheme.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      logger.warn(
        `Refusing unsafe ${fieldName} URL on ${ownerLabel}: ${JSON.stringify(value)} (scheme: ${scheme}:)`,
      );
      return undefined;
    }
  }
  return value;
}

// Re-slugify any string from an untrusted Ghost export so it is safe to use as
// a single path segment. `strict: true` strips path separators, dots, and
// other punctuation that could otherwise enable path traversal (#160).
//
// Final result must match SAFE_SLUG_RE before being returned. slugify with
// `lower: true, strict: true` should already emit only [a-z0-9-], but we
// re-check the postcondition so a future slugify upgrade, option drift, or
// dependency-pinning slip can't quietly reintroduce traversal chars like `/`
// or `.` into a path segment (#115).
const SAFE_SLUG_RE = /^[a-z0-9-]+$/;

function safeSlug(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const result = slugify(input, { lower: true, strict: true });
  if (result.length === 0) return '';
  if (!SAFE_SLUG_RE.test(result)) return '';
  return result;
}

function tierSlug(tier: GhostTier | undefined): string {
  if (!tier) return '';
  return safeSlug(tier.slug) || safeSlug(tier.name);
}

function tierSlugsFromPost(tiers: GhostPost['tiers']): string[] {
  if (!Array.isArray(tiers)) return [];
  return tiers.map(tierSlug).filter((slug): slug is string => slug.length > 0);
}

function boolFromGhost(value: boolean | 0 | 1 | null | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
}

function postEngagementCount(meta: GhostPostMeta | undefined): Record<string, number> | undefined {
  if (!meta) return undefined;
  const out: Record<string, number> = {};
  for (const key of [
    'signups',
    'clicks',
    'comments',
    'conversions',
    'positive_feedback',
    'negative_feedback',
  ] as const) {
    const value = nonNegativeInt(meta[key]);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function nonNegativeInt(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n >= 0 ? n : undefined;
  }
  if (typeof value === 'string') {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Defense in depth: even after safeSlug, refuse to write anywhere outside the
// expected base directory. Catches future regressions where a caller forgets
// to sanitize a slug before joining it into a path.
function assertWithin(baseDir: string, candidate: string): void {
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(resolvedBase + sep)) {
    throw new Error(
      `Refusing to write outside target directory: candidate=${resolvedCandidate} base=${resolvedBase}`,
    );
  }
}

// Group rows by a key (post_id) and sort each bucket by sort_order so callers
// can drop the per-call filter+sort. Single pass over the input plus one sort
// per bucket — O(M + sum(k log k)) instead of O(N*M).
function groupBySortedByOrder<T extends { sort_order?: number }, K>(
  rows: T[],
  keyOf: (row: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  for (const bucket of out.values()) {
    bucket.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  return out;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function nextAvailablePath(dest: string, writtenThisRun?: Set<string>): Promise<string> {
  const ext = extname(dest);
  const base = ext ? dest.slice(0, -ext.length) : dest;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (writtenThisRun?.has(candidate)) continue;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Could not find a non-conflicting filename for ${dest} after many attempts`);
}

function renderPostHtml(post: GhostPost): string {
  if (post.html?.trim()) {
    const html = stripGhostUrlPlaceholder(post.html);
    const structuredHtml = renderStructuredPostHtml(post);
    if (!hasBookmarkCardMarkup(html) && hasBookmarkCardMarkup(structuredHtml)) {
      return structuredHtml;
    }
    return html;
  }
  return renderStructuredPostHtml(post);
}

function renderStructuredPostHtml(post: GhostPost): string {
  // Ghost exports written by ≥ 5.x typically carry only the `lexical` column;
  // older 1.x–4.x exports carry `mobiledoc`. Materialise to HTML so the same
  // kg-card-aware turndown pipeline can convert to Markdown (#127).
  if (post.lexical) {
    const html = stripGhostUrlPlaceholder(renderLexicalToHtml(post.lexical));
    if (html.trim()) {
      return html;
    }
  }
  if (post.mobiledoc) {
    const html = stripGhostUrlPlaceholder(renderMobiledocToHtml(post.mobiledoc));
    if (html.trim()) {
      return html;
    }
  }
  return '';
}

function hasBookmarkCardMarkup(html: string): boolean {
  return /\bkg-bookmark-card\b|<!--\s*kg-card-begin:\s*bookmark\s*-->/i.test(html);
}

function renderPostBody(
  post: GhostPost,
  turndown: ReturnType<typeof createGhostTurndown>,
  html = renderPostHtml(post),
  maxPostHtmlSizeBytes?: number,
): string {
  if (html.trim()) {
    const cap = maxPostHtmlSizeBytes ?? DEFAULT_MAX_POST_HTML_BYTES;
    if (Number.isFinite(cap) && cap > 0) {
      const byteLength = Buffer.byteLength(html, 'utf8');
      if (byteLength > cap) {
        logger.warn(
          `Skipping Turndown for ${postImportLabel(post)}: rendered HTML is ${formatImportBytes(byteLength)}, which exceeds the configured per-post HTML cap of ${formatImportBytes(cap)}. Falling back to an empty Markdown body. Re-run with --max-post-html-size to raise the limit, or pass 0 to disable the cap.`,
        );
        return '';
      }
    }

    try {
      const bodyHtml = stripLeadingDuplicateTitleH1(html, post.title);
      const lexicalMarkdownCards = extractLexicalMarkdownCards(post.lexical);
      const rawMarkdownCards =
        lexicalMarkdownCards.length > 0
          ? lexicalMarkdownCards
          : extractMobiledocMarkdownCards(post.mobiledoc);
      if (rawMarkdownCards.length > 0) {
        const body = turndownHtmlPreservingRawMarkdownCards(bodyHtml, rawMarkdownCards, turndown);
        if (body !== null) return body;
      }
      return turndownHtml(bodyHtml, turndown);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Skipping Turndown for ${postImportLabel(post)}: ${reason}. Falling back to an empty Markdown body.`,
      );
      return '';
    }
  }
  if (post.lexical || post.mobiledoc) {
    logger.warn(`Post ${post.slug}: Lexical/Mobiledoc body rendered to empty content, skipping.`);
  }
  return '';
}

function postImportLabel(post: GhostPost): string {
  return `post ${JSON.stringify(post.slug ?? post.id ?? '(no id)')}`;
}

function stripLeadingDuplicateTitleH1(html: string, title: string): string {
  const doc = parseDocument(html, {
    decodeEntities: true,
    lowerCaseAttributeNames: false,
    withEndIndices: true,
    withStartIndices: true,
  });
  const first = doc.children.find((node) => !isBlankTextOrComment(node));
  if (!first || !isElement(first) || first.name.toLowerCase() !== 'h1') return html;
  if (normalizeHeadingText(textContent(first)) !== normalizeHeadingText(title)) return html;

  const start = first.startIndex;
  const end = first.endIndex;
  if (start === null || end === null || start < 0 || end < start) return html;
  return `${html.slice(0, start)}${html.slice(end + 1)}`;
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function textContent(node: ChildNode): string {
  if ('data' in node) return node.data;
  if (!isElement(node)) return '';
  return node.children.map((child) => textContent(child)).join('');
}

function isElement(node: ChildNode): node is Element {
  return 'attribs' in node && 'children' in node;
}

function isBlankTextOrComment(node: ChildNode): boolean {
  if ('data' in node) return node.data.trim() === '';
  return false;
}

function turndownHtml(html: string, turndown: ReturnType<typeof createGhostTurndown>): string {
  return turndown.turndown(preprocessKoenigCardFences(html));
}

function turndownHtmlPreservingRawMarkdownCards(
  html: string,
  rawMarkdownCards: readonly string[],
  turndown: ReturnType<typeof createGhostTurndown>,
): string | null {
  if (rawMarkdownCards.length === 0) return null;

  const chunks: string[] = [];
  let lastIndex = 0;
  let cardIndex = 0;

  for (const match of html.matchAll(MARKDOWN_CARD_FENCE_RE)) {
    if (match.index === undefined) continue;
    if (cardIndex >= rawMarkdownCards.length) return null;

    const before = html.slice(lastIndex, match.index);
    const converted = turndownHtml(before, turndown).trim();
    if (converted) chunks.push(converted);

    const rawCard = rawMarkdownCards[cardIndex];
    if (!rawCard) return null;
    chunks.push(formatRawMarkdownCard(rawCard));
    cardIndex += 1;
    lastIndex = match.index + match[0].length;
  }

  if (cardIndex !== rawMarkdownCards.length) return null;

  const after = turndownHtml(html.slice(lastIndex), turndown).trim();
  if (after) chunks.push(after);

  return chunks.join('\n\n').trim();
}

function normalizeRawPostFrontmatter(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return stripGhostUrlPlaceholder(value);
}

function formatRawMarkdownCard(markdown: string): string {
  const normalized = stripGhostUrlPlaceholder(markdown).replace(/\r\n?/g, '\n');
  const body = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  return `<!--kg-card-begin: markdown-->\n${body}<!--kg-card-end: markdown-->`;
}

function extractLexicalMarkdownCards(json: string | null | undefined): string[] {
  if (typeof json !== 'string' || json.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const cards: string[] = [];
  collectLexicalMarkdownCards((parsed as { root?: unknown })?.root, cards);
  return cards;
}

function collectLexicalMarkdownCards(node: unknown, cards: string[]): void {
  if (typeof node !== 'object' || node === null) return;
  const record = node as { type?: unknown; markdown?: unknown; children?: unknown };
  if (record.type === 'markdown' && typeof record.markdown === 'string') {
    cards.push(record.markdown);
  }
  if (!Array.isArray(record.children)) return;
  for (const child of record.children) {
    collectLexicalMarkdownCards(child, cards);
  }
}

function extractMobiledocMarkdownCards(json: string | null | undefined): string[] {
  if (typeof json !== 'string' || json.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const doc = parsed as { cards?: unknown; sections?: unknown };
  if (!Array.isArray(doc.cards) || !Array.isArray(doc.sections)) return [];

  const cards: string[] = [];
  for (const section of doc.sections) {
    if (!Array.isArray(section) || section[0] !== 10 || typeof section[1] !== 'number') continue;
    const card = doc.cards[section[1]];
    if (!Array.isArray(card) || card[0] !== 'markdown') continue;
    const payload = card[1];
    if (typeof payload === 'object' && payload !== null) {
      const markdown = (payload as { markdown?: unknown }).markdown;
      if (typeof markdown === 'string') cards.push(markdown);
    }
  }
  return cards;
}

function extractEmailCardSegments(post: GhostPost): ImportedEmailCardSegment[] {
  const lexicalSegments = extractLexicalEmailCardSegments(post.lexical);
  if (lexicalSegments.length > 0) return lexicalSegments;
  return extractMobiledocEmailCardSegments(post.mobiledoc);
}

function extractLexicalEmailCardSegments(
  json: string | null | undefined,
): ImportedEmailCardSegment[] {
  const parsed = parseJsonObject(json);
  if (!parsed) return [];
  const cards: ImportedEmailCardSegment[] = [];
  collectLexicalEmailCardSegments(parsed.root, cards);
  return cards;
}

function collectLexicalEmailCardSegments(node: unknown, cards: ImportedEmailCardSegment[]): void {
  if (!isPlainRecord(node)) return;
  const type = node.type;
  if (type === 'email' || type === 'email-cta') {
    cards.push(emailCardSegmentFromPayload(type, node));
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    collectLexicalEmailCardSegments(child, cards);
  }
}

function extractMobiledocEmailCardSegments(
  json: string | null | undefined,
): ImportedEmailCardSegment[] {
  const parsed = parseJsonObject(json);
  if (!parsed || !Array.isArray(parsed.cards) || !Array.isArray(parsed.sections)) return [];

  const cards: ImportedEmailCardSegment[] = [];
  for (const section of parsed.sections) {
    if (!Array.isArray(section) || section[0] !== 10 || typeof section[1] !== 'number') continue;
    const card = parsed.cards[section[1]];
    if (!Array.isArray(card)) continue;
    const type = card[0];
    if (type !== 'email' && type !== 'email-cta') continue;
    cards.push(emailCardSegmentFromPayload(type, card[1]));
  }
  return cards;
}

function emailCardSegmentFromPayload(
  type: 'email' | 'email-cta',
  payload: unknown,
): ImportedEmailCardSegment {
  const out: ImportedEmailCardSegment = { type };
  if (isPlainRecord(payload)) {
    const html = payload.html;
    if (typeof html === 'string' && html.length > 0) {
      out.html = stripGhostUrlPlaceholder(html);
    }
    const visibility = jsonRecord(payload.visibility);
    if (visibility) out.visibility = visibility;
  }
  return out;
}

function parseJsonObject(json: string | null | undefined): Record<string, unknown> | undefined {
  if (typeof json !== 'string' || json.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  try {
    const cloned: unknown = JSON.parse(JSON.stringify(value));
    return isPlainRecord(cloned) ? cloned : undefined;
  } catch {
    return undefined;
  }
}

function buildFrontmatter(data: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}
