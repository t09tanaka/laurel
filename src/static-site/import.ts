import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { parse as parseToml } from '@iarna/toml';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import slugify from 'slugify';
import type { RedirectRule } from '~/build/redirects.ts';
import { ensureDir } from '~/util/fs.ts';
import { ON_CONFLICT_VALUES, type OnConflict } from '~/wordpress/import.ts';

export { ON_CONFLICT_VALUES };
export type { OnConflict };

export type StaticSiteSource = 'hugo' | 'jekyll';

interface ImportStaticSiteOptions {
  cwd: string;
  source: StaticSiteSource;
  sourcePath: string;
  onConflict?: OnConflict;
  dryRun?: boolean;
}

interface StaticSiteImportSummary {
  posts: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  redirects: number;
  unsupportedFrontmatter: number;
  sourceDir: string;
  dryRun: boolean;
}

interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
  unsupportedFrontmatter: boolean;
}

interface ConflictCounters {
  skipped: number;
  overwritten: number;
  renamed: number;
}

export async function importStaticSiteMarkdown(
  opts: ImportStaticSiteOptions,
): Promise<StaticSiteImportSummary> {
  const root = resolve(opts.cwd, opts.sourcePath);
  const sourceDir = await findPostsDir(root, opts.source);
  if (!sourceDir) {
    throw new Error(
      `Could not locate a posts directory under ${root}. Expected ${expectedSubdirsLabel(opts.source)}.`,
    );
  }

  const dryRun = opts.dryRun === true;
  const onConflict = opts.onConflict ?? 'skip';
  const counters: ConflictCounters = { skipped: 0, overwritten: 0, renamed: 0 };
  const files = await collectMarkdown(sourceDir);
  const redirectRules: RedirectRule[] = [];
  let posts = 0;
  let unsupportedFrontmatter = 0;

  for (const rel of files) {
    const src = join(sourceDir, rel);
    const raw = await readFile(src, 'utf8');
    const parsed = parseMarkdownFrontmatter(raw);
    if (parsed.unsupportedFrontmatter) unsupportedFrontmatter += 1;

    const slug = deriveSlug(parsed.data, rel);
    const targetUrl = `/${slug}/`;
    const remapped = remapFrontmatter(parsed.data, rel, slug, opts.source);
    for (const alias of aliasPaths(parsed.data.aliases)) {
      if (alias !== targetUrl) {
        redirectRules.push({ from: alias, to: targetUrl, status: 301, force: false });
      }
    }

    const destDir = join(opts.cwd, 'content/posts');
    const dest = join(destDir, `${slug}.md`);
    assertWithin(destDir, dest);
    const contents = `${dumpFrontmatter(remapped)}\n\n${parsed.body.trimStart()}`;
    if (!dryRun) await ensureDir(destDir);
    const written = await writeWithConflictPolicy(dest, ensureTrailingNewline(contents), {
      onConflict,
      counters,
      dryRun,
    });
    if (written) posts += 1;
  }

  if (redirectRules.length > 0 && !dryRun) {
    await appendRedirects(opts.cwd, redirectRules);
  }

  return {
    posts,
    skipped: counters.skipped,
    overwritten: counters.overwritten,
    renamed: counters.renamed,
    redirects: redirectRules.length,
    unsupportedFrontmatter,
    sourceDir,
    dryRun,
  };
}

async function findPostsDir(root: string, source: StaticSiteSource): Promise<string | null> {
  if (!(await isDirectory(root))) {
    throw new Error(
      `Source directory not found or not a directory: ${root}. Expected a ${source} project root.`,
    );
  }
  const candidates =
    source === 'hugo' ? ['content/posts', 'content/post', 'content/blog', 'content'] : ['_posts'];
  for (const rel of candidates) {
    const dir = join(root, rel);
    if (await isDirectory(dir)) return dir;
  }
  return null;
}

function expectedSubdirsLabel(source: StaticSiteSource): string {
  return source === 'hugo'
    ? 'content/posts/, content/post/, content/blog/, or content/'
    : '_posts/';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Bun.file(path).stat();
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function collectMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      if (ext === '.md' || ext === '.markdown') out.push(rel);
    }
  }
  await walk(dir, '');
  out.sort();
  return out;
}

function parseMarkdownFrontmatter(raw: string): ParsedMarkdown {
  if (raw.startsWith('---\n') || raw.startsWith('---\r\n')) {
    const close = findClosingFence(raw, '---');
    if (close) {
      return {
        data: parseYamlObject(close.frontmatter),
        body: raw.slice(close.bodyStart),
        unsupportedFrontmatter: false,
      };
    }
  }
  if (raw.startsWith('+++\n') || raw.startsWith('+++\r\n')) {
    const close = findClosingFence(raw, '+++');
    if (close) {
      return {
        data: parseTomlObject(close.frontmatter),
        body: raw.slice(close.bodyStart),
        unsupportedFrontmatter: false,
      };
    }
  }
  return {
    data: {},
    body: raw,
    unsupportedFrontmatter: raw.startsWith('---') || raw.startsWith('+++'),
  };
}

