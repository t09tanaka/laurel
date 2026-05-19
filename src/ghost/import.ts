import {
  access,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import slugify from 'slugify';
import { ensureDir, pathContainsSymlink } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { GhostImageDownloader } from './image-downloader.ts';
import { renderLexicalToHtml } from './lexical-renderer.ts';
import { renderMobiledocToHtml } from './mobiledoc-renderer.ts';
import { type SlugChange, loadRedirectsJson, writeRedirectMaps } from './redirects.ts';
import { createGhostTurndown, preprocessKoenigCardFences } from './turndown-rules.ts';
import { GhostUrlRewriter } from './url-rewriter.ts';

export type OnConflict = 'skip' | 'overwrite' | 'rename';

export const ON_CONFLICT_VALUES: readonly OnConflict[] = ['skip', 'overwrite', 'rename'];

const turndown = createGhostTurndown();

// Ghost exports replace site URLs with the literal `__GHOST_URL__` placeholder
// in HTML bodies and image/URL fields. We rewrite to the empty string so the
// remaining `/content/images/...` path resolves against the deployed site root.
const GHOST_URL_PLACEHOLDER = /__GHOST_URL__/g;

function stripGhostUrlPlaceholder<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(GHOST_URL_PLACEHOLDER, '') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripGhostUrlPlaceholder(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripGhostUrlPlaceholder(v);
    }
    return out as T;
  }
  return value;
}

interface GhostExportDbEntry {
  data?: {
    posts?: GhostPost[];
    tags?: GhostTag[];
    users?: GhostUser[];
    posts_tags?: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
    posts_authors?: Array<{ post_id: string; user_id: string; sort_order?: number }>;
  };
}

interface GhostExport {
  db: GhostExportDbEntry[];
}

interface MergedGhostData {
  posts: GhostPost[];
  tags: GhostTag[];
  users: GhostUser[];
  postsTags: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
  postsAuthors: Array<{ post_id: string; user_id: string; sort_order?: number }>;
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
  visibility?: 'public' | 'members' | 'paid';
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

interface GhostTag {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  feature_image?: string | null;
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
    postsTags: [],
    postsAuthors: [],
  };

  let sawData = false;
  for (const entry of db) {
    const d = entry?.data;
    if (!d) continue;
    sawData = true;
    if (d.posts) merged.posts.push(...d.posts);
    if (d.tags) merged.tags.push(...d.tags);
    if (d.users) merged.users.push(...d.users);
    if (d.posts_tags) merged.postsTags.push(...d.posts_tags);
    if (d.posts_authors) merged.postsAuthors.push(...d.posts_authors);
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
  };

  let extractedZipRoot: string | undefined;
  let inputFile = opts.file;
  if (opts.file.toLowerCase().endsWith('.zip')) {
    const extracted = await extractZipExport(opts.file);
    extractedZipRoot = extracted.cleanupRoot;
    inputFile = extracted.contentRoot;
  }

