import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_HUGO_SPEC, IMPORT_JEKYLL_SPEC, MIGRATE_SPEC } from '../specs.ts';

const VALID_SOURCES = ['ghost', 'wordpress', 'hugo', 'jekyll', 'eleventy'] as const;
type Source = (typeof VALID_SOURCES)[number];

export async function runMigrate(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(MIGRATE_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(MIGRATE_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(MIGRATE_SPEC));
    return 0;
  }

  const sourceRaw = parsed.positionals[0];
  const path = parsed.positionals[1];
  if (!sourceRaw) {
    process.stderr.write(`Source is required. Expected one of: ${VALID_SOURCES.join(', ')}.\n`);
    return 2;
  }
  if (!path) {
    process.stderr.write(`A source path is required after \`${sourceRaw}\`.\n`);
    return 2;
  }
  if (!(VALID_SOURCES as readonly string[]).includes(sourceRaw)) {
    process.stderr.write(
      `Invalid source: ${sourceRaw}. Expected one of: ${VALID_SOURCES.join(', ')}.\n`,
    );
    return 2;
  }
  const source = sourceRaw as Source;
  const cwd = process.cwd();

  if (source === 'ghost') {
    const { runImportGhost } = await import('./import-ghost.ts');
    return runImportGhost(buildGhostArgs(parsed, path));
  }
  if (source === 'wordpress') {
    const { runImportWordPress } = await import('./import-wordpress.ts');
    return runImportWordPress(buildWordPressArgs(parsed, path));
  }

  if (source === 'hugo' || source === 'jekyll') {
    const { runImportStaticSite } = await import('./import-static.ts');
    return runImportStaticSite(source, source === 'hugo' ? IMPORT_HUGO_SPEC : IMPORT_JEKYLL_SPEC, [
      ...buildStaticSiteArgs(parsed),
      path,
    ]);
  }

  // Eleventy remains a conservative copy-only path. Its collection structure
  // varies enough that the dedicated Hugo/Jekyll frontmatter remapper should
  // not be applied to it without a separate compatibility pass.
  const dryRun = parsed.values['dry-run'] === true;
  const asJson = parsed.values.json === true;
  try {
    const result = await runMinimalImport({ cwd, source, sourcePath: path, dryRun });
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, source, dryRun, posts: result.posts, sourceDir: result.sourceDir })}\n`,
      );
      return 0;
    }
    if (dryRun) {
      logger.info(
        `Dry run (${source}): would copy ${result.posts} post(s) from ${result.sourceDir}`,
      );
    } else {
      logger.info(`Imported ${result.posts} post(s) from ${source} at ${result.sourceDir}`);
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function buildGhostArgs(parsed: ParsedCommand, file: string): string[] {
  const out: string[] = [];
  pushIfString(out, parsed.values['on-conflict'], '--on-conflict');
  pushIfString(out, parsed.values.assets, '--assets');
  pushIfString(out, parsed.values['max-image-size'], '--max-image-size');
  pushIfString(out, parsed.values['source-url'], '--source-url');
  pushIfString(out, parsed.values['max-size'], '--max-size');
  pushIfString(out, parsed.values['max-post-html-size'], '--max-post-html-size');
  if (parsed.values['download-images'] === true) out.push('--download-images');
  if (parsed.values['dry-run'] === true) out.push('--dry-run');
  if (parsed.values['keep-code-injection'] === true) out.push('--keep-code-injection');
  if (parsed.values.json === true) out.push('--json');
  out.push(file);
  return out;
}

function buildWordPressArgs(parsed: ParsedCommand, file: string): string[] {
  const out: string[] = [];
  pushIfString(out, parsed.values['on-conflict'], '--on-conflict');
  if (parsed.values['dry-run'] === true) out.push('--dry-run');
  if (parsed.values.json === true) out.push('--json');
  out.push(file);
  return out;
}

function buildStaticSiteArgs(parsed: ParsedCommand): string[] {
  const out: string[] = [];
  pushIfString(out, parsed.values['on-conflict'], '--on-conflict');
  if (parsed.values['dry-run'] === true) out.push('--dry-run');
  if (parsed.values.json === true) out.push('--json');
  return out;
}

function pushIfString(out: string[], value: unknown, flag: string): void {
  if (typeof value === 'string') {
    out.push(flag, value);
  }
}

interface MinimalImportOpts {
  cwd: string;
  source: 'hugo' | 'jekyll' | 'eleventy';
  sourcePath: string;
  dryRun: boolean;
}

interface MinimalImportResult {
  posts: number;
  sourceDir: string;
}

async function runMinimalImport(opts: MinimalImportOpts): Promise<MinimalImportResult> {
  const root = isAbsolute(opts.sourcePath) ? opts.sourcePath : resolve(opts.cwd, opts.sourcePath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(
      `Source directory not found or not a directory: ${root}. Expected a ${opts.source} project root.`,
    );
  }
  const sourceDir = findPostsDir(root, opts.source);
  if (!sourceDir) {
    throw new Error(
      `Could not locate a posts directory under ${root} for source=${opts.source}. Expected ${expectedSubdirsLabel(opts.source)}.`,
    );
  }
  const destDir = join(opts.cwd, 'content/posts');
  let count = 0;
  const entries = await collectMarkdown(sourceDir);
  if (!opts.dryRun) {
    await mkdir(destDir, { recursive: true });
  }
  for (const rel of entries) {
    const src = join(sourceDir, rel);
    const dest = join(destDir, rel);
    if (!opts.dryRun) {
      await mkdir(join(dest, '..'), { recursive: true });
      if (existsSync(dest)) {
        // Default behavior: skip rather than clobber existing content. The
        // ghost / wordpress paths surface --on-conflict; the minimal path
        // does not yet, on purpose — operators copy into an empty target
        // and resolve manually.
        continue;
      }
      const raw = await readFile(src, 'utf8');
      const adapted = adaptMarkdown(opts.source, raw);
      await writeFile(dest, adapted, 'utf8');
    }
    count += 1;
  }
  return { posts: count, sourceDir };
}

function findPostsDir(root: string, source: 'hugo' | 'jekyll' | 'eleventy'): string | null {
  const candidates: string[] =
    source === 'hugo'
      ? ['content/posts', 'content/post', 'content/blog', 'content']
      : source === 'jekyll'
        ? ['_posts']
        : ['posts', 'src/posts', 'content/posts'];
  for (const rel of candidates) {
    const dir = join(root, rel);
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

function expectedSubdirsLabel(source: 'hugo' | 'jekyll' | 'eleventy'): string {
  if (source === 'hugo') return 'content/posts/ or content/';
  if (source === 'jekyll') return '_posts/';
  return 'posts/ or src/posts/';
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
  return out;
}

// Per-source adaption pass. Hugo's frontmatter is YAML-compatible enough that
// most files import verbatim. Jekyll often uses `layout:` and `date:` fields
// the loader ignores cleanly. Eleventy is the most divergent (JS / Nunjucks
// pre-processors); we copy bodies as-is and rely on operator follow-up.
export function adaptMarkdown(source: 'hugo' | 'jekyll' | 'eleventy', raw: string): string {
  // Hugo uses `+++` (TOML) on some sites; reject those to a helpful note
  // rather than smuggle TOML through as YAML.
  if (source === 'hugo' && raw.startsWith('+++')) {
    return `---\n# TODO: Hugo TOML frontmatter detected; convert to YAML.\n---\n\n${raw}`;
  }
  return raw;
}
