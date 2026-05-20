import { loadConfig } from '~/config/loader.ts';
import { logger } from '~/util/logger.ts';
import {
  CONTENT_KINDS,
  type ContentKind,
  absolutise,
  resolveContentSlugPath,
} from '../content-paths.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { OPEN_SPEC } from '../specs.ts';

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
  let kindHint: ContentKind | undefined;
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

  const dirs: Record<ContentKind, string> = {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: absolutise(cwd, config.content.pages_dir),
  };

  const search: ContentKind[] = kindHint ? [kindHint] : [...CONTENT_KINDS];
  let resolvedPath: string | undefined;
  try {
    resolvedPath = await resolveContentSlugPath(slug, search, dirs);
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