  try {
    return await importFromResolvedInput(inputFile, opts, onConflict, counters);
  } finally {
    if (extractedZipRoot) {
      await rm(extractedZipRoot, { recursive: true, force: true });
    }
  }
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
  },
): Promise<ImportSummary> {
  const dryRun = opts.dryRun === true;
  const resolved = await resolveInput(inputFile, opts.assetsDir);
  const raw = await readFile(resolved.jsonFile, 'utf8');
  const parsed = stripGhostUrlPlaceholder(JSON.parse(raw) as GhostExport);
  const { posts, tags, users, postsTags, postsAuthors } = mergeGhostDbEntries(parsed.db);

  // Image download requires network and writes to content/images. In dry-run
  // mode we skip the downloader entirely; the dry-run summary should preview
  // local-only side effects rather than perform fetches.
  const downloader =
    opts.downloadImages && !dryRun
      ? new GhostImageDownloader({ cwd: opts.cwd, fetcher: opts.fetcher })
      : undefined;
  const urlRewriter = opts.sourceUrl ? new GhostUrlRewriter(opts.sourceUrl) : undefined;

  const tagById = new Map(tags.map((t) => [t.id, t]));
  const userById = new Map(users.map((u) => [u.id, u]));

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

  let postCount = 0;
  let pageCount = 0;
  for (const post of posts) {
    if (post.status && post.status !== 'published' && post.status !== 'draft') {
      counters.statusFiltered += 1;
      continue;
    }
    const isPage = post.type === 'page';
    const slug = safeSlug(post.slug) || safeSlug(post.title);
    if (!slug) {
      logger.warn(
        `Skipping post ${post.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(post.slug)} title=${JSON.stringify(post.title)}`,
      );
      continue;
    }
    recordSlugChange(isPage ? 'page' : 'post', post.slug, slug);
    if (post.status === 'draft') counters.drafts += 1;
    const dir = isPage ? 'content/pages' : 'content/posts';
    const rawBody = renderPostBody(post);
    if (rawBody === '') counters.bodiesEmpty += 1;
    const bodyAfterDownload = downloader ? await downloader.rewriteText(rawBody) : rawBody;
    const body = urlRewriter ? urlRewriter.rewriteText(bodyAfterDownload) : bodyAfterDownload;
    const feature_image = downloader
      ? await downloader.rewriteField(post.feature_image ?? undefined)
      : (post.feature_image ?? undefined);
    const og_image = downloader
      ? await downloader.rewriteField(post.og_image ?? undefined)
      : (post.og_image ?? undefined);
    const twitter_image = downloader
      ? await downloader.rewriteField(post.twitter_image ?? undefined)
      : (post.twitter_image ?? undefined);
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
      status: post.status ?? 'published',
      tags: tagSlugsForPost(post.id),
      authors: authorSlugsForPost(post.id),
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
      codeinjection_head: post.codeinjection_head ?? undefined,
      codeinjection_foot: post.codeinjection_foot ?? undefined,
    });
    const baseDir = join(opts.cwd, dir);
    const dest = join(baseDir, `${slug}.md`);
    assertWithin(baseDir, dest);
    if (!dryRun) await ensureDir(baseDir);
    const written = await writeWithConflictPolicy(
      dest,
      `${frontmatter}\n\n${body}\n`,
      onConflict,
      counters,
      dryRun,
    );
    if (!written) continue;
    if (isPage) pageCount += 1;
    else postCount += 1;
  }

  let tagCount = 0;
  for (const tag of tags) {
    if (!tag.description && !tag.feature_image && !tag.meta_title) continue;
    const tagSlug = safeSlug(tag.slug) || safeSlug(tag.name);
    if (!tagSlug) {
      logger.warn(
        `Skipping tag ${tag.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(tag.slug)} name=${JSON.stringify(tag.name)}`,
      );
      continue;
    }
    recordSlugChange('tag', tag.slug, tagSlug);
    const baseDir = join(opts.cwd, 'content/tags');
    const dest = join(baseDir, `${tagSlug}.md`);
    assertWithin(baseDir, dest);
    if (!dryRun) await ensureDir(baseDir);
    const tagFeatureImage = downloader
      ? await downloader.rewriteField(tag.feature_image ?? undefined)
      : (tag.feature_image ?? undefined);
    const frontmatter = buildFrontmatter({
      slug: tagSlug,
      name: tag.name,
      description: tag.description ?? undefined,
      feature_image: tagFeatureImage,
      meta_title: tag.meta_title ?? undefined,
      meta_description: tag.meta_description ?? undefined,
    });
    const written = await writeWithConflictPolicy(
      dest,
      `${frontmatter}\n`,
      onConflict,
      counters,
      dryRun,
    );
    if (written) tagCount += 1;
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
    const baseDir = join(opts.cwd, 'content/authors');
    const dest = join(baseDir, `${userSlug}.md`);
    assertWithin(baseDir, dest);
    if (!dryRun) await ensureDir(baseDir);
    const profileImage = downloader
      ? await downloader.rewriteField(user.profile_image ?? undefined)
      : (user.profile_image ?? undefined);
    const coverImage = downloader
      ? await downloader.rewriteField(user.cover_image ?? undefined)
      : (user.cover_image ?? undefined);
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
    const written = await writeWithConflictPolicy(
      dest,
      `${frontmatter}\n`,
      onConflict,
      counters,
      dryRun,
    );
    if (written) authorCount += 1;
  }

  const assetsCopied = resolved.assetsDir
    ? await copyGhostAssets(resolved.assetsDir, opts.cwd, resolved.assetsDirIsExplicit, dryRun)
    : 0;

  // Ghost stores custom redirects at content/data/redirects.json. The resolved
  // assetsDir points at the Ghost `content/` folder when the user passed a
  // directory or zip, so the lookup happens here. When the user passed only
  // the JSON file, we have no asset root to inspect and skip the load (#503).
  const customRedirects = resolved.assetsDir ? await loadRedirectsJson(resolved.assetsDir) : [];
  const redirectMaps = await writeRedirectMaps({
    cwd: opts.cwd,
    customRedirects,
    slugChanges,
    dryRun,
  });

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

