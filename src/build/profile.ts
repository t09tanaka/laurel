import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BUILD_STATS_FILENAME = '.nectar-build-stats.json';

export interface BuildStatsPhase {
  name: string;
  durationMs: number;
}

export interface BuildStatsRoute {
  url: string;
  outputPath: string;
  template: string;
  kind: string;
  durationMs: number;
  bytes: number;
  reused: boolean;
}

export interface BuildStats {
  schemaVersion: 1;
  generatedAt: string;
  outputDir: string;
  routeCount: number;
  assetCount: number;
  totalDurationMs: number;
  phases: BuildStatsPhase[];
  routes: BuildStatsRoute[];
}

export type StopFn = (extra?: { bytes?: number; reused?: boolean }) => void;

export interface RouteTimerInput {
  url: string;
  outputPath: string;
  template: string;
  kind: string;
}

export interface Profiler {
  startPhase(name: string): StopFn;
  startRoute(route: RouteTimerInput): StopFn;
  readonly phases: readonly BuildStatsPhase[];
  readonly routes: readonly BuildStatsRoute[];
  toJSON(summary: { outputDir: string; routeCount: number; assetCount: number }): BuildStats;
}

export function buildStatsPath(outputDir: string): string {
  return join(outputDir, BUILD_STATS_FILENAME);
}

export function createProfiler(): Profiler {
  const startedAt = performance.now();
  const phases: BuildStatsPhase[] = [];
  const routes: BuildStatsRoute[] = [];

  return {
    startPhase(name) {
      const t0 = performance.now();
      return () => {
        phases.push({ name, durationMs: roundMs(performance.now() - t0) });
      };
    },
    startRoute(route) {
      const t0 = performance.now();
      return (extra) => {
        routes.push({
          ...route,
          durationMs: roundMs(performance.now() - t0),
          bytes: extra?.bytes ?? 0,
          reused: extra?.reused ?? false,
        });
      };
    },
    get phases() {
      return phases;
    },
    get routes() {
      return routes;
    },
    toJSON(summary) {
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        outputDir: summary.outputDir,
        routeCount: summary.routeCount,
        assetCount: summary.assetCount,
        totalDurationMs: roundMs(performance.now() - startedAt),
        phases: aggregatePhases(phases),
        routes: [...routes],
      };
    },
  };
}

export async function writeProfile(
  outputDir: string,
  profiler: Profiler,
  summary: { outputDir?: string; routeCount: number; assetCount: number },
): Promise<string> {
  const statsPath = buildStatsPath(outputDir);
  const body = profiler.toJSON({
    outputDir: summary.outputDir ?? outputDir,
    routeCount: summary.routeCount,
    assetCount: summary.assetCount,
  });
  await writeFile(statsPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return statsPath;
}

function aggregatePhases(phases: readonly BuildStatsPhase[]): BuildStatsPhase[] {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const phase of phases) {
    if (!totals.has(phase.name)) order.push(phase.name);
    totals.set(phase.name, (totals.get(phase.name) ?? 0) + phase.durationMs);
  }
  return order.map((name) => ({ name, durationMs: roundMs(totals.get(name) ?? 0) }));
}

function roundMs(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}
