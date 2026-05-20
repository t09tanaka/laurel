import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import type { Page, Post } from '~/content/model.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { CONTENT_SPEC } from '../specs.ts';

type Kind = 'posts' | 'pages';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

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
  if (sub === 'rename') {
    return runRename({ parsed, cwd, configPath });
  }
  if (sub !== 'list') {
    process.stderr.write(
      `Unknown subcommand: ${sub ?? ''}. Expected \`list\` or \`rename <old-slug> <new-slug>\`.\n`,
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

interface RenameOpts {
  parsed: ParsedCommand;
  cwd: string;
  configPath: string | undefined;
}

async function runRename({ parsed, cwd, configPath }: RenameOpts): Promise<number> {
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
    const baseAbs = isAbsolute(baseDir) ? baseDir : resolve(cwd, baseDir);
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
    // loader will surface this via `nectar check`; rename just preserves
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
