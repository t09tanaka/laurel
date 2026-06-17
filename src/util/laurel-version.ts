import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

// Resolves Laurel's own package version at runtime by reading the bundled or
// source-layout package.json. Used by emitters (e.g. build-manifest) that
// embed the running CLI version into output artifacts so downstream tooling
// can detect generator upgrades. Falls back to '0.0.0' if the file cannot be
// located, which only happens in unusual embeddings — never in normal use.
export async function getLaurelVersion(): Promise<string> {
  if (cached !== undefined) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // Source layout: src/util/laurel-version.ts -> ../../package.json
  // Bundled layout: dist/<entry>.mjs -> ../package.json
  const candidates = [resolve(here, '../../package.json'), resolve(here, '../package.json')];
  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf8');
      const json = JSON.parse(raw) as { name?: string; version?: string };
      if (json.name === '@t09tanaka/laurel' && typeof json.version === 'string') {
        cached = json.version;
        return cached;
      }
    } catch {
      // try next candidate
    }
  }
  cached = '0.0.0';
  return cached;
}

// Visible for tests.
export function resetLaurelVersionCache(): void {
  cached = undefined;
}
