import { spawnSync } from 'node:child_process';

export interface VersionJson {
  name: 'nectar';
  version: string;
  bun: string | null;
  node: string;
  commit: string | null;
}

const COMMIT_ENV_KEYS = [
  'NECTAR_COMMIT_SHA',
  'GITHUB_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'CF_PAGES_COMMIT_SHA',
  'COMMIT_REF',
] as const;

export function buildVersionJson(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): VersionJson {
  return {
    name: 'nectar',
    version,
    bun: currentBunVersion(),
    node: process.version,
    commit: resolveCommit(env, cwd),
  };
}

function currentBunVersion(): string | null {
  return typeof Bun !== 'undefined' && typeof Bun.version === 'string' ? Bun.version : null;
}

function resolveCommit(env: NodeJS.ProcessEnv, cwd: string): string | null {
  for (const key of COMMIT_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0) return null;
    const commit = result.stdout.trim();
    return commit === '' ? null : commit;
  } catch {
    return null;
  }
}
