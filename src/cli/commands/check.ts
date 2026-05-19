import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { loadTheme } from '~/theme/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { CHECK_SPEC } from '../specs.ts';

export async function runCheck(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CHECK_SPEC, args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CHECK_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CHECK_SPEC));
    return 0;
  }

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
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
