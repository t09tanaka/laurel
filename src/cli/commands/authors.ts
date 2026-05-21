import { existsSync } from 'node:fs';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { slugifyCliValue } from '../slug.ts';
import { AUTHORS_SPEC } from '../specs.ts';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

interface AuthorRow {
  slug: string;
  name: string;
  post_count: number;
}

export async function runAuthors(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(AUTHORS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(AUTHORS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(AUTHORS_SPEC));
    return 0;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const sub = parsed.positionals[0];
  if (sub === 'rename') {
    return runRename({ parsed, cwd, configPath });
  }
  if (sub !== 'list') {
    process.stderr.write(
      `Unknown subcommand: ${sub ?? ''}. Expected \`list\` or \`rename <old-slug> <new-slug>\`.\n`,
    );
    return 2;
  }

  const orphanedOnly = parsed.values.orphaned === true;
  const asJson = parsed.values.json === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const graph = await loadContent({ cwd, config });

    const rows: AuthorRow[] = graph.authors
      .map((author) => ({
        slug: author.slug,
        name: author.name,
        post_count: author.count.posts,
      }))
      .filter((row) => (orphanedOnly ? row.post_count === 0 : true))
      .sort((a, b) => {
        if (b.post_count !== a.post_count) return b.post_count - a.post_count;
        return a.slug.localeCompare(b.slug);
      });

    if (asJson) {
      process.stdout.write(`${JSON.stringify({ count: rows.length, authors: rows }, null, 2)}\n`);
    } else if (rows.length === 0) {
      process.stdout.write(orphanedOnly ? 'No orphaned authors found.\n' : 'No authors defined.\n');
    } else {
      process.stdout.write(renderTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function renderTable(rows: AuthorRow[]): string {
  const slugWidth = Math.max(4, ...rows.map((r) => r.slug.length));
  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
  const lines: string[] = [];
  lines.push(`${pad('slug', slugWidth)}  ${pad('name', nameWidth)}  posts`);
  lines.push(`${'-'.repeat(slugWidth)}  ${'-'.repeat(nameWidth)}  -----`);
  for (const r of rows) {
    lines.push(`${pad(r.slug, slugWidth)}  ${pad(r.name, nameWidth)}  ${r.post_count}`);
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
  const oldSlug = normalizeAuthorCliSlug(parsed.positionals[1] ?? '');
  const newSlug = normalizeAuthorCliSlug(parsed.positionals[2] ?? '');
  if (!oldSlug || !newSlug) {
    process.stderr.write('`authors rename` requires <old-slug> and <new-slug>.\n');
    return 2;
  }
  if (parsed.positionals.length > 3) {
    process.stderr.write('`authors rename` takes exactly <old-slug> <new-slug>.\n');
    return 2;
  }
  if (oldSlug === newSlug) {
    process.stderr.write('Old and new slug are identical; nothing to do.\n');
    return 2;
  }
  if (!SLUG_RE.test(newSlug)) {
    process.stderr.write(
      `Invalid new slug: ${newSlug}. Expected lowercase alphanumerics + dashes (e.g. \`jane\`).\n`,
    );
    return 2;
  }

  const dryRun = parsed.values['dry-run'] === true;
  const asJson = parsed.values.json === true;
  try {
    const config = await loadConfig({ cwd, configPath });
    const result = await renameAuthor({
      cwd,
      oldSlug,
      newSlug,
      postsDir: config.content.posts_dir,
      pagesDir: config.content.pages_dir,
      authorsDir: config.content.authors_dir,
      dryRun,
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const verb = dryRun ? 'Would update' : 'Updated';
      logger.info(
        `${verb} ${result.changed_files.length} file(s); author file ${result.author_file_moved ? 'moved' : 'unchanged'}`,
      );
      for (const file of result.changed_files) {
        process.stdout.write(`  ${file}\n`);
      }
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

interface RenameAuthorOptions {
  cwd: string;
  oldSlug: string;
  newSlug: string;
  postsDir: string;
  pagesDir: string;
  authorsDir: string;
  dryRun: boolean;
}

interface RenameAuthorResult {
  old_slug: string;
  new_slug: string;
  changed_files: string[];
  author_file_moved: boolean;
  dry_run: boolean;
}

export async function renameAuthor(opts: RenameAuthorOptions): Promise<RenameAuthorResult> {
  const postsAbs = absUnder(opts.cwd, opts.postsDir);
  const pagesAbs = absUnder(opts.cwd, opts.pagesDir);
  const authorsAbs = absUnder(opts.cwd, opts.authorsDir);

  const changed: string[] = [];
  for (const dir of [postsAbs, pagesAbs]) {
    if (!existsSync(dir)) continue;
    const files = await listMarkdown(dir);
    for (const file of files) {
      const raw = await readFile(file, 'utf8');
      const rewritten = rewriteAuthorsInFrontmatter(raw, opts.oldSlug, opts.newSlug);
      if (rewritten !== raw) {
        if (!opts.dryRun) {
          await writeFile(file, rewritten, 'utf8');
        }
        changed.push(file);
      }
    }
  }

  let authorFileMoved = false;
  if (existsSync(authorsAbs)) {
    const oldAuthorFile = join(authorsAbs, `${opts.oldSlug}.md`);
    const newAuthorFile = join(authorsAbs, `${opts.newSlug}.md`);
    if (existsSync(oldAuthorFile)) {
      if (existsSync(newAuthorFile)) {
        throw new Error(
          `Cannot move author file: destination already exists (${newAuthorFile}). Resolve the conflict manually.`,
        );
      }
      if (!opts.dryRun) {
        const raw = await readFile(oldAuthorFile, 'utf8');
        const rewritten = rewriteSingleSlug(raw, opts.newSlug);
        await writeFile(oldAuthorFile, rewritten, 'utf8');
        await rename(oldAuthorFile, newAuthorFile);
      }
      authorFileMoved = true;
      changed.push(oldAuthorFile);
    }
  }

  return {
    old_slug: opts.oldSlug,
    new_slug: opts.newSlug,
    changed_files: changed,
    author_file_moved: authorFileMoved,
    dry_run: opts.dryRun,
  };
}

function absUnder(cwd: string, p: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

export function rewriteAuthorsInFrontmatter(
  source: string,
  oldSlug: string,
  newSlug: string,
): string {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') return source;
  const closeIdx = findFrontmatterEnd(lines);
  if (closeIdx === -1) return source;

  let changed = false;
  let inAuthorsBlock = false;
  for (let i = 1; i < closeIdx; i += 1) {
    const raw = lines[i] ?? '';
    const scalarMatch = /^(\s*author\s*:\s*)(.+?)\s*$/.exec(raw);
    if (scalarMatch) {
      const [, prefix, body] = scalarMatch;
      const replaced = replaceQuotedSlug((body ?? '').trim(), oldSlug, newSlug);
      const rebuilt = `${prefix}${replaced}`;
      if (rebuilt !== raw) {
        lines[i] = rebuilt;
        changed = true;
      }
      inAuthorsBlock = false;
      continue;
    }

    const inlineMatch = /^(\s*authors\s*:\s*)\[(.*)\]\s*$/.exec(raw);
    if (inlineMatch) {
      const [, prefix, body] = inlineMatch;
      const items = (body ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const replaced = items.map((it) => replaceQuotedSlug(it, oldSlug, newSlug));
      const rebuilt = `${prefix}[${replaced.join(', ')}]`;
      if (rebuilt !== raw) {
        lines[i] = rebuilt;
        changed = true;
      }
      inAuthorsBlock = false;
      continue;
    }

    if (/^\s*authors\s*:\s*$/.test(raw)) {
      inAuthorsBlock = true;
      continue;
    }
    if (inAuthorsBlock) {
      const blockMatch = /^(\s*-\s*)(.*)$/.exec(raw);
      if (blockMatch) {
        const [, dash, value] = blockMatch;
        const replaced = replaceQuotedSlug((value ?? '').trim(), oldSlug, newSlug);
        const rebuilt = `${dash}${replaced}`;
        if (rebuilt !== raw) {
          lines[i] = rebuilt;
          changed = true;
        }
        continue;
      }
      inAuthorsBlock = false;
    }
  }
  return changed ? lines.join('\n') : source;
}

function findFrontmatterEnd(lines: string[]): number {
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') return i;
  }
  return -1;
}

function replaceQuotedSlug(item: string, oldSlug: string, newSlug: string): string {
  const unq = unquote(item);
  if (normalizeAuthorCliSlug(unq) !== oldSlug) return item;
  if (item.startsWith('"') && item.endsWith('"')) return `"${newSlug}"`;
  if (item.startsWith("'") && item.endsWith("'")) return `'${newSlug}'`;
  return newSlug;
}

function rewriteSingleSlug(source: string, newSlug: string): string {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') return source;
  const closeIdx = findFrontmatterEnd(lines);
  if (closeIdx === -1) return source;
  for (let i = 1; i < closeIdx; i += 1) {
    const raw = lines[i] ?? '';
    if (/^\s*slug\s*:/.test(raw)) {
      lines[i] = raw.replace(/^(\s*slug\s*:\s*).*$/, `$1${newSlug}`);
      return lines.join('\n');
    }
  }
  lines.splice(closeIdx, 0, `slug: ${newSlug}`);
  return lines.join('\n');
}

function normalizeAuthorCliSlug(value: string): string {
  return slugifyCliValue(value.trim());
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
