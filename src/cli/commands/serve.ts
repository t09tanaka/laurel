import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { SERVE_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = 'localhost';
const REBUILD_DEBOUNCE_MS = 120;

export type ServeSimulationTarget = 'netlify' | 'cloudflare-pages' | 'vercel';

export interface ServeHeaderRule {
  pattern: string;
  headers: Array<{ key: string; value: string }>;
}

export interface ServeRedirectRule {
  source: string;
  destination: string;
  status: number;
}

export interface ServeSimulation {
  target: ServeSimulationTarget;
  headers: ServeHeaderRule[];
  redirects: ServeRedirectRule[];
}

export async function runServe(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(SERVE_SPEC, args, process.env);
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
    const raw = parsed.values.port.trim();
    // Insist on the `^\d+$` shape so typos like `--port 80.5` or `--port 80abc`
    // fail loudly instead of being silently coerced to 80 by `Number()`. The
    // 1..65535 bound matches POSIX port semantics (port 0 means "kernel picks
    // one" which we never want for a long-running dev server).
    const parsedPort = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isInteger(parsedPort) ||
      parsedPort < 1 ||
      parsedPort > 65535
    ) {
      process.stderr.write(
        `Invalid --port value: ${parsed.values.port} (expected an integer in 1..65535)\n`,
      );
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

  let simulateTarget: ServeSimulationTarget | undefined;
  if (typeof parsed.values.simulate === 'string') {
    simulateTarget = parseServeSimulationTarget(parsed.values.simulate);
    if (simulateTarget === undefined) {
      process.stderr.write(
        `Invalid --simulate value: ${parsed.values.simulate} (expected netlify, cloudflare-pages, or vercel)\n`,
      );
      return 2;
    }
  }

  const watchMode = parsed.values['no-watch'] !== true;
  const forceBuild = parsed.values.build === true;
  const cwd = process.cwd();
  const config = await loadConfig({ cwd });
  const distDir = join(cwd, config.build.output_dir);

  if (forceBuild) {
    logger.info(`--build requested; running a build before serving (${distDir}).`);
    try {
      const summary = await build({ cwd });
      logger.info(
        `Initial build complete: ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
      );
    } catch (err) {
      reportError(err, cwd);
      return 1;
    }
  } else if (!existsSync(distDir)) {
    logger.info(`No build output at ${distDir}; running an initial build before serving.`);
    try {
      const summary = await build({ cwd });
      logger.info(
        `Initial build complete: ${summary.routeCount} routes (${summary.assetCount} assets) → ${summary.outputDir}`,
      );
    } catch (err) {
      reportError(err, cwd);
      return 1;
    }
  }

  const simulation =
    simulateTarget !== undefined ? await loadServeSimulation(distDir, simulateTarget) : null;
  if (simulation !== null) {
    logger.info(
      `Simulating ${simulation.target} deploy artifacts: ${simulation.headers.length} header rule(s), ${simulation.redirects.length} redirect rule(s)`,
    );
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
        // External livereload script (mirrors `nectar dev`). Same client logic
        // works whether the inline tag is injected into the HTML or the script
        // is fetched separately; serving both shapes lets manually-injected
        // HTML or non-rebuilt fixtures still find a working client.
        if (watchMode && url.pathname === LIVERELOAD_SCRIPT_PATH) {
          return new Response(LIVERELOAD_CLIENT_JS, {
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });
        }
        const simulatedRedirect = findServeSimulationRedirect(simulation, url.pathname);
        if (simulatedRedirect !== undefined && simulatedRedirect.status >= 300) {
          return new Response(null, {
            status: simulatedRedirect.status,
            headers: { Location: simulatedRedirect.destination },
          });
        }
        const servedPath =
          simulatedRedirect !== undefined && simulatedRedirect.status === 200
            ? simulatedRedirect.destination
            : url.pathname;
        const simulatedHeaders = collectServeSimulationHeaders(simulation, url.pathname);
        const effectivePathname = servedPath === '/' ? '/index.html' : servedPath;
        const target = effectivePathname.endsWith('/')
          ? `${effectivePathname}index.html`
          : effectivePathname;
        const filePath = normalize(join(distDir, target));
        if (!filePath.startsWith(distDir)) {
          return new Response('Forbidden', { status: 403 });
        }
        const file = Bun.file(filePath);
        if (await file.exists()) {
          if (watchMode && filePath.endsWith('.html')) {
            const html = await file.text();
            return new Response(injectLiveReloadScript(html), {
              headers: mergeServeHeaders(simulatedHeaders, {
                'Content-Type': 'text/html; charset=utf-8',
              }),
            });
          }
          return new Response(file, { headers: simulatedHeaders });
        }
        const fallback = Bun.file(join(distDir, '404.html'));
        if (await fallback.exists()) {
          if (watchMode) {
            const html = await fallback.text();
            return new Response(injectLiveReloadScript(html), {
              status: 404,
              headers: mergeServeHeaders(simulatedHeaders, {
                'Content-Type': 'text/html; charset=utf-8',
              }),
            });
          }
          return new Response(fallback, { status: 404, headers: simulatedHeaders });
        }
        return new Response('Not Found', { status: 404, headers: simulatedHeaders });
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
  // Reflect `build.base_path` in the announced URL so deploys with a
  // subpath (e.g. `/blog/`) point operators at the actual landing page
  // instead of a 404 at the bare host:port root.
  const basePath = config.build.base_path || '/';
  logger.info(
    `Serving ${distDir} on http://${displayHost}:${port}${basePath} (bound to ${hostname})`,
  );

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
      // JSON wire format leaves room for non-reload signals (CSS hot-swap,
      // error overlays) without breaking the legacy `'reload'` string path:
      // the client falls back to `location.reload()` on any unknown payload.
      const payload = encodeReloadMessage({ type: 'reload' });
      for (const ws of clients) {
        try {
          ws.send(payload);
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

  const signal = await waitForShutdownSignal();

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
  // SIGINT (Ctrl-C) is a user-driven abort; POSIX convention is exit 128+SIGNUM
  // = 130. Surfacing it lets shell loops (`until nectar serve; do …; done`) and
  // CI runners distinguish "user cancelled" from a clean shutdown, and matches
  // the behaviour of common dev servers (vite, next dev, hugo server).
  if (signal === 'SIGINT') {
    process.exit(130);
  }
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

export function parseServeSimulationTarget(value: string): ServeSimulationTarget | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'cloudflare' || normalized === 'cloudflare-pages') return 'cloudflare-pages';
  if (normalized === 'netlify' || normalized === 'vercel') return normalized;
  return undefined;
}

export function parseServeHeadersArtifact(body: string): ServeHeaderRule[] {
  const rules: ServeHeaderRule[] = [];
  let current: ServeHeaderRule | undefined;
  for (const rawLine of body.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue;
    if (/^\s/.test(rawLine)) {
      if (current === undefined) continue;
      const idx = rawLine.indexOf(':');
      if (idx < 0) continue;
      const key = rawLine.slice(0, idx).trim();
      const value = rawLine.slice(idx + 1).trim();
      if (key.length > 0 && value.length > 0) current.headers.push({ key, value });
      continue;
    }
    current = { pattern: rawLine.trim(), headers: [] };
    rules.push(current);
  }
  return rules.filter((rule) => rule.headers.length > 0);
}

export function parseServeRedirectsArtifact(body: string): ServeRedirectRule[] {
  const rules: ServeRedirectRule[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [source, destination, rawStatus = '301'] = line.split(/\s+/);
    if (source === undefined || destination === undefined) continue;
    const status = Number.parseInt(rawStatus.replace(/!$/, ''), 10);
    if (!Number.isInteger(status)) continue;
    rules.push({ source, destination, status });
  }
  return rules;
}

export function collectServeSimulationHeaders(
  simulation: ServeSimulation | null,
  pathname: string,
): Headers {
  const headers = new Headers();
  if (simulation === null) return headers;
  for (const rule of simulation.headers) {
    if (!servePatternMatches(rule.pattern, pathname)) continue;
    for (const entry of rule.headers) {
      if (!headers.has(entry.key)) headers.set(entry.key, entry.value);
    }
  }
  return headers;
}

export function findServeSimulationRedirect(
  simulation: ServeSimulation | null,
  pathname: string,
): ServeRedirectRule | undefined {
  if (simulation === null) return undefined;
  return simulation.redirects.find((rule) => servePatternMatches(rule.source, pathname));
}

async function loadServeSimulation(
  distDir: string,
  target: ServeSimulationTarget,
): Promise<ServeSimulation> {
  if (target === 'vercel') {
    const path = join(distDir, 'vercel.json');
    if (!existsSync(path)) return { target, headers: [], redirects: [] };
    const body = JSON.parse(await readFile(path, 'utf8')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      redirects?: Array<{ source: string; destination: string; statusCode: number }>;
    };
    return {
      target,
      headers: (body.headers ?? []).map((rule) => ({
        pattern: rule.source,
        headers: rule.headers,
      })),
      redirects: (body.redirects ?? []).map((rule) => ({
        source: rule.source,
        destination: rule.destination,
        status: rule.statusCode,
      })),
    };
  }

  const headersPath = join(distDir, '_headers');
  const redirectsPath = join(distDir, '_redirects');
  const headers = existsSync(headersPath)
    ? parseServeHeadersArtifact(await readFile(headersPath, 'utf8'))
    : [];
  const redirects = existsSync(redirectsPath)
    ? parseServeRedirectsArtifact(await readFile(redirectsPath, 'utf8'))
    : [];
  return { target, headers, redirects };
}

function mergeServeHeaders(base: Headers, extra: Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return headers;
}

function servePatternMatches(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;
  if (pattern === '/*' || pattern === '/(.*)') return true;
  if (pattern.includes('(.*)')) {
    const prefix = pattern.slice(0, pattern.indexOf('(.*)'));
    return pathname.startsWith(prefix);
  }
  const starIndex = pattern.indexOf('*');
  if (starIndex >= 0) {
    const prefix = pattern.slice(0, starIndex);
    return pathname.startsWith(prefix);
  }
  return false;
}

// Re-export the shared injector under the legacy name so call sites and tests
// don't have to reach into ~/dev/livereload directly. The inline variant
// matches the historical behavior (one-shot script tag inlined into the body).
export function injectLiveReloadScript(html: string): string {
  return injectLiveReload(html, 'inline');
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
