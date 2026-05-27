import { CliUsageError, globalEnvVarName, parseBooleanEnv } from './parse.ts';
import { globalRcDefaults, rcValue, readRcBoolean, readRcInteger, readRcString } from './rc.ts';

export interface GlobalFlags {
  quiet: boolean;
  verboseCount: number;
  json: boolean;
  logFormat: 'json' | 'pretty' | undefined;
  noColor: boolean;
  debug: boolean;
  warningsAsErrors: boolean;
  locale: string | undefined;
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
const WARNINGS_AS_ERRORS_ENV = globalEnvVarName('warnings-as-errors');
const LOCALE_ENV = globalEnvVarName('locale');

// Strips top-level verbosity / output-mode flags from argv so subcommand
// parsers (which run node:util `parseArgs` in strict mode) don't choke on
// them. Flags may appear anywhere before `--`; after `--`, tokens are passed
// through untouched. CLI flags take priority over env-var and .nectarrc fallbacks
// (NECTAR_QUIET / NECTAR_VERBOSE / NECTAR_LOG_FORMAT / NECTAR_JSON /
// NECTAR_NO_COLOR / NECTAR_DEBUG / NECTAR_WARNINGS_AS_ERRORS).
// We also recognise the conventional `NO_COLOR` (any non-empty value disables
// color) and `FORCE_COLOR` (overrides env-level no-color defaults) so nectar
// matches the rest of the CLI ecosystem out of the box.
export function extractGlobalFlags(
  argv: string[],
  env: Record<string, string | undefined> = {},
  cwd: string = process.cwd(),
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
  let warningsAsErrors = false;
  let warningsAsErrorsFromCli = false;
  let locale: string | undefined;
  let localeFromCli = false;
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
    if (arg === '--warnings-as-errors') {
      warningsAsErrors = true;
      warningsAsErrorsFromCli = true;
      continue;
    }
    if (arg === '--locale') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new CliUsageError('Missing value for --locale (expected a BCP 47 locale tag)');
      }
      locale = parseLocale(value, '--locale');
      localeFromCli = true;
      i += 1;
      continue;
    }
    if (arg.startsWith('--locale=')) {
      locale = parseLocale(arg.slice('--locale='.length), '--locale');
      localeFromCli = true;
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
  const forceColor = parseForceColor(env.FORCE_COLOR);
  // `NO_COLOR` (conventional) -> off whenever set to a non-empty value.
  // `NECTAR_NO_COLOR` (project-specific) parses the usual boolean spelling so
  // `0`/`false` can explicitly re-enable color even when the upstream env has
  // it disabled, e.g. when running inside a CI that exports `NO_COLOR=1`
  // globally. Precedence: CLI > FORCE_COLOR > NECTAR_NO_COLOR > NO_COLOR.
  if (!noColorFromCli) {
    if (forceColor !== undefined) {
      noColor = !forceColor;
    } else if (env[NO_COLOR_ENV_NECTAR] !== undefined) {
      const nectarRaw = env[NO_COLOR_ENV_NECTAR];
      noColor = parseBooleanEnv(nectarRaw, NO_COLOR_ENV_NECTAR);
    } else if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
      noColor = true;
    }
  }
  const debugRaw = env[DEBUG_ENV];
  if (!debugFromCli && debugRaw !== undefined) {
    debug = parseBooleanEnv(debugRaw, DEBUG_ENV);
  }
  const warningsAsErrorsRaw = env[WARNINGS_AS_ERRORS_ENV];
  if (!warningsAsErrorsFromCli && warningsAsErrorsRaw !== undefined) {
    warningsAsErrors = parseBooleanEnv(warningsAsErrorsRaw, WARNINGS_AS_ERRORS_ENV);
  }
  const localeRaw = env[LOCALE_ENV];
  if (!localeFromCli && localeRaw !== undefined && localeRaw !== '') {
    locale = parseLocale(localeRaw, LOCALE_ENV);
  }
  let rc: ReturnType<typeof globalRcDefaults>;
  try {
    rc = globalRcDefaults(cwd, env);
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }
  if (rc !== undefined) {
    if (!quietFromCli && quietRaw === undefined) {
      quiet = readGlobalRcBoolean(rc, 'quiet') ?? quiet;
    }
    if (verboseCount === 0 && verboseRaw === undefined) {
      verboseCount = readGlobalRcInteger(rc, 'verbose') ?? verboseCount;
    }
    if (!jsonFromCli && jsonRaw === undefined) {
      const rcJson = readGlobalRcBoolean(rc, 'json');
      if (rcJson !== undefined) {
        json = rcJson;
        if (json && !logFormatFromCli && logFormatRaw === undefined) logFormat = 'json';
      }
    }
    if (!logFormatFromCli && logFormatRaw === undefined) {
      const rcLogFormat = readGlobalRcString(rc, 'log-format');
      if (rcLogFormat !== undefined)
        logFormat = parseLogFormat(rcLogFormat, '.nectarrc global.log-format');
    }
    if (
      !noColorFromCli &&
      forceColor === undefined &&
      env[NO_COLOR_ENV_NECTAR] === undefined &&
      (env.NO_COLOR === undefined || env.NO_COLOR === '')
    ) {
      noColor = readGlobalRcBoolean(rc, 'no-color') ?? noColor;
    }
    if (!debugFromCli && debugRaw === undefined) {
      debug = readGlobalRcBoolean(rc, 'debug') ?? debug;
    }
    if (!warningsAsErrorsFromCli && warningsAsErrorsRaw === undefined) {
      warningsAsErrors = readGlobalRcBoolean(rc, 'warnings-as-errors') ?? warningsAsErrors;
    }
    if (!localeFromCli && localeRaw === undefined) {
      locale = readGlobalRcString(rc, 'locale') ?? locale;
    }
  }

  return {
    flags: { quiet, verboseCount, json, logFormat, noColor, debug, warningsAsErrors, locale },
    rest,
  };
}

function readGlobalRcBoolean(rc: Record<string, unknown>, key: string): boolean | undefined {
  try {
    return readRcBoolean(rcValue(rc, key), `.nectarrc global.${key}`);
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }
}

function readGlobalRcInteger(rc: Record<string, unknown>, key: string): number | undefined {
  try {
    return readRcInteger(rcValue(rc, key), `.nectarrc global.${key}`);
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }
}

function readGlobalRcString(rc: Record<string, unknown>, key: string): string | undefined {
  try {
    return readRcString(rcValue(rc, key), `.nectarrc global.${key}`);
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }
}

function parseLogFormat(raw: string, source: string): NonNullable<GlobalFlags['logFormat']> {
  if (raw === 'json' || raw === 'pretty') return raw;
  throw new CliUsageError(
    `Invalid ${source}: ${JSON.stringify(raw)} (expected "json" or "pretty")`,
  );
}

function parseLocale(raw: string, source: string): string {
  const value = raw.trim();
  if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) return value;
  throw new CliUsageError(
    `Invalid ${source}: ${JSON.stringify(raw)} (expected a BCP 47 locale tag like "en-US")`,
  );
}

function parseForceColor(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === '0' || value === 'false') return false;
  if (value === '' || value === '1' || value === '2' || value === '3' || value === 'true') {
    return true;
  }
  return undefined;
}
