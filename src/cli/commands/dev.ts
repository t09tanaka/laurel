import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import type { Server, ServerWebSocket } from 'bun';
import { build } from '~/build/pipeline.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import {
  LIVERELOAD_CLIENT_JS,
  LIVERELOAD_PATH,
  LIVERELOAD_SCRIPT_PATH,
  encodeReloadMessage,
  injectLiveReload,
} from '~/dev/livereload.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DEV_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = 'localhost';
const REBUILD_DEBOUNCE_MS = 100;

// `nectar dev` is the operator-facing wrapper for "build once, serve dist/,
// rebuild on every change, reload the browser". Under the hood it composes
// the same three pieces as `nectar serve` (build → Bun.serve → fs.watch loop)
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

  let config: NectarConfig;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }
  const distDir = join(cwd, config.build.output_dir);

  // Always run an initial build so the developer never sees a stale dist/
  // from a previous run. Failing here is fatal — there is nothing to serve.
  logger.info(`Running initial build before starting dev server (${distDir}).`);
  try {
    const summary = await build({ cwd, configPath });
    logger.info(
      `Initial build complete: ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
    );
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }

  const clients = new Set<ServerWebSocket<unknown>>();
  // The Server generic widened in recent Bun types; biome/tsc disagree on
  // whether the type argument is required. Pre-existing serve.ts uses the
  // same un-parameterized form (`let server: Server`), so we follow that
  // pattern for consistency and accept the lint/tsc mismatch as a known
  // platform quirk.
  let server: Server;
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
          if (srv.upgrade(request)) return undefined;
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
  const basePath = config.build.base_path || '/';
  logger.info(
    `Listening on http://${displayHost}:${announcedPort}${basePath} (bound to ${hostname})`,
  );

  const watchPaths = gatherWatchPaths(cwd, config);
  const watchers: FSWatcher[] = [];
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let pending = false;
  let cssOnly = true;

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
    try {
      const summary = await build({ cwd, configPath });
      const messageType = isCssOnly ? 'css' : 'reload';
      logger.info(
        `Rebuilt ${summary.routeCount} routes (${summary.assetCount} assets); pushing ${messageType} to ${clients.size} client(s)`,
      );
      broadcast({ type: messageType });
    } catch (err) {
      // file:line format is the responsibility of reportError → formatNectarError;
      // it pretty-prints NectarError with source location when available and
      // falls back to the plain message for anything else.
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
    }, REBUILD_DEBOUNCE_MS);
  };

  for (const p of watchPaths) {
    try {
      const w = fsWatch(p, { recursive: true }, (_event, filename) => {
        if (filename !== null && filename !== undefined && isIgnoredChange(filename)) return;
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
      logger.warn(`Failed to watch ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger.info(`Watch mode enabled: tracking ${watchers.length} path(s) for changes`);

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
  // with `nectar serve` and common dev servers (vite, next dev, hugo server).
  if (signal === 'SIGINT') {
    process.exit(130);
  }
  return EXIT_CODES.ok;
}

function resolvePort(raw: unknown): number | CliUsageError {
  if (typeof raw !== 'string') return DEFAULT_PORT;
  const trimmed = raw.trim();
  // Allow --port 0 → "kernel picks a free port" because `nectar dev` is the
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

function isAddrInUseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ('code' in err && (err as { code?: unknown }).code === 'EADDRINUSE') return true;
  return /EADDRINUSE|address already in use/i.test(err.message);
}
