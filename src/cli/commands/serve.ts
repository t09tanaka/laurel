import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import type { Server, ServerWebSocket } from 'bun';
import { build } from '~/build/pipeline.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { SERVE_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = 'localhost';
const LIVERELOAD_PATH = '/__nectar_livereload';
const REBUILD_DEBOUNCE_MS = 120;

const CLIENT_SCRIPT = `<script>(function(){if(window.__nectarLiveReload)return;window.__nectarLiveReload=true;var p=location.protocol==='https:'?'wss:':'ws:';function c(){var w=new WebSocket(p+'//'+location.host+'${LIVERELOAD_PATH}');w.onmessage=function(e){if(e.data==='reload')location.reload();};w.onclose=function(){setTimeout(c,1000);};}c();})();</script>`;

export async function runServe(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(SERVE_SPEC, args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(SERVE_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(SERVE_SPEC));
    return 0;
  }

  let port = DEFAULT_PORT;
  if (typeof parsed.values.port === 'string') {
    const parsedPort = Number(parsed.values.port);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      process.stderr.write(`Invalid --port value: ${parsed.values.port}\n`);
      return 2;
    }
    port = parsedPort;
  }

  let hostname = DEFAULT_HOST;
  if (typeof parsed.values.host === 'string') {
    const trimmed = parsed.values.host.trim();
    if (trimmed.length === 0) {
      process.stderr.write('Invalid --host value: cannot be empty\n');
      return 2;
    }
    hostname = trimmed;
  }

  const watchMode = parsed.values.watch === true;
  const cwd = process.cwd();
  const config = await loadConfig({ cwd });
  const distDir = join(cwd, config.build.output_dir);

  if (!existsSync(distDir)) {
    if (watchMode) {
      try {
        const summary = await build({ cwd });
        logger.info(
          `Initial build complete: ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
        );
      } catch (err) {
        reportError(err, cwd);
        return 1;
      }
    } else {
      logger.error(`No build output found at ${distDir}. Run \`nectar build\` first.`);
      return 1;
    }
  }

  const clients = new Set<ServerWebSocket<unknown>>();
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
        if (watchMode && url.pathname === LIVERELOAD_PATH) {
          if (srv.upgrade(request)) return undefined;
          return new Response('upgrade failed', { status: 426 });
        }
        const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
        const target = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
        const filePath = normalize(join(distDir, target));
        if (!filePath.startsWith(distDir)) {
          return new Response('Forbidden', { status: 403 });
        }
        const file = Bun.file(filePath);
        if (await file.exists()) {
          if (watchMode && filePath.endsWith('.html')) {
            const html = await file.text();
            return new Response(injectLiveReloadScript(html), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          return new Response(file);
        }
        const fallback = Bun.file(join(distDir, '404.html'));
        if (await fallback.exists()) {
          if (watchMode) {
            const html = await fallback.text();
            return new Response(injectLiveReloadScript(html), {
              status: 404,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          return new Response(fallback, { status: 404 });
        }
        return new Response('Not Found', { status: 404 });
      },
    });
  } catch (err) {
    if (isAddrInUseError(err)) {
      process.stderr.write(`Port ${port} is in use; try --port ${port + 1}\n`);
      return 2;
    }
    throw err;
  }

  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
  logger.info(`Serving ${distDir} on http://${displayHost}:${port} (bound to ${hostname})`);

  if (!watchMode) return 0;

  const watchPaths = gatherWatchPaths(cwd, config);
  const watchers: FSWatcher[] = [];
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let pending = false;
  const runRebuild = async (): Promise<void> => {
    building = true;
    try {
      const summary = await build({ cwd });
      logger.info(
        `Rebuilt ${summary.routeCount} routes (${summary.assetCount} assets); pushing reload to ${clients.size} client(s)`,
      );
      for (const ws of clients) {
        try {
          ws.send('reload');
        } catch {
          // client may have disconnected mid-broadcast; ignore
        }
      }
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
    }, REBUILD_DEBOUNCE_MS);
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

  await waitForShutdownSignal();

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
  return 0;
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

export function isIgnoredChange(filename: string): boolean {
  const norm = filename.replace(/\\/g, '/');
  if (norm.endsWith('.map')) return true;
  if (norm.includes('assets/built/')) return true;
  if (norm.includes('node_modules/')) return true;
  if (norm.includes('/.') || norm.startsWith('.')) return true;
  if (norm.endsWith('~') || norm.endsWith('.swp') || norm.endsWith('.tmp')) return true;
  return false;
}

export function injectLiveReloadScript(html: string): string {
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + CLIENT_SCRIPT;
  return html.slice(0, idx) + CLIENT_SCRIPT + html.slice(idx);
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise<void>((resolve) => {
    const handler = (): void => {
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      resolve();
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  });
}

function isAddrInUseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ('code' in err && (err as { code?: unknown }).code === 'EADDRINUSE') return true;
  return /EADDRINUSE|address already in use/i.test(err.message);
}
