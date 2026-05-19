import { build } from '~/build/pipeline.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
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
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(BUILD_SPEC));
    return EXIT_CODES.ok;
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

  let concurrency: number | undefined;
  const concurrencyRaw = parsed.values.concurrency;
  if (typeof concurrencyRaw === 'string') {
    const parsedConcurrency = parseConcurrency(concurrencyRaw);
    if (parsedConcurrency instanceof CliUsageError) {
      process.stderr.write(`${parsedConcurrency.message}\n\n`);
      process.stderr.write(formatCommandHelp(BUILD_SPEC));
      return EXIT_CODES.usage;
    }
    concurrency = parsedConcurrency;
  }

  try {
    const summary = await build({
      cwd,
      configPath,
      outputDir,
      basePath,
      baseUrl,
      profile,
      noAtomic,
      concurrency,
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
      return EXIT_CODES.generic;
    }
    return EXIT_CODES.ok;
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }
}

function parseConcurrency(raw: string): number | CliUsageError {
  const trimmed = raw.trim();
  if (trimmed === '' || !/^[0-9]+$/.test(trimmed)) {
    return new CliUsageError(
      `Invalid value for --concurrency: ${JSON.stringify(raw)} (expected a positive integer)`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) {
    return new CliUsageError(
      `Invalid value for --concurrency: ${JSON.stringify(raw)} (expected a positive integer)`,
    );
  }
  return n;
}
