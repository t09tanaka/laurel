import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BUILD_STATS_FILENAME = '.laurel-build-stats.json';

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

export interface BuildStatsHelperHotspot {
  name: string;
  calls: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

export interface BuildStatsMemory {
  peakRssBytes: number;
  peakRssMiB: number;
  samples: number;
}

export interface BuildStats {
  schemaVersion: 1;
  generatedAt: string;
  outputDir: string;
  routeCount: number;
  assetCount: number;
  totalDurationMs: number;
  memory: BuildStatsMemory;
  phases: BuildStatsPhase[];
  routes: BuildStatsRoute[];
  slowestRoutes: BuildStatsRoute[];
  helperHotspots: BuildStatsHelperHotspot[];
}

export type StopFn = (extra?: { bytes?: number; reused?: boolean }) => void;
export type HelperStopFn = () => void;

export interface RouteTimerInput {
  url: string;
  outputPath: string;
  template: string;
  kind: string;
}

export interface Profiler {
  startPhase(name: string): StopFn;
  startRoute(route: RouteTimerInput): StopFn;
  startHelper(name: string): HelperStopFn;
  readonly memory: BuildStatsMemory;
  readonly phases: readonly BuildStatsPhase[];
  readonly routes: readonly BuildStatsRoute[];
  readonly slowestRoutes: readonly BuildStatsRoute[];
  readonly helperHotspots: readonly BuildStatsHelperHotspot[];
  toJSON(summary: { outputDir: string; routeCount: number; assetCount: number }): BuildStats;
  dispose?: () => void;
}

interface ProfilerOptions {
  readRssBytes?: () => number;
  sampleIntervalMs?: number | false;
}

export function buildStatsPath(outputDir: string): string {
  return join(outputDir, BUILD_STATS_FILENAME);
}

export function createProfiler(options: ProfilerOptions = {}): Profiler {
  const startedAt = performance.now();
  const phases: BuildStatsPhase[] = [];
  const routes: BuildStatsRoute[] = [];
  const helpers = new Map<
    string,
    { calls: number; totalDurationMs: number; maxDurationMs: number }
  >();
  const readRssBytes = options.readRssBytes ?? readProcessRssBytes;
  const memory = createMemorySampler(readRssBytes);
  memory.sample();
  const interval =
    typeof options.sampleIntervalMs === 'number' && options.sampleIntervalMs > 0
      ? setInterval(() => memory.sample(), options.sampleIntervalMs)
      : undefined;
  interval?.unref?.();
  let disposed = false;

  return {
    startPhase(name) {
      memory.sample();
      const t0 = performance.now();
      return () => {
        memory.sample();
        phases.push({ name, durationMs: roundMs(performance.now() - t0) });
      };
    },
    startRoute(route) {
      memory.sample();
      const t0 = performance.now();
      return (extra) => {
        memory.sample();
        routes.push({
          ...route,
          durationMs: roundMs(performance.now() - t0),
          bytes: extra?.bytes ?? 0,
          reused: extra?.reused ?? false,
        });
      };
    },
    startHelper(name) {
      const t0 = performance.now();
      return () => {
        const durationMs = roundMs(performance.now() - t0);
        const current = helpers.get(name) ?? { calls: 0, totalDurationMs: 0, maxDurationMs: 0 };
        current.calls += 1;
        current.totalDurationMs = roundMs(current.totalDurationMs + durationMs);
        current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
        helpers.set(name, current);
      };
    },
    get phases() {
      return phases;
    },
    get routes() {
      return routes;
    },
    get slowestRoutes() {
      return topRoutes(routes);
    },
    get helperHotspots() {
      return topHelpers(helpers);
    },
    get memory() {
      if (!disposed) memory.sample();
      return memory.toJSON();
    },
    toJSON(summary) {
      if (!disposed) memory.sample();
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        outputDir: summary.outputDir,
        routeCount: summary.routeCount,
        assetCount: summary.assetCount,
        totalDurationMs: roundMs(performance.now() - startedAt),
        memory: memory.toJSON(),
        phases: aggregatePhases(phases),
        routes: [...routes],
        slowestRoutes: topRoutes(routes),
        helperHotspots: topHelpers(helpers),
      };
    },
    dispose() {
      if (interval) clearInterval(interval);
      disposed = true;
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
  profiler.dispose?.();
  await writeFile(statsPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return statsPath;
}

function createMemorySampler(readRssBytes: () => number): {
  sample: () => void;
  toJSON: () => BuildStatsMemory;
} {
  let peakRssBytes = 0;
  let samples = 0;
  return {
    sample() {
      const rss = readRssBytes();
      if (!Number.isFinite(rss) || rss < 0) return;
      samples += 1;
      peakRssBytes = Math.max(peakRssBytes, Math.round(rss));
    },
    toJSON() {
      return {
        peakRssBytes,
        peakRssMiB: roundMiB(peakRssBytes),
        samples,
      };
    },
  };
}

function readProcessRssBytes(): number {
  const memoryUsage = process.memoryUsage;
  return typeof memoryUsage.rss === 'function' ? memoryUsage.rss() : memoryUsage().rss;
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

function topRoutes(routes: readonly BuildStatsRoute[], limit = 5): BuildStatsRoute[] {
  return [...routes]
    .sort(
      (a, b) =>
        b.durationMs - a.durationMs ||
        b.bytes - a.bytes ||
        a.url.localeCompare(b.url) ||
        a.outputPath.localeCompare(b.outputPath),
    )
    .slice(0, limit);
}

function topHelpers(
  helpers: ReadonlyMap<string, { calls: number; totalDurationMs: number; maxDurationMs: number }>,
  limit = 5,
): BuildStatsHelperHotspot[] {
  return [...helpers.entries()]
    .map(([name, stats]) => ({
      name,
      calls: stats.calls,
      totalDurationMs: roundMs(stats.totalDurationMs),
      maxDurationMs: roundMs(stats.maxDurationMs),
    }))
    .sort(
      (a, b) =>
        b.totalDurationMs - a.totalDurationMs ||
        b.calls - a.calls ||
        b.maxDurationMs - a.maxDurationMs ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

function roundMs(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

function roundMiB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
