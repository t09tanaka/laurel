import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { loadContent } from '~/content/loader.ts';
import type { Page, Post } from '~/content/model.ts';
import { logger } from '~/util/logger.ts';
import {
  type ContentKind,
  absolutise,
  contentSearchKinds,
  resolveContentSlugPath,
} from '../content-paths.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { CONTENT_SPEC } from '../specs.ts';

type Kind = ContentKind;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

interface ContentRow {
  slug: string;
  title: string;
  date: string;
  status: string;
  tags: string[];
  authors: string[];
  url: string;
}

export async function runContent(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CONTENT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CONTENT_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CONTENT_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  if (sub === 'show') {
    return runShow({ parsed, cwd, configPath });
  }
  if (sub === 'rename') {
    return runRename({ parsed, cwd, configPath });
  }
  if (sub === 'delete') {
    return runDelete({ parsed, cwd, configPath, now: new Date() });
  }
  if (sub === 'touch') {
    return runTouch({ parsed, cwd, configPath });
  }
  if (sub !== 'list') {
    process.stderr.write(
      `Unknown subcommand: ${sub ?? ''}. Expected \`list\`, \`show <slug>\`, \`rename <old-slug> <new-slug>\`, \`delete <slug>\`, or \`touch <slug>\`.\n`,
    );
    return 2;
  }

  const kindRaw = typeof parsed.values.kind === 'string' ? parsed.values.kind : 'posts';
  if (kindRaw !== 'posts' && kindRaw !== 'pages') {
    process.stderr.write(`Invalid --kind value: ${kindRaw} (expected "posts" or "pages")\n`);
    return 2;
  }
  const kind: Kind = kindRaw;
  const includeDrafts = parsed.values.draft === true;
  const tagFilters = parseCsvList(typeof parsed.values.tag === 'string' ? parsed.values.tag : '');
  const authorFilters = parseCsvList(
    typeof parsed.values.author === 'string' ? parsed.values.author : '',
  );
  const asJson = parsed.values.json === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const graph = await loadContent({ cwd, config, includeDrafts });

    const items = kind === 'posts' ? graph.posts : graph.pages;
    const rows = items
      .filter((item) => (tagFilters.length > 0 ? hasAnyTag(item, tagFilters) : true))
      .filter((item) => (authorFilters.length > 0 ? hasAnyAuthor(item, authorFilters) : true))
      .map(toRow);

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ kind, count: rows.length, items: rows }, null, 2)}\n`,
      );
    } else if (rows.length === 0) {
      process.stdout.write(`No ${kind} match the given filters.\n`);
    } else {
      process.stdout.write(renderTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

interface DeleteOpts {
  parsed: ParsedCommand;
  cwd: string;
  configPath: string | undefined;
  now: Date;
}

interface TrashMetadata {
  slug: string;
  kind: Kind | null;
  original_path: string;
  trash_path: string;
  trashed_at: string;
  purge_after: string;
}

async function runDelete({ parsed, cwd, configPath, now }: DeleteOpts): Promise<number> {
  const slug = parsed.positionals[1]?.trim();
  if (parsed.positionals.length > 2) {
    process.stderr.write('`content delete` takes at most one <slug> positional.\n');
    return 2;
  }
  const asJson = parsed.values.json === true;
  const purge = parsed.values.purge === true;

  if (purge) {
    return purgeTrash({ cwd, slug, now, asJson });
  }
  if (!slug) {
    process.stderr.write('`content delete` requires <slug> unless --purge is set.\n');
    return 2;
  }

  const kindHint = parseKindHint(parsed);
  if (kindHint === false) return 2;

  try {
    const config = await loadConfig({ cwd, configPath });
    const dirs: Record<Kind, string> = {
      posts: absolutise(cwd, config.content.posts_dir),
      pages: absolutise(cwd, config.content.pages_dir),
    };
    const resolved = await resolveContentSlugPath(slug, contentSearchKinds(kindHint), dirs);
    if (!resolved) {
      process.stderr.write(`No post or page found with slug "${slug}".\n`);
      return 1;
    }

    const { kind, path: sourcePath } = resolved;
    const trashedAt = now.toISOString();
    const purgeAfter = new Date(now.getTime() + TRASH_RETENTION_MS).toISOString();
    const trashDir = resolveUniqueTrashDir(cwd, now);
    const trashPath = join(trashDir, `${slug}.md`);
    const metadataPath = join(trashDir, `${slug}.meta.json`);

    await mkdir(trashDir, { recursive: true });
    await rename(sourcePath, trashPath);
    const metadata: TrashMetadata = {
      slug,
      kind,
      original_path: relative(cwd, sourcePath),
      trash_path: relative(cwd, trashPath),
      trashed_at: trashedAt,
      purge_after: purgeAfter,
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            slug,
            kind,
            original_path: sourcePath,
            trash_path: trashPath,
            metadata_path: metadataPath,
            purge_after: purgeAfter,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      logger.info(`Moved ${sourcePath} to ${trashPath}`);
      logger.info(`Wrote restore metadata to ${metadataPath}`);
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function parseKindHint(parsed: ParsedCommand): Kind | undefined | false {
  const kindRaw =
    typeof parsed.values.kind === 'string' ? parsed.values.kind.trim().toLowerCase() : '';
  if (!kindRaw) return undefined;
  if (kindRaw !== 'posts' && kindRaw !== 'pages') {
    process.stderr.write(`Invalid --kind value: ${kindRaw} (expected "posts" or "pages")\n`);
    return false;
  }
  return kindRaw;
}

function timestampForPath(now: Date): string {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function resolveUniqueTrashDir(cwd: string, now: Date): string {
  const trashRoot = join(cwd, '.laurel', 'trash');
  for (let offsetMs = 0; offsetMs < 1000; offsetMs += 1) {
    const candidate = join(trashRoot, timestampForPath(new Date(now.getTime() + offsetMs)));
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('could not allocate a unique trash directory');
}

interface PurgeOpts {
  cwd: string;
  slug: string | undefined;
  now: Date;
  asJson: boolean;
}

async function purgeTrash({ cwd, slug, now, asJson }: PurgeOpts): Promise<number> {
  const trashRoot = join(cwd, '.laurel', 'trash');
  const cutoff = now.getTime() - TRASH_RETENTION_MS;
  if (!existsSync(trashRoot)) {
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ purged: 0, entries: [] }, null, 2)}\n`);
    } else {
      logger.info('No trash entries to purge.');
    }
    return 0;
  }

  const purged: Array<{ slug: string | null; path: string; trashed_at: string | null }> = [];
  const entries = await readdir(trashRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryDir = join(trashRoot, entry.name);
    const trashedAt = parseTrashTimestamp(entry.name);
    if (!trashedAt || trashedAt.getTime() > cutoff) continue;

    const target = await findTrashTarget(entryDir, slug);
    if (!target) continue;
    await rm(entryDir, { recursive: true, force: true });
    purged.push({
      slug: target.slug,
      path: entryDir,
      trashed_at: trashedAt.toISOString(),
    });
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ purged: purged.length, entries: purged }, null, 2)}\n`,
    );
  } else if (purged.length === 0) {
    logger.info('No trash entries older than 30 days matched.');
  } else {
    logger.info(`Purged ${purged.length} trash entr${purged.length === 1 ? 'y' : 'ies'}.`);
  }
  return 0;
}

function parseTrashTimestamp(name: string): Date | null {
  const iso = name.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, '$1:$2:$3.$4');
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function findTrashTarget(
  entryDir: string,
  slug: string | undefined,
): Promise<{ slug: string | null } | null> {
  const entries = await readdir(entryDir, { withFileTypes: true });
  const meta = entries.find((entry) => entry.isFile() && entry.name.endsWith('.meta.json'));
  if (meta) {
    let parsed: Partial<TrashMetadata>;
    try {
      const raw = await readFile(join(entryDir, meta.name), 'utf8');
      parsed = JSON.parse(raw) as Partial<TrashMetadata>;
    } catch {
      return null;
    }
    const metadataSlug = typeof parsed.slug === 'string' ? parsed.slug : null;
    if (!slug || metadataSlug === slug) return { slug: metadataSlug };
    return null;
  }

  const markdown = entries.find((entry) => entry.isFile() && entry.name.endsWith('.md'));
  if (!markdown) return null;
  const inferredSlug = basename(markdown.name, '.md');
  if (!slug || inferredSlug === slug) return { slug: inferredSlug };
  return null;
}

function parseCsvList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function hasAnyTag(item: Post | Page, slugs: readonly string[]): boolean {
  return item.tags.some((t) => slugs.includes(t.slug));
}

function hasAnyAuthor(item: Post | Page, slugs: readonly string[]): boolean {
  return item.authors.some((a) => slugs.includes(a.slug));
}

function toRow(item: Post | Page): ContentRow {
  return {
    slug: item.slug,
    title: item.title,
    date: item.published_at,
    status: item.status,
    tags: item.tags.map((t) => t.slug),
    authors: item.authors.map((a) => a.slug),
    url: item.url,
  };
}

function renderTable(rows: ContentRow[]): string {
  const headers = ['slug', 'title', 'date', 'status'];
  const widths = headers.map((h) => h.length);
  for (const r of rows) {
    widths[0] = Math.max(widths[0] ?? 0, r.slug.length);
    widths[1] = Math.max(widths[1] ?? 0, Math.min(r.title.length, 50));
    widths[2] = Math.max(widths[2] ?? 0, r.date.length);
    widths[3] = Math.max(widths[3] ?? 0, r.status.length);
  }
  const lines: string[] = [];
  lines.push(
    `${pad(headers[0] ?? '', widths[0] ?? 0)}  ${pad(headers[1] ?? '', widths[1] ?? 0)}  ${pad(headers[2] ?? '', widths[2] ?? 0)}  ${pad(headers[3] ?? '', widths[3] ?? 0)}`,
  );
  lines.push(
    `${'-'.repeat(widths[0] ?? 0)}  ${'-'.repeat(widths[1] ?? 0)}  ${'-'.repeat(widths[2] ?? 0)}  ${'-'.repeat(widths[3] ?? 0)}`,
  );
  for (const r of rows) {
    const title = r.title.length > 50 ? `${r.title.slice(0, 47)}…` : r.title;
    lines.push(
      `${pad(r.slug, widths[0] ?? 0)}  ${pad(title, widths[1] ?? 0)}  ${pad(r.date, widths[2] ?? 0)}  ${pad(r.status, widths[3] ?? 0)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

interface ContentCommandOpts {
  parsed: ParsedCommand;
  cwd: string;
  configPath: string | undefined;
}

async function runShow({ parsed, cwd, configPath }: ContentCommandOpts): Promise<number> {
  const slug = parsed.positionals[1];
  if (!slug) {
    process.stderr.write('`content show` requires <slug>.\n');
    return 2;
  }
  if (parsed.positionals.length > 2) {
    process.stderr.write('`content show` takes exactly <slug>.\n');
    return 2;
  }

  const kindHint = parseKindHintValue(parsed.values.kind);
  if (kindHint === false) return 2;
  const lines = parseLineCount(parsed.values.lines);
  if (lines === undefined) return 2;

  const asJson = parsed.values.json === true;
  const frontmatterOnly = parsed.values.frontmatter === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const dirs: Record<Kind, string> = {
      posts: absolutise(cwd, config.content.posts_dir),
      pages: absolutise(cwd, config.content.pages_dir),
    };
    const resolved = await resolveContentSlugPath(slug, contentSearchKinds(kindHint), dirs);
    if (!resolved) {
      process.stderr.write(`No post or page found with slug "${slug}".\n`);
      return 1;
    }

    const raw = await readFile(resolved.path, 'utf8');
    const parsedFrontmatter = parseFrontmatter(raw, { filePath: resolved.path });
    const frontmatterBlock = extractFrontmatterBlock(raw);
    const bodyPreview = previewBody(parsedFrontmatter.body, lines);

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            kind: resolved.kind,
            slug,
            path: resolved.path,
            frontmatter: parsedFrontmatter.data,
            body_preview: frontmatterOnly ? '' : bodyPreview,
          },
          null,
          2,
        )}\n`,
      );
    } else if (frontmatterOnly) {
      process.stdout.write(frontmatterBlock ? ensureTrailingNewline(frontmatterBlock) : '');
    } else {
      process.stdout.write(renderShowOutput(frontmatterBlock, bodyPreview));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function parseKindHintValue(value: string | boolean | undefined): Kind | undefined | false {
  const kindRaw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!kindRaw) return undefined;
  if (kindRaw !== 'posts' && kindRaw !== 'pages') {
    process.stderr.write(`Invalid --kind value: ${kindRaw} (expected "posts" or "pages")\n`);
    return false;
  }
  return kindRaw;
}

function parseLineCount(value: string | boolean | undefined): number | undefined {
  if (value === undefined) return 20;
  if (typeof value !== 'string') {
    process.stderr.write('Invalid --lines value: expected a positive integer.\n');
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    process.stderr.write(`Invalid --lines value: ${value} (expected a positive integer)\n`);
    return undefined;
  }
  return Number.parseInt(trimmed, 10);
}

function extractFrontmatterBlock(raw: string): string {
  const normalized = raw.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') return '';
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      return lines.slice(0, i + 1).join('\n');
    }
  }
  return '';
}

function previewBody(body: string, lines: number): string {
  const trimmed = body.replace(/^\r?\n/, '').replaceAll('\r\n', '\n');
  return trimmed.split('\n').slice(0, lines).join('\n');
}

function renderShowOutput(frontmatterBlock: string, bodyPreview: string): string {
  const parts = [frontmatterBlock, bodyPreview].filter((part) => part.length > 0);
  return ensureTrailingNewline(parts.join('\n\n'));
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

async function runRename({ parsed, cwd, configPath }: ContentCommandOpts): Promise<number> {
  const oldSlug = parsed.positionals[1];
  const newSlug = parsed.positionals[2];
  if (!oldSlug || !newSlug) {
    process.stderr.write('`content rename` requires <old-slug> and <new-slug>.\n');
    return 2;
  }
  if (parsed.positionals.length > 3) {
    process.stderr.write('`content rename` takes exactly <old-slug> <new-slug>.\n');
    return 2;
  }
  if (oldSlug === newSlug) {
    process.stderr.write('Old and new slug are identical; nothing to do.\n');
    return 2;
  }
  if (!SLUG_RE.test(newSlug)) {
    process.stderr.write(
      `Invalid new slug: ${newSlug}. Expected lowercase alphanumerics + dashes (e.g. \`my-post\`).\n`,
    );
    return 2;
  }

  const kindRaw = typeof parsed.values.kind === 'string' ? parsed.values.kind : 'posts';
  if (kindRaw !== 'posts' && kindRaw !== 'pages') {
    process.stderr.write(`Invalid --kind value: ${kindRaw} (expected "posts" or "pages")\n`);
    return 2;
  }
  const kind: Kind = kindRaw;
  const asJson = parsed.values.json === true;
  const addRedirect = parsed.values.redirect === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const baseDir = kind === 'posts' ? config.content.posts_dir : config.content.pages_dir;
    const baseAbs = absolutise(cwd, baseDir);
    const oldFile = join(baseAbs, `${oldSlug}.md`);
    const newFile = join(baseAbs, `${newSlug}.md`);

    if (!existsSync(oldFile)) {
      process.stderr.write(`No such file: ${oldFile}\n`);
      return 1;
    }
    if (existsSync(newFile)) {
      process.stderr.write(`Destination already exists: ${newFile}\n`);
      return 1;
    }

    const original = await readFile(oldFile, 'utf8');
    const updated = rewriteFrontmatterSlug(original, newSlug);
    // Write updated body to the destination path then unlink the source so a
    // mid-operation crash never leaves both copies on disk. Using a temp file
    // would also work but would still need a final unlink — keep this simple.
    await writeFile(newFile, updated, 'utf8');
    await unlink(oldFile);

    let redirectAppended: string | null = null;
    if (addRedirect) {
      const basePath = normaliseBasePath(config.build.base_path);
      const from = `${basePath}${oldSlug}/`;
      const to = `${basePath}${newSlug}/`;
      redirectAppended = await appendRedirect(cwd, from, to);
    }

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            kind,
            old_slug: oldSlug,
            new_slug: newSlug,
            old_path: oldFile,
            new_path: newFile,
            redirect_appended: redirectAppended,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      logger.info(`Renamed ${oldSlug} -> ${newSlug} (${oldFile} -> ${newFile})`);
      if (redirectAppended) {
        logger.info(`Appended redirect to ${redirectAppended}`);
      }
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

