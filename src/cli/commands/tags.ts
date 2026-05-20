import { existsSync } from 'node:fs';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { TAGS_SPEC } from '../specs.ts';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

interface TagRow {
  slug: string;
  name: string;
  post_count: number;
}

export async function runTags(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(TAGS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(TAGS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(TAGS_SPEC));
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

  const orphanedOnly = parsed.values.orphaned === true || parsed.values.unused === true;
  const asJson = parsed.values.json === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const graph = await loadContent({ cwd, config });

    const rows: TagRow[] = graph.tags
      .map((t) => ({
        slug: t.slug,
        name: t.name,
        post_count: graph.postsByTag.get(t.slug)?.length ?? 0,
      }))
      .filter((row) => (orphanedOnly ? row.post_count === 0 : true))
      .sort((a, b) => {
        if (b.post_count !== a.post_count) return b.post_count - a.post_count;
        return a.slug.localeCompare(b.slug);
      });

    if (asJson) {
      process.stdout.write(`${JSON.stringify({ count: rows.length, tags: rows }, null, 2)}\n`);
    } else if (rows.length === 0) {
      process.stdout.write(orphanedOnly ? 'No orphaned tags found.\n' : 'No tags defined.\n');
    } else {
      process.stdout.write(renderTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function renderTable(rows: TagRow[]): string {
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
  const oldSlug = parsed.positionals[1];
  const newSlug = parsed.positionals[2];
  if (!oldSlug || !newSlug) {
    process.stderr.write('`tags rename` requires <old-slug> and <new-slug>.\n');
    return 2;
  }
  if (parsed.positionals.length > 3) {
    process.stderr.write('`tags rename` takes exactly <old-slug> <new-slug>.\n');
    return 2;
  }
  if (oldSlug === newSlug) {
    process.stderr.write('Old and new slug are identical; nothing to do.\n');
    return 2;
  }
  if (!SLUG_RE.test(newSlug)) {
    process.stderr.write(
      `Invalid new slug: ${newSlug}. Expected lowercase alphanumerics + dashes (e.g. \`news\`).\n`,
    );
    return 2;
  }
  const dryRun = parsed.values['dry-run'] === true;
  const asJson = parsed.values.json === true;
  try {
    const config = await loadConfig({ cwd, configPath });
    const result = await renameTag({
      cwd,
      oldSlug,
      newSlug,
      postsDir: config.content.posts_dir,
      pagesDir: config.content.pages_dir,
      tagsDir: config.content.tags_dir,
      dryRun,
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const verb = dryRun ? 'Would update' : 'Updated';
      logger.info(
        `${verb} ${result.changed_files.length} file(s); tag file ${result.tag_file_moved ? 'moved' : 'unchanged'}`,
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

interface RenameTagOptions {
  cwd: string;
  oldSlug: string;
  newSlug: string;
  postsDir: string;
  pagesDir: string;
  tagsDir: string;
  dryRun: boolean;
}

interface RenameTagResult {
  old_slug: string;
  new_slug: string;
  changed_files: string[];
  tag_file_moved: boolean;
  dry_run: boolean;
}

export async function renameTag(opts: RenameTagOptions): Promise<RenameTagResult> {
  const postsAbs = absUnder(opts.cwd, opts.postsDir);
  const pagesAbs = absUnder(opts.cwd, opts.pagesDir);
  const tagsAbs = absUnder(opts.cwd, opts.tagsDir);

  const changed: string[] = [];
  for (const dir of [postsAbs, pagesAbs]) {
    if (!existsSync(dir)) continue;
    const files = await listMarkdown(dir);
    for (const file of files) {
      const raw = await readFile(file, 'utf8');
      const rewritten = rewriteTagsInFrontmatter(raw, opts.oldSlug, opts.newSlug);
      if (rewritten !== raw) {
        if (!opts.dryRun) {
          await writeFile(file, rewritten, 'utf8');
        }
        changed.push(file);
      }
    }
  }

  let tagFileMoved = false;
  if (existsSync(tagsAbs)) {
    const oldTagFile = join(tagsAbs, `${opts.oldSlug}.md`);
    const newTagFile = join(tagsAbs, `${opts.newSlug}.md`);
    if (existsSync(oldTagFile)) {
      if (existsSync(newTagFile)) {
        throw new Error(
          `Cannot move tag file: destination already exists (${newTagFile}). Resolve the conflict manually.`,
        );
      }
      if (!opts.dryRun) {
        const raw = await readFile(oldTagFile, 'utf8');
        const rewritten = rewriteSingleSlug(raw, opts.newSlug);
        await writeFile(oldTagFile, rewritten, 'utf8');
        await rename(oldTagFile, newTagFile);
      }
      tagFileMoved = true;
      changed.push(oldTagFile);
    }
  }

  return {
    old_slug: opts.oldSlug,
    new_slug: opts.newSlug,
    changed_files: changed,
    tag_file_moved: tagFileMoved,
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

// Rewrite both the inline `tags: [news, foo]` and the block-form
// `tags:\n  - news\n  - foo` variants. Operates only on the leading YAML
// frontmatter so body content like a paragraph mentioning `news` is left
// untouched.
export function rewriteTagsInFrontmatter(source: string, oldSlug: string, newSlug: string): string {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') return source;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return source;

  let inTagsBlock = false;
  let changed = false;
  for (let i = 1; i < closeIdx; i += 1) {
    const raw = lines[i] ?? '';
    const inlineMatch = /^(\s*tags\s*:\s*)\[(.*)\]\s*$/.exec(raw);
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
      inTagsBlock = false;
      continue;
    }
    if (/^\s*tags\s*:\s*$/.test(raw)) {
      inTagsBlock = true;
      continue;
    }
    if (inTagsBlock) {
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
      // Anything else (blank or a new top-level key) ends the block.
      inTagsBlock = false;
    }
  }
  return changed ? lines.join('\n') : source;
}

function replaceQuotedSlug(item: string, oldSlug: string, newSlug: string): string {
  const unq = unquote(item);
  if (unq !== oldSlug) return item;
  // Preserve original quoting style for cleanliness.
  if (item.startsWith('"') && item.endsWith('"')) return `"${newSlug}"`;
  if (item.startsWith("'") && item.endsWith("'")) return `'${newSlug}'`;
  return newSlug;
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

// Replace the top-level `slug:` value in the tag file's frontmatter so the
// renamed file's body still reports the new slug to the loader.
function rewriteSingleSlug(source: string, newSlug: string): string {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') return source;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return source;
  for (let i = 1; i < closeIdx; i += 1) {
    const raw = lines[i] ?? '';
    if (/^\s*slug\s*:/.test(raw)) {
      lines[i] = raw.replace(/^(\s*slug\s*:\s*).*$/, `$1${newSlug}`);
      return lines.join('\n');
    }
  }
  // No slug key; insert one before the closing fence.
  lines.splice(closeIdx, 0, `slug: ${newSlug}`);
  return lines.join('\n');
}
