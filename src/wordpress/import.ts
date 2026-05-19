import { access, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import slugify from 'slugify';
import { parseStringPromise } from 'xml2js';
import { ON_CONFLICT_VALUES, type OnConflict } from '~/ghost/import.ts';
import { createGhostTurndown, preprocessKoenigCardFences } from '~/ghost/turndown-rules.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

export { ON_CONFLICT_VALUES };
export type { OnConflict };

// Turndown is configured for Ghost's Koenig cards, but the underlying HTML-to-
// Markdown rules apply just as well to WordPress's `content:encoded` payloads.
// Reusing the same instance keeps the output shape consistent across both
// importers, which is what callers expect when they consume the resulting
// `content/posts/<slug>.md` files (#501).
const turndown = createGhostTurndown();

// xml2js (with `explicitArray: false`) parses leaf elements as plain strings
// when they have no attributes, and as `{ _: 'text', $: { attr: ... } }` when
// they do. WXR's `<category>` is the only element that carries attributes we
// care about (`domain`, `nicename`), so it arrives in the latter shape.
// Repeated elements (multiple `<item>`, `<wp:author>`, etc.) become arrays
// only when there is more than one. `toArray()` normalises that ambiguity so
// the rest of the importer always sees a list.
type XmlText = string | { _: string; $?: Record<string, string> };

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

interface WxrCategoryElement {
  _: string;
  $?: { domain?: string; nicename?: string };
}

interface WxrAuthor {
  'wp:author_login'?: XmlText;
  'wp:author_email'?: XmlText;
  'wp:author_display_name'?: XmlText;
  'wp:author_first_name'?: XmlText;
  'wp:author_last_name'?: XmlText;
}

interface WxrTagTerm {
  'wp:term_id'?: XmlText;
  'wp:tag_slug'?: XmlText;
  'wp:tag_name'?: XmlText;
  'wp:tag_description'?: XmlText;
}

interface WxrItem {
  title?: XmlText;
  link?: XmlText;
  pubDate?: XmlText;
  'dc:creator'?: XmlText;
  guid?: XmlText | { _: string; $?: { isPermaLink?: string } };
  description?: XmlText;
  'content:encoded'?: XmlText;
  'excerpt:encoded'?: XmlText;
  'wp:post_id'?: XmlText;
  'wp:post_date'?: XmlText;
  'wp:post_date_gmt'?: XmlText;
  'wp:post_modified'?: XmlText;
  'wp:post_modified_gmt'?: XmlText;
  'wp:status'?: XmlText;
  'wp:post_name'?: XmlText;
  'wp:post_type'?: XmlText;
  'wp:post_parent'?: XmlText;
  category?: WxrCategoryElement | WxrCategoryElement[];
}

interface WxrChannel {
  title?: XmlText;
  link?: XmlText;
  description?: XmlText;
  'wp:author'?: WxrAuthor | WxrAuthor[];
  'wp:tag'?: WxrTagTerm | WxrTagTerm[];
  item?: WxrItem | WxrItem[];
}

interface WxrDocument {
  rss?: {
    channel?: WxrChannel | WxrChannel[];
  };
}

export interface ImportWordPressOptions {
  cwd: string;
  // Path to a WXR (WordPress eXtended RSS) export file. WordPress writes these
  // from Tools → Export as `*.xml` (or `*.wordpress.xml`).
  file: string;
  onConflict?: OnConflict;
  // When true, walk the export and count what would happen without writing any
  // files. Mirrors the Ghost importer's `--dry-run` so users with large
  // exports can preview before committing (#501).
  dryRun?: boolean;
}

export interface WordPressImportSummary {
  posts: number;
  pages: number;
  tags: number;
  authors: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  // Items whose post_type is not one of {post, page} (e.g. attachment,
  // nav_menu_item, revision). They are not imported but counted for the
  // dry-run summary.
  typeFiltered: number;
  // Items with `wp:status` not in {publish, draft}. Mirrors the Ghost
  // importer's `statusFiltered` counter.
  statusFiltered: number;
  // Imported items whose `content:encoded` was empty after CDATA unwrap.
  bodiesEmpty: number;
  // Items written with `wp:status === 'draft'`. Imported alongside published
  // content; tracked separately so dry-run callers can see how many drafts
  // would land before committing to the write.
  drafts: number;
  dryRun: boolean;
}

export async function importWordPressExport(
  opts: ImportWordPressOptions,
): Promise<WordPressImportSummary> {
  const onConflict: OnConflict = opts.onConflict ?? 'skip';
  const dryRun = opts.dryRun === true;
  const counters = {
    skipped: 0,
    overwritten: 0,
    renamed: 0,
    typeFiltered: 0,
    statusFiltered: 0,
    bodiesEmpty: 0,
    drafts: 0,
  };

  const raw = await readWxrFile(opts.file);
  const parsed = (await parseStringPromise(raw, {
    // explicitArray:false collapses single occurrences to objects and only
    // wraps in arrays when an element appears multiple times. `toArray()`
    // normalises the ambiguity at every list iteration site.
    explicitArray: false,
    trim: false,
    explicitCharkey: false,
  })) as WxrDocument;

  const channel = pickChannel(parsed);
  if (!channel) {
    throw new Error(`Invalid WXR export: <rss><channel>... not found in ${opts.file}`);
  }

  // We only need term-level metadata for tags (description, name) because that
  // is what gets written to content/tags/<slug>.md. Categories on items are
  // surfaced inside each post's frontmatter directly and never get their own
  // metadata file in the current implementation.
  const tagBySlug = new Map<string, WxrTagTerm>();
  for (const t of toArray(channel['wp:tag'])) {
    const slug = safeSlug(text(t['wp:tag_slug'])) || safeSlug(text(t['wp:tag_name']));
    if (slug) tagBySlug.set(slug, t);
  }

  let postCount = 0;
  let pageCount = 0;
  for (const item of toArray(channel.item)) {
    const postType = text(item['wp:post_type']) || 'post';
    if (postType !== 'post' && postType !== 'page') {
      counters.typeFiltered += 1;
      continue;
    }
    const status = text(item['wp:status']);
    if (status && status !== 'publish' && status !== 'draft') {
      counters.statusFiltered += 1;
      continue;
    }
    const slug = safeSlug(text(item['wp:post_name'])) || safeSlug(text(item.title));
    if (!slug) {
      logger.warn(
        `Skipping WordPress item ${text(item['wp:post_id']) || '(no id)'}: cannot derive a safe slug from post_name=${JSON.stringify(text(item['wp:post_name']))} title=${JSON.stringify(text(item.title))}`,
      );
      continue;
    }
    if (status === 'draft') counters.drafts += 1;

    const html = text(item['content:encoded']);
    const body = html.trim() ? turndown.turndown(preprocessKoenigCardFences(html)) : '';
    if (body === '') counters.bodiesEmpty += 1;

    const excerpt = text(item['excerpt:encoded']);
    const author = text(item['dc:creator']);
    const tagSlugs: string[] = [];
    const categorySlugs: string[] = [];
    for (const cat of toArray(item.category)) {
      const domain = cat.$?.domain ?? 'category';
      const slugFromCat = safeSlug(cat.$?.nicename ?? '') || safeSlug(cat._ ?? '');
      if (!slugFromCat) continue;
      if (domain === 'post_tag') tagSlugs.push(slugFromCat);
      else if (domain === 'category') categorySlugs.push(slugFromCat);
    }

    const isPage = postType === 'page';
    const dir = isPage ? 'content/pages' : 'content/posts';
    const frontmatter = buildFrontmatter({
      slug,
      title: text(item.title),
      date:
        normalizeDate(text(item['wp:post_date_gmt'])) ?? normalizeDate(text(item['wp:post_date'])),
      updated_at:
        normalizeDate(text(item['wp:post_modified_gmt'])) ??
        normalizeDate(text(item['wp:post_modified'])),
      status: status === 'draft' ? 'draft' : 'published',
      tags: tagSlugs,
      // WP categories don't map cleanly onto a single Ghost-style concept;
      // surfacing them as additional tags is the lowest-surprise option and
      // matches what most existing WP-to-static converters do.
      categories: categorySlugs,
      authors: author ? [safeSlug(author)] : [],
      custom_excerpt: excerpt || undefined,
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

  let tagWritten = 0;
  for (const [slug, tag] of tagBySlug) {
    const description = text(tag['wp:tag_description']);
    const name = text(tag['wp:tag_name']);
    if (!description && !name) continue;
    const baseDir = join(opts.cwd, 'content/tags');
    const dest = join(baseDir, `${slug}.md`);
    assertWithin(baseDir, dest);
    if (!dryRun) await ensureDir(baseDir);
    const frontmatter = buildFrontmatter({
      slug,
      name: name || slug,
      description: description || undefined,
    });
    const written = await writeWithConflictPolicy(
      dest,
      `${frontmatter}\n`,
      onConflict,
      counters,
      dryRun,
    );
    if (written) tagWritten += 1;
  }

  let authorWritten = 0;
  for (const a of toArray(channel['wp:author'])) {
    const login = text(a['wp:author_login']);
    const display = text(a['wp:author_display_name']);
    const slug = safeSlug(login) || safeSlug(display);
    if (!slug) {
      logger.warn(
        `Skipping WordPress author: cannot derive a safe slug from login=${JSON.stringify(login)} display=${JSON.stringify(display)}`,
      );
      continue;
    }
    const baseDir = join(opts.cwd, 'content/authors');
    const dest = join(baseDir, `${slug}.md`);
    assertWithin(baseDir, dest);
    if (!dryRun) await ensureDir(baseDir);
    const frontmatter = buildFrontmatter({
      slug,
      name: display || login || slug,
      email: text(a['wp:author_email']) || undefined,
    });
    const written = await writeWithConflictPolicy(
      dest,
      `${frontmatter}\n`,
      onConflict,
      counters,
      dryRun,
    );
    if (written) authorWritten += 1;
  }

  return {
    posts: postCount,
    pages: pageCount,
    tags: tagWritten,
    authors: authorWritten,
    skipped: counters.skipped,
    overwritten: counters.overwritten,
    renamed: counters.renamed,
    typeFiltered: counters.typeFiltered,
    statusFiltered: counters.statusFiltered,
    bodiesEmpty: counters.bodiesEmpty,
    drafts: counters.drafts,
    dryRun,
  };
}

async function readWxrFile(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read WordPress export at ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function pickChannel(doc: WxrDocument): WxrChannel | undefined {
  const ch = doc.rss?.channel;
  if (!ch) return undefined;
  return Array.isArray(ch) ? ch[0] : ch;
}

function text(value: XmlText | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && '_' in value) {
    return (value._ ?? '').trim();
  }
  return '';
}

// WXR dates look like "2026-01-15 09:30:00" (local) or "2026-01-15T09:30:00Z"
// (GMT). The local form is ambiguous without TZ data; we coerce both to ISO so
// downstream frontmatter consumers (gray-matter + the build's date helpers)
// parse them deterministically.
function normalizeDate(raw: string): string | undefined {
  if (!raw) return undefined;
  // WP exports literally write "0000-00-00 00:00:00" for unset timestamps.
  if (raw.startsWith('0000-')) return undefined;
  const space = raw.replace(' ', 'T');
  return space.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(space) ? space : `${space}Z`;
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

function safeSlug(input: string): string {
  if (!input) return '';
  return slugify(input, { lower: true, strict: true });
}

function assertWithin(baseDir: string, candidate: string): void {
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(resolvedBase + sep)) {
    throw new Error(
      `Refusing to write outside target directory: candidate=${resolvedCandidate} base=${resolvedBase}`,
    );
  }
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