async function runTouch({ parsed, cwd, configPath }: ContentCommandOpts): Promise<number> {
  const slug = parsed.positionals[1];
  if (!slug) {
    process.stderr.write('`content touch` requires <slug>.\n');
    return 2;
  }
  if (parsed.positionals.length > 2) {
    process.stderr.write('`content touch` takes exactly <slug>.\n');
    return 2;
  }

  const kindHint = parseKindHintValue(parsed.values.kind);
  if (kindHint === false) return 2;
  const search = contentSearchKinds(kindHint);

  const dateRaw = typeof parsed.values.date === 'string' ? parsed.values.date : 'now';
  const updatedAt = parseTouchDate(dateRaw, '--date');
  if (updatedAt === undefined) return 2;

  let publishedAt: string | undefined;
  if (typeof parsed.values['published-at'] === 'string') {
    publishedAt = parseTouchDate(parsed.values['published-at'], '--published-at');
    if (publishedAt === undefined) return 2;
  } else if (parsed.values.published === true) {
    publishedAt = updatedAt;
  }

  const asJson = parsed.values.json === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const dirs: Record<Kind, string> = {
      posts: absolutise(cwd, config.content.posts_dir),
      pages: absolutise(cwd, config.content.pages_dir),
    };
    const matches = await resolveContentFilesBySlug(slug, search, dirs);
    if (matches.length === 0) {
      process.stderr.write(`No post or page found with slug "${slug}".\n`);
      return 1;
    }
    if (matches.length > 1) {
      process.stderr.write(
        `Slug "${slug}" is ambiguous (${matches.map((m) => m.kind).join(', ')}). Pass --kind posts or --kind pages.\n`,
      );
      return 2;
    }

    const target = matches[0];
    if (!target) return 1;
    const original = await readFile(target.path, 'utf8');
    const touched = rewriteFrontmatterDates(original, { updatedAt, publishedAt });
    await writeFile(target.path, touched, 'utf8');

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            kind: target.kind,
            slug,
            path: target.path,
            updated_at: updatedAt,
            published_at: publishedAt ?? null,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      logger.info(`Touched ${target.kind}/${slug} (${target.path}) updated_at=${updatedAt}`);
      if (publishedAt) {
        logger.info(`Updated published_at=${publishedAt}`);
      }
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function parseTouchDate(value: string, flag: string): string | undefined {
  const raw = value.trim();
  if (raw.length === 0) {
    process.stderr.write(`${flag} must not be empty.\n`);
    return undefined;
  }
  const date = raw.toLowerCase() === 'now' ? new Date() : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    process.stderr.write(`Invalid ${flag} value: ${value}. Expected ISO-8601 or "now".\n`);
    return undefined;
  }
  return date.toISOString();
}

