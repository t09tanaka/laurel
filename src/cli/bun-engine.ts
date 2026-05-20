import pkg from '../../package.json' with { type: 'json' };

type BunLike = { version?: unknown };

export function currentBunVersion(): string | undefined {
  const runtime = globalThis as typeof globalThis & { Bun?: BunLike };
  const version = runtime.Bun?.version;
  return typeof version === 'string' && version.trim() !== '' ? version : undefined;
}

export function packageBunEngine(): string | undefined {
  const engine = (pkg as { engines?: { bun?: unknown } }).engines?.bun;
  return typeof engine === 'string' && engine.trim() !== '' ? engine : undefined;
}

export function bunEngineWarning(
  current: string | undefined,
  required: string | undefined,
): string | undefined {
  if (current === undefined || required === undefined) return undefined;
  if (satisfiesMinimumVersion(current, required)) return undefined;
  return `Bun ${current} does not satisfy package engines.bun ${required}; upgrade Bun with \`bun upgrade\`.`;
}

export function warnIfBunEngineMismatch(
  warn: (message: string) => void,
  current = currentBunVersion(),
  required = packageBunEngine(),
): void {
  const message = bunEngineWarning(current, required);
  if (message) warn(message);
}

export function satisfiesMinimumVersion(current: string, constraint: string): boolean {
  const required = parseMinimumVersion(constraint);
  if (!required) return true;
  const actual = parseVersion(current);
  if (!actual) return false;

  for (let i = 0; i < 3; i += 1) {
    const have = actual[i] as number;
    const need = required[i] as number;
    if (have > need) return true;
    if (have < need) return false;
  }
  return true;
}

function parseMinimumVersion(constraint: string): [number, number, number] | undefined {
  return parseVersion(constraint);
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}
