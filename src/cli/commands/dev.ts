import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { basename, isAbsolute, join, normalize } from 'node:path';
import type { Server, ServerWebSocket } from 'bun';
import { type BuildSummary, build } from '~/build/pipeline.ts';
import { findOutdatedSkills } from '~/cli/skill/check-updates.ts';
import { loadConfig } from '~/config/loader.ts';
import type { LaurelConfig } from '~/config/schema.ts';
import { type DevChangeCategory, decideDevReuse } from '~/dev/incremental.ts';
import {
  LIVERELOAD_CLIENT_JS,
  LIVERELOAD_PATH,
  LIVERELOAD_SCRIPT_PATH,
  encodeReloadMessage,
  injectLiveReload,
} from '~/dev/livereload.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { getLaurelVersion } from '~/util/laurel-version.ts';
import { logger, setWarningSubscriber } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DEV_SPEC } from '../specs.ts';
import {
  emitStartupEvent,
  findActiveConfigDisplay,
  formatPath,
  renderBanner,
  renderNotice,
  renderReady,
  renderRebuild,
  renderWarnings,
  summarizeWatching,
  writeBlock,
} from './startup-banner.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = 'localhost';
const REBUILD_DEBOUNCE_MS = 100;
// The dev server always serves dist/ from the filesystem root, so a configured
// `build.base_path` (e.g. `/blog/`) would make every emitted asset/link point at
// a subpath that the server does not mount — links 404 and CSS goes missing.
// Force the base path to `/` for dev builds so the announced URL, the served
// routes, and the in-page links all agree. Production builds keep base_path.
const DEV_BASE_PATH = '/';

