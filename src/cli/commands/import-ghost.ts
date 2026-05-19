import { ON_CONFLICT_VALUES, type OnConflict, importGhostExport } from '~/ghost/import.ts';
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

  const rawOnConflict = parsed.values['on-conflict'];
  let onConflict: OnConflict = 'skip';
  if (typeof rawOnConflict === 'string') {
    if (!(ON_CONFLICT_VALUES as readonly string[]).includes(rawOnConflict)) {
      process.stderr.write(
        `Invalid --on-conflict value: ${rawOnConflict}. Expected one of: ${ON_CONFLICT_VALUES.join(', ')}.\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    onConflict = rawOnConflict as OnConflict;
  }

  const rawAssets = parsed.values.assets;
  const assetsDir = typeof rawAssets === 'string' ? rawAssets : undefined;

  const cwd = process.cwd();
  try {
    const summary = await importGhostExport({ cwd, file, onConflict, assetsDir });
    logger.info(
      `Imported ${summary.posts} posts, ${summary.pages} pages, ${summary.tags} tags, ${summary.authors} authors`,
    );
    if (summary.assetsCopied > 0) {
      logger.info(`Copied ${summary.assetsCopied} asset files into content/`);
    }
    if (summary.skipped > 0 || summary.overwritten > 0 || summary.renamed > 0) {
      logger.info(
        `Conflicts: ${summary.skipped} skipped, ${summary.overwritten} overwritten, ${summary.renamed} renamed`,
      );
    }
    return 0;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
