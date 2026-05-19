import { CliUsageError, globalEnvVarName, parseBooleanEnv } from './parse.ts';

export interface GlobalFlags {
  quiet: boolean;
  verboseCount: number;
}

export interface ExtractResult {
  flags: GlobalFlags;
  rest: string[];
}

const QUIET_ENV = globalEnvVarName('quiet');
const VERBOSE_ENV = globalEnvVarName('verbose');

// Strips top-level verbosity flags from argv so subcommand parsers (which run
// node:util `parseArgs` in strict mode) don't choke on them. Flags may appear
// anywhere before `--`; after `--`, tokens are passed through untouched. CLI
// flags take priority over env-var fallbacks (NECTAR_QUIET / NECTAR_VERBOSE).
export function extractGlobalFlags(
  argv: string[],
  env: Record<string, string | undefined> = {},
): ExtractResult {
  const rest: string[] = [];
  let quiet = false;
  let quietFromCli = false;
  let verboseCount = 0;
  let passthrough = false;

  for (const arg of argv) {
    if (passthrough) {
      rest.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      rest.push(arg);
      continue;
    }
    if (arg === '--quiet') {
      quiet = true;
      quietFromCli = true;
      continue;
    }
    if (arg === '--verbose') {
      verboseCount += 1;
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

  return { flags: { quiet, verboseCount }, rest };
}
