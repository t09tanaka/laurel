import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import slugify from 'slugify';
import { pLimit } from '~/util/concurrency.ts';
import { ensureDir, pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { sanitizeImageAssetBytes } from '~/util/image-sanitization.ts';
import { logger } from '~/util/logger.ts';
import { GhostImageDownloader } from './image-downloader.ts';
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

const turndown = createGhostTurndown();
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
    posts_tags?: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
    posts_authors?: Array<{ post_id: string; user_id: string; sort_order?: number }>;
    posts_tiers?: Array<{ post_id: string; tier_id: string; sort_order?: number }>;
  };
}

interface GhostExport {
  db: GhostExportDbEntry[];
}

interface MergedGhostData {
  posts: GhostPost[];
  tags: GhostTag[];
  users: GhostUser[];
  tiers: GhostTier[];
  postsTags: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
  postsAuthors: Array<{ post_id: string; user_id: string; sort_order?: number }>;
  postsTiers: Array<{ post_id: string; tier_id: string; sort_order?: number }>;
}

interface GhostPost {
  id: string;
  uuid?: string;
  title: string;
  slug: string;
  html?: string | null;
  mobiledoc?: string | null;
  lexical?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  featured?: boolean | 0 | 1;
  type?: 'post' | 'page';
  status?: string;
  visibility?: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
  tiers?: GhostTier[] | null;
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

interface GhostTier {
  id: string;
  slug?: string | null;
  name?: string | null;
  monthly_price?: number | null;
  yearly_price?: number | null;
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
  meta_title?: string | null;
  meta_description?: string | null;
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
  // Posts whose lexical/mobiledoc body rendered to empty content and so
  // would be written as empty markdown. Surfaced separately so users with
  // large exports can spot silent body loss before importing.
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
  // primarily surfaced by `nectar import-ghost --dry-run` so operators can
  // review the exact files before committing an import.
  plannedPaths: string[];
}

export interface ImportProgressEvent {
  type: 'posts';
  processedPosts: number;
  totalPosts: number;
}

export interface ImportGhostOptions {
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
}

// Ghost subfolder names whose contents should be copied verbatim into
// <cwd>/content/<name>/ so that imported markdown's /content/<name>/... URLs
// resolve at build time.
const GHOST_ASSET_SUBDIRS = ['images', 'files', 'media'] as const;

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
    postsTags: [],
    postsAuthors: [],
    postsTiers: [],
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
    if (d.posts_tags) merged.postsTags.push(...d.posts_tags);
    if (d.posts_authors) merged.postsAuthors.push(...d.posts_authors);
    if (d.posts_tiers) merged.postsTiers.push(...d.posts_tiers);
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
      `${opts.file} looks like a WordPress WXR XML export. Use \`nectar import-wordpress ${opts.file}\` instead.`,
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

export type GhostExportFormat = 'json' | 'zip' | 'directory' | 'wordpress-xml' | 'unknown';

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
  await assertJsonWithinSizeCap(resolved.jsonFile, opts.maxFileSizeBytes);
  const raw = await readFile(resolved.jsonFile, 'utf8');
  let parsed: GhostExport;
  try {
    parsed = stripGhostUrlPlaceholder(JSON.parse(raw) as GhostExport);
  } catch (err) {
    const reason = err instanceof Error ? `: ${err.message}` : '';
    throw new Error(`Invalid JSON in Ghost export: ${resolved.jsonFile}${reason}`);
  }
  const { posts, tags, users, tiers, postsTags, postsAuthors, postsTiers } = mergeGhostDbEntries(
    parsed.db,
  );

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

  const tagSlugsForPost = (postId: string): string[] =>
    (postsTagsByPost.get(postId) ?? [])
      .map((r) => {
        const t = tagById.get(r.tag_id);
        if (!t) return '';
        return safeSlug(t.slug) || safeSlug(t.name);
      })
      .filter((slug): slug is string => slug.length > 0);

