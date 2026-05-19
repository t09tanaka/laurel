import { loadRoutesYaml } from '~/build/routes-yaml.ts';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { compileThemeTemplates } from '~/theme/compile-check.ts';
import { loadTheme } from '~/theme/loader.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
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
  const strict = parsed.values.strict === true;
  const cwd = process.cwd();

  resetWarningCount();

  try {
    const config = await loadConfig({ cwd, configPath });
    logger.info(`Config OK (site: ${config.site.title})`);

    const routesYaml = await loadRoutesYaml(cwd);
    const content = await loadContent({ cwd, config, routesYaml });
    logger.info(
      `Content OK: ${content.posts.length} posts, ${content.pages.length} pages, ${content.tags.length} tags, ${content.authors.length} authors`,
    );

    const theme = await loadTheme({ cwd, config });
    const compileIssues = compileThemeTemplates(theme);
    if (compileIssues.length > 0) {
      for (const issue of compileIssues) {
        logger.error(
          `Theme ${issue.kind} '${issue.name}' (${issue.file}) failed to compile: ${issue.message}`,
        );
      }
      return 1;
    }
    logger.info(
      `Theme OK: ${theme.name} (${Object.keys(theme.templates).length} templates, ${Object.keys(theme.partials).length} partials compiled)`,
    );
    validateThemeCustom({ config, pkg: theme.pkg });

    if (strict) {
      const warnings = getWarningCount();
      if (warnings > 0) {
        logger.error(`Strict mode: check emitted ${warnings} warning${warnings === 1 ? '' : 's'}`);
        return 1;
      }
    }

    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}
