import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import slugify from 'slugify';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { loadContent } from '~/content/loader.ts';
import type {
  Author,
  ContentGraph,
  ContentSourceFingerprint,
  Page,
  Post,
  Tag,
} from '~/content/model.ts';
import { logger } from '~/util/logger.ts';
import { absolutise, resolveContentSlugPath } from '../content-paths.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DASHBOARD_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4322;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 100;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type EditableKind = 'posts' | 'pages' | 'authors' | 'tags';

export interface DashboardStateOptions {
  cwd: string;
  configPath?: string;
  page?: number;
  postsPage?: number;
  pagesPage?: number;
  perPage?: number;
}

interface DashboardList<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

interface DashboardContentSummary {
  slug: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  path: string;
  url: string;
  authors: string[];
  tags: string[];
  words: number;
}

interface DashboardTaxonomySummary {
  slug: string;
  name: string;
  count: number;
  path: string;
  url: string;
  editable: boolean;
}

interface DashboardState {
  site: {
    title: string;
    description: string;
    url: string;
    accentColor: string;
  };
  posts: DashboardList<DashboardContentSummary>;
  pages: DashboardList<DashboardContentSummary>;
  authors: DashboardList<DashboardTaxonomySummary>;
  tags: DashboardList<DashboardTaxonomySummary>;
  settings: {
    configPath: string;
    fingerprint: ContentSourceFingerprint;
    contentDirs: {
      posts: string;
      pages: string;
      authors: string;
      tags: string;
    };
    outputDir: string;
    theme: string;
  };
  generatedAt: string;
}

export interface DashboardContentItem {
  kind: EditableKind;
  slug: string;
  path: string;
  fingerprint: ContentSourceFingerprint;
  frontmatter: Record<string, unknown>;
  body: string;
}

export type DashboardWriteResult =
  | { ok: true; fingerprint: ContentSourceFingerprint }
  | { ok: false; reason: 'conflict'; current: DashboardContentItem }
  | { ok: false; reason: 'not-found' | 'invalid-kind' };

export interface DashboardSettings {
  configPath: string;
  fingerprint: ContentSourceFingerprint;
  site: {
    title: string;
    description: string;
    url: string;
    locale: string;
    timezone: string;
    accentColor: string;
  };
}

export type DashboardSettingsWriteResult =
  | { ok: true; fingerprint: ContentSourceFingerprint }
  | { ok: false; reason: 'conflict'; current: DashboardSettings };