async function findExportJson(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name);
  const fallback = jsonFiles[0];
  if (!fallback) {
    throw new Error(`No .json export file found in ${dir}`);
  }
  const ghosty = jsonFiles.find((n) => /ghost/i.test(n));
  return join(dir, ghosty ?? fallback);
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
  cwd: string,
  isExplicit: boolean,
  dryRun: boolean,
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
    const dst = join(cwd, 'content', name);
    const glob = new Bun.Glob('**/*');
    for await (const rel of glob.scan({ cwd: src, onlyFiles: true })) {
      if (pathContainsSymlink(src, rel)) {
        logger.warn(`Skipping symlinked Ghost asset: ${join(src, rel)}`);
        continue;
      }
      const from = join(src, rel);
      const to = join(dst, rel);
      if (await pathExists(to)) continue;
      if (!dryRun) {
        await ensureDir(dirname(to));
        await copyFile(from, to);
      }
      total += 1;
    }
  }
  return total;
}

async function writeWithConflictPolicy(
  dest: string,
  contents: string,
  onConflict: OnConflict,
  counters: { skipped: number; overwritten: number; renamed: number },
  dryRun: boolean,
): Promise<boolean> {
  if (!(await pathExists(dest))) {
    if (!dryRun) await writeFile(dest, contents, 'utf8');
    return true;
  }
  switch (onConflict) {
    case 'skip':
      process.stderr.write(`Skipped (already exists): ${dest}\n`);
      counters.skipped += 1;
      return false;
    case 'overwrite':
      process.stderr.write(`Overwrote: ${dest}\n`);
      if (!dryRun) await writeFile(dest, contents, 'utf8');
      counters.overwritten += 1;
      return true;
    case 'rename': {
      const renamed = await nextAvailablePath(dest);
      process.stderr.write(`Renamed (conflict with ${dest}): ${renamed}\n`);
      if (!dryRun) await writeFile(renamed, contents, 'utf8');
      counters.renamed += 1;
      return true;
    }
  }
}

// Re-slugify any string from an untrusted Ghost export so it is safe to use as
// a single path segment. `strict: true` strips path separators, dots, and
// other punctuation that could otherwise enable path traversal (#160).
function safeSlug(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return slugify(input, { lower: true, strict: true });
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

async function nextAvailablePath(dest: string): Promise<string> {
  const ext = extname(dest);
  const base = ext ? dest.slice(0, -ext.length) : dest;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Could not find a non-conflicting filename for ${dest} after many attempts`);
}

function renderPostBody(post: GhostPost): string {
  if (post.html?.trim()) {
    return turndown.turndown(preprocessKoenigCardFences(post.html));
  }
  // Ghost exports written by ≥ 5.x typically carry only the `lexical` column;
  // older 1.x–4.x exports carry `mobiledoc`. Materialise to HTML so the same
  // kg-card-aware turndown pipeline can convert to Markdown (#127).
  if (post.lexical) {
    const html = renderLexicalToHtml(post.lexical);
    if (html.trim()) {
      return turndown.turndown(preprocessKoenigCardFences(html));
    }
  }
  if (post.mobiledoc) {
    const html = renderMobiledocToHtml(post.mobiledoc);
    if (html.trim()) {
      return turndown.turndown(preprocessKoenigCardFences(html));
    }
  }
  if (post.lexical || post.mobiledoc) {
    logger.warn(`Post ${post.slug}: Lexical/Mobiledoc body rendered to empty content, skipping.`);
  }
  return '';
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
