import { existsSync } from 'node:fs';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { slugifyCliValue } from '../slug.ts';
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
  if (sub === 'merge') {
    return runMerge({ parsed, cwd, configPath });
  }
  if (sub !== 'list') {
    process.stderr.write(
      `Unknown subcommand: ${sub ?? ''}. Expected \`list\`, \`rename <old-slug> <new-slug>\`, or \`merge <from> [from...] <into>\`.\n`,
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

interface MergeOpts {
  parsed: ParsedCommand;
  cwd: string;
  configPath: string | undefined;
}

async function runMerge({ parsed, cwd, configPath }: MergeOpts): Promise<number> {
  const operands = parsed.positionals.slice(1);
  if (operands.length < 2) {
    process.stderr.write('`tags merge` requires <from> [from...] <into>.\n');
    return 2;
  }

  const intoRaw = operands.at(-1) ?? '';
  const intoSlug = normalizeTagCliSlug(intoRaw);
  if (!intoSlug) {
    process.stderr.write(`Invalid target tag slug: ${intoRaw}\n`);
    return 2;
  }

  const fromSlugs = uniqueSlugs(operands.slice(0, -1).map((slug) => normalizeTagCliSlug(slug)));
  if (fromSlugs.length === 0) {
    process.stderr.write('`tags merge` requires at least one valid source tag slug.\n');
    return 2;
  }
  if (fromSlugs.includes(intoSlug)) {
    process.stderr.write('Source and target tag slugs must be different.\n');
    return 2;
  }

  const dryRun = parsed.values['dry-run'] === true;
  const asJson = parsed.values.json === true;
  try {
    const config = await loadConfig({ cwd, configPath });
    const result = await mergeTags({
      cwd,
      fromSlugs,
      intoSlug,
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
        `${verb} ${result.changed_files.length} file(s); merged ${result.from_slugs.join(', ')} -> ${result.into_slug}`,
      );
      for (const file of result.changed_files) {
        process.stdout.write(`  ${file}\n`);
      }
      if (result.tag_file_promoted) {
        logger.info(
          `${dryRun ? 'Would promote' : 'Promoted'} tag file ${result.tag_file_promoted.from} -> ${result.tag_file_promoted.to}`,
        );
      }
      for (const file of result.tag_files_left) {
        logger.warn(`Left source tag file in place for manual review: ${file}`);
      }
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

interface MergeTagsOptions {
  cwd: string;
  fromSlugs: string[];
  intoSlug: string;
  postsDir: string;
  pagesDir: string;
  tagsDir: string;
  dryRun: boolean;
}

interface MergeTagsResult {
  from_slugs: string[];
  into_slug: string;
  changed_files: string[];
  scanned_files: number;
  tag_file_promoted: { from: string; to: string } | null;
  tag_files_left: string[];
  tag_files_missing: string[];
  dry_run: boolean;
}

export async function mergeTags(opts: MergeTagsOptions): Promise<MergeTagsResult> {
  const postsAbs = absUnder(opts.cwd, opts.postsDir);
  const pagesAbs = absUnder(opts.cwd, opts.pagesDir);
  const tagsAbs = absUnder(opts.cwd, opts.tagsDir);

  const fromSet = new Set(opts.fromSlugs);
  const changed: string[] = [];
  let scannedFiles = 0;
  for (const dir of [postsAbs, pagesAbs]) {
    if (!existsSync(dir)) continue;
    const files = await listMarkdown(dir);
    for (const file of files) {
      scannedFiles += 1;
      const raw = await readFile(file, 'utf8');
      const rewritten = mergeTagsInFrontmatter(raw, fromSet, opts.intoSlug);
      if (rewritten !== raw) {
        if (!opts.dryRun) {
          await writeFile(file, rewritten, 'utf8');
        }
        changed.push(file);
      }
    }
  }

  const tagFilesLeft: string[] = [];
  const tagFilesMissing: string[] = [];
  let tagFilePromoted: { from: string; to: string } | null = null;
  if (existsSync(tagsAbs)) {
    const intoTagFile = join(tagsAbs, `${opts.intoSlug}.md`);
    let targetExists = existsSync(intoTagFile);
    for (const slug of opts.fromSlugs) {
      const fromTagFile = join(tagsAbs, `${slug}.md`);
      if (!existsSync(fromTagFile)) {
        tagFilesMissing.push(fromTagFile);
        continue;
      }

      if (!targetExists && tagFilePromoted === null) {
        if (!opts.dryRun) {
          const raw = await readFile(fromTagFile, 'utf8');
          const rewritten = rewriteSingleSlug(raw, opts.intoSlug);
          await writeFile(fromTagFile, rewritten, 'utf8');
          await rename(fromTagFile, intoTagFile);
        }
        tagFilePromoted = { from: fromTagFile, to: intoTagFile };
        targetExists = true;
        changed.push(fromTagFile);
        continue;
      }

      tagFilesLeft.push(fromTagFile);
    }
  }

  return {
    from_slugs: opts.fromSlugs,
    into_slug: opts.intoSlug,
    changed_files: changed,
    scanned_files: scannedFiles,
    tag_file_promoted: tagFilePromoted,
    tag_files_left: tagFilesLeft,
    tag_files_missing: tagFilesMissing,
    dry_run: opts.dryRun,
  };
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

export function mergeTagsInFrontmatter(
  source: string,
  fromSlugs: ReadonlySet<string>,
  intoSlug: string,
): string {
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

  let changed = false;
  for (let i = 1; i < closeIdx; i += 1) {
    const raw = lines[i] ?? '';
    const inlineMatch = /^(\s*tags\s*:\s*)\[(.*)\]\s*$/.exec(raw);
    if (inlineMatch) {
      const [, prefix, body] = inlineMatch;
      const { values, changed: lineChanged } = mergeTagItems(parseInlineTagItems(body ?? ''), {
        fromSlugs,
        intoSlug,
      });
      const rebuilt = `${prefix}[${values.join(', ')}]`;
      if (lineChanged || rebuilt !== raw) {
        lines[i] = rebuilt;
        changed = true;
      }
      continue;
    }

    const blockMatch = /^(\s*tags\s*:\s*)$/.exec(raw);
    if (blockMatch) {
      const itemLines: string[] = [];
      let j = i + 1;
      for (; j < closeIdx; j += 1) {
        const itemLine = lines[j] ?? '';
        if (!/^(\s*-\s*)(.*)$/.test(itemLine)) break;
        itemLines.push(itemLine);
      }
      if (itemLines.length === 0) continue;

      const blockValues = itemLines.map((line) => {
        const [, prefix = '', value = ''] = /^(\s*-\s*)(.*)$/.exec(line) ?? [];
        return { prefix, value: value.trimEnd() };
      });
      const { values, changed: blockChanged } = mergeBlockTagItems(blockValues, {
        fromSlugs,
        intoSlug,
      });
      if (blockChanged || values.length !== itemLines.length) {
        lines.splice(i + 1, itemLines.length, ...values);
        closeIdx += values.length - itemLines.length;
        changed = true;
      }
      i += values.length;
      continue;
    }

    const scalarMatch = /^(\s*tags\s*:\s*)(.+?)\s*$/.exec(raw);
    if (scalarMatch) {
      const [, prefix, body] = scalarMatch;
      const { values, changed: lineChanged } = mergeTagItems(parseInlineTagItems(body ?? ''), {
        fromSlugs,
        intoSlug,
      });
      if (lineChanged) {
        lines[i] = `${prefix}[${values.join(', ')}]`;
        changed = true;
      }
    }
  }

  return changed ? lines.join('\n') : source;
}

interface MergeTagItemsOptions {
  fromSlugs: ReadonlySet<string>;
  intoSlug: string;
}

function mergeTagItems(
  items: string[],
  opts: MergeTagItemsOptions,
): { values: string[]; changed: boolean } {
  const values: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const item of items) {
    const next = rewriteMergedTagItem(item, opts);
    const key = normalizeTagReference(next);
    if (!key) {
      values.push(item);
      continue;
    }
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    values.push(next);
    if (next !== item) changed = true;
  }
  return { values, changed };
}

function mergeBlockTagItems(
  items: Array<{ prefix: string; value: string }>,
  opts: MergeTagItemsOptions,
): { values: string[]; changed: boolean } {
  const values: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const item of items) {
    const next = rewriteMergedTagItem(item.value, opts);
    const key = normalizeTagReference(next);
    if (!key) {
      values.push(`${item.prefix}${item.value}`);
      continue;
    }
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    values.push(`${item.prefix}${next}`);
    if (next !== item.value) changed = true;
  }
  return { values, changed };
}

function rewriteMergedTagItem(item: string, opts: MergeTagItemsOptions): string {
  const normalized = normalizeTagReference(item);
  if (!opts.fromSlugs.has(normalized)) return item;
  return quoteLike(item, opts.intoSlug);
}

function parseInlineTagItems(body: string): string[] {
  return body
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeTagReference(item: string): string {
  return normalizeTagCliSlug(unquote(item));
}

function quoteLike(item: string, slug: string): string {
  if (item.startsWith('"') && item.endsWith('"')) return `"${slug}"`;
  if (item.startsWith("'") && item.endsWith("'")) return `'${slug}'`;
  return slug;
}

function normalizeTagCliSlug(value: string): string {
  return slugifyCliValue(value.trim());
}

function uniqueSlugs(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
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