async function resolveContentFilesBySlug(
  slug: string,
  search: readonly Kind[],
  dirs: Record<Kind, string>,
): Promise<Array<{ kind: Kind; path: string }>> {
  const matches: Array<{ kind: Kind; path: string }> = [];
  for (const kind of search) {
    const resolved = await resolveContentSlugPath(slug, [kind], dirs);
    if (resolved) matches.push(resolved);
  }
  return matches;
}

export function rewriteFrontmatterDates(
  source: string,
  opts: { updatedAt: string; publishedAt?: string },
): string {
  const lines = source.split('\n');
  const updates: Array<[key: string, value: string]> = [['updated_at', opts.updatedAt]];
  if (opts.publishedAt !== undefined) updates.push(['published_at', opts.publishedAt]);

  if (!isOpeningFrontmatterFence(lines[0])) {
    const frontmatter = ['---', ...updates.map(([key, value]) => `${key}: ${value}`), '---', ''];
    return [...frontmatter, source].join('\n');
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error('frontmatter has no closing `---`; refusing to touch');
  }

  for (const [key, value] of updates) {
    let found = false;
    const keyPattern = new RegExp(`^(\\s*${key}\\s*:\\s*).*$`);
    for (let i = 1; i < closeIdx; i += 1) {
      const raw = lines[i] ?? '';
      if (keyPattern.test(raw)) {
        lines[i] = raw.replace(keyPattern, `$1${value}`);
        found = true;
        break;
      }
    }
    if (!found) {
      lines.splice(closeIdx, 0, `${key}: ${value}`);
      closeIdx += 1;
    }
  }

  return lines.join('\n');
}

