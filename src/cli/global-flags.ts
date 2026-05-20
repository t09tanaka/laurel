import { CliUsageError, globalEnvVarName, parseBooleanEnv } from './parse.ts';

export interface GlobalFlags {
  quiet: boolean;
  verboseCount: number;
  json: boolean;
  logFormat: 'json' | 'pretty' | undefined;
  noColor: boolean;
  debug: boolean;
}

export interface ExtractResult {
  flags: GlobalFlags;
  rest: string[];
}

const QUIET_ENV = globalEnvVarName('quiet');
const VERBOSE_ENV = globalEnvVarName('verbose');
const JSON_ENV = globalEnvVarName('json');
const LOG_FORMAT_ENV = globalEnvVarName('log-format');
const NO_COLOR_ENV_NECTAR = globalEnvVarName('no-color');
const DEBUG_ENV = globalEnvVarName('debug');

// Strips top-level verbosity / output-mode flags from argv so subcommand
// parsers (which run node:util `parseArgs` in strict mode) don't choke on
// them. Flags may appear anywhere before `--`; after `--`, tokens are passed
// through untouched. CLI flags take priority over env-var fallbacks
// (NECTAR_QUIET / NECTAR_VERBOSE / NECTAR_LOG_FORMAT / NECTAR_JSON /
// NECTAR_NO_COLOR / NECTAR_DEBUG).
// We also recognise the conventional `NO_COLOR` (any non-empty value disables
// color) so nectar matches the rest of the CLI ecosystem out of the box.
export function extractGlobalFlags(
  argv: string[],
  env: Record<string, string | undefined> = {},
): ExtractResult {
  const rest: string[] = [];
  let quiet = false;
  let quietFromCli = false;
  let verboseCount = 0;
  let json = false;
  let jsonFromCli = false;
  let logFormat: GlobalFlags['logFormat'];
  let logFormatFromCli = false;
  let noColor = false;
  let noColorFromCli = false;
  let debug = false;
  let debugFromCli = false;
  let passthrough = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (passthrough) {
      rest.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      rest.push(arg);
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      quiet = true;
      quietFromCli = true;
      continue;
    }
    if (arg === '--verbose') {
      verboseCount += 1;
      continue;
    }
    if (arg === '--json' || arg === '-j') {
      json = true;
      jsonFromCli = true;
      if (!logFormatFromCli) {
        logFormat = 'json';
        logFormatFromCli = true;
      }
      // `--json` is stripped here so the dispatcher doesn't see it as a
      // command name. The CLI entrypoint forwards the global flag back into
      // the subcommand argv after dispatch resolves so commands that declare
      // `json` in their spec still parse it through `parsed.values.json`.
      continue;
    }
    if (arg === '--log-format') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new CliUsageError('Missing value for --log-format (expected json or pretty)');
      }
      logFormat = parseLogFormat(value, '--log-format');
      logFormatFromCli = true;
      i += 1;
      continue;
    }
    if (arg.startsWith('--log-format=')) {
      logFormat = parseLogFormat(arg.slice('--log-format='.length), '--log-format');
      logFormatFromCli = true;
      continue;
    }
    if (arg === '--no-color') {
      noColor = true;
      noColorFromCli = true;
      continue;
    }
    if (arg === '--debug') {
      debug = true;
      debugFromCli = true;
      continue;
    }
    if (/^-V+$/.test(arg)) {
      verboseCount += arg.length - 1;
      continue;
    }
    rest.push(arg);
  }

  const quietRaw = env[QUIET_ENV];
  if (!quietFromCli && quietRaw !== undefined) {
    quiet = parseBooleanEnv(quietRaw, QUIET_ENV);
  }
  const verboseRaw = env[VERBOSE_ENV];
  if (verboseCount === 0 && verboseRaw !== undefined) {
    const n = Number(verboseRaw);
    if (!Number.isInteger(n) || n < 0) {
      throw new CliUsageError(
        `Invalid ${VERBOSE_ENV}: ${JSON.stringify(verboseRaw)} (expected a non-negative integer)`,
      );
    }
    verboseCount = n;
  }
  const jsonRaw = env[JSON_ENV];
  if (!jsonFromCli && jsonRaw !== undefined) {
    json = parseBooleanEnv(jsonRaw, JSON_ENV);
    if (json && !logFormatFromCli) logFormat = 'json';
  }
  const logFormatRaw = env[LOG_FORMAT_ENV];
  if (!logFormatFromCli && logFormatRaw !== undefined && logFormatRaw !== '') {
    logFormat = parseLogFormat(logFormatRaw, LOG_FORMAT_ENV);
  }
  // `NO_COLOR` (conventional) → off whenever set to a non-empty value.
  // `NECTAR_NO_COLOR` (project-specific) parses the usual boolean spelling so
  // `0`/`false` can explicitly re-enable color even when the upstream env has
  // it disabled, e.g. when running inside a CI that exports `NO_COLOR=1`
  // globally. Precedence: CLI > NECTAR_NO_COLOR > NO_COLOR.
  if (!noColorFromCli) {
    const nectarRaw = env[NO_COLOR_ENV_NECTAR];
    if (nectarRaw !== undefined) {
      noColor = parseBooleanEnv(nectarRaw, NO_COLOR_ENV_NECTAR);
    } else if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
      noColor = true;
    }
  }
  const debugRaw = env[DEBUG_ENV];
  if (!debugFromCli && debugRaw !== undefined) {
    debug = parseBooleanEnv(debugRaw, DEBUG_ENV);
  }

  return { flags: { quiet, verboseCount, json, logFormat, noColor, debug }, rest };
}

function parseLogFormat(raw: string, source: string): NonNullable<GlobalFlags['logFormat']> {
  if (raw === 'json' || raw === 'pretty') return raw;
  throw new CliUsageError(
    `Invalid ${source}: ${JSON.stringify(raw)} (expected "json" or "pretty")`,
  );
}
