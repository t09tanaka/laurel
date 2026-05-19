import { build } from '~/build/pipeline.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { BUILD_SPEC } from '../specs.ts';

export async function runBuild(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(BUILD_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(BUILD_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(BUILD_SPEC));
    return 0;
  }

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const outputDir = typeof parsed.values.output === 'string' ? parsed.values.output : undefined;
  const basePath =
    typeof parsed.values['base-path'] === 'string' ? parsed.values['base-path'] : undefined;
  const baseUrl =
    typeof parsed.values['base-url'] === 'string' ? parsed.values['base-url'] : undefined;
  const strict = parsed.values.strict === true;
  const profile = parsed.values.profile === true;
  const noAtomic = parsed.values['no-atomic'] === true;
  const cwd = process.cwd();

  try {
    const summary = await build({
      cwd,
      configPath,
      outputDir,
      basePath,
      baseUrl,
      profile,
      noAtomic,
    });
    logger.info(
      `Built ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
    );
    if (strict && summary.warningCount > 0) {
      logger.error(
        `Strict mode: build emitted ${summary.warningCount} warning${
          summary.warningCount === 1 ? '' : 's'
        }`,
      );
      return 1;
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}