// `laurel dev` is the operator-facing wrapper for "build once, serve dist/,
// rebuild on every change, reload the browser". Under the hood it composes
// the same three pieces as `laurel serve` (build → Bun.serve → fs.watch loop)
// but with dev-specific defaults baked in:
//   * always force a fresh initial build (no stale dist/ surprises)
//   * always watch (no `--no-watch` opt-out)
//   * inject the external livereload script at emit time so the served HTML
//     stays cache-friendly and the client code lives in one place
//   * push a JSON-encoded reload signal (CSS-only changes flip <link href>
//     instead of reloading the whole document)
// The serve command keeps its lower-level surface so existing scripts and the
// `--build` opt-in don't break.
export async function runDev(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(DEV_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(DEV_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(DEV_SPEC));
    return EXIT_CODES.ok;
  }

  const portResult = resolvePort(parsed.values.port);
  if (portResult instanceof CliUsageError) {
    process.stderr.write(`${portResult.message}\n`);
    return EXIT_CODES.usage;
  }
  const port = portResult;

  const hostResult = resolveHost(parsed.values.host);
  if (hostResult instanceof CliUsageError) {
    process.stderr.write(`${hostResult.message}\n`);
    return EXIT_CODES.usage;
  }
  const hostname = hostResult;

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const cwd = process.cwd();

  let config: LaurelConfig;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }
  const distDir = join(cwd, config.build.output_dir);
  const watchPaths = gatherWatchPaths(cwd, config);
  const version = await getLaurelVersion();

  // Banner -> build -> ready ordering: dev.start advertises what is about
  // to spin up, the build runs with warnings captured into a buffer, and
  // the Ready block carries the URL only after the server is actually up.
  // If the build fails the captured warnings still flush so they don't get
  // lost behind the error report.
  writeBlock(
    renderBanner({
      version,
      mode: 'dev mode',
      rows: [
        ['Site', basename(cwd) || cwd],
        ['Config', findActiveConfigDisplay(cwd, configPath)],
        ['Theme', config.theme.name],
        ['Output', formatPath(cwd, distDir, { trailingSlash: true })],
        ['Watching', summarizeWatching(cwd, watchPaths).join(', ')],
      ],
    }),
  );
  emitStartupEvent('dev.start', { mode: 'dev', port, host: hostname });

  let reusable: NonNullable<BuildSummary['reusable']> | undefined;
  let routeCount = 0;
  let assetCount = 0;
  const capturedWarnings: string[] = [];
  const buildStarted = performance.now();
  setWarningSubscriber((msg) => {
    capturedWarnings.push(msg);
    emitStartupEvent('build.warning', { message: msg });
    return true;
  });
  try {
    const summary = await build({
      cwd,
      configPath,
      captureReusable: true,
      basePath: DEV_BASE_PATH,
    });
    reusable = summary.reusable;
    routeCount = summary.routeCount;
    assetCount = summary.assetCount;
  } catch (err) {
    setWarningSubscriber(undefined);
    writeBlock(renderWarnings(capturedWarnings));
    reportError(err, cwd);
    return exitCodeForError(err);
  }
  setWarningSubscriber(undefined);
  const buildElapsedMs = performance.now() - buildStarted;

  const clients = new Set<ServerWebSocket<unknown>>();
  // Recent Bun types require an explicit WebSocket data parameter even when
  // the dev server does not attach per-socket state.
  let server: Server<unknown>;
  try {
    server = Bun.serve({
      port,
      hostname,
      websocket: {
        open(ws) {
          clients.add(ws);
        },
        close(ws) {
          clients.delete(ws);
        },
        message() {},
      },
      async fetch(request, srv) {
        const url = new URL(request.url);
        if (url.pathname === LIVERELOAD_PATH) {
          if (srv.upgrade(request, { data: undefined })) return undefined;
          return new Response('upgrade failed', { status: 426 });
        }
        if (url.pathname === LIVERELOAD_SCRIPT_PATH) {
          return new Response(LIVERELOAD_CLIENT_JS, {
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });
        }
        const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
        const target = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
        const filePath = normalize(join(distDir, target));
        // Prevent directory traversal: any resolved path that escapes distDir
        // (e.g. `/../etc/passwd`) is rejected with 403 instead of being served.
        if (!filePath.startsWith(distDir)) {
          return new Response('Forbidden', { status: 403 });
        }
        const file = Bun.file(filePath);
        if (await file.exists()) {
          if (filePath.endsWith('.html')) {
            const html = await file.text();
            return new Response(injectLiveReload(html, 'external'), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          return new Response(file);
        }
        const fallback = Bun.file(join(distDir, '404.html'));
        if (await fallback.exists()) {
          const html = await fallback.text();
          return new Response(injectLiveReload(html, 'external'), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    });
  } catch (err) {
    if (isAddrInUseError(err)) {
      process.stderr.write(`Port ${port} is in use; try --port ${port + 1}\n`);
      return EXIT_CODES.usage;
    }
    throw err;
  }

  const announcedPort = server.port;
  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
  const localUrl = `http://${displayHost}:${announcedPort}${DEV_BASE_PATH}`;
  const configuredSiteUrl = typeof config.site.url === 'string' ? config.site.url : undefined;

  // Surfaced before the Ready banner so it gives context for the root URL shown
  // there: dev always serves dist/ from `/`, so a configured subpath is dropped.
  const configuredBasePath = config.build.base_path || '/';
  if (configuredBasePath !== '/') {
    writeBlock(
      renderNotice(
        'info',
        `base_path \`${configuredBasePath}\` is ignored in dev — the site is served from \`/\`. The production build still uses \`${configuredBasePath}\`.`,
      ),
    );
  }

  writeBlock(
    renderReady({
      elapsedMs: buildElapsedMs,
      url: localUrl,
      routes: routeCount,
      assets: assetCount,
      siteUrl: configuredSiteUrl,
    }),
  );
  writeBlock(renderWarnings(capturedWarnings));
  const outdatedSkills = await findOutdatedSkills(cwd);
  if (outdatedSkills.length > 0) {
    writeBlock(
      renderNotice(
        'info',
        `${outdatedSkills.length} skill ${outdatedSkills.length === 1 ? 'update' : 'updates'} available — run \`laurel skill install\` to apply.`,
      ),
    );
  }
  emitStartupEvent('dev.ready', {
    url: localUrl,
    routes: routeCount,
    assets: assetCount,
    elapsedMs: Math.round(buildElapsedMs),
    warnings: capturedWarnings.length,
    siteUrl: configuredSiteUrl,
    skillUpdatesAvailable: outdatedSkills.length,
  });

  const watchers: FSWatcher[] = [];
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let pending = false;
  let cssOnly = true;
  // Categories observed in the current debounce window. Used to decide what
  // the next build() can reuse from the previously-loaded config + theme.
  // Reset to empty inside runRebuild() once the build kicks off; subsequent
  // file events landing during the build accumulate into the next window via
  // `pending`/`scheduleRebuild`.
  let pendingCategories = new Set<DevChangeCategory>();

  const broadcast = (message: { type: 'reload' | 'css' }): void => {
    const payload = encodeReloadMessage(message);
    for (const ws of clients) {
      try {
        ws.send(payload);
      } catch {
        // client may have disconnected mid-broadcast; ignore
      }
    }
  };

  const runRebuild = async (): Promise<void> => {
    building = true;
    const isCssOnly = cssOnly;
    cssOnly = true;
    const windowCategories = pendingCategories;
    pendingCategories = new Set();
    const decision = decideDevReuse(windowCategories);
    const reuseArg =
      reusable !== undefined
        ? {
            rawContentCache: reusable.rawContentCache,
            ...(decision.reuseConfig ? { config: reusable.config } : {}),
            ...(decision.reuseTheme ? { theme: reusable.theme } : {}),
          }
        : undefined;
    try {
      const rebuildStart = performance.now();
      const summary = await build({
        cwd,
        configPath,
        captureReusable: true,
        basePath: DEV_BASE_PATH,
        ...(reuseArg !== undefined ? { reuse: reuseArg } : {}),
      });
      const rebuildElapsedMs = performance.now() - rebuildStart;
      // A successful build either confirms the reused state is still valid or
      // produces a fresh one; either way, refresh `reusable` so the next
      // rebuild keeps benefiting from the cache.
      if (summary.reusable !== undefined) reusable = summary.reusable;
      const messageType = isCssOnly ? 'css' : 'reload';
      writeBlock(
        renderRebuild({
          routes: summary.routeCount,
          assets: summary.assetCount,
          elapsedMs: rebuildElapsedMs,
          changeType: messageType,
          clients: clients.size,
        }),
      );
      emitStartupEvent('dev.rebuilt', {
        routes: summary.routeCount,
        assets: summary.assetCount,
        elapsedMs: Math.round(rebuildElapsedMs),
        reuse: describeReuse(reuseArg),
        changeType: messageType,
        clients: clients.size,
      });
      broadcast({ type: messageType });
    } catch (err) {
      // file:line format is the responsibility of reportError → formatLaurelError;
      // it pretty-prints LaurelError with source location when available and
      // falls back to the plain message for anything else.
      reportError(err, cwd);
      // A failed build may have left half-mutated reusable state on the table.
      // Drop it so the next rebuild starts from a clean load and we don't
      // serve subtly stale config/theme to the next pass.
      reusable = undefined;
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
    }, REBUILD_DEBOUNCE_MS);
  };

  for (const target of watchPaths) {
    try {
      const w = fsWatch(target.path, { recursive: true }, (_event, filename) => {
        if (filename !== null && filename !== undefined && isIgnoredChange(filename)) return;
        pendingCategories.add(target.category);
        // Heuristic: if every change in this debounce window is a CSS file,
        // tell the client to hot-swap stylesheets instead of full-reloading.
        // Any non-CSS change in the same window flips this back to a full
        // reload — partial registry invalidation lives in scope for a future
        // pass, so the safe default is "rerender everything".
        if (filename !== null && filename !== undefined) {
          if (!filename.endsWith('.css')) cssOnly = false;
        } else {
          // fs.watch surfaces filename=null on some platforms; assume the
          // worst (non-CSS change) so we don't accidentally skip a reload.
          cssOnly = false;
        }
        scheduleRebuild();
      });
      watchers.push(w);
    } catch (err) {
      logger.warn(
        `Failed to watch ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const signal = await waitForShutdownSignal();

  if (rebuildTimer !== undefined) clearTimeout(rebuildTimer);
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // already closed; ignore
    }
  }
  for (const ws of clients) {
    try {
      ws.close();
    } catch {
      // already closed; ignore
    }
  }
  server.stop(true);
  // 128 + SIGINT(2) = 130 is the POSIX convention for "user cancelled". Aligns
  // with `laurel serve` and common dev servers (vite, next dev, hugo server).
  if (signal === 'SIGINT') {
    process.exit(130);
  }
  return EXIT_CODES.ok;
}

function resolvePort(raw: unknown): number | CliUsageError {
  if (typeof raw !== 'string') return DEFAULT_PORT;
  const trimmed = raw.trim();
  // Allow --port 0 → "kernel picks a free port" because `laurel dev` is the
  // canonical command for ephemeral / CI / smoke-test runs where binding to a
  // fixed port would just trip EADDRINUSE on parallel jobs. The full 0..65535
  // range matches POSIX. The strict `^\d+$` shape stops `--port 80abc` from
  // being silently coerced to 80 by Number().
  const parsed = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return new CliUsageError(`Invalid --port value: ${raw} (expected an integer in 0..65535)`);
  }
  return parsed;
}

function resolveHost(raw: unknown): string | CliUsageError {
  if (typeof raw !== 'string') return DEFAULT_HOST;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return new CliUsageError('Invalid --host value: cannot be empty');
  }
  return trimmed;
}

interface WatchTarget {
  path: string;
  category: DevChangeCategory;
}

function gatherWatchPaths(cwd: string, config: LaurelConfig): WatchTarget[] {
  const seen = new Set<string>();
  const targets: WatchTarget[] = [];
  const add = (p: string, category: DevChangeCategory): void => {
    const abs = isAbsolute(p) ? p : join(cwd, p);
    if (seen.has(abs)) return;
    if (!existsSync(abs)) return;
    seen.add(abs);
    targets.push({ path: abs, category });
  };
  add(config.content.posts_dir, 'content');
  add(config.content.pages_dir, 'content');
  add(config.content.authors_dir, 'content');
  add(config.content.tags_dir, 'content');
  add(config.content.assets_dir, 'content');
  add(join(config.theme.dir, config.theme.name), 'theme');
  for (const name of ['laurel.toml', 'laurel.config.toml']) {
    add(join(cwd, name), 'config');
  }
  return targets;
}

// Filters fs.watch noise that would otherwise spam rebuilds: build artifacts
// the next build will overwrite, editor swap files, hidden dotfiles, and
// node_modules churn. Mirrors the build/serve filter so dev/serve see the
// same change semantics.
export function isIgnoredChange(filename: string): boolean {
  const norm = filename.replace(/\\/g, '/');
  if (norm.endsWith('.map')) return true;
  if (norm.includes('assets/built/')) return true;
  if (norm.includes('node_modules/')) return true;
  if (norm.includes('/.') || norm.startsWith('.')) return true;
  if (norm.endsWith('~') || norm.endsWith('.swp') || norm.endsWith('.tmp')) return true;
  return false;
}

function waitForShutdownSignal(): Promise<'SIGINT' | 'SIGTERM'> {
  return new Promise<'SIGINT' | 'SIGTERM'>((resolve) => {
    const onInt = (): void => {
      process.removeListener('SIGTERM', onTerm);
      resolve('SIGINT');
    };
    const onTerm = (): void => {
      process.removeListener('SIGINT', onInt);
      resolve('SIGTERM');
    };
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
  });
}

function describeReuse(
  reuse: { config?: unknown; theme?: unknown; rawContentCache?: unknown } | undefined,
): string {
  if (!reuse) return 'fresh load';
  const parts: string[] = [];
  if (reuse.config !== undefined) parts.push('config');
  if (reuse.theme !== undefined) parts.push('theme');
  if (reuse.rawContentCache !== undefined) parts.push('content');
  if (parts.length === 0) return 'fresh load';
  return `reused ${parts.join('+')}`;
}

function isAddrInUseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ('code' in err && (err as { code?: unknown }).code === 'EADDRINUSE') return true;
  return /EADDRINUSE|address already in use/i.test(err.message);
}
