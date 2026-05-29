import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
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
import { getLogLevel, logger } from '~/util/logger.ts';
import { t } from '../i18n/index.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { SERVE_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_PORT_SCAN_MAX = 4400;
const DEFAULT_HOST = '127.0.0.1';
const REBUILD_DEBOUNCE_MS = 120;
const DEV_CACHE_CONTROL = 'no-store';
const DEFAULT_MAX_SERVE_RESPONSE_BYTES = 128 * 1024 * 1024;

const SERVE_CONTENT_TYPES_BY_FILENAME = new Map<string, string>([
  ['rss.xml', 'application/rss+xml'],
  ['sitemap.xml', 'application/xml'],
  ['robots.txt', 'text/plain; charset=utf-8'],
]);

const SERVE_CONTENT_TYPES_BY_EXTENSION = new Map<string, string>([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml'],
]);

export type ServeSimulationTarget = 'netlify' | 'cloudflare-pages' | 'vercel';
type ServeCompressionMode = 'auto' | 'gzip' | 'br' | 'none';
type BrowserOpener = (command: string[]) => void;
interface ServeTlsOptions {
  cert: string;
  key: string;
}

interface ServeRunOptions {
  openBrowser?: BrowserOpener;
}

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

export async function runServe(args: string[], options: ServeRunOptions = {}): Promise<number> {
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

  const cwd = process.cwd();
  let port = DEFAULT_PORT;
  const explicitPort = typeof parsed.values.port === 'string';
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
      process.stderr.write(`${t('serve.invalidPort', { value: parsed.values.port })}\n`);
      return 2;
    }
    port = parsedPort;
  }

  let hostname = DEFAULT_HOST;
  if (typeof parsed.values.host === 'string') {
    const trimmed = parsed.values.host.trim();
    if (trimmed.length === 0) {
      process.stderr.write(`${t('serve.invalidHost')}\n`);
      return 2;
    }
    hostname = trimmed;
  }

  let simulateTarget: ServeSimulationTarget | undefined;
  if (typeof parsed.values.simulate === 'string') {
    simulateTarget = parseServeSimulationTarget(parsed.values.simulate);
    if (simulateTarget === undefined) {
      process.stderr.write(`${t('serve.invalidSimulate', { value: parsed.values.simulate })}\n`);
      return 2;
    }
  }

  let compression: ServeCompressionMode = 'none';
  if (typeof parsed.values.compression === 'string') {
    const parsedCompression = parseServeCompressionMode(parsed.values.compression);
    if (parsedCompression === undefined) {
      process.stderr.write(
        `${t('serve.invalidCompression', { value: parsed.values.compression })}\n`,
      );
      return 2;
    }
    compression = parsedCompression;
  }

  let proxyBase: URL | undefined;
  if (typeof parsed.values.proxy === 'string') {
    try {
      proxyBase = new URL(parsed.values.proxy);
    } catch {
      process.stderr.write(`${t('serve.invalidProxy', { value: parsed.values.proxy })}\n`);
      return 2;
    }
    if (proxyBase.protocol !== 'http:' && proxyBase.protocol !== 'https:') {
      process.stderr.write(`${t('serve.invalidProxy', { value: parsed.values.proxy })}\n`);
      return 2;
    }
  }

  const rawTlsCert = typeof parsed.values['tls-cert'] === 'string' ? parsed.values['tls-cert'] : '';
  const rawTlsKey = typeof parsed.values['tls-key'] === 'string' ? parsed.values['tls-key'] : '';
  let tls: ServeTlsOptions | undefined;
  if (rawTlsCert || rawTlsKey) {
    if (!rawTlsCert || !rawTlsKey) {
      process.stderr.write(`${t('serve.tlsPairRequired')}\n`);
      return 2;
    }
    try {
      tls = {
        cert: await readFile(resolve(cwd, rawTlsCert), 'utf8'),
        key: await readFile(resolve(cwd, rawTlsKey), 'utf8'),
      };
    } catch (err) {
      process.stderr.write(
        `${t('serve.tlsReadFailed', { message: err instanceof Error ? err.message : String(err) })}\n`,
      );
      return 2;
    }
  }

  const watchMode = parsed.values.watch !== false;
  const forceBuild = parsed.values.build === true;
  const openOnStart = parsed.values.open === true;
  const config = await loadConfig({ cwd });
  const distDir = join(cwd, config.build.output_dir);

  if (forceBuild) {
    logger.info(t('serve.buildRequested', { distDir }));
    try {
      const summary = await build({ cwd });
      logger.info(
        t('serve.initialBuildComplete', {
          routeCount: summary.routeCount,
          assetCount: summary.assetCount,
          outputDir: summary.outputDir,
        }),
      );
    } catch (err) {
      reportError(err, cwd);
      return 1;
    }
  } else if (!existsSync(distDir)) {
    logger.info(t('serve.noBuildOutput', { distDir }));
    try {
      const summary = await build({ cwd });
      logger.info(
        t('serve.initialBuildComplete', {
          routeCount: summary.routeCount,
          assetCount: summary.assetCount,
          outputDir: summary.outputDir,
        }),
      );
    } catch (err) {
      reportError(err, cwd);
      return 1;
    }
  }

  const simulation =
    simulateTarget !== undefined ? await loadServeSimulation(distDir, simulateTarget) : null;
  const serveRoot = await realpath(distDir);
  if (simulation !== null) {
    logger.info(
      t('serve.simulating', {
        target: simulation.target,
        headers: simulation.headers.length,
        redirects: simulation.redirects.length,
      }),
    );
  }

  const clients = new Set<ServerWebSocket<unknown>>();
  const fileLookupCache = createServeFileLookupCache(serveRoot);
  let server: Server<unknown>;
  try {
    server = startServeServer({
      initialPort: port,
      maxPort: explicitPort ? port : DEFAULT_PORT_SCAN_MAX,
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
      tls,
      fetch: async (request, srv) => {
        const startedAt = performance.now();
        let status = 500;
        const finish = (response: Response | undefined): Response | undefined => {
          status = response?.status ?? 101;
          return response;
        };
        try {
          const url = new URL(request.url);
          if (watchMode && url.pathname === LIVERELOAD_PATH) {
            if (srv.upgrade(request, { data: undefined })) return finish(undefined);
            return finish(new Response('upgrade failed', { status: 426 }));
          }
          // External livereload script (mirrors `nectar dev`). Same client logic
          // works whether the inline tag is injected into the HTML or the script
          // is fetched separately; serving both shapes lets manually-injected
          // HTML or non-rebuilt fixtures still find a working client.
          if (watchMode && url.pathname === LIVERELOAD_SCRIPT_PATH) {
            return finish(
              await serveResponse(
                request,
                LIVERELOAD_CLIENT_JS,
                {
                  headers: {
                    'Content-Type': 'application/javascript; charset=utf-8',
                    'Cache-Control': DEV_CACHE_CONTROL,
                  },
                },
                compression,
              ),
            );
          }
          const simulatedRedirect = findServeSimulationRedirect(simulation, url.pathname);
          if (simulatedRedirect !== undefined && simulatedRedirect.status >= 300) {
            return finish(
              new Response(null, {
                status: simulatedRedirect.status,
                headers: { Location: simulatedRedirect.destination },
              }),
            );
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
          const filePath = decodeServeRequestPath(serveRoot, target);
          if (filePath === 'bad-request') {
            return finish(new Response('Bad Request', { status: 400 }));
          }
          if (filePath === null) {
            return finish(new Response('Forbidden', { status: 403 }));
          }
          const fileLookup = await fileLookupCache.lookup(filePath);
          if (fileLookup.kind === 'forbidden') {
            return finish(new Response('Forbidden', { status: 403 }));
          }
          if (fileLookup.kind === 'file') {
            if (isServeFileOverResponseLimit(fileLookup.size)) {
              return finish(new Response('Payload Too Large', { status: 413 }));
            }
            if (watchMode && filePath.endsWith('.html')) {
              const html = await fileLookup.file.text();
              return finish(
                await serveResponse(
                  request,
                  injectLiveReloadScript(html),
                  {
                    headers: serveHeaders(simulatedHeaders, {
                      'Content-Type': 'text/html; charset=utf-8',
                    }),
                  },
                  compression,
                ),
              );
            }
            return finish(
              await serveResponse(
                request,
                fileLookup.file,
                { headers: serveFileHeaders(simulatedHeaders, filePath) },
                compression,
              ),
            );
          }
          if (proxyBase !== undefined && isProxyableServePath(url.pathname)) {
            return finish(await proxyServeRequest(request, proxyBase));
          }
          const fallbackPath = resolve(serveRoot, '404.html');
          const fallbackLookup = await fileLookupCache.lookup(fallbackPath);
          if (fallbackLookup.kind === 'forbidden') {
            return finish(new Response('Forbidden', { status: 403 }));
          }
          if (fallbackLookup.kind === 'file') {
            if (isServeFileOverResponseLimit(fallbackLookup.size)) {
              return finish(new Response('Payload Too Large', { status: 413 }));
            }
            if (watchMode) {
              const html = await fallbackLookup.file.text();
              return finish(
                await serveResponse(
                  request,
                  injectLiveReloadScript(html),
                  {
                    status: 404,
                    headers: serveHeaders(simulatedHeaders, {
                      'Content-Type': 'text/html; charset=utf-8',
                    }),
                  },
                  compression,
                ),
              );
            }
            return finish(
              await serveResponse(
                request,
                fallbackLookup.file,
                {
                  status: 404,
                  headers: serveFileHeaders(simulatedHeaders, fallbackPath),
                },
                compression,
              ),
            );
          }
          return finish(
            await serveResponse(
              request,
              'Not Found',
              { status: 404, headers: serveHeaders(simulatedHeaders) },
              compression,
            ),
          );
        } finally {
          writeServeAccessLog(request, status, performance.now() - startedAt);
        }
      },
    });
  } catch (err) {
    if (isAddrInUseError(err)) {
      process.stderr.write(`${t('serve.portInUse', { port, nextPort: port + 1 })}\n`);
      return 2;
    }
    throw err;
  }

  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
  // Reflect `build.base_path` in the announced URL so deploys with a
  // subpath (e.g. `/blog/`) point operators at the actual landing page
  // instead of a 404 at the bare host:port root.
  const basePath = config.build.base_path || '/';
  const announcedPort = server.port ?? port;
  const servedUrl = formatServeUrl(displayHost, announcedPort, basePath, tls ? 'https' : 'http');
  logger.info(
    t('serve.serving', {
      distDir,
      scheme: tls ? 'https' : 'http',
      host: displayHost,
      port: announcedPort,
      basePath,
      hostname,
    }),
  );
  writeVerboseServeExamples(servedUrl);

  if (openOnStart) {
    openBrowserUrl(servedUrl, options.openBrowser);
  }

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
      fileLookupCache.invalidate();
      logger.info(
        t('serve.rebuilt', {
          routeCount: summary.routeCount,
          assetCount: summary.assetCount,
          clientCount: clients.size,
        }),
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
      logger.warn(
        t('watch.failed', { path: p, message: err instanceof Error ? err.message : String(err) }),
      );
    }
  }
  logger.info(t('watch.enabled', { count: watchers.length }));

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