export async function runDashboard(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(DASHBOARD_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(DASHBOARD_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(DASHBOARD_SPEC));
    return 0;
  }

  const port = parsePort(parsed.values.port);
  if (port instanceof CliUsageError) {
    process.stderr.write(`${port.message}\n`);
    return 2;
  }
  const host = parseHost(parsed.values.host);
  if (host instanceof CliUsageError) {
    process.stderr.write(`${host.message}\n`);
    return 2;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  try {
    await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  const changeBus = createChangeBus();
  const watchers = await watchDashboardFiles({ cwd, configPath, changeBus });
  const server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 255,
    async fetch(request) {
      return handleDashboardRequest(request, { cwd, configPath, changeBus });
    },
  });

  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${displayHost}:${server.port}/`;
  logger.info(`Dashboard listening on ${url}`);
  if (parsed.values.open === true) {
    openBrowser(url);
  }

  await waitForShutdownSignal();
  for (const watcher of watchers) watcher.close();
  server.stop(true);
  return 0;
}

export async function loadDashboardState({
  cwd,
  configPath,
  page,
  postsPage,
  pagesPage,
  perPage,
}: DashboardStateOptions): Promise<DashboardState> {
  const config = await loadConfig({ cwd, configPath });
  const graph = await loadContent({
    cwd,
    config,
    includeDrafts: true,
    includeFuturePosts: true,
  });
  const safePerPage = clampPositiveInt(perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE);
  const postPage = clampPositiveInt(postsPage ?? page, 1, Number.MAX_SAFE_INTEGER);
  const pagePage = clampPositiveInt(pagesPage ?? page, 1, Number.MAX_SAFE_INTEGER);

  const posts = sortByCreatedAt(graph.posts).map((post) => postSummary(post, graph, config));
  const pages = sortByCreatedAt(graph.pages).map((item) => pageSummary(item, graph, config));

  return {
    site: {
      title: graph.site.title,
      description: graph.site.description,
      url: graph.site.url,
      accentColor: graph.site.accent_color,
    },
    posts: paginate(posts, postPage, safePerPage),
    pages: paginate(pages, pagePage, safePerPage),
    authors: paginate(
      graph.authors
        .map((author) => taxonomySummary(author, graph, config, 'authors'))
        .sort((a, b) => a.name.localeCompare(b.name)),
      1,
      MAX_PER_PAGE,
    ),
    tags: paginate(
      graph.tags
        .map((tag) => taxonomySummary(tag, graph, config, 'tags'))
        .sort((a, b) => a.name.localeCompare(b.name)),
      1,
      MAX_PER_PAGE,
    ),
    settings: {
      configPath: relativePath(cwd, resolveConfigPath(cwd, configPath)),
      fingerprint: await optionalFingerprintFor(cwd, resolveConfigPath(cwd, configPath)),
      contentDirs: {
        posts: config.content.posts_dir,
        pages: config.content.pages_dir,
        authors: config.content.authors_dir,
        tags: config.content.tags_dir,
      },
      outputDir: config.build.output_dir,
      theme: config.theme.name,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function readDashboardContentItem({
  cwd,
  config,
  kind,
  slug,
}: {
  cwd: string;
  config: NectarConfig;
  kind: EditableKind;
  slug: string;
}): Promise<DashboardContentItem> {
  const filePath = await resolveEditablePath(cwd, config, kind, slug);
  if (filePath === undefined) throw new Response('Not Found', { status: 404 });
  const raw = await readFile(filePath, 'utf8');
  const parsed = parseFrontmatter(raw, { filePath });
  return {
    kind,
    slug,
    path: relativePath(cwd, filePath),
    fingerprint: await fingerprintFor(cwd, filePath),
    frontmatter: parsed.data,
    body: parsed.body,
  };
}

export async function writeDashboardContentItem({
  cwd,
  config,
  kind,
  slug,
  expectedFingerprint,
  frontmatter,
  body,
}: {
  cwd: string;
  config: NectarConfig;
  kind: EditableKind;
  slug: string;
  expectedFingerprint: ContentSourceFingerprint;
  frontmatter: Record<string, unknown>;
  body: string;
}): Promise<DashboardWriteResult> {
  const filePath = await resolveEditablePath(cwd, config, kind, slug);
  if (filePath === undefined) return { ok: false, reason: 'not-found' };
  const current = await readDashboardContentItem({ cwd, config, kind, slug });
  if (!sameFingerprint(current.fingerprint, expectedFingerprint)) {
    return { ok: false, reason: 'conflict', current };
  }
  const yamlText = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd();
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  await writeFile(filePath, `---\n${yamlText}\n---\n\n${normalizedBody}`, 'utf8');
  return { ok: true, fingerprint: await fingerprintFor(cwd, filePath) };
}

export async function readDashboardSettings({
  cwd,
  configPath,
}: {
  cwd: string;
  configPath?: string;
}): Promise<DashboardSettings> {
  const config = await loadConfig({ cwd, configPath });
  const filePath = resolveConfigPath(cwd, configPath);
  return {
    configPath: relativePath(cwd, filePath),
    fingerprint: await optionalFingerprintFor(cwd, filePath),
    site: {
      title: config.site.title,
      description: config.site.description,
      url: config.site.url,
      locale: config.site.locale,
      timezone: config.site.timezone,
      accentColor: config.site.accent_color,
    },
  };
}

export async function writeDashboardSiteSettings({
  cwd,
  configPath,
  expectedFingerprint,
  updates,
}: {
  cwd: string;
  configPath?: string;
  expectedFingerprint: ContentSourceFingerprint;
  updates: Record<string, unknown>;
}): Promise<DashboardSettingsWriteResult> {
  const filePath = resolveConfigPath(cwd, configPath);
  const current = await readDashboardSettings({ cwd, configPath });
  if (!sameFingerprint(current.fingerprint, expectedFingerprint)) {
    return { ok: false, reason: 'conflict', current };
  }
  await writeSiteSettingsFile(filePath, updates);
  return { ok: true, fingerprint: await optionalFingerprintFor(cwd, filePath) };
}

async function handleDashboardRequest(
  request: Request,
  ctx: { cwd: string; configPath?: string; changeBus: ChangeBus },
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/') {
      return htmlResponse(renderDashboardHtml());
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return jsonResponse(
        await loadDashboardState({
          cwd: ctx.cwd,
          configPath: ctx.configPath,
          postsPage: numberParam(url, 'posts_page'),
          pagesPage: numberParam(url, 'pages_page'),
          perPage: numberParam(url, 'per_page'),
        }),
      );
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      return ctx.changeBus.stream();
    }
    const contentMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/([^/]+)$/);
    if (contentMatch) {
      const kind = parseEditableKind(contentMatch[1] ?? '');
      const slug = decodeURIComponent(contentMatch[2] ?? '');
      if (kind === undefined || !SLUG_RE.test(slug))
        return jsonResponse({ error: 'invalid content path' }, 400);
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      if (request.method === 'GET') {
        return jsonResponse(await readDashboardContentItem({ cwd: ctx.cwd, config, kind, slug }));
      }
      if (request.method === 'PUT') {
        const payload = (await request.json()) as {
          fingerprint?: ContentSourceFingerprint;
          frontmatter?: Record<string, unknown>;
          body?: string;
        };
        if (!payload.fingerprint || !payload.frontmatter || typeof payload.body !== 'string') {
          return jsonResponse({ error: 'fingerprint, frontmatter, and body are required' }, 400);
        }
        const result = await writeDashboardContentItem({
          cwd: ctx.cwd,
          config,
          kind,
          slug,
          expectedFingerprint: payload.fingerprint,
          frontmatter: payload.frontmatter,
          body: payload.body,
        });
        if (!result.ok && result.reason === 'conflict') return jsonResponse(result, 409);
        if (!result.ok) return jsonResponse(result, 404);
        ctx.changeBus.broadcast('dashboard-write');
        return jsonResponse(result);
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/settings/site') {
      return jsonResponse(
        await readDashboardSettings({ cwd: ctx.cwd, configPath: ctx.configPath }),
      );
    }
    if (request.method === 'POST' && url.pathname === '/api/content') {
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const payload = (await request.json()) as {
        kind?: EditableKind;
        title?: string;
        slug?: string;
      };
      const result = await createDashboardContentItem({ cwd: ctx.cwd, config, payload });
      ctx.changeBus.broadcast('dashboard-create');
      return jsonResponse(result, 201);
    }
    if (request.method === 'PATCH' && url.pathname === '/api/settings/site') {
      const payload = (await request.json()) as {
        fingerprint?: ContentSourceFingerprint;
        updates?: Record<string, unknown>;
      };
      if (!payload.fingerprint || !payload.updates) {
        return jsonResponse({ error: 'fingerprint and updates are required' }, 400);
      }
      const result = await writeDashboardSiteSettings({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        expectedFingerprint: payload.fingerprint,
        updates: payload.updates,
      });
      if (!result.ok) return jsonResponse(result, 409);
      ctx.changeBus.broadcast('settings-write');
      return jsonResponse(result);
    }
    return new Response('Not Found', { status: 404 });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function createDashboardContentItem({
  cwd,
  config,
  payload,
}: {
  cwd: string;
  config: NectarConfig;
  payload: { kind?: EditableKind; title?: string; slug?: string };
}): Promise<{ ok: true; kind: EditableKind; slug: string; path: string }> {
  const kind = parseEditableKind(payload.kind ?? '');
  if (kind === undefined) throw new Error('invalid kind');
  const title = (payload.title ?? '').trim();
  if (!title) throw new Error('title is required');
  const slug = (payload.slug?.trim() || slugify(title, { lower: true, strict: true })).trim();
  if (!SLUG_RE.test(slug)) throw new Error('invalid slug');
  const dir = editableDir(cwd, config, kind);
  const filePath = join(dir, `${slug}.md`);
  if (existsSync(filePath)) throw new Error(`content already exists: ${slug}`);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const frontmatter =
    kind === 'authors'
      ? { slug, name: title }
      : kind === 'tags'
        ? { slug, name: title }
        : { title, slug, date: now, created_at: now, updated_at: now, status: 'draft' };
  const yamlText = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd();
  await writeFile(filePath, `---\n${yamlText}\n---\n\n`, 'utf8');
  return { ok: true, kind, slug, path: relativePath(cwd, filePath) };
}

function postSummary(
  post: Post,
  graph: ContentGraph,
  config: NectarConfig,
): DashboardContentSummary {
  return {
    slug: post.slug,
    title: post.title,
    status: post.status,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    publishedAt: post.published_at,
    path: contentPath(config.content.posts_dir, graph.sources?.posts.get(post.id)),
    url: post.url,
    authors: post.authors.map((author) => author.name),
    tags: post.tags.map((tag) => tag.name),
    words: post.word_count,
  };
}

function pageSummary(
  page: Page,
  graph: ContentGraph,
  config: NectarConfig,
): DashboardContentSummary {
  return {
    slug: page.slug,
    title: page.title,
    status: page.status,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
    publishedAt: page.published_at,
    path: contentPath(config.content.pages_dir, graph.sources?.pages.get(page.id)),
    url: page.url,
    authors: page.authors.map((author) => author.name),
    tags: page.tags.map((tag) => tag.name),
    words: page.word_count,
  };
}

function taxonomySummary(
  item: Author | Tag,
  graph: ContentGraph,
  config: NectarConfig,
  kind: 'authors' | 'tags',
): DashboardTaxonomySummary {
  const source =
    kind === 'authors' ? graph.sources?.authors.get(item.id) : graph.sources?.tags.get(item.id);
  return {
    slug: item.slug,
    name: item.name,
    count: item.count.posts,
    path: contentPath(
      kind === 'authors' ? config.content.authors_dir : config.content.tags_dir,
      source,
    ),
    url: item.url,
    editable: source !== undefined,
  };
}

function sortByCreatedAt<T extends { created_at: string; published_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const created = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (created !== 0) return created;
    return Date.parse(b.published_at) - Date.parse(a.published_at);
  });
}

function paginate<T>(items: T[], page: number, perPage: number): DashboardList<T> {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(page, 1), pages);
  const start = (safePage - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    total: items.length,
    page: safePage,
    perPage,
    pages,
  };
}

function contentPath(dir: string, source: ContentSourceFingerprint | undefined): string {
  return source ? `${dir.replace(/\/$/, '')}/${source.path}` : '';
}

function editableDir(cwd: string, config: NectarConfig, kind: EditableKind): string {
  const dir =
    kind === 'posts'
      ? config.content.posts_dir
      : kind === 'pages'
        ? config.content.pages_dir
        : kind === 'authors'
          ? config.content.authors_dir
          : config.content.tags_dir;
  return absolutise(cwd, dir);
}

async function resolveEditablePath(
  cwd: string,
  config: NectarConfig,
  kind: EditableKind,
  slug: string,
): Promise<string | undefined> {
  if (kind === 'posts' || kind === 'pages') {
    const resolved = await resolveContentSlugPath(slug, [kind], {
      posts: absolutise(cwd, config.content.posts_dir),
      pages: absolutise(cwd, config.content.pages_dir),
    });
    return resolved?.path;
  }
  const fast = join(editableDir(cwd, config, kind), `${slug}.md`);
  return existsSync(fast) ? fast : undefined;
}

async function fingerprintFor(cwd: string, filePath: string): Promise<ContentSourceFingerprint> {
  const info = await stat(filePath);
  return {
    path: relative(cwd, filePath).replaceAll('\\', '/'),
    mtimeMs: Math.round(info.mtimeMs * 1000) / 1000,
    size: info.size,
  };
}

async function optionalFingerprintFor(
  cwd: string,
  filePath: string,
): Promise<ContentSourceFingerprint> {
  try {
    return await fingerprintFor(cwd, filePath);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { path: relativePath(cwd, filePath), mtimeMs: 0, size: 0 };
    }
    throw err;
  }
}

function sameFingerprint(a: ContentSourceFingerprint, b: ContentSourceFingerprint): boolean {
  return a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function parseEditableKind(value: string): EditableKind | undefined {
  if (value === 'posts' || value === 'pages' || value === 'authors' || value === 'tags')
    return value;
  return undefined;
}

async function writeSiteSettingsFile(
  target: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const allowed = ['title', 'description', 'url', 'locale', 'timezone', 'accent_color'];
  const updates = new Map<string, string>();
  for (const key of allowed) {
    const value = payload[key];
    if (typeof value === 'string') updates.set(key, value);
  }
  if (updates.size === 0) return;
  const raw = existsSync(target) ? await readFile(target, 'utf8') : '';
  await writeFile(target, updateTomlSection(raw, 'site', updates), 'utf8');
}

function updateTomlSection(raw: string, section: string, updates: Map<string, string>): string {
  const lines = raw ? raw.split(/\r?\n/) : [];
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    const inserted = [
      header,
      ...[...updates].map(([key, value]) => `${key} = ${tomlString(value)}`),
      '',
    ];
    return `${inserted.join('\n')}${raw ? `\n${raw}` : ''}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  const seen = new Set<string>();
  for (let i = start + 1; i < end; i += 1) {
    const match = (lines[i] ?? '').match(/^(\s*)([A-Za-z0-9_-]+)(\s*=\s*).*/);
    if (!match) continue;
    const key = match[2] ?? '';
    const value = updates.get(key);
    if (value === undefined) continue;
    lines[i] = `${match[1] ?? ''}${key}${match[3] ?? ' = '}${tomlString(value)}`;
    seen.add(key);
  }
  const missing = [...updates].filter(([key]) => !seen.has(key));
  lines.splice(end, 0, ...missing.map(([key, value]) => `${key} = ${tomlString(value)}`));
  return lines.join('\n').replace(/\n*$/, '\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function resolveConfigPath(cwd: string, configPath: string | undefined): string {
  const first = configPath?.split(',')[0]?.trim() || 'nectar.toml';
  return isAbsolute(first) ? first : resolve(cwd, first);
}

function relativePath(cwd: string, filePath: string): string {
  return relative(cwd, filePath).replaceAll('\\', '/');
}

function numberParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) return fallback;
  return Math.min(value, max);
}

