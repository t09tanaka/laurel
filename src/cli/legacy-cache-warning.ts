import { existsSync } from 'node:fs';
import { join } from 'node:path';

// `.laurel-cache/` was the original per-project cache root before #575 unified
// everything under `.laurel/cache/`. Existing projects upgraded to the new
// layout may still have the legacy directory left behind; this helper emits a
// single warning telling the operator to remove it. Auto-deleting on their
// behalf would be a surprising destructive operation, so we leave the cleanup
// to the user.
const LEGACY_CACHE_DIR = '.laurel-cache';

export function legacyCacheWarning(
  cwd: string,
  exists = legacyCacheExists(cwd),
): string | undefined {
  if (!exists) return undefined;
  return `Detected legacy ${LEGACY_CACHE_DIR}/ directory at ${join(cwd, LEGACY_CACHE_DIR)}. The build cache has moved to .laurel/cache/; you can safely \`rm -rf ${LEGACY_CACHE_DIR}\` to reclaim disk space.`;
}

export function warnIfLegacyCacheDir(
  warn: (message: string) => void,
  cwd: string = process.cwd(),
): void {
  const message = legacyCacheWarning(cwd);
  if (message) warn(message);
}

export function legacyCacheExists(cwd: string): boolean {
  return existsSync(join(cwd, LEGACY_CACHE_DIR));
}