function startServeServer(opts: {
  initialPort: number;
  maxPort: number;
  hostname: string;
  websocket: NonNullable<Parameters<typeof Bun.serve>[0]['websocket']>;
  tls?: ServeTlsOptions;
  fetch(
    this: Server<unknown>,
    request: Request,
    server: Server<unknown>,
  ): Response | undefined | Promise<Response | undefined>;
}): Server<unknown> {
  let candidate = opts.initialPort;
  while (candidate <= opts.maxPort) {
    try {
      return Bun.serve({
        port: candidate,
        hostname: opts.hostname,
        tls: opts.tls,
        websocket: opts.websocket,
        fetch: opts.fetch,
      });
    } catch (err) {
      if (!isAddrInUseError(err) || candidate >= opts.maxPort) throw err;
      candidate += 1;
    }
  }
  throw new Error(`No open port found in ${opts.initialPort}..${opts.maxPort}`);
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

export function inferServeContentType(filePath: string): string | undefined {
  const filename = basename(filePath).toLowerCase();
  return (
    SERVE_CONTENT_TYPES_BY_FILENAME.get(filename) ??
    SERVE_CONTENT_TYPES_BY_EXTENSION.get(extname(filename))
  );
}

export function isInsideServeRoot(rootDir: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootDir), resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function decodeServeRequestPath(
  rootDir: string,
  requestPathname: string,
): string | 'bad-request' | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(requestPathname);
  } catch {
    return 'bad-request';
  }
  if (decodedPathname.includes('\\')) return null;
  const rootRelativePath = decodedPathname.startsWith('/')
    ? `.${decodedPathname}`
    : decodedPathname;
  const candidatePath = resolve(rootDir, rootRelativePath);
  if (!isInsideServeRoot(rootDir, candidatePath)) return null;
  return candidatePath;
}

