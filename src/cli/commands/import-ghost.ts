import { importGhostExport } from '~/ghost/import.ts';
import { logger } from '~/util/logger.ts';

export async function runImportGhost(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) {
    logger.error('Usage: nectar import-ghost <export.json>');
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
