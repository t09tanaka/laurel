import { type DryRunRouteSummary, build } from '~/build/pipeline.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { getLogLevel, logger } from '~/util/logger.ts';
import {
  CliUsageError,
  type ParsedCommand,
  formatCommandHelp,
  parseBooleanEnv,
  parseCommand,
} from '../parse.ts';
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
  const dryRun = parsed.values['dry-run'] === true;
  // NECTAR_DRAFTS=1 is documented as a shorter alias for the auto-derived
  // NECTAR_BUILD_INCLUDE_DRAFTS env fallback. The standard fallback already
  // populated `parsed.values['include-drafts']` if set; only fall back to the
  // shorter alias when the flag and the standard env var are both unset, so a
  // misspelled NECTAR_DRAFTS value can't override an explicit --include-drafts=false.
  let includeDrafts = parsed.values['include-drafts'] === true;
  if (!includeDrafts && parsed.values['include-drafts'] === undefined) {
    const aliasRaw = process.env.NECTAR_DRAFTS;
    if (aliasRaw !== undefined) {
      try {
        includeDrafts = parseBooleanEnv(aliasRaw, 'NECTAR_DRAFTS');
      } catch (err) {
        if (err instanceof CliUsageError) {
          process.stderr.write(`${err.message}\n\n`);
          process.stderr.write(formatCommandHelp(BUILD_SPEC));
          return EXIT_CODES.usage;
        }
        throw err;
      }
    }
  }
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
      dryRun,
      includeDrafts,
    });
    const prefix = summary.dryRun ? 'Dry run: would build' : 'Built';
    logger.info(
      `${prefix} ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
    );
    if (summary.dryRun && summary.routes && isVerbose()) {
      logger.info(formatDryRunRouteTable(summary.routes));
    }
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

function isVerbose(): boolean {
  const level = getLogLevel();
  return level === 'debug' || level === 'trace';
}

// Renders a fixed-width per-route table for `--dry-run --verbose`. Columns
// pad to the longest value in the column so URL/template/path stay aligned
// even with long slugs. Routes are emitted in plan order (the same order
// they would have been rendered/written by a real build).
export function formatDryRunRouteTable(routes: readonly DryRunRouteSummary[]): string {
  if (routes.length === 0) return 'Routes: (none)';
  const headers = {
    kind: 'KIND',
    url: 'URL',
    template: 'TEMPLATE',
    bytes: 'BYTES',
    path: 'OUTPUT',
  };
  const rows = routes.map((r) => ({
    kind: r.kind,
    url: r.url,
    template: r.template,
    bytes: String(r.bytes),
    path: r.outputPath,
  }));
  const widths = {
    kind: Math.max(headers.kind.length, ...rows.map((r) => r.kind.length)),
    url: Math.max(headers.url.length, ...rows.map((r) => r.url.length)),
    template: Math.max(headers.template.length, ...rows.map((r) => r.template.length)),
    bytes: Math.max(headers.bytes.length, ...rows.map((r) => r.bytes.length)),
    path: Math.max(headers.path.length, ...rows.map((r) => r.path.length)),
  };
  const fmt = (r: typeof headers): string =>
    `  ${r.kind.padEnd(widths.kind)}  ${r.url.padEnd(widths.url)}  ${r.template.padEnd(
      widths.template,
    )}  ${r.bytes.padStart(widths.bytes)}  ${r.path.padEnd(widths.path)}`;
  const lines = ['Routes:', fmt(headers)];
  for (const r of rows) lines.push(fmt(r));
  return lines.join('\n');
}