async function isResolvedFileInsideServeRoot(rootDir: string, filePath: string): Promise<boolean> {
  try {
    return isInsideServeRoot(rootDir, await realpath(filePath));
  } catch {
    return false;
  }
}

type ServeFileLookupResult =
  | { kind: 'file'; filePath: string; file: Blob; size: number }
  | { kind: 'missing' }
  | { kind: 'forbidden' };

interface ServeFileLookupCache {
  lookup(filePath: string): Promise<ServeFileLookupResult>;
  invalidate(): void;
}

export function createServeFileLookupCache(serveRoot: string): ServeFileLookupCache {
  const cache = new Map<string, Promise<ServeFileLookupResult>>();
  return {
    lookup(filePath: string): Promise<ServeFileLookupResult> {
      const key = resolve(filePath);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const lookup = resolveServeFileLookup(serveRoot, key);
      cache.set(key, lookup);
      return lookup;
    },
    invalidate(): void {
      cache.clear();
    },
  };
}

async function resolveServeFileLookup(
  serveRoot: string,
  filePath: string,
): Promise<ServeFileLookupResult> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    if (isMissingFileError(err)) return { kind: 'missing' };
    throw err;
  }
  if (!fileStat.isFile()) return { kind: 'missing' };
  if (!(await isResolvedFileInsideServeRoot(serveRoot, filePath))) return { kind: 'forbidden' };
  return { kind: 'file', filePath, file: Bun.file(filePath), size: fileStat.size };
}

