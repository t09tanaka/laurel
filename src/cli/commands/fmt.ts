import { loadConfig } from '~/config/loader.ts';
import { formatContent } from '~/content/format.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { FMT_SPEC } from '../specs.ts';

export async function runFmt(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(FMT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(FMT_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(FMT_SPEC));
    return 0;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const check = parsed.values.check === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const result = await formatContent({ cwd, config, check });
    if (result.changed.length === 0) {
      logger.info(`All ${result.scanned} content file(s) are formatted.`);
      return 0;
    }

    if (check) {
      process.stderr.write(
        [
          `${result.changed.length} content file(s) need formatting:`,
          ...result.changed.map((file) => `  ${file}`),
          '',
        ].join('\n'),
      );
      return 1;
    }

    logger.info(`Formatted ${result.changed.length} content file(s).`);
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}
