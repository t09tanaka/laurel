import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { loadTheme } from '~/theme/loader.ts';
import { logger } from '~/util/logger.ts';

export async function runCheck(args: string[]): Promise<number> {
  const configFlag = args.indexOf('--config');
  const configPath = configFlag >= 0 ? args[configFlag + 1] : undefined;
  const cwd = process.cwd();

  try {
    const config = await loadConfig({ cwd, configPath });
    logger.info(`Config OK (site: ${config.site.title})`);

    const content = await loadContent({ cwd, config });
    logger.info(
      `Content OK: ${content.posts.length} posts, ${content.pages.length} pages, ${content.tags.length} tags, ${content.authors.length} authors`,
    );

    const theme = await loadTheme({ cwd, config });
    logger.info(
      `Theme OK: ${theme.name} (${Object.keys(theme.templates).length} templates, ${Object.keys(theme.partials).length} partials)`,
    );

    return 0;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