function isMissingFileError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    ((err as { code?: unknown }).code === 'ENOENT' ||
      (err as { code?: unknown }).code === 'ENOTDIR')
  );
}

export function parseServeSimulationTarget(value: string): ServeSimulationTarget | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'cloudflare' || normalized === 'cloudflare-pages') return 'cloudflare-pages';
  if (normalized === 'netlify' || normalized === 'vercel') return normalized;
  return undefined;
}

export function parseServeCompressionMode(value: string): ServeCompressionMode | undefined {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'auto' ||
    normalized === 'gzip' ||
    normalized === 'br' ||
    normalized === 'none'
  ) {
    return normalized;
  }
  return undefined;
}

export function formatServeUrl(
  host: string,
  port: number,
  basePath: string,
  scheme: 'http' | 'https' = 'http',
): string {
  return `${scheme}://${host}:${port}${basePath}`;
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): string[] | null {
  if (platform === 'darwin') return ['open', url];
  if (platform === 'linux') return ['xdg-open', url];
  if (platform === 'win32') return ['cmd', '/c', 'start', '', url];
  return null;
}

export function openBrowserUrl(url: string, opener: BrowserOpener = spawnBrowserOpener): boolean {
  const command = browserOpenCommand(url);
  if (command === null) return false;
  opener(command);
  return true;
}

