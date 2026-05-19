import { importGhostExport } from '~/ghost/import.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { IMPORT_GHOST_SPEC } from '../specs.ts';

export async function runImportGhost(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(IMPORT_GHOST_SPEC, args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(IMPORT_GHOST_SPEC));
    return 0;
  }

  const file = parsed.positionals[0];
  if (!file) {
    process.stderr.write('A file path is required.\n\n');
    process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
    return 2;
  }

  const cwd = process.cwd();
  try {
    const summary = await importGhostExport({ cwd, file });
    logger.info(
      `Imported ${summary.posts} posts, ${summary.pages} pages, ${summary.tags} tags, ${summary.authors} authors`,
    );
    return 0;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
