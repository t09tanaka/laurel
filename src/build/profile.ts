import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';

// `nectar build --profile` writes per-phase timing + bytes_emitted to
// dist/.nectar/profile.json so users can attribute their own build slowness
// to a phase (render, copy_assets, …) before reaching for an issue tracker.
//
// Shape is intentionally flat and append-only: one record per phase, plus one
// record per route inside the `render` phase. `route` and `bytes_emitted`
// are optional so phases that have no natural byte counter (e.g. config load)
// can omit them rather than reporting zero and lying.
export interface ProfileEntry {
  phase: string;
  duration_ms: number;
  route?: string;
  bytes_emitted?: number;
}

export type StopFn = (extra?: { bytes_emitted?: number }) => void;

export interface Profiler {
  start(phase: string, route?: string): StopFn;
  record(entry: ProfileEntry): void;
  readonly entries: readonly ProfileEntry[];
}

export function createProfiler(): Profiler {
  const entries: ProfileEntry[] = [];
  return {
    start(phase, route) {
      const t0 = performance.now();
      return (extra) => {
        const entry: ProfileEntry = {
          phase,
          duration_ms: roundMs(performance.now() - t0),
        };
        if (route !== undefined) entry.route = route;
        if (extra?.bytes_emitted !== undefined) entry.bytes_emitted = extra.bytes_emitted;
        entries.push(entry);
      };
    },
    record(entry) {
      entries.push({ ...entry, duration_ms: roundMs(entry.duration_ms) });
    },
    get entries() {
      return entries;
    },
  };
}

export async function writeProfile(outputDir: string, profiler: Profiler): Promise<void> {
  const dir = join(outputDir, '.nectar');
  await ensureDir(dir);
  await writeFile(
    join(dir, 'profile.json'),
    `${JSON.stringify(profiler.entries, null, 2)}\n`,
    'utf8',
  );
}

function roundMs(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}