function spawnBrowserOpener(command: string[]): void {
  Bun.spawn(command, {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
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

function serveHeaders(base: Headers, extra: Record<string, string> = {}): Headers {
  const headers = mergeServeHeaders(base, extra);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', DEV_CACHE_CONTROL);
  return headers;
}

function serveFileHeaders(base: Headers, filePath: string): Headers {
  const contentType = inferServeContentType(filePath);
  if (contentType === undefined) return serveHeaders(base);
  return serveHeaders(base, { 'Content-Type': contentType });
}

function isServeFileOverResponseLimit(size: number): boolean {
  const maxBytes = serveMaxResponseBytes();
  return maxBytes > 0 && size > maxBytes;
}

function serveMaxResponseBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.NECTAR_SERVE_MAX_RESPONSE_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_SERVE_RESPONSE_BYTES;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) return DEFAULT_MAX_SERVE_RESPONSE_BYTES;
  return value;
}

function isProxyableServePath(pathname: string): boolean {
  return pathname.startsWith('/ghost/api/') || pathname.startsWith('/content/');
}

async function proxyServeRequest(request: Request, proxyBase: URL): Promise<Response> {
  const incoming = new URL(request.url);
  const upstream = new URL(incoming.pathname.replace(/^\/+/, ''), ensureTrailingSlash(proxyBase));
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.set('Host', upstream.host);
  return fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

function ensureTrailingSlash(url: URL): URL {
  const out = new URL(url);
  if (!out.pathname.endsWith('/')) out.pathname = `${out.pathname}/`;
  return out;
}

interface ServeResponseInit {
  status?: number;
  headers?: Headers | Record<string, string>;
}

async function serveResponse(
  request: Request,
  body: string | Blob,
  init: ServeResponseInit,
  compression: ServeCompressionMode,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const encoding = selectServeCompressionEncoding(request, headers, compression);
  if (encoding === undefined)
    return new Response(body, { status: init.status, headers: headersToRecord(headers) });

  const raw =
    typeof body === 'string'
      ? new TextEncoder().encode(body)
      : new Uint8Array(await body.arrayBuffer());
  const compressed = encoding === 'br' ? brotliCompressSync(raw) : gzipSync(raw);
  headers.set('Content-Encoding', encoding);
  headers.set('Vary', appendVary(headers.get('Vary'), 'Accept-Encoding'));
  headers.delete('Content-Length');
  return new Response(compressed, { status: init.status, headers: headersToRecord(headers) });
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function selectServeCompressionEncoding(
  request: Request,
  headers: Headers,
  compression: ServeCompressionMode,
): 'br' | 'gzip' | undefined {
  if (compression === 'none') return undefined;
  if (!isCompressibleServeResponse(headers)) return undefined;
  const accepted = request.headers.get('Accept-Encoding') ?? '';
  if (compression === 'br') return acceptsEncoding(accepted, 'br') ? 'br' : undefined;
  if (compression === 'gzip') return acceptsEncoding(accepted, 'gzip') ? 'gzip' : undefined;
  if (acceptsEncoding(accepted, 'br')) return 'br';
  if (acceptsEncoding(accepted, 'gzip')) return 'gzip';
  return undefined;
}

function isCompressibleServeResponse(headers: Headers): boolean {
  const contentType = headers.get('Content-Type')?.toLowerCase() ?? '';
  return (
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('manifest')
  );
}

function acceptsEncoding(header: string, encoding: 'br' | 'gzip'): boolean {
  return header
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === encoding || part.startsWith(`${encoding};`));
}

function appendVary(current: string | null, value: string): string {
  if (current === null || current.trim() === '') return value;
  const entries = current.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry.toLowerCase() === value.toLowerCase())) return current;
  return `${current}, ${value}`;
}

function writeVerboseServeExamples(servedUrl: string): void {
  if (!isServeAccessLogEnabled()) return;
  const base = servedUrl.endsWith('/') ? servedUrl : `${servedUrl}/`;
  logger.debug(`curl -I ${base}`);
  logger.debug(`curl -I ${new URL('sitemap.xml', base).toString()}`);
  logger.debug(`curl -I ${new URL('rss.xml', base).toString()}`);
}

function writeServeAccessLog(request: Request, status: number, elapsedMs: number): void {
  if (!isServeAccessLogEnabled()) return;
  const url = new URL(request.url);
  process.stderr.write(`${request.method} ${url.pathname} ${status} ${Math.round(elapsedMs)}ms\n`);
}

function isServeAccessLogEnabled(): boolean {
  const level = getLogLevel();
  return level === 'debug' || level === 'trace';
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