  const authorSlugsForPost = (postId: string): string[] =>
    (postsAuthorsByPost.get(postId) ?? [])
      .map((r) => {
        const u = userById.get(r.user_id);
        if (!u) return '';
        return safeSlug(u.slug) || safeSlug(u.name);
      })
      .filter((slug): slug is string => slug.length > 0);

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
          keepCodeInjection,
          keepHtml,
          downloader,
          urlRewriter,
          tagSlugsForPost,
          authorSlugsForPost,
          tierSlugsForPost,
        }).finally(reportPostProgress),
      ),
    ),
  );

  let postCount = 0;
  let pageCount = 0;
  // Phase B: sequential conflict claim + parallel writes. The
  // `writtenThisRun.has`/`add` cycle has to be sync to give first-occurrence
  // wins (#1138), but once a destination is claimed the actual writeFile is
  // queued onto the same fan-out as the body renderer. Rename policy stays
  // serial because nextAvailablePath() needs an accurate view of
  // writtenThisRun + the live filesystem to pick the next numeric suffix.
  const writeLimit = pLimit(IMPORT_CONCURRENCY);
  const writeQueue: Array<Promise<void>> = [];
  const plannedPaths: string[] = [];
  let htmlPreserved = 0;
  for (const r of renderedPosts) {
    if (!r) continue;
    recordSlugChange(r.isPage ? 'page' : 'post', r.originalSlug, r.slug);
    if (!dryRun) await ensureDirOnce(dirname(r.dest));
    const written = await dispatchWrite(
      r.dest,
      r.contents,
      onConflict,
      counters,
      dryRun,
      writtenThisRun,
      writeQueue,
      writeLimit,
    );
    if (!written) continue;
    plannedPaths.push(written);
    if (r.htmlContents !== undefined) {
      const htmlDest = `${written}.html`;
      const htmlWritten = await dispatchWrite(
        htmlDest,
        r.htmlContents,
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
    if (r.isPage) pageCount += 1;
    else postCount += 1;
  }
  await Promise.all(writeQueue);

  // Tags and authors are much smaller than posts in any real Ghost export
  // (O(hundreds), not O(tens of thousands)), so we don't bother with a
  // separate render-fanout phase. We do still parallelize the writes via the
  // same writeLimit so a 500-tag export doesn't pay 500*roundtrip serially.
  let tagCount = 0;
  for (const tag of tags) {
    if (!tag.description && !tag.feature_image && !tag.accent_color && !tag.meta_title) continue;
    const tagSlug = safeSlug(tag.slug) || safeSlug(tag.name);
    if (!tagSlug) {
      logger.warn(
        `Skipping tag ${tag.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(tag.slug)} name=${JSON.stringify(tag.name)}`,
      );
      continue;
    }
    recordSlugChange('tag', tag.slug, tagSlug);
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
    const frontmatter = buildFrontmatter({
      slug: tagSlug,
      name: tag.name,
      description: tag.description ?? undefined,
      feature_image: tagFeatureImage,
      accent_color: tag.accent_color ?? undefined,
      meta_title: tag.meta_title ?? undefined,
      meta_description: tag.meta_description ?? undefined,
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
    const userSlug = safeSlug(user.slug) || safeSlug(user.name);
    if (!userSlug) {
      logger.warn(
        `Skipping author ${user.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(user.slug)} name=${JSON.stringify(user.name)}`,
      );
      continue;
    }
    recordSlugChange('author', user.slug, userSlug);
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
      meta_title: user.meta_title ?? undefined,
      meta_description: user.meta_description ?? undefined,
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
    dryRun,
    drafts: counters.drafts,
    statusFiltered: counters.statusFiltered,
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

  const dir = await mkdtemp(join(tmpdir(), 'nectar-ghost-zip-'));
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
    const stderrText = await new Response(proc.stderr).text();
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
  if (!only.isDirectory()) return dir;
  return join(dir, only.name);
}

interface ResolvedInput {
  jsonFile: string;
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

  let jsonFile: string;
  let folderAssetsDir: string | undefined;

  if (st.isDirectory()) {
    jsonFile = await findExportJson(file);
    const candidateContent = join(file, 'content');
    if (await isDirectory(candidateContent)) {
      folderAssetsDir = candidateContent;
    } else if (await hasAnyAssetSubdir(file)) {
      folderAssetsDir = file;
    }
  } else {
    jsonFile = file;
  }

  if (explicitAssetsDir) {
    const resolvedExplicit = resolve(explicitAssetsDir);
    if (!(await isDirectory(resolvedExplicit))) {
      throw new Error(
        `--assets directory does not exist or is not a directory: ${resolvedExplicit}`,
      );
    }
    return { jsonFile, assetsDir: resolvedExplicit, assetsDirIsExplicit: true };
  }

  return { jsonFile, assetsDir: folderAssetsDir, assetsDirIsExplicit: false };
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

async function findExportJson(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name);
  const fallback = jsonFiles[0];
  if (!fallback) {
    throw new Error(`Ghost export directory does not contain a .json export file: ${dir}`);
  }
  const ghosty = jsonFiles.find((n) => /ghost/i.test(n));
  return join(dir, ghosty ?? fallback);
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
}

interface RenderPostContext {
  opts: ImportGhostOptions;
  counters: {
    skipped: number;
    overwritten: number;
    renamed: number;
    drafts: number;
    statusFiltered: number;
    bodiesEmpty: number;
    codeInjectionSkipped: number;
    slugCollisions: number;
  };
  keepCodeInjection: boolean;
  keepHtml: boolean;
  downloader: GhostImageDownloader | undefined;
  urlRewriter: GhostUrlRewriter | undefined;
  tagSlugsForPost: (postId: string) => string[];
  authorSlugsForPost: (postId: string) => string[];
  tierSlugsForPost: (postId: string) => string[];
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
  const { opts, counters, keepCodeInjection, keepHtml, downloader, urlRewriter } = ctx;
  if (post.status && post.status !== 'published' && post.status !== 'draft') {
    counters.statusFiltered += 1;
    return undefined;
  }
  const isPage = post.type === 'page';
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
  const rawBody = renderPostBody(post, renderedHtml);
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
  const frontmatter = buildFrontmatter({
    slug,
    title: post.title,
    date: post.published_at ?? post.created_at ?? undefined,
    updated_at: post.updated_at ?? undefined,
    featured: !!post.featured,
    feature_image,
    feature_image_alt: post.feature_image_alt ?? undefined,
    feature_image_caption: post.feature_image_caption ?? undefined,
    visibility: post.visibility ?? 'public',
    tiers,
    status: post.status ?? 'published',
    tags: ctx.tagSlugsForPost(post.id),
    authors: ctx.authorSlugsForPost(post.id),
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
    contents: `${frontmatter}\n\n${body}\n`,
    htmlContents,
  };
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
    const scheme = match[1].toLowerCase();
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
    return stripGhostUrlPlaceholder(post.html);
  }
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

function renderPostBody(post: GhostPost, html = renderPostHtml(post)): string {
  if (html.trim()) {
    const lexicalMarkdownCards = extractLexicalMarkdownCards(post.lexical);
    const rawMarkdownCards =
      lexicalMarkdownCards.length > 0
        ? lexicalMarkdownCards
        : extractMobiledocMarkdownCards(post.mobiledoc);
    if (rawMarkdownCards.length > 0) {
      const body = turndownHtmlPreservingRawMarkdownCards(html, rawMarkdownCards);
      if (body !== null) return body;
    }
    return turndownHtml(html);
  }
  if (post.lexical || post.mobiledoc) {
    logger.warn(`Post ${post.slug}: Lexical/Mobiledoc body rendered to empty content, skipping.`);
  }
  return '';
}

function turndownHtml(html: string): string {
  return turndown.turndown(preprocessKoenigCardFences(html));
}

function turndownHtmlPreservingRawMarkdownCards(
  html: string,
  rawMarkdownCards: readonly string[],
): string | null {
  if (rawMarkdownCards.length === 0) return null;

  const chunks: string[] = [];
  let lastIndex = 0;
  let cardIndex = 0;

  for (const match of html.matchAll(MARKDOWN_CARD_FENCE_RE)) {
    if (match.index === undefined) continue;
    if (cardIndex >= rawMarkdownCards.length) return null;

    const before = html.slice(lastIndex, match.index);
    const converted = turndownHtml(before).trim();
    if (converted) chunks.push(converted);

    chunks.push(formatRawMarkdownCard(rawMarkdownCards[cardIndex]));
    cardIndex += 1;
    lastIndex = match.index + match[0].length;
  }

  if (cardIndex !== rawMarkdownCards.length) return null;

  const after = turndownHtml(html.slice(lastIndex)).trim();
  if (after) chunks.push(after);

  return chunks.join('\n\n').trim();
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