function findClosingFence(
  raw: string,
  fence: '---' | '+++',
): { frontmatter: string; bodyStart: number } | null {
  const firstLineEnd = raw.indexOf('\n');
  if (firstLineEnd === -1) return null;
  const matcher = new RegExp(`\\r?\\n${escapeRegExp(fence)}\\r?\\n`);
  const match = matcher.exec(raw.slice(firstLineEnd));
  if (!match || match.index < 0) return null;
  const frontmatterStart = firstLineEnd + 1;
  const fenceStart = firstLineEnd + match.index + (match[0].startsWith('\r') ? 1 : 0);
  return {
    frontmatter: raw.slice(frontmatterStart, fenceStart),
    bodyStart: firstLineEnd + match.index + match[0].length,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseYamlObject(raw: string): Record<string, unknown> {
  const parsed = loadYaml(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseTomlObject(raw: string): Record<string, unknown> {
  const parsed = parseToml(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function deriveSlug(data: Record<string, unknown>, rel: string): string {
  const explicit = firstString(data.slug, data.url, data.permalink);
  if (explicit) {
    const normalized = explicit.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '');
    const last = normalized.split('/').filter(Boolean).pop();
    const slug = safeSlug(last ?? normalized);
    if (slug) return slug;
  }
  const filename = rel.split('/').pop() ?? rel;
  const withoutExt = filename.replace(/\.(md|markdown)$/i, '');
  return safeSlug(withoutExt.replace(/^\d{4}-\d{2}-\d{2}-/, '')) || 'post';
}

function remapFrontmatter(
  data: Record<string, unknown>,
  rel: string,
  slug: string,
  source: StaticSiteSource,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'categories' || key === 'aliases' || key === 'permalink' || key === 'url') continue;
    if (key === 'draft') continue;
    next[key] = value;
  }

  next.slug = slug;
  if (typeof next.title !== 'string' || next.title.trim() === '') {
    next.title = titleFromSlug(slug);
  }
  const date = firstString(data.date, data.published_at) ?? dateFromJekyllFilename(source, rel);
  if (date) next.date = normalizeDate(date);
  if (data.draft === true || data.published === false) {
    next.status = 'draft';
  } else if (typeof next.status !== 'string') {
    next.status = 'published';
  }

  const tags = [...slugList(data.tags), ...slugList(data.categories)];
  if (tags.length > 0) next.tags = [...new Set(tags)];
  return next;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function slugList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return values
    .map((entry) =>
      typeof entry === 'string' || typeof entry === 'number' ? safeSlug(String(entry)) : '',
    )
    .filter(Boolean);
}

function aliasPaths(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const withoutHost = raw.trim().replace(/^https?:\/\/[^/]+/i, '');
    const path = withoutHost.startsWith('/') ? withoutHost : `/${withoutHost}`;
    out.push(path.endsWith('/') ? path : `${path}/`);
  }
  return [...new Set(out)];
}

function dateFromJekyllFilename(source: StaticSiteSource, rel: string): string | undefined {
  if (source !== 'jekyll') return undefined;
  const filename = rel.split('/').pop() ?? '';
  const match = /^(\d{4}-\d{2}-\d{2})-/.exec(filename);
  return match?.[1];
}

function normalizeDate(raw: string): string {
  return raw.replace(' ', 'T');
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function dumpFrontmatter(data: Record<string, unknown>): string {
  return `---\n${dumpYaml(data, { lineWidth: 100, sortKeys: false }).trimEnd()}\n---`;
}

async function writeWithConflictPolicy(
  dest: string,
  contents: string,
  opts: { onConflict: OnConflict; counters: ConflictCounters; dryRun: boolean },
): Promise<boolean> {
  if (!(await pathExists(dest))) {
    if (!opts.dryRun) await writeFile(dest, contents, 'utf8');
    return true;
  }
  switch (opts.onConflict) {
    case 'skip':
      process.stderr.write(`Skipped (already exists): ${dest}\n`);
      opts.counters.skipped += 1;
      return false;
    case 'overwrite':
      process.stderr.write(`Overwrote: ${dest}\n`);
      if (!opts.dryRun) await writeFile(dest, contents, 'utf8');
      opts.counters.overwritten += 1;
      return true;
    case 'rename': {
      const renamed = await nextAvailablePath(dest);
      process.stderr.write(`Renamed (conflict with ${dest}): ${renamed}\n`);
      if (!opts.dryRun) await writeFile(renamed, contents, 'utf8');
      opts.counters.renamed += 1;
      return true;
    }
  }
}

async function appendRedirects(cwd: string, rules: RedirectRule[]): Promise<void> {
  const path = join(cwd, 'redirects.yaml');
  const existing = (await pathExists(path)) ? parseRedirects(await readFile(path, 'utf8')) : [];
  const seen = new Set(existing.map((rule) => rule.from));
  const merged = [...existing];
  for (const rule of rules) {
    if (seen.has(rule.from)) continue;
    seen.add(rule.from);
    merged.push(rule);
  }
  await writeFile(path, dumpYaml(merged, { lineWidth: 100, sortKeys: false }), 'utf8');
}

function parseRedirects(raw: string): RedirectRule[] {
  const parsed = loadYaml(raw);
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid redirects.yaml: expected a list before appending imported aliases.');
  }
  return parsed as RedirectRule[];
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

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}
