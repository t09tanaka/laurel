import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import TOML from '@iarna/toml';
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
import { CliUsageError, type ParsedCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { isIgnoredChange } from './dev.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = 'localhost';
const REBUILD_DEBOUNCE_MS = 100;

export interface ThemeServeOptions {
  parsed: ParsedCommand;
  cwd: string;
  configPath?: string | undefined;
}

export interface ThemeServeFixture {
  workDir: string;
  configPath: string;
  distDir: string;
  themeRoot: string;
}

export async function runThemeServe({
  parsed,
  cwd,
  configPath,
}: ThemeServeOptions): Promise<number> {
  if (parsed.positionals.length > 1) {
    process.stderr.write('`theme serve` takes no further arguments.\n');
    return EXIT_CODES.usage;
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

  let fixture: ThemeServeFixture;
  try {
    fixture = await createThemeServeFixture({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }

  logger.info(`Running initial theme build using fixture content (${fixture.workDir}).`);
  try {
    const summary = await build({ cwd: fixture.workDir, configPath: fixture.configPath });
    logger.info(
      `Initial theme build complete: ${summary.routeCount} routes (${summary.assetCount} assets) -> ${summary.outputDir}`,
    );
  } catch (err) {
    await rm(fixture.workDir, { recursive: true, force: true });
    reportError(err, cwd);
    return exitCodeForError(err);
  }

  const clients = new Set<ServerWebSocket<unknown>>();
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
        const filePath = normalize(join(fixture.distDir, target));
        if (!filePath.startsWith(fixture.distDir)) {
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
        const fallback = Bun.file(join(fixture.distDir, '404.html'));
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
    await rm(fixture.workDir, { recursive: true, force: true });
    if (isAddrInUseError(err)) {
      process.stderr.write(`Port ${port} is in use; try --port ${port + 1}\n`);
      return EXIT_CODES.usage;
    }
    throw err;
  }

  const announcedPort = server.port;
  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
  logger.info(
    `Theme server listening on http://${displayHost}:${announcedPort}/ (bound to ${hostname})`,
  );

  const watchPaths = gatherThemeServeWatchPaths(fixture);
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
      const summary = await build({ cwd: fixture.workDir, configPath: fixture.configPath });
      const messageType = isCssOnly ? 'css' : 'reload';
      logger.info(
        `Rebuilt theme fixture ${summary.routeCount} routes (${summary.assetCount} assets); pushing ${messageType} to ${clients.size} client(s)`,
      );
      broadcast({ type: messageType });
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
        if (filename !== null && filename !== undefined) {
          if (!filename.endsWith('.css')) cssOnly = false;
        } else {
          cssOnly = false;
        }
        scheduleRebuild();
      });
      watchers.push(w);
    } catch (err) {
      logger.warn(`Failed to watch ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger.info(`Theme watch mode enabled: tracking ${watchers.length} path(s)`);

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
  await rm(fixture.workDir, { recursive: true, force: true });
  if (signal === 'SIGINT') {
    process.exit(130);
  }
  return EXIT_CODES.ok;
}

export async function createThemeServeFixture(opts: {
  cwd: string;
  configPath?: string | undefined;
}): Promise<ThemeServeFixture> {
  const sourceConfig = await loadConfig({ cwd: opts.cwd, configPath: opts.configPath });
  const themeRoot = resolveThemeRoot(opts.cwd, sourceConfig);
  if (!existsSync(themeRoot)) {
    throw new CliUsageError(`Theme directory not found: ${themeRoot}`);
  }

  const workDir = await mkdtemp(join(tmpdir(), 'nectar-theme-serve-'));
  await writeFixtureContent(workDir);
  const fixtureConfigPath = join(workDir, 'nectar.theme-serve.toml');
  await writeFile(fixtureConfigPath, renderFixtureConfig(sourceConfig, themeRoot), 'utf8');
  return {
    workDir,
    configPath: fixtureConfigPath,
    distDir: join(workDir, 'dist'),
    themeRoot,
  };
}

export function gatherThemeServeWatchPaths(fixture: ThemeServeFixture): string[] {
  return existsSync(fixture.themeRoot) ? [fixture.themeRoot] : [];
}

function resolveThemeRoot(cwd: string, config: NectarConfig): string {
  const dir = config.theme.dir;
  return isAbsolute(dir) ? join(dir, config.theme.name) : join(cwd, dir, config.theme.name);
}

async function writeFixtureContent(workDir: string): Promise<void> {
  await mkdir(join(workDir, 'content/posts'), { recursive: true });
  await mkdir(join(workDir, 'content/pages'), { recursive: true });
  await mkdir(join(workDir, 'content/authors'), { recursive: true });
  await mkdir(join(workDir, 'content/tags'), { recursive: true });
  await mkdir(join(workDir, 'content/images'), { recursive: true });
  await writeFile(
    join(workDir, 'content/authors/nectar-theme-author.md'),
    [
      '---',
      'name: Theme Author',
      'slug: nectar-theme-author',
      'bio: Minimal author used by `nectar theme serve`.',
      '---',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workDir, 'content/tags/general.md'),
    ['---', 'name: General', 'slug: general', 'description: Theme fixture tag.', '---', ''].join(
      '\n',
    ),
    'utf8',
  );
  await writeFile(
    join(workDir, 'content/posts/welcome.md'),
    [
      '---',
      'title: Theme Fixture Post',
      'slug: theme-fixture-post',
      'date: 2026-01-01T00:00:00Z',
      'author: nectar-theme-author',
      'tags: [general]',
      'feature_image: /content/images/cover.svg',
      'custom_excerpt: A compact post for fast theme iteration.',
      '---',
      '',
      'This compact post exercises the common post-card, post, author, tag, and image paths.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workDir, 'content/pages/about.md'),
    [
      '---',
      'title: About Theme Fixture',
      'slug: about',
      'date: 2026-01-02T00:00:00Z',
      '---',
      '',
      'A short page so page templates render during theme development.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workDir, 'content/images/cover.svg'),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">',
      '<rect width="1200" height="630" fill="#222"/>',
      '<circle cx="600" cy="315" r="160" fill="#f5c542"/>',
      '</svg>',
      '',
    ].join('\n'),
    'utf8',
  );
}

function renderFixtureConfig(sourceConfig: NectarConfig, themeRoot: string): string {
  const themeDir = dirname(themeRoot);
  const config = {
    site: {
      title: sourceConfig.site.title || 'Theme Fixture',
      description:
        sourceConfig.site.description || 'Small fixture site generated by nectar theme serve',
      url: 'http://localhost:4321',
      locale: sourceConfig.site.locale,
      timezone: sourceConfig.site.timezone,
      accent_color: sourceConfig.site.accent_color,
      logo: '/content/images/cover.svg',
      icon: '/content/images/cover.svg',
      members_enabled: sourceConfig.site.members_enabled,
      paid_members_enabled: sourceConfig.site.paid_members_enabled,
      members_invite_only: sourceConfig.site.members_invite_only,
    },
    theme: {
      name: sourceConfig.theme.name,
      dir: themeDir,
      custom: sourceConfig.theme.custom,
    },
    content: {
      posts_dir: 'content/posts',
      pages_dir: 'content/pages',
      authors_dir: 'content/authors',
      tags_dir: 'content/tags',
      assets_dir: 'content/images',
    },
    build: {
      output_dir: 'dist',
      base_path: '/',
      posts_per_page: 5,
      copy_content_assets: true,
      minify_html: false,
      precompress: false,
    },
    navigation: [
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about/' },
      { label: 'Tag', url: '/tag/general/' },
    ],
    components: {
      rss: { enabled: true },
      sitemap: { enabled: true },
      opengraph: { enabled: true, rasterize_svg: false },
      search: { enabled: false },
      content_api: { enabled: false },
    },
  };
  return TOML.stringify(stripUndefined(config) as Parameters<typeof TOML.stringify>[0]);
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child !== undefined) out[key] = stripUndefined(child);
    }
    return out;
  }
  return value;
}

function resolvePort(raw: unknown): number | CliUsageError {
  if (typeof raw !== 'string') return DEFAULT_PORT;
  const trimmed = raw.trim();
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
