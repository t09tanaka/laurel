import { type LogOutputMode, getOutputMode } from '~/util/logger.ts';

export type CliProgressMode = 'interactive' | 'plain';

export interface ProgressDetectionInput {
  env?: Record<string, string | undefined>;
  stdout?: { isTTY?: boolean | undefined };
  stderr?: { isTTY?: boolean | undefined };
  outputMode?: LogOutputMode;
}

function envFlagEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === '' || value === '0' || value === 'false' || value === 'no' || value === 'off') {
    return false;
  }
  return true;
}

function isCiEnvironment(env: Record<string, string | undefined>): boolean {
  if (envFlagEnabled(env.CI)) return true;
  if (envFlagEnabled(env.GITHUB_ACTIONS)) return true;
  if (envFlagEnabled(env.GITLAB_CI)) return true;
  if (envFlagEnabled(env.BUILDKITE)) return true;
  if (envFlagEnabled(env.CIRCLECI)) return true;
  if (envFlagEnabled(env.VERCEL)) return true;
  if (envFlagEnabled(env.NETLIFY)) return true;
  return false;
}

export function detectCliProgressMode(input: ProgressDetectionInput = {}): CliProgressMode {
  const env = input.env ?? process.env;
  const outputMode = input.outputMode ?? getOutputMode();
  if (outputMode === 'json') return 'plain';
  if (isCiEnvironment(env)) return 'plain';
  if (env.TERM === 'dumb') return 'plain';

  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  if (stdout.isTTY !== true) return 'plain';
  if (stderr.isTTY !== true) return 'plain';

  return 'interactive';
}

export function getCliProgressMode(): CliProgressMode {
  return detectCliProgressMode();
}

export function canUseInteractiveProgress(input: ProgressDetectionInput = {}): boolean {
  return detectCliProgressMode(input) === 'interactive';
}
