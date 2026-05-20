import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { OPEN_SPEC } from '../specs.ts';

type Kind = 'posts' | 'pages';
const KINDS: readonly Kind[] = ['posts', 'pages'];

export async function runOpen(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(OPEN_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(OPEN_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(OPEN_SPEC));
    return 0;
  }

  const slug = (parsed.positionals[0] ?? '').trim();
  if (!slug) {
    process.stderr.write('A slug is required.\n\n');
    process.stderr.write(formatCommandHelp(OPEN_SPEC));
    return 1;
  }

  const kindHintRaw =
    typeof parsed.values.kind === 'string' ? parsed.values.kind.trim().toLowerCase() : '';
  let kindHint: Kind | undefined;
  if (kindHintRaw) {
    if (kindHintRaw !== 'posts' && kindHintRaw !== 'pages') {
      process.stderr.write(`Invalid --kind value: ${kindHintRaw} (expected "posts" or "pages")\n`);
      return 2;
    }
    kindHint = kindHintRaw;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  const dirs: Record<Kind, string> = {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: absolutise(cwd, config.content.pages_dir),
  };

  const search: Kind[] = kindHint ? [kindHint] : [...KINDS];
  let resolvedPath: string | undefined;
  try {
    resolvedPath = await resolveSlugPath(slug, search, dirs);
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  if (!resolvedPath) {
    process.stderr.write(`No post or page found with slug "${slug}".\n`);
    return 1;
  }

  const editor = process.env.EDITOR ?? 'vi';
  logger.info(`Opening ${resolvedPath} in ${editor}`);
  const proc = Bun.spawn([editor, resolvedPath], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(`Editor "${editor}" exited with code ${code}.\n`);
  }
  return code;
}

function absolutise(cwd: string, dir: string): string {
  return isAbsolute(dir) ? dir : resolve(cwd, dir);
}

// Resolve a slug to a Markdown file path. Fast path: `<dir>/<slug>.md` (the
// convention `nectar new` writes). Fallback: scan every `.md` under the
// candidate dirs and parse the leading YAML frontmatter for an explicit
// `slug: <value>` line. The scan only fires when the fast path misses, so
// the common case stays a single `existsSync` call. Returns the first match
// in the order given by `search`, so `--kind posts` is honoured deterministically.
async function resolveSlugPath(
  slug: string,
  search: readonly Kind[],
  dirs: Record<Kind, string>,
): Promise<string | undefined> {
  for (const kind of search) {
    const fast = join(dirs[kind], `${slug}.md`);
    if (existsSync(fast)) return fast;
  }
  for (const kind of search) {
    const hit = await scanForFrontmatterSlug(dirs[kind], slug);
    if (hit) return hit;
  }
  return undefined;
}

async function scanForFrontmatterSlug(dir: string, slug: string): Promise<string | undefined> {
  if (!existsSync(dir)) return undefined;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = join(dir, entry);
    const raw = await readFile(filePath, 'utf8');
    if (extractFrontmatterSlug(raw) === slug) return filePath;
  }
  return undefined;
}

function extractFrontmatterSlug(raw: string): string | undefined {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === '---') return undefined;
    const match = line.match(/^\s*slug\s*:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/);
    if (match) return match[1];
  }
  return undefined;
}