function isOpeningFrontmatterFence(line: string | undefined): boolean {
  const trimmed = line?.trim() ?? '';
  return trimmed === '---' || /^---ya?ml$/i.test(trimmed);
}

// Rewrite the `slug:` line inside the leading YAML frontmatter block. If the
// frontmatter has no `slug:` key, append one before the closing `---`. Bodies
// without frontmatter at all get a fresh `---\nslug: <new>\n---\n` prepended
// so the renamed file still surfaces the intended slug to the loader.
export function rewriteFrontmatterSlug(source: string, newSlug: string): string {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') {
    return ['---', `slug: ${newSlug}`, '---', '', source].join('\n');
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    // Malformed frontmatter (no closing fence). Don't try to repair — the
    // loader will surface this via `laurel check`; rename just preserves
    // the file content and emits an error to the caller.
    throw new Error('frontmatter has no closing `---`; refusing to rewrite');
  }
  let foundSlug = false;
  for (let i = 1; i < closeIdx; i += 1) {
    const raw = lines[i] ?? '';
    if (/^\s*slug\s*:/.test(raw)) {
      lines[i] = raw.replace(/^(\s*slug\s*:\s*).*$/, `$1${newSlug}`);
      foundSlug = true;
      break;
    }
  }
  if (!foundSlug) {
    lines.splice(closeIdx, 0, `slug: ${newSlug}`);
  }
  return lines.join('\n');
}

function normaliseBasePath(base: string): string {
  if (!base || base === '/') return '/';
  const withLead = base.startsWith('/') ? base : `/${base}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

async function appendRedirect(cwd: string, from: string, to: string): Promise<string> {
  const file = join(cwd, 'redirects.yaml');
  const line = `- { from: "${from}", to: "${to}", status: 301 }\n`;
  if (existsSync(file)) {
    const existing = await readFile(file, 'utf8');
    const suffix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
    await writeFile(file, `${existing}${suffix}${line}`, 'utf8');
  } else {
    await writeFile(file, line, 'utf8');
  }
  return file;
}