function parsePort(value: unknown): number | CliUsageError {
  if (value === undefined) return DEFAULT_PORT;
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    return new CliUsageError(`Invalid --port value: ${String(value)}`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return new CliUsageError(`Invalid --port value: ${value}`);
  return port;
}

function parseHost(value: unknown): string | CliUsageError {
  if (value === undefined) return DEFAULT_HOST;
  if (typeof value !== 'string' || value.trim().length === 0)
    return new CliUsageError('Invalid --host value');
  return value.trim();
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

interface ChangeBus {
  broadcast(reason: string): void;
  stream(): Response;
}

function createChangeBus(): ChangeBus {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  return {
    broadcast(reason: string) {
      const payload = encoder.encode(
        `event: sync\ndata: ${JSON.stringify({ reason, at: new Date().toISOString() })}\n\n`,
      );
      for (const client of clients) {
        try {
          client.enqueue(payload);
        } catch {
          clients.delete(client);
        }
      }
    },
    stream() {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          clients.add(controller);
          controller.enqueue(encoder.encode(': connected\n\n'));
        },
        cancel(controller) {
          clients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        },
      });
    },
  };
}

async function watchDashboardFiles({
  cwd,
  configPath,
  changeBus,
}: {
  cwd: string;
  configPath?: string;
  changeBus: ChangeBus;
}): Promise<FSWatcher[]> {
  const config = await loadConfig({ cwd, configPath });
  const paths = [
    resolveConfigPath(cwd, configPath),
    absolutise(cwd, config.content.posts_dir),
    absolutise(cwd, config.content.pages_dir),
    absolutise(cwd, config.content.authors_dir),
    absolutise(cwd, config.content.tags_dir),
  ];
  const watchers: FSWatcher[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      watchers.push(fsWatch(path, { recursive: true }, () => changeBus.broadcast('file-change')));
    } catch (err) {
      logger.warn(
        `Dashboard could not watch ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return watchers;
}

function waitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolveSignal) => {
    const done = (signal: NodeJS.Signals): void => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      resolveSignal(signal);
    };
    const onInt = (): void => done('SIGINT');
    const onTerm = (): void => done('SIGTERM');
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
  });
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', url]
        : ['xdg-open', url];
  Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
}

function renderDashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nectar Dashboard</title>
<style>
:root{color-scheme:light;--paper:#f5f7f1;--ink:#20231f;--muted:#66706a;--line:#d6ddd3;--field:#fbfcf8;--green:#2f6f63;--moss:#93a86a;--rust:#b5532a;--blue:#305c7a;--gold:#c99b42;--shadow:0 18px 45px rgba(24,34,31,.12)}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#eef3ef 0%,#f8faf4 54%,#e4ece7 100%);background-attachment:fixed;color:var(--ink);font:14px/1.5 Avenir Next,Segoe UI,Helvetica Neue,sans-serif;letter-spacing:0}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(32,35,31,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(32,35,31,.028) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.08))}
button,input,textarea,select{font:inherit}button{cursor:pointer;border:0}.shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
.side{border-right:1px solid #111b17;padding:24px 18px;background:linear-gradient(180deg,#18221f,#22231f 58%,#111713);color:#f8fbf2;position:sticky;top:0;height:100vh}.brand{font-family:Georgia,serif;font-size:30px;line-height:1;margin-bottom:6px}.tagline{color:#afc1b8;font-size:12px;margin-bottom:30px}
.nav{display:grid;gap:6px}.nav button{width:100%;text-align:left;padding:11px 12px;border-radius:8px;background:transparent;color:#d9e2da}.nav button.active{background:#f8fbf2;color:#18221f;box-shadow:inset 3px 0 0 var(--gold)}.sync{position:absolute;bottom:18px;left:18px;right:18px;color:#afc1b8;font-size:12px}
.main{padding:26px;min-width:0}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px}.kicker{font-size:12px;color:var(--green);font-weight:800;text-transform:uppercase;letter-spacing:.08em}.title{font-family:Georgia,serif;font-size:42px;line-height:1.05;margin:3px 0}.sub{color:var(--muted);max-width:760px}
.actions{display:flex;gap:8px;flex-wrap:wrap}.btn{border-radius:8px;padding:10px 13px;background:var(--ink);color:#fff;box-shadow:0 7px 18px rgba(32,35,31,.13)}.btn.secondary{background:var(--field);color:var(--ink);border:1px solid var(--line);box-shadow:none}.btn:disabled{opacity:.46;cursor:not-allowed}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.stat{background:rgba(251,252,248,.86);border:1px solid var(--line);border-radius:8px;padding:14px;box-shadow:var(--shadow)}.stat b{font-size:30px;font-family:Georgia,serif;display:block}.stat span{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:800}
.panel{background:rgba(251,252,248,.9);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);overflow:hidden;backdrop-filter:blur(10px)}.panelHead{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}.panelHead h2{margin:0;font-size:15px}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:12px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.table th{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em}.table tr:hover td{background:#f2f7ee}.slug{font-family:Menlo,Consolas,monospace;font-size:12px;color:var(--blue)}.pill{display:inline-flex;border-radius:99px;background:#e5ead2;color:#334321;padding:3px 8px;font-size:12px}.pill.draft{background:#f2ded6;color:#7b351c}.meta{color:var(--muted);font-size:12px}.pager{display:flex;gap:8px;align-items:center;padding:14px 16px}
.editor{position:fixed;inset:0 0 0 auto;width:min(760px,100vw);background:#fbfcf8;border-left:1px solid var(--line);box-shadow:-22px 0 55px rgba(21,32,29,.24);padding:20px;display:none;grid-template-rows:auto auto 1fr auto;gap:12px;z-index:5}.editor.open{display:grid}.editor textarea{width:100%;height:100%;resize:none;border:1px solid var(--line);border-radius:8px;background:white;padding:14px;font-family:Menlo,Consolas,monospace;font-size:13px}.fields{display:grid;grid-template-columns:1fr 160px;gap:10px}.settingsGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}.field{display:grid;gap:5px}.field span{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:800}.field input,.field select{border:1px solid var(--line);border-radius:8px;padding:10px;background:white;min-width:0}.field.wide{grid-column:1/-1}.notice{color:var(--rust);font-size:13px;min-height:20px}
@media (max-width:860px){.shell{grid-template-columns:1fr}.side{position:static;height:auto}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.top{display:block}.table th:nth-child(4),.table td:nth-child(4){display:none}}
</style>
</head>
<body>
<div class="shell">
  <aside class="side"><div class="brand">Nectar</div><div class="tagline">file-backed editorial dashboard</div><nav class="nav"><button data-view="posts" class="active">Posts</button><button data-view="pages">Pages</button><button data-view="authors">Authors</button><button data-view="tags">Tags</button><button data-view="settings">Settings</button></nav><div class="sync" id="sync">syncing from disk</div></aside>
  <main class="main"><div class="top"><div><div class="kicker" id="kicker">Local workspace</div><h1 class="title" id="siteTitle">Nectar Dashboard</h1><div class="sub" id="siteSub">Reading content files directly from this repository.</div></div><div class="actions"><button class="btn secondary" id="refresh">Refresh</button><button class="btn" id="newItem">New</button></div></div><section class="stats"><div class="stat"><b id="postCount">0</b><span>posts</span></div><div class="stat"><b id="pageCount">0</b><span>pages</span></div><div class="stat"><b id="authorCount">0</b><span>authors</span></div><div class="stat"><b id="tagCount">0</b><span>tags</span></div></section><section class="panel" id="content"></section></main>
</div>
<aside class="editor" id="editor"><div class="panelHead"><h2 id="editorTitle">Editor</h2><button class="btn secondary" id="closeEditor">Close</button></div><div class="fields"><label class="field"><span>Title</span><input id="editTitle"></label><label class="field"><span>Status</span><select id="editStatus"><option>published</option><option>draft</option><option>scheduled</option></select></label></div><textarea id="editBody"></textarea><div><div class="notice" id="notice"></div><button class="btn" id="saveEditor">Save to file</button></div></aside>
<script>
let state=null, view='posts', postsPage=1, pagesPage=1, current=null;
const $=(id)=>document.getElementById(id);
async function load(){ $('sync').textContent='reading files...'; const r=await fetch('/api/state?posts_page='+postsPage+'&pages_page='+pagesPage+'&per_page=12'); state=await r.json(); render(); $('sync').textContent='synced '+new Date(state.generatedAt).toLocaleTimeString(); }
function render(){ $('siteTitle').textContent=state.site.title; $('siteSub').textContent=state.site.description || state.site.url; $('postCount').textContent=state.posts.total; $('pageCount').textContent=state.pages.total; $('authorCount').textContent=state.authors.total; $('tagCount').textContent=state.tags.total; document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); if(view==='settings') return renderSettings(); if(view==='authors'||view==='tags') return renderTax(view); renderContent(view); }
function renderContent(kind){ const list=state[kind]; $('kicker').textContent=kind+' · created newest first'; $('newItem').style.display='inline-block'; $('content').innerHTML='<div class="panelHead"><h2>'+kind+'</h2><span class="meta">page '+list.page+' of '+list.pages+'</span></div><table class="table"><thead><tr><th>Title</th><th>Status</th><th>Created</th><th>Path</th><th></th></tr></thead><tbody>'+list.items.map(item=>'<tr><td><b>'+escapeHtml(item.title)+'</b><div class="slug">'+item.slug+'</div></td><td><span class="pill '+(item.status==='draft'?'draft':'')+'">'+item.status+'</span></td><td>'+date(item.createdAt)+'</td><td class="meta">'+escapeHtml(item.path)+'</td><td><button class="btn secondary" data-edit="'+item.slug+'">Edit</button></td></tr>').join('')+'</tbody></table><div class="pager"><button class="btn secondary" id="prev">Prev</button><button class="btn secondary" id="next">Next</button></div>'; $('prev').onclick=()=>{ if(kind==='posts') postsPage--; else pagesPage--; load(); }; $('next').onclick=()=>{ if(kind==='posts') postsPage++; else pagesPage++; load(); }; document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(kind,b.dataset.edit)); }
function renderTax(kind){ const list=state[kind]; $('kicker').textContent=kind+' · taxonomy files'; $('newItem').style.display='inline-block'; $('content').innerHTML='<div class="panelHead"><h2>'+kind+'</h2><span class="meta">'+list.total+' files</span></div><table class="table"><thead><tr><th>Name</th><th>Posts</th><th>Path</th><th>URL</th><th></th></tr></thead><tbody>'+list.items.map(item=>'<tr><td><b>'+escapeHtml(item.name)+'</b><div class="slug">'+item.slug+'</div></td><td>'+item.count+'</td><td class="meta">'+escapeHtml(item.path||'generated from content references')+'</td><td class="meta">'+escapeHtml(item.url)+'</td><td>'+(item.editable?'<button class="btn secondary" data-edit="'+item.slug+'">Edit</button>':'<button class="btn secondary" disabled>Missing file</button>')+'</td></tr>').join('')+'</tbody></table>'; document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(kind,b.dataset.edit)); }
function renderSettings(){ $('kicker').textContent='settings · nectar.toml'; $('newItem').style.display='none'; const s=state.settings; $('content').innerHTML='<div class="panelHead"><h2>Project settings</h2><span class="meta">'+escapeHtml(s.configPath)+'</span></div><div class="settingsGrid"><label class="field"><span>Site title</span><input id="setTitle" value="'+escapeAttr(state.site.title)+'"></label><label class="field"><span>Accent color</span><input id="setAccent" value="'+escapeAttr(state.site.accentColor)+'"></label><label class="field wide"><span>Description</span><input id="setDescription" value="'+escapeAttr(state.site.description)+'"></label><label class="field wide"><span>Site URL</span><input id="setUrl" value="'+escapeAttr(state.site.url)+'"></label><label class="field"><span>Theme</span><input value="'+escapeAttr(s.theme)+'" disabled></label><label class="field"><span>Output</span><input value="'+escapeAttr(s.outputDir)+'" disabled></label><label class="field"><span>Posts dir</span><input value="'+escapeAttr(s.contentDirs.posts)+'" disabled></label><label class="field"><span>Pages dir</span><input value="'+escapeAttr(s.contentDirs.pages)+'" disabled></label><div class="field wide"><span id="settingsNotice" class="notice"></span><button class="btn" id="saveSettings">Save settings</button></div></div>'; $('saveSettings').onclick=saveSettings; }
async function openEditor(kind,slug){ const r=await fetch('/api/content/'+kind+'/'+slug); current=await r.json(); $('editorTitle').textContent=current.path; $('editTitle').value=current.frontmatter.title||current.frontmatter.name||''; $('editStatus').value=current.frontmatter.status||'published'; $('editStatus').disabled=kind!=='posts'&&kind!=='pages'; $('editBody').value=current.body; $('notice').textContent=''; $('editor').classList.add('open'); }
async function saveEditor(){ if(!current)return; const fm={...current.frontmatter}; if(current.kind==='posts'||current.kind==='pages'){ fm.title=$('editTitle').value; fm.status=$('editStatus').value; fm.updated_at=new Date().toISOString(); } else { fm.name=$('editTitle').value; } const r=await fetch('/api/content/'+current.kind+'/'+current.slug,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({fingerprint:current.fingerprint,frontmatter:fm,body:$('editBody').value})}); const data=await r.json(); if(r.status===409){ current=data.current; $('notice').textContent='This file changed on disk. Reloaded latest version; review before saving.'; $('editBody').value=current.body; return; } current=null; $('editor').classList.remove('open'); await load(); }
async function saveSettings(){ const updates={title:$('setTitle').value,description:$('setDescription').value,url:$('setUrl').value,accent_color:$('setAccent').value}; const r=await fetch('/api/settings/site',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({fingerprint:state.settings.fingerprint,updates})}); const data=await r.json(); if(r.status===409){ $('settingsNotice').textContent='nectar.toml changed on disk. Reloaded latest settings; review before saving.'; await load(); return; } if(!r.ok){ $('settingsNotice').textContent=data.error||'Could not save settings'; return; } await load(); if($('settingsNotice')) $('settingsNotice').textContent='Saved to nectar.toml'; }
async function createItem(){ const title=prompt('Title or name'); if(!title)return; const kind=view==='settings'?'posts':view; const r=await fetch('/api/content',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,title})}); if(!r.ok){ alert((await r.json()).error||'Could not create file'); return; } await load(); }
function date(v){ return new Date(v).toLocaleDateString(); } function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); } function escapeAttr(v){ return escapeHtml(v).replace(/"/g,'&quot;'); }
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{view=b.dataset.view;load();}); $('refresh').onclick=load; $('newItem').onclick=createItem; $('closeEditor').onclick=()=>$('editor').classList.remove('open'); $('saveEditor').onclick=saveEditor;
new EventSource('/api/events').addEventListener('sync',()=>load()); load();
</script>
</body>
</html>`;
}
