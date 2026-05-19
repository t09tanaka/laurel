import { build } from '~/build/pipeline.ts';
import { logger } from '~/util/logger.ts';

export async function runBuild(args: string[]): Promise<number> {
  const configFlag = args.indexOf('--config');
  const configPath = configFlag >= 0 ? args[configFlag + 1] : undefined;
  const cwd = process.cwd();

  try {
    const summary = await build({ cwd, configPath });
    logger.info(
      `Built ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
    );
    return 0;
  } catch (err) {
    logger.error(err instanceof Error ? err.stack ?? err.message : String(err));
    return 1;
  }
}
