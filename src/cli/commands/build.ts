import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { type BuildSummary, type DryRunRouteSummary, build } from '~/build/pipeline.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { createCleanupRegistry } from '~/util/cleanup.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { getLogLevel, logger } from '~/util/logger.ts';
import { ensureContentDirs } from '../ensure-content-dirs.ts';
import {
  CliUsageError,
  type ParsedCommand,
  formatCommandHelp,
  parseBooleanEnv,
  parseCommand,
} from '../parse.ts';
import { reportError } from '../report.ts';
import { BUILD_SPEC } from '../specs.ts';

const WATCH_DEBOUNCE_MS = 100;

export async function runBuild(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(BUILD_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(BUILD_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(BUILD_SPEC));
    return EXIT_CODES.ok;
  }

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const outputDir = typeof parsed.values.output === 'string' ? parsed.values.output : undefined;
  const basePath =
    typeof parsed.values['base-path'] === 'string' ? parsed.values['base-path'] : undefined;
  const baseUrl =
    typeof parsed.values['base-url'] === 'string' ? parsed.values['base-url'] : undefined;
  const strict = parsed.values.strict === true;
  const profile = parsed.values.profile === true;
  const noAtomic = parsed.values['no-atomic'] === true;
  const dryRun = parsed.values['dry-run'] === true;
  const watch = parsed.values.watch === true;
  const force = parsed.values.force === true;
  const asJson = parsed.values.json === true;
  // NECTAR_DRAFTS=1 is documented as a shorter alias for the auto-derived
  // NECTAR_BUILD_INCLUDE_DRAFTS env fallback. The standard fallback already
  // populated `parsed.values['include-drafts']` if set; only fall back to the
  // shorter alias when the flag and the standard env var are both unset, so a
  // misspelled NECTAR_DRAFTS value can't override an explicit --include-drafts=false.
  let includeDrafts = parsed.values['include-drafts'] === true;
  if (!includeDrafts && parsed.values['include-drafts'] === undefined) {
    const aliasRaw = process.env.NECTAR_DRAFTS;
    if (aliasRaw !== undefined) {
      try {
        includeDrafts = parseBooleanEnv(aliasRaw, 'NECTAR_DRAFTS');
      } catch (err) {
        if (err instanceof CliUsageError) {
          process.stderr.write(`${err.message}\n\n`);
          process.stderr.write(formatCommandHelp(BUILD_SPEC));
          return EXIT_CODES.usage;
        }
        throw err;
      }
    }
  }
  const cwd = process.cwd();

  if (watch && dryRun) {
    process.stderr.write('--watch and --dry-run are mutually exclusive\n\n');
    process.stderr.write(formatCommandHelp(BUILD_SPEC));
    return EXIT_CODES.usage;
  }

  let concurrency: number | undefined;
  const concurrencyRaw = parsed.values.concurrency;
  if (typeof concurrencyRaw === 'string') {
    const parsedConcurrency = parseConcurrency(concurrencyRaw);
    if (parsedConcurrency instanceof CliUsageError) {
      process.stderr.write(`${parsedConcurrency.message}\n\n`);
      process.stderr.write(formatCommandHelp(BUILD_SPEC));
      return EXIT_CODES.usage;
    }
    concurrency = parsedConcurrency;
  }

  // `--emit-content-api` is tri-state at the BuildOptions layer (undefined =
  // use config, true = force on, false = force off). The CLI parser only ever
  // produces `true` or `undefined` for boolean flags, but the env-var
  // fallback (NECTAR_BUILD_EMIT_CONTENT_API=0) can populate `false` directly,
  // so we forward whatever the parser landed on without coercion.
  const emitContentApiRaw = parsed.values['emit-content-api'];
  const emitContentApi: boolean | undefined =
    typeof emitContentApiRaw === 'boolean' ? emitContentApiRaw : undefined;

  const buildArgs = {
    cwd,
    configPath,
    outputDir,
    basePath,
    baseUrl,
    profile,
    noAtomic,
    concurrency,
    dryRun,
    includeDrafts,
    force,
    emitContentApi,
  } as const;

  const reportSummary = (summary: BuildSummary, opts: { prefix?: string } = {}): void => {
    if (asJson) {
      // Emit one JSON line per invocation (initial build + each rebuild) so
      // CI consumers can `tail -f | jq` the stream. The payload mirrors the
      // BuildSummary surface without leaking internal types.
      const payload = {
        ok: true,
        prefix: opts.prefix ?? (summary.dryRun ? 'dry-run' : 'built'),
        routeCount: summary.routeCount,
        assetCount: summary.assetCount,
        outputDir: summary.outputDir,
        warningCount: summary.warningCount,
        dryRun: summary.dryRun === true,
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    const prefix = opts.prefix ?? (summary.dryRun ? 'Dry run: would build' : 'Built');
    logger.info(
      `${prefix} ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
    );
    if (summary.dryRun && summary.routes && isVerbose()) {
      logger.info(formatDryRunRouteTable(summary.routes));
    }
  };

  // Auto-create missing content dirs before the first build so a fresh
  // checkout doesn't fail with ENOENT. Warning-level so the user sees the
  // remediation; safe to no-op when dirs already exist.
  try {
    const cfgForPreflight = await loadConfig({ cwd, configPath });
    await ensureContentDirs(cwd, cfgForPreflight);
  } catch {
    // Config errors are surfaced by the build pipeline below with a richer
    // NectarError; do not double-report here.
  }

  let initialSummary: BuildSummary;
  try {
    initialSummary = await build(buildArgs);
    reportSummary(initialSummary);
    if (!watch && strict && initialSummary.warningCount > 0) {
      logger.error(
        `Strict mode: build emitted ${initialSummary.warningCount} warning${
          initialSummary.warningCount === 1 ? '' : 's'
        }`,
      );
      return EXIT_CODES.generic;
    }
  } catch (err) {
    reportError(err, cwd);
    if (!watch) return exitCodeForError(err);
    logger.warn('Initial build failed; staying in watch mode so the next change can retry');
  }

  if (!watch) return EXIT_CODES.ok;

  return runWatchLoop({
    cwd,
    configPath,
    onRebuild: async () => {
      const summary = await build(buildArgs);
      reportSummary(summary, { prefix: 'Rebuilt' });
      if (strict && summary.warningCount > 0) {
        logger.warn(
          `Strict mode: build emitted ${summary.warningCount} warning${
            summary.warningCount === 1 ? '' : 's'
          } (watch mode keeps running)`,
        );
      }
    },
  });
}

interface WatchLoopOptions {
  cwd: string;
  configPath?: string | undefined;
  onRebuild: () => Promise<void>;
}

async function runWatchLoop({ cwd, configPath, onRebuild }: WatchLoopOptions): Promise<number> {
  // Re-load config so the watcher knows which paths the just-completed build
  // actually depends on (content dirs, theme dir, config files). Failing to
  // read config is fatal — there is nothing to watch otherwise.
  let config: NectarConfig;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }

  const watchPaths = gatherWatchPaths(cwd, config);
  const watchers: FSWatcher[] = [];
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let pending = false;
  const cleanup = createCleanupRegistry();

  cleanup.register(
    () => {
      if (rebuildTimer !== undefined) {
        clearTimeout(rebuildTimer);
        rebuildTimer = undefined;
      }
    },
    { name: 'build-watch-debounce-timer' },
  );
  cleanup.register(
    () => {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // already closed; ignore
        }
      }
    },
    { name: 'build-watchers' },
  );

  const runRebuild = async (): Promise<void> => {
    building = true;
    try {
      await onRebuild();
    } catch (err) {
      reportError(err, cwd);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        scheduleRebuild();
      }
    }
  };
  const scheduleRebuild = (): void => {
    if (building) {
      pending = true;
      return;
    }
    if (rebuildTimer !== undefined) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      void runRebuild();
    }, WATCH_DEBOUNCE_MS);
  };

  for (const p of watchPaths) {
    try {
      const w = fsWatch(p, { recursive: true }, (_event, filename) => {
        if (filename !== null && filename !== undefined && isIgnoredChange(filename)) return;
        scheduleRebuild();
      });
      watchers.push(w);
    } catch (err) {
      logger.warn(`Failed to watch ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger.info(`Watch mode enabled: tracking ${watchers.length} path(s) for changes`);

  await cleanup.waitForSignal({ signals: ['SIGINT', 'SIGTERM'] });
  return EXIT_CODES.ok;
}

function gatherWatchPaths(cwd: string, config: NectarConfig): string[] {
  const paths = new Set<string>();
  const add = (p: string): void => {
    const abs = isAbsolute(p) ? p : join(cwd, p);
    if (existsSync(abs)) paths.add(abs);
  };
  add(config.content.posts_dir);
  add(config.content.pages_dir);
  add(config.content.authors_dir);
  add(config.content.tags_dir);
  add(config.content.assets_dir);
  add(join(config.theme.dir, config.theme.name));
  for (const name of ['nectar.toml', 'nectar.config.toml']) {
    const p = join(cwd, name);
    if (existsSync(p)) paths.add(p);
  }
  return [...paths];
}

// Filters fs.watch noise that would otherwise spam rebuilds: build artifacts
// the next build will overwrite, editor swap files, hidden dotfiles, and
// node_modules churn.
export function isIgnoredChange(filename: string): boolean {
  const norm = filename.replace(/\\/g, '/');
  if (norm.endsWith('.map')) return true;
  if (norm.includes('assets/built/')) return true;
  if (norm.includes('node_modules/')) return true;
  if (norm.includes('/.') || norm.startsWith('.')) return true;
  if (norm.endsWith('~') || norm.endsWith('.swp') || norm.endsWith('.tmp')) return true;
  return false;
}

function parseConcurrency(raw: string): number | CliUsageError {
  const trimmed = raw.trim();
  if (trimmed === '' || !/^[0-9]+$/.test(trimmed)) {
    return new CliUsageError(
      `Invalid value for --concurrency: ${JSON.stringify(raw)} (expected a positive integer)`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) {
    return new CliUsageError(
      `Invalid value for --concurrency: ${JSON.stringify(raw)} (expected a positive integer)`,
    );
  }
  return n;
}

function isVerbose(): boolean {
  const level = getLogLevel();
  return level === 'debug' || level === 'trace';
}

// Renders a fixed-width per-route table for `--dry-run --verbose`. Columns
// pad to the longest value in the column so URL/template/path stay aligned
// even with long slugs. Routes are emitted in plan order (the same order
// they would have been rendered/written by a real build).
export function formatDryRunRouteTable(routes: readonly DryRunRouteSummary[]): string {
  if (routes.length === 0) return 'Routes: (none)';
  const headers = {
    kind: 'KIND',
    url: 'URL',
    template: 'TEMPLATE',
    bytes: 'BYTES',
    path: 'OUTPUT',
  };
  const rows = routes.map((r) => ({
    kind: r.kind,
    url: r.url,
    template: r.template,
    bytes: String(r.bytes),
    path: r.outputPath,
  }));
  const widths = {
    kind: Math.max(headers.kind.length, ...rows.map((r) => r.kind.length)),
    url: Math.max(headers.url.length, ...rows.map((r) => r.url.length)),
    template: Math.max(headers.template.length, ...rows.map((r) => r.template.length)),
    bytes: Math.max(headers.bytes.length, ...rows.map((r) => r.bytes.length)),
    path: Math.max(headers.path.length, ...rows.map((r) => r.path.length)),
  };
  const fmt = (r: typeof headers): string =>
    `  ${r.kind.padEnd(widths.kind)}  ${r.url.padEnd(widths.url)}  ${r.template.padEnd(
      widths.template,
    )}  ${r.bytes.padStart(widths.bytes)}  ${r.path.padEnd(widths.path)}`;
  const lines = ['Routes:', fmt(headers)];
  for (const r of rows) lines.push(fmt(r));
  return lines.join('\n');
}
