import { randomBytes } from 'node:crypto';
import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import slugify from 'slugify';
import { loadRedirects } from '~/build/redirects.ts';
import { loadRoutesYaml, resolveCollections, resolveRouteEntries } from '~/build/routes-yaml.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { formatContentSource } from '~/content/format.ts';
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
import { loadTheme } from '~/theme/loader.ts';
import { createCleanupRegistry } from '~/util/cleanup.ts';
import { logger } from '~/util/logger.ts';
import { absolutise, resolveContentSlugPath } from '../content-paths.ts';
import { renderDashboardHtml as renderDashboardShellHtml } from '../dashboard/html.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DASHBOARD_SPEC } from '../specs.ts';
import { type CheckResult, runChecks } from './doctor.ts';

const DEFAULT_PORT = 4322;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 100;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const ACTIVITY_LIMIT = 50;
const WATCH_DEBOUNCE_MS = 100;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SITE_SETTINGS_FIELDS = ['title', 'description', 'url', 'locale', 'timezone', 'accent_color'];

type EditableKind = 'posts' | 'pages' | 'authors' | 'tags';
type DashboardContentKind = 'posts' | 'pages';
type DashboardSort = 'created_desc' | 'created_asc' | 'updated_desc' | 'title_asc';

export interface DashboardStateOptions {
  cwd: string;
  configPath?: string;
  page?: number;
  postsPage?: number;
  pagesPage?: number;
  perPage?: number;
  kind?: DashboardContentKind;
  status?: string;
  search?: string;
  sort?: DashboardSort;
  sync?: DashboardSyncSnapshot;
  requestOrigin?: string;
}

export interface DashboardStateQuery {
  kind?: DashboardContentKind;
  status?: string;
  search?: string;
  sort?: DashboardSort;
}

export interface DashboardList<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  query: DashboardStateQuery;
}

export interface DashboardContentSummary {
  slug: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  path: string;
  url: string;
  authors: string[];
  authorSlugs: string[];
  tags: string[];
  tagSlugs: string[];
  words: number;
  warnings: DashboardContentWarning[];
}

export interface DashboardTaxonomySummary {
  slug: string;
  name: string;
  description: string;
  count: number;
  path: string;
  url: string;
  editable: boolean;
  missing: boolean;
  generated: boolean;
  orphaned: boolean;
  source: 'file' | 'generated';
  materializePath: string;
}

type DashboardCardMode =
  | 'editable'
  | 'read-only'
  | 'cli-action'
  | 'dangerous-cli-only'
  | 'scope-note';
type DashboardCardStatus = 'ok' | 'warn' | 'danger' | 'info';

interface DashboardCardValue {
  label: string;
  value: string;
  status?: DashboardCardStatus;
}

interface DashboardSettingsCard {
  id: string;
  section: string;
  title: string;
  summary: string;
  source: string;
  mode: DashboardCardMode;
  status: DashboardCardStatus;
  values: DashboardCardValue[];
  command?: string;
}

interface DashboardReadinessItem {
  id: string;
  label: string;
  status: DashboardCardStatus;
  detail: string;
  command?: string;
}

interface DashboardCliAsset {
  command: string;
  adminSurface: string;
  exposure: 'read-only' | 'safe-action' | 'dangerous-cli-only' | 'not-suitable';
  note: string;
}

interface DashboardOperations {
  readiness: DashboardReadinessItem[];
  doctor: CheckResult[];
  cliAssets: DashboardCliAsset[];
  cache: {
    path: string;
    exists: boolean;
    files: number;
    bytes: number;
  };
  redirects: {
    path: string | null;
    rules: number;
    duplicates: string[];
    error?: string;
  };
  routes: {
    path: string | null;
    routes: number;
    collections: number;
    error?: string;
  };
  inventory: {
    postsByStatus: Record<string, number>;
    pagesByStatus: Record<string, number>;
    futurePosts: number;
    staleDrafts: number;
    missingTaxonomyFiles: number;
  };
  search: {
    query: string;
    status: string;
    fields: string[];
    bodySearch: 'deferred';
    resultCount: number;
  };
  collaboration: {
    editorCommand: string;
    lockPolicy: string;
    presencePolicy: string;
    safety: string;
  };
  membersPolicy: {
    adminScope: 'out-of-scope';
    subscribeProvider: string;
    portalProvider: string;
    note: string;
  };
}

export interface DashboardSyncEvent {
  reason: string;
  at: string;
  kind?: EditableKind | 'settings' | 'project';
  changedPath?: string;
}

export interface DashboardSyncSnapshot {
  status: 'synced' | 'reading' | 'changed-on-disk' | 'conflict' | 'save-failed';
  watchedPaths: string[];
  watchWarnings: string[];
  warnings: string[];
  lastEvent?: DashboardSyncEvent;
  activity: DashboardSyncEvent[];
  loadStartedAt: string;
  loadFinishedAt: string;
}

type DashboardContentWarningSeverity = 'info' | 'warning';

export interface DashboardContentWarning {
  code:
    | 'feature-image-alt'
    | 'inline-image-alt'
    | 'empty-title'
    | 'long-title'
    | 'missing-description';
  severity: DashboardContentWarningSeverity;
  message: string;
}

export interface DashboardState {
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
      assets: string;
    };
    outputDir: string;
    theme: string;
    cards: DashboardSettingsCard[];
    operations: DashboardOperations;
  };
  sync: DashboardSyncSnapshot;
  build: {
    outputDir: string;
    theme: string;
    previewUrl: string;
    routeCount: number | null;
    warnings: string[];
  };
  git: DashboardGitStatus;
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
  | { ok: true; fingerprint: ContentSourceFingerprint; changedPath: string }
  | {
      ok: false;
      reason: 'conflict';
      changedPath: string;
      current: DashboardContentItem;
      conflict: DashboardConflictDiff;
    }
  | { ok: false; reason: 'not-found' | 'invalid-kind' | 'forbidden'; changedPath?: string };

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
  | { ok: true; fingerprint: ContentSourceFingerprint; changedPath: string }
  | { ok: false; reason: 'conflict'; changedPath: string; current: DashboardSettings };

export interface DashboardConflictDiff {
  frontmatter: {
    current: Record<string, unknown>;
    draft: Record<string, unknown>;
  };
  body: {
    current: string;
    draft: string;
  };
}

export interface DashboardGitStatus {
  isRepo: boolean;
  branch?: string;
  dirty: boolean;
  changedFiles: number;
  lastCommit?: string;
}

interface DashboardWatchMetadata {
  watchedPaths: string[];
  warnings: string[];
}

export interface DashboardSecurityContext {
  origin: string;
  token: string;
  lanExposed: boolean;
}

export interface DashboardRequestContext {
  cwd: string;
  configPath?: string;
  changeBus: ChangeBus;
  watch?: DashboardWatchMetadata;
  security?: DashboardSecurityContext;
  maxBodyBytes?: number;
}

export type DashboardTaxonomyFileResult =
  | {
      ok: true;
      kind: 'authors' | 'tags';
      slug: string;
      path: string;
      fingerprint: ContentSourceFingerprint;
    }
  | { ok: false; reason: 'not-found' | 'already-exists' | 'invalid-kind' | 'forbidden' };

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
  const cleanup = createCleanupRegistry();
  const watchSetup = await watchDashboardFiles({ cwd, configPath, changeBus });
  cleanup.register(
    () => {
      for (const watcher of watchSetup.watchers) watcher.close();
    },
    { name: 'dashboard-watchers' },
  );
  const token = createDashboardToken();
  const lanExposed = isLanExposedHost(host);
  const server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 255,
    async fetch(request): Promise<Response> {
      return handleDashboardRequest(request, {
        cwd,
        configPath,
        changeBus,
        watch: watchSetup,
        security: {
          origin: new URL(request.url).origin,
          token,
          lanExposed,
        },
      });
    },
  });
  cleanup.register(() => server.stop(true), { name: 'dashboard-server' });

  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${displayHost}:${server.port}/`;
  logger.info(`Dashboard listening on ${url}`);
  if (lanExposed) {
    logger.warn(
      'Dashboard is listening on a LAN-facing host. Keep the startup URL private because this process can write local project files.',
    );
  }
  if (parsed.values.open === true) {
    openBrowser(url);
  }

  await cleanup.waitForSignal({ signals: ['SIGINT', 'SIGTERM'] });
  return 0;
}

export async function loadDashboardState({
  cwd,
  configPath,
  page,
  postsPage,
  pagesPage,
  perPage,
  kind,
  status,
  search,
  sort,
  sync,
  requestOrigin,
}: DashboardStateOptions): Promise<DashboardState> {
  const loadStartedAt = new Date().toISOString();
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
  const query: DashboardStateQuery = {};
  if (kind !== undefined) query.kind = kind;
  if (status !== undefined && status.trim().length > 0) query.status = status.trim();
  if (search !== undefined && search.trim().length > 0) query.search = search.trim();
  query.sort = sort ?? 'created_desc';

  const posts = applyContentQuery(
    graph.posts.map((post) => postSummary(post, graph, config)),
    'posts',
    query,
  );
  const pages = applyContentQuery(
    graph.pages.map((item) => pageSummary(item, graph, config)),
    'pages',
    query,
  );
  const loadFinishedAt = new Date().toISOString();
  const syncSnapshot = sync ?? defaultSyncSnapshot({ loadStartedAt, loadFinishedAt });
  const git = await readGitStatus(cwd);
  const settingsFingerprint = await optionalFingerprintFor(cwd, resolveConfigPath(cwd, configPath));
  const operations = await buildDashboardOperations({
    cwd,
    configPath,
    config,
    graph,
    posts,
    pages,
    query: query.search?.trim().toLowerCase() ?? '',
    status: query.status ?? '',
  });

  return {
    site: {
      title: graph.site.title,
      description: graph.site.description,
      url: graph.site.url,
      accentColor: graph.site.accent_color,
    },
    posts: paginate(posts, postPage, safePerPage, query),
    pages: paginate(pages, pagePage, safePerPage, query),
    authors: paginate(
      graph.authors
        .map((author) => taxonomySummary(author, graph, config, 'authors'))
        .sort((a, b) => a.name.localeCompare(b.name)),
      1,
      MAX_PER_PAGE,
      query,
    ),
    tags: paginate(
      graph.tags
        .map((tag) => taxonomySummary(tag, graph, config, 'tags'))
        .sort((a, b) => a.name.localeCompare(b.name)),
      1,
      MAX_PER_PAGE,
      query,
    ),
    settings: {
      configPath: relativePath(cwd, resolveConfigPath(cwd, configPath)),
      fingerprint: settingsFingerprint,
      contentDirs: {
        posts: config.content.posts_dir,
        pages: config.content.pages_dir,
        authors: config.content.authors_dir,
        tags: config.content.tags_dir,
        assets: config.content.assets_dir,
      },
      outputDir: config.build.output_dir,
      theme: config.theme.name,
      cards: await buildSettingsCards({ cwd, configPath, config, operations }),
      operations,
    },
    sync: {
      ...syncSnapshot,
      loadStartedAt,
      loadFinishedAt,
      warnings: syncSnapshot.warnings,
    },
    build: {
      outputDir: config.build.output_dir,
      theme: config.theme.name,
      previewUrl: requestOrigin ?? graph.site.url,
      routeCount: null,
      warnings: [],
    },
    git,
    generatedAt: loadFinishedAt,
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
  if (!(await isEditableRealPath(cwd, config, kind, filePath))) {
    throw new Response('Forbidden', { status: 403 });
  }
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
  if (!(await isEditableRealPath(cwd, config, kind, filePath))) {
    return { ok: false, reason: 'forbidden', changedPath: relativePath(cwd, filePath) };
  }
  const current = await readDashboardContentItem({ cwd, config, kind, slug });
  if (!sameFingerprint(current.fingerprint, expectedFingerprint)) {
    return {
      ok: false,
      reason: 'conflict',
      changedPath: current.path,
      current,
      conflict: {
        frontmatter: { current: current.frontmatter, draft: frontmatter },
        body: { current: current.body, draft: body },
      },
    };
  }
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  await writeFile(filePath, serializeContentSource(frontmatter, normalizedBody), 'utf8');
  return {
    ok: true,
    fingerprint: await fingerprintFor(cwd, filePath),
    changedPath: relativePath(cwd, filePath),
  };
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
    return { ok: false, reason: 'conflict', changedPath: current.configPath, current };
  }
  await writeSiteSettingsFile(filePath, updates);
  return {
    ok: true,
    fingerprint: await optionalFingerprintFor(cwd, filePath),
    changedPath: relativePath(cwd, filePath),
  };
}

export async function handleDashboardRequest(
  request: Request,
  ctx: DashboardRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/') {
      return htmlResponse(renderDashboardHtml(ctx.security?.token ?? ''));
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const kind = stateKindParam(url);
      if (url.searchParams.has('kind') && kind === undefined) {
        return jsonResponse({ error: 'invalid kind query' }, 400);
      }
      const sort = sortParam(url);
      if (url.searchParams.has('sort') && sort === undefined) {
        return jsonResponse({ error: 'invalid sort query' }, 400);
      }
      return jsonResponse(
        await loadDashboardState({
          cwd: ctx.cwd,
          configPath: ctx.configPath,
          postsPage: numberParam(url, 'posts_page'),
          pagesPage: numberParam(url, 'pages_page'),
          perPage: numberParam(url, 'per_page'),
          kind,
          status: stringParam(url, 'status'),
          search: stringParam(url, 'search') ?? stringParam(url, 'q'),
          sort,
          sync: ctx.changeBus.snapshot(ctx.watch),
          requestOrigin: `${url.protocol}//${url.host}`,
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
        const blocked = validateWriteRequest(request, ctx.security);
        if (blocked) return blocked;
        const payload = await readJsonPayload<{
          fingerprint?: ContentSourceFingerprint;
          frontmatter?: Record<string, unknown>;
          body?: string;
        }>(request, ctx.maxBodyBytes);
        if (payload instanceof Response) return payload;
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
        if (!result.ok && result.reason === 'forbidden') return jsonResponse(result, 403);
        if (!result.ok) return jsonResponse(result, 404);
        ctx.changeBus.broadcast({
          reason: 'dashboard-write',
          kind,
          changedPath: result.changedPath,
        });
        return jsonResponse(result);
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/settings/site') {
      return jsonResponse(
        await readDashboardSettings({ cwd: ctx.cwd, configPath: ctx.configPath }),
      );
    }
    const taxonomyMaterializeMatch = url.pathname.match(
      /^\/api\/taxonomy\/(authors|tags)\/([^/]+)\/file$/,
    );
    if (request.method === 'POST' && taxonomyMaterializeMatch) {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const kind = taxonomyMaterializeMatch[1] as 'authors' | 'tags';
      const slug = decodeURIComponent(taxonomyMaterializeMatch[2] ?? '');
      if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'invalid taxonomy slug' }, 400);
      const result = await createDashboardTaxonomyFile({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        kind,
        slug,
      });
      if (!result.ok && result.reason === 'already-exists') return jsonResponse(result, 409);
      if (!result.ok && result.reason === 'forbidden') return jsonResponse(result, 403);
      if (!result.ok) return jsonResponse(result, 404);
      ctx.changeBus.broadcast({
        reason: 'taxonomy-file-create',
        kind,
        changedPath: result.path,
      });
      return jsonResponse(result, 201);
    }
    if (request.method === 'POST' && url.pathname === '/api/content') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const payload = await readJsonPayload<{
        kind?: EditableKind;
        title?: string;
        slug?: string;
      }>(request, ctx.maxBodyBytes);
      if (payload instanceof Response) return payload;
      const result = await createDashboardContentItem({ cwd: ctx.cwd, config, payload });
      ctx.changeBus.broadcast({
        reason: 'dashboard-create',
        kind: result.kind,
        changedPath: result.path,
      });
      return jsonResponse(result, 201);
    }
    if (request.method === 'PATCH' && url.pathname === '/api/settings/site') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const payload = await readJsonPayload<{
        fingerprint?: ContentSourceFingerprint;
        updates?: Record<string, unknown>;
      }>(request, ctx.maxBodyBytes);
      if (payload instanceof Response) return payload;
      if (!payload.fingerprint || !payload.updates) {
        return jsonResponse({ error: 'fingerprint and updates are required' }, 400);
      }
      const invalidSettingsFields = findInvalidSettingsFields(payload.updates);
      if (invalidSettingsFields.length > 0) {
        return jsonResponse(
          { error: 'unknown settings fields', fields: invalidSettingsFields },
          400,
        );
      }
      const result = await writeDashboardSiteSettings({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        expectedFingerprint: payload.fingerprint,
        updates: payload.updates,
      });
      if (!result.ok) return jsonResponse(result, 409);
      ctx.changeBus.broadcast({
        reason: 'settings-write',
        kind: 'settings',
        changedPath: result.changedPath,
      });
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
  if (!(await isEditableRootInsideProject(cwd, config, kind))) {
    throw new Response('Forbidden', { status: 403 });
  }
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
  await writeFile(filePath, serializeContentSource(frontmatter, '\n'), 'utf8');
  return { ok: true, kind, slug, path: relativePath(cwd, filePath) };
}

export async function createDashboardTaxonomyFile({
  cwd,
  configPath,
  kind,
  slug,
}: {
  cwd: string;
  configPath?: string;
  kind: 'authors' | 'tags';
  slug: string;
}): Promise<DashboardTaxonomyFileResult> {
  const config = await loadConfig({ cwd, configPath });
  const graph = await loadContent({
    cwd,
    config,
    includeDrafts: true,
    includeFuturePosts: true,
  });
  const item =
    kind === 'authors'
      ? graph.authors.find((author) => author.slug === slug)
      : graph.tags.find((tag) => tag.slug === slug);
  if (item === undefined) return { ok: false, reason: 'not-found' };
  if (!(await isEditableRootInsideProject(cwd, config, kind))) {
    return { ok: false, reason: 'forbidden' };
  }
  const filePath = join(editableDir(cwd, config, kind), `${slug}.md`);
  if (existsSync(filePath)) return { ok: false, reason: 'already-exists' };
  await mkdir(dirname(filePath), { recursive: true });
  const frontmatter =
    kind === 'authors'
      ? { slug, name: item.name, bio: 'bio' in item ? item.bio : '' }
      : {
          slug,
          name: item.name,
          description: 'description' in item ? item.description : '',
          visibility: 'visibility' in item ? item.visibility : 'public',
        };
  await writeFile(filePath, serializeContentSource(frontmatter, '\n'), 'utf8');
  return {
    ok: true,
    kind,
    slug,
    path: relativePath(cwd, filePath),
    fingerprint: await fingerprintFor(cwd, filePath),
  };
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
    authorSlugs: post.authors.map((author) => author.slug),
    tags: post.tags.map((tag) => tag.name),
    tagSlugs: post.tags.map((tag) => tag.slug),
    words: post.word_count,
    warnings: contentWarnings(post),
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
    authorSlugs: page.authors.map((author) => author.slug),
    tags: page.tags.map((tag) => tag.name),
    tagSlugs: page.tags.map((tag) => tag.slug),
    words: page.word_count,
    warnings: contentWarnings(page),
  };
}

function contentWarnings(item: Post | Page): DashboardContentWarning[] {
  const warnings: DashboardContentWarning[] = [];
  if (item.title.trim().length === 0) {
    warnings.push({
      code: 'empty-title',
      severity: 'warning',
      message: 'Title is empty.',
    });
  }
  if (item.title.length > 80) {
    warnings.push({
      code: 'long-title',
      severity: 'info',
      message: 'Title is long; check narrow layouts and search snippets.',
    });
  }
  if (item.feature_image && !item.feature_image_alt?.trim()) {
    warnings.push({
      code: 'feature-image-alt',
      severity: 'warning',
      message: 'Feature image has no alt text.',
    });
  }
  const inlineMissingAlt = countImagesMissingAlt(item.html);
  if (inlineMissingAlt > 0) {
    warnings.push({
      code: 'inline-image-alt',
      severity: 'warning',
      message: `${inlineMissingAlt} inline image${inlineMissingAlt === 1 ? '' : 's'} need alt text.`,
    });
  }
  if (!item.custom_excerpt && item.excerpt.trim().length === 0) {
    warnings.push({
      code: 'missing-description',
      severity: 'info',
      message: 'No excerpt or description is available.',
    });
  }
  return warnings;
}

function countImagesMissingAlt(html: string): number {
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  let count = 0;
  for (const image of images) {
    const alt = image.match(/\salt\s*=\s*(["'])(.*?)\1/i);
    if (!alt || (alt[2] ?? '').trim().length === 0) count += 1;
  }
  return count;
}

function taxonomySummary(
  item: Author | Tag,
  graph: ContentGraph,
  config: NectarConfig,
  kind: 'authors' | 'tags',
): DashboardTaxonomySummary {
  const source =
    kind === 'authors' ? graph.sources?.authors.get(item.id) : graph.sources?.tags.get(item.id);
  const editable = source !== undefined;
  return {
    slug: item.slug,
    name: item.name,
    description: 'bio' in item ? item.bio : item.description,
    count: item.count.posts,
    path: contentPath(
      kind === 'authors' ? config.content.authors_dir : config.content.tags_dir,
      source,
    ),
    url: item.url,
    editable,
    missing: !editable,
    generated: !editable,
    orphaned: editable && item.count.posts === 0,
    source: editable ? 'file' : 'generated',
    materializePath: `${
      kind === 'authors' ? config.content.authors_dir : config.content.tags_dir
    }/${item.slug}.md`,
  };
}

function applyContentQuery(
  items: DashboardContentSummary[],
  itemKind: DashboardContentKind,
  query: DashboardStateQuery,
): DashboardContentSummary[] {
  const needle = query.search?.toLowerCase();
  const filtered = items.filter((item) => {
    if (query.kind !== undefined && query.kind !== itemKind) return false;
    if (query.status !== undefined && item.status !== query.status) return false;
    if (needle === undefined) return true;
    return [
      item.slug,
      item.title,
      item.path,
      item.url,
      ...item.authors,
      ...item.authorSlugs,
      ...item.tags,
      ...item.tagSlugs,
    ].some((value) => value.toLowerCase().includes(needle));
  });
  return sortContentSummaries(filtered, query.sort ?? 'created_desc');
}

function sortContentSummaries(
  items: DashboardContentSummary[],
  sort: DashboardSort,
): DashboardContentSummary[] {
  return [...items].sort((a, b) => {
    if (sort === 'title_asc') return a.title.localeCompare(b.title);
    if (sort === 'updated_desc') return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (sort === 'created_asc') return created;
    return -created || Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}

function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
  query: DashboardStateQuery,
): DashboardList<T> {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(page, 1), pages);
  const start = (safePage - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    total: items.length,
    page: safePage,
    perPage,
    pages,
    query,
  };
}

function serializeContentSource(frontmatter: Record<string, unknown>, body: string): string {
  const separatedBody = body.startsWith('\n') ? body : `\n${body}`;
  return formatContentSource(`---\n${JSON.stringify(frontmatter)}\n---\n${separatedBody}`, {
    filePath: 'dashboard.md',
  });
}

async function buildSettingsCards({
  cwd,
  configPath,
  config,
  operations,
}: {
  cwd: string;
  configPath?: string;
  config: NectarConfig;
  operations: DashboardOperations;
}): Promise<DashboardSettingsCard[]> {
  const configSource = relativePath(cwd, resolveConfigPath(cwd, configPath));
  const themeInfo = await readThemeInfo(cwd, config);
  const missingDirs = operations.readiness.filter((item) => item.id.startsWith('dir:'));
  const deployEnabled = enabledDeployTargets(config);
  const pluginCount = config.plugins.length + (config.plugin_auto_detect ? 1 : 0);

  return [
    {
      id: 'site',
      section: 'Site',
      title: 'Site identity',
      summary: 'Core public metadata written to [site].',
      source: configSource,
      mode: 'editable',
      status: 'ok',
      values: [
        { label: 'title', value: config.site.title },
        { label: 'url', value: config.site.url },
        { label: 'locale', value: config.site.locale },
        { label: 'timezone', value: config.site.timezone },
        { label: 'accent_color', value: config.site.accent_color },
      ],
    },
    {
      id: 'content-paths',
      section: 'Content paths',
      title: 'File-backed content directories',
      summary: 'Posts, pages, authors, tags, and assets remain the source of truth.',
      source: configSource,
      mode: 'read-only',
      status: missingDirs.length > 0 ? 'warn' : 'ok',
      values: [
        {
          label: 'posts_dir',
          value: config.content.posts_dir,
          status: dirStatus(cwd, config.content.posts_dir),
        },
        {
          label: 'pages_dir',
          value: config.content.pages_dir,
          status: dirStatus(cwd, config.content.pages_dir),
        },
        {
          label: 'authors_dir',
          value: config.content.authors_dir,
          status: dirStatus(cwd, config.content.authors_dir),
        },
        {
          label: 'tags_dir',
          value: config.content.tags_dir,
          status: dirStatus(cwd, config.content.tags_dir),
        },
        {
          label: 'assets_dir',
          value: config.content.assets_dir,
          status: dirStatus(cwd, config.content.assets_dir),
        },
      ],
    },
    {
      id: 'theme',
      section: 'Theme',
      title: 'Active theme and design surface',
      summary: themeInfo.error ?? 'Theme metadata, template count, assets, and custom settings.',
      source: `${config.theme.dir}/${config.theme.name}`,
      mode: 'read-only',
      status: themeInfo.error ? 'danger' : 'ok',
      values: [
        { label: 'name', value: config.theme.name },
        { label: 'dir', value: config.theme.dir },
        { label: 'package', value: themeInfo.packageName },
        { label: 'templates', value: String(themeInfo.templates) },
        { label: 'partials', value: String(themeInfo.partials) },
        { label: 'assets', value: String(themeInfo.assets) },
        { label: 'custom settings', value: String(themeInfo.customSettings) },
      ],
      command: 'nectar theme lint',
    },
    {
      id: 'build-output',
      section: 'Build',
      title: 'Build output and URL shape',
      summary: 'Read-only build settings that affect generated files and public URLs.',
      source: configSource,
      mode: 'read-only',
      status: 'info',
      values: [
        { label: 'output_dir', value: config.build.output_dir },
        { label: 'base_path', value: config.build.base_path },
        { label: 'trailing_slash', value: config.build.trailing_slash },
        { label: 'posts_per_page', value: String(config.build.posts_per_page) },
        { label: 'copy_content_assets', value: String(config.build.copy_content_assets) },
        { label: 'include_future_posts', value: String(config.build.include_future_posts) },
      ],
      command: 'nectar build --dry-run --verbose',
    },
    {
      id: 'navigation',
      section: 'Site structure',
      title: 'Navigation',
      summary: 'Primary and secondary navigation are config-backed arrays.',
      source: configSource,
      mode: 'read-only',
      status: 'ok',
      values: [
        { label: 'primary items', value: String(config.navigation.length) },
        { label: 'secondary items', value: String(config.secondary_navigation.length) },
        {
          label: 'edit policy',
          value: 'fingerprint-gated config write; slug rename remains CLI-only',
        },
      ],
    },
    {
      id: 'redirects',
      section: 'Site structure',
      title: 'Redirects manager',
      summary:
        operations.redirects.error ?? 'Canonical redirects.yaml inventory and validation state.',
      source: operations.redirects.path ?? 'redirects.yaml',
      mode: 'cli-action',
      status: operations.redirects.error
        ? 'danger'
        : operations.redirects.duplicates.length > 0
          ? 'warn'
          : 'ok',
      values: [
        { label: 'rules', value: String(operations.redirects.rules) },
        { label: 'duplicates', value: String(operations.redirects.duplicates.length) },
        { label: 'component enabled', value: String(config.components.redirects.enabled) },
      ],
      command: 'nectar redirects validate',
    },
    {
      id: 'routes',
      section: 'Site structure',
      title: 'Routes and collections',
      summary: operations.routes.error ?? 'routes.yaml collections are read-only in the dashboard.',
      source: operations.routes.path ?? 'routes.yaml',
      mode: 'read-only',
      status: operations.routes.error ? 'danger' : 'ok',
      values: [
        { label: 'routes', value: String(operations.routes.routes) },
        { label: 'collections', value: String(operations.routes.collections) },
      ],
    },
    {
      id: 'content-health',
      section: 'Operations',
      title: 'Content health and readiness',
      summary: 'Doctor, link checks, taxonomy coverage, and stale draft signals.',
      source: 'CLI checks',
      mode: 'cli-action',
      status: operations.readiness.some((item) => item.status === 'danger')
        ? 'danger'
        : operations.readiness.some((item) => item.status === 'warn')
          ? 'warn'
          : 'ok',
      values: [
        { label: 'doctor checks', value: String(operations.doctor.length) },
        { label: 'future posts', value: String(operations.inventory.futurePosts) },
        { label: 'stale drafts', value: String(operations.inventory.staleDrafts) },
        {
          label: 'missing taxonomy files',
          value: String(operations.inventory.missingTaxonomyFiles),
        },
      ],
      command: 'nectar check --frontmatter --check-links',
    },
    {
      id: 'feeds-search-images',
      section: 'Operations',
      title: 'Generated surfaces',
      summary: 'RSS, sitemap, site search, image processing, and cache status.',
      source: configSource,
      mode: 'read-only',
      status: 'info',
      values: [
        { label: 'rss', value: String(config.components.rss.enabled) },
        { label: 'sitemap', value: String(config.components.sitemap.enabled) },
        { label: 'search engine', value: config.components.search.engine },
        { label: 'images enabled', value: String(config.components.images.enabled) },
        { label: 'cache files', value: String(operations.cache.files) },
      ],
    },
    {
      id: 'deploy',
      section: 'Operations',
      title: 'Deploy readiness',
      summary: 'Provider configuration is visible, but deploy execution stays CLI-only.',
      source: configSource,
      mode: 'dangerous-cli-only',
      status: deployEnabled.length > 0 ? 'ok' : 'info',
      values: [
        { label: 'enabled providers', value: deployEnabled.join(', ') || 'none' },
        { label: 'merge artifacts', value: String(config.deploy.merge) },
        { label: 'output', value: config.build.output_dir },
      ],
      command: 'nectar deploy <target> --dry-run',
    },
    {
      id: 'advanced-security',
      section: 'Advanced',
      title: 'Advanced and code injection',
      summary: 'Dangerous or experimental settings are grouped instead of scattered.',
      source: configSource,
      mode: 'read-only',
      status: config.build.allow_code_injection ? 'warn' : 'ok',
      values: [
        { label: 'allow_code_injection', value: String(config.build.allow_code_injection) },
        { label: 'csp_nonce', value: config.build.csp_nonce ? 'configured' : 'not set' },
        { label: 'plugin_auto_detect', value: String(config.plugin_auto_detect) },
        { label: 'plugins', value: String(pluginCount) },
      ],
    },
    {
      id: 'import-export-diagnostics',
      section: 'Advanced',
      title: 'Import, export, diagnostics',
      summary: 'Potentially destructive workflows are discoverable as CLI examples only.',
      source: 'CLI assets',
      mode: 'dangerous-cli-only',
      status: 'info',
      values: [
        { label: 'import', value: 'import-ghost / import-wordpress' },
        { label: 'export', value: 'export' },
        { label: 'diagnostics', value: 'redacted bundle via CLI' },
      ],
      command: 'nectar diagnostics bundle --dry-run',
    },
    {
      id: 'dashboard-frontend-bundle',
      section: 'Advanced',
      title: 'Dashboard frontend bundle',
      summary:
        'The dashboard stays dependency-light: generated shell, style, script, state, and view-state helpers are TypeScript modules with no extra build step.',
      source: 'src/cli/dashboard',
      mode: 'read-only',
      status: 'ok',
      values: [
        { label: 'asset strategy', value: 'inline HTML/CSS/JS generated from modules' },
        { label: 'build step', value: 'none; renderDashboardHtml() remains the contract' },
        { label: 'lint target', value: 'src/cli/dashboard included in biome/tsc checks' },
        { label: 'iconography', value: 'single toolbar/nav icon system; no external icon bundle' },
      ],
    },
    {
      id: 'dashboard-i18n-policy',
      section: 'Advanced',
      title: 'Dashboard internationalization policy',
      summary:
        'Admin copy remains English in this local CLI surface until file-backed translation catalogs exist.',
      source: 'docs/admin-dashboard.md',
      mode: 'scope-note',
      status: 'info',
      values: [
        { label: 'runtime locale', value: config.site.locale },
        {
          label: 'catalog source',
          value: 'future file-backed admin catalog, not bundled CMS data',
        },
        { label: 'fallback', value: 'English UI copy' },
        { label: 'content locale', value: 'preserved from nectar.toml/frontmatter' },
      ],
    },
    {
      id: 'dashboard-rollout-telemetry',
      section: 'Advanced',
      title: 'Feature flags and telemetry',
      summary:
        'Progressive rollout is local and explicit. Telemetry is not collected by the dashboard.',
      source: 'local settings and docs',
      mode: 'scope-note',
      status: 'ok',
      values: [
        { label: 'feature flags', value: 'local-only; config/file-backed flags when needed' },
        { label: 'remote rollout', value: 'not used' },
        { label: 'telemetry', value: 'disabled; no network analytics from Admin' },
        { label: 'privacy', value: 'file-first and local-process only' },
      ],
    },
    {
      id: 'members-policy',
      section: 'Advanced',
      title: 'Members and newsletter scope',
      summary: operations.membersPolicy.note,
      source: configSource,
      mode: 'scope-note',
      status: 'info',
      values: [
        { label: 'admin scope', value: operations.membersPolicy.adminScope },
        { label: 'subscribe provider', value: operations.membersPolicy.subscribeProvider },
        { label: 'portal provider', value: operations.membersPolicy.portalProvider },
        { label: 'tiers', value: String(config.tiers.length) },
      ],
    },
    {
      id: 'collaboration',
      section: 'Advanced',
      title: 'External editor and conflict policy',
      summary: operations.collaboration.safety,
      source: 'local filesystem',
      mode: 'cli-action',
      status: 'ok',
      values: [
        { label: 'editor command', value: operations.collaboration.editorCommand },
        { label: 'lock policy', value: operations.collaboration.lockPolicy },
        { label: 'presence', value: operations.collaboration.presencePolicy },
      ],
      command: 'nectar open <slug> --kind posts',
    },
  ];
}

async function buildDashboardOperations({
  cwd,
  configPath,
  config,
  graph,
  posts,
  pages,
  query,
  status,
}: {
  cwd: string;
  configPath?: string;
  config: NectarConfig;
  graph: ContentGraph;
  posts: DashboardContentSummary[];
  pages: DashboardContentSummary[];
  query: string;
  status: string;
}): Promise<DashboardOperations> {
  const [doctor, cache, redirects, routes] = await Promise.all([
    runChecks({ cwd, configPath, skipNetwork: true }),
    readCacheStats(resolve(cwd, '.nectar-cache')),
    readRedirectInventory(cwd),
    readRoutesInventory(cwd),
  ]);
  const inventory = contentInventory(graph);
  return {
    readiness: readinessItems({ cwd, config, graph, doctor, inventory, redirects, routes }),
    doctor,
    cliAssets: cliAssetLedger(),
    cache,
    redirects,
    routes,
    inventory,
    search: {
      query,
      status,
      fields: ['title', 'slug', 'path', 'tags', 'authors', 'status'],
      bodySearch: 'deferred',
      resultCount: posts.length + pages.length,
    },
    collaboration: {
      editorCommand: 'nectar open <slug> --kind posts',
      lockPolicy: 'No filesystem lock; saves remain fingerprint-gated.',
      presencePolicy: 'SSE file-change events mark open editors stale before save.',
      safety:
        'The dashboard never launches local apps from the browser; it exposes paths and CLI commands.',
    },
    membersPolicy: {
      adminScope: 'out-of-scope',
      subscribeProvider: config.components.subscribe.provider,
      portalProvider: config.components.portal.provider,
      note: 'Ghost-like Members, newsletters, and paid tiers are not Admin features; only static provider state is shown.',
    },
  };
}

function dirStatus(cwd: string, dir: string): DashboardCardStatus {
  return existsSync(absolutise(cwd, dir)) ? 'ok' : 'warn';
}

async function readThemeInfo(
  cwd: string,
  config: NectarConfig,
): Promise<{
  packageName: string;
  templates: number;
  partials: number;
  assets: number;
  customSettings: number;
  error?: string;
}> {
  try {
    const theme = await loadTheme({ cwd, config });
    return {
      packageName: theme.pkg.name,
      templates: Object.keys(theme.templates).length,
      partials: Object.keys(theme.partials).length,
      assets: theme.assets.size,
      customSettings: Object.keys(theme.pkg.custom).length,
    };
  } catch (err) {
    return {
      packageName: config.theme.name,
      templates: 0,
      partials: 0,
      assets: 0,
      customSettings: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function enabledDeployTargets(config: NectarConfig): string[] {
  const out: string[] = [];
  if (config.deploy.cloudflare_pages.enabled) out.push('cloudflare-pages');
  if (config.deploy.cloudflare_workers.enabled) out.push('cloudflare-workers');
  if (config.deploy.netlify.enabled) out.push('netlify');
  if (config.deploy.vercel.enabled) out.push('vercel');
  if (config.deploy.firebase.enabled) out.push('firebase');
  if (config.deploy.apache.enabled) out.push('apache');
  if (config.deploy.nginx.enabled) out.push('nginx');
  if (config.deploy.caddy.enabled) out.push('caddy');
  if (config.deploy.github_pages.redirects || config.deploy.github_pages.custom_domain) {
    out.push('github-pages');
  }
  if (config.deploy.s3.bucket) out.push('s3');
  if (config.deploy.r2.bucket) out.push('r2');
  if (config.deploy.rsync.destination) out.push('rsync');
  return out;
}

async function readCacheStats(path: string): Promise<DashboardOperations['cache']> {
  if (!existsSync(path)) return { path, exists: false, files: 0, bytes: 0 };
  const scanned = await scanFiles(path);
  return { path, exists: true, files: scanned.files, bytes: scanned.bytes };
}

async function scanFiles(path: string): Promise<{ files: number; bytes: number }> {
  const info = await stat(path);
  if (info.isFile()) return { files: 1, bytes: info.size };
  if (!info.isDirectory()) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanFiles(child);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      const childStat = await stat(child);
      files += 1;
      bytes += childStat.size;
    }
  }
  return { files, bytes };
}

async function readRedirectInventory(cwd: string): Promise<DashboardOperations['redirects']> {
  const path = existingProjectFile(cwd, ['redirects.yaml', 'redirects.yml']);
  try {
    const rules = await loadRedirects(cwd);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const rule of rules) {
      if (seen.has(rule.from)) duplicates.add(rule.from);
      seen.add(rule.from);
    }
    return { path, rules: rules.length, duplicates: [...duplicates].sort() };
  } catch (err) {
    return {
      path,
      rules: 0,
      duplicates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readRoutesInventory(cwd: string): Promise<DashboardOperations['routes']> {
  const path = existingProjectFile(cwd, ['routes.yaml', 'routes.yml']);
  try {
    const routes = await loadRoutesYaml(cwd);
    return {
      path,
      routes: resolveRouteEntries(routes).length,
      collections: resolveCollections(routes).length,
    };
  } catch (err) {
    return {
      path,
      routes: 0,
      collections: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function existingProjectFile(cwd: string, names: readonly string[]): string | null {
  for (const name of names) {
    if (existsSync(join(cwd, name))) return name;
  }
  return null;
}

function contentInventory(graph: ContentGraph): DashboardOperations['inventory'] {
  const postsByStatus = countByStatus(graph.posts);
  const pagesByStatus = countByStatus(graph.pages);
  const now = Date.now();
  const futurePosts = graph.posts.filter((post) => Date.parse(post.published_at) > now).length;
  const staleDraftCutoff = now - 90 * 24 * 60 * 60 * 1000;
  const staleDrafts = [...graph.posts, ...graph.pages].filter(
    (item) => item.status === 'draft' && Date.parse(item.updated_at) < staleDraftCutoff,
  ).length;
  const missingTaxonomyFiles =
    graph.tags.filter((tag) => !graph.sources?.tags.has(tag.id)).length +
    graph.authors.filter((author) => !graph.sources?.authors.has(author.id)).length;
  return { postsByStatus, pagesByStatus, futurePosts, staleDrafts, missingTaxonomyFiles };
}

function countByStatus(items: Array<{ status: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.status] = (out[item.status] ?? 0) + 1;
  }
  return out;
}

function readinessItems({
  cwd,
  config,
  graph,
  doctor,
  inventory,
  redirects,
  routes,
}: {
  cwd: string;
  config: NectarConfig;
  graph: ContentGraph;
  doctor: CheckResult[];
  inventory: DashboardOperations['inventory'];
  redirects: DashboardOperations['redirects'];
  routes: DashboardOperations['routes'];
}): DashboardReadinessItem[] {
  const items: DashboardReadinessItem[] = [];
  for (const [key, dir] of Object.entries({
    posts: config.content.posts_dir,
    pages: config.content.pages_dir,
    authors: config.content.authors_dir,
    tags: config.content.tags_dir,
    assets: config.content.assets_dir,
  })) {
    const exists = existsSync(absolutise(cwd, dir));
    items.push({
      id: `dir:${key}`,
      label: `${key} directory`,
      status: exists ? 'ok' : 'warn',
      detail: exists ? dir : `Missing ${dir}`,
      command: exists ? undefined : `mkdir -p ${dir}`,
    });
  }
  const failingDoctor = doctor.filter((item) => item.status === 'FAIL');
  const warningDoctor = doctor.filter((item) => item.status === 'WARN');
  items.push({
    id: 'doctor',
    label: 'Doctor checks',
    status: failingDoctor.length > 0 ? 'danger' : warningDoctor.length > 0 ? 'warn' : 'ok',
    detail: `${doctor.length} check(s), ${failingDoctor.length} failure(s), ${warningDoctor.length} warning(s)`,
    command: 'nectar doctor --no-network',
  });
  items.push({
    id: 'taxonomy-files',
    label: 'Taxonomy file coverage',
    status: inventory.missingTaxonomyFiles > 0 ? 'warn' : 'ok',
    detail:
      inventory.missingTaxonomyFiles > 0
        ? `${inventory.missingTaxonomyFiles} generated author/tag record(s) need files`
        : 'All displayed authors/tags have backing files',
  });
  items.push({
    id: 'scheduled',
    label: 'Scheduled/future content',
    status: inventory.futurePosts > 0 && !config.build.include_future_posts ? 'info' : 'ok',
    detail:
      inventory.futurePosts > 0
        ? `${inventory.futurePosts} future post(s); build.include_future_posts=${config.build.include_future_posts}`
        : 'No future-dated posts loaded',
  });
  items.push({
    id: 'stale-drafts',
    label: 'Draft aging',
    status: inventory.staleDrafts > 0 ? 'warn' : 'ok',
    detail: `${inventory.staleDrafts} draft(s) older than 90 days`,
  });
  items.push({
    id: 'redirects',
    label: 'Redirect rules',
    status: redirects.error ? 'danger' : redirects.duplicates.length > 0 ? 'warn' : 'ok',
    detail:
      redirects.error ??
      `${redirects.rules} rule(s), ${redirects.duplicates.length} duplicate source(s)`,
    command: 'nectar redirects validate',
  });
  items.push({
    id: 'routes',
    label: 'Routes and collections',
    status: routes.error ? 'danger' : 'ok',
    detail: routes.error ?? `${routes.routes} route(s), ${routes.collections} collection(s)`,
  });
  items.push({
    id: 'feeds',
    label: 'RSS and sitemap',
    status: config.components.rss.enabled && config.components.sitemap.enabled ? 'ok' : 'info',
    detail: `rss=${config.components.rss.enabled}, sitemap=${config.components.sitemap.enabled}`,
  });
  items.push({
    id: 'search',
    label: 'Site search index',
    status: config.components.search.enabled ? 'ok' : 'info',
    detail: `engine=${config.components.search.engine}; Admin search is separate metadata search`,
  });
  items.push({
    id: 'link-checker',
    label: 'Link checker',
    status: 'info',
    detail:
      'Internal/frontmatter checks can be surfaced immediately; external probes stay explicit.',
    command: 'nectar check --check-links',
  });
  items.push({
    id: 'preview-output',
    label: 'HTML output preview',
    status: existsSync(join(cwd, config.build.output_dir)) ? 'ok' : 'warn',
    detail: existsSync(join(cwd, config.build.output_dir))
      ? `Build artifacts found in ${config.build.output_dir}`
      : `Run nectar build before opening saved-output previews for ${graph.posts.length + graph.pages.length} content item(s)`,
    command: 'nectar build',
  });
  return items;
}

function cliAssetLedger(): DashboardCliAsset[] {
  return [
    {
      command: 'build',
      adminSurface: 'Build readiness and saved-output preview',
      exposure: 'read-only',
      note: 'Show output_dir, base_path, recent artifacts, and dry-run command examples.',
    },
    {
      command: 'check / doctor',
      adminSurface: 'Content health',
      exposure: 'read-only',
      note: 'Use existing CLI checks as the authority; avoid reimplementing validators in UI.',
    },
    {
      command: 'redirects',
      adminSurface: 'Redirects manager',
      exposure: 'safe-action',
      note: 'Validate/list rules; editing remains fingerprint-gated YAML work.',
    },
    {
      command: 'cache',
      adminSurface: 'Cache manager',
      exposure: 'safe-action',
      note: 'Stats are read-only; clean requires confirmation and can remain CLI-only initially.',
    },
    {
      command: 'deploy',
      adminSurface: 'Deploy readiness',
      exposure: 'dangerous-cli-only',
      note: 'Never deploy from the browser in the first pass; expose --dry-run examples.',
    },
    {
      command: 'import-ghost / import-wordpress / export',
      adminSurface: 'Import/export',
      exposure: 'dangerous-cli-only',
      note: 'Discovery and command examples only; file picker/upload is a separate design.',
    },
    {
      command: 'diagnostics',
      adminSurface: 'Diagnostics bundle',
      exposure: 'dangerous-cli-only',
      note: 'Bundle creation needs redaction and destination confirmation.',
    },
    {
      command: 'open',
      adminSurface: 'External editor handoff',
      exposure: 'safe-action',
      note: 'Expose copyable commands/paths, not automatic local app launch from the browser.',
    },
    {
      command: 'plugins / theme / schema',
      adminSurface: 'Advanced settings',
      exposure: 'read-only',
      note: 'Schema and plugin state inform cards; installation and arbitrary code stay out of Admin.',
    },
  ];
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

async function isEditableRealPath(
  cwd: string,
  config: NectarConfig,
  kind: EditableKind,
  filePath: string,
): Promise<boolean> {
  try {
    const [projectRoot, root, target] = await Promise.all([
      realpath(cwd),
      realpath(editableDir(cwd, config, kind)),
      realpath(filePath),
    ]);
    return isInsidePath(projectRoot, root) && isInsidePath(root, target);
  } catch {
    return false;
  }
}

async function isEditableRootInsideProject(
  cwd: string,
  config: NectarConfig,
  kind: EditableKind,
): Promise<boolean> {
  try {
    const [projectRoot, root] = await Promise.all([
      realpath(cwd),
      realpath(editableDir(cwd, config, kind)),
    ]);
    return isInsidePath(projectRoot, root);
  } catch {
    return false;
  }
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
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
  const updates = new Map<string, string>();
  for (const key of SITE_SETTINGS_FIELDS) {
    const value = payload[key];
    if (typeof value === 'string') updates.set(key, value);
  }
  if (updates.size === 0) return;
  const raw = existsSync(target) ? await readFile(target, 'utf8') : '';
  await writeFile(target, updateTomlSection(raw, 'site', updates), 'utf8');
}

function findInvalidSettingsFields(payload: Record<string, unknown>): string[] {
  const allowed = new Set(SITE_SETTINGS_FIELDS);
  return Object.keys(payload).filter((key) => !allowed.has(key));
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

function stringParam(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  const value = raw?.trim();
  return value ? value : undefined;
}

function stateKindParam(url: URL): DashboardContentKind | undefined {
  const value = stringParam(url, 'kind');
  if (value === 'posts' || value === 'pages') return value;
  return undefined;
}

function sortParam(url: URL): DashboardSort | undefined {
  const value = stringParam(url, 'sort');
  if (
    value === 'created_desc' ||
    value === 'created_asc' ||
    value === 'updated_desc' ||
    value === 'title_asc'
  ) {
    return value;
  }
  return undefined;
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

function createDashboardToken(): string {
  return randomBytes(24).toString('base64url');
}

function isLanExposedHost(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
}

async function readGitStatus(cwd: string): Promise<DashboardGitStatus> {
  const inside = await gitOutput(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside?.trim() !== 'true') return { isRepo: false, dirty: false, changedFiles: 0 };
  const [branch, dirty, lastCommit] = await Promise.all([
    gitOutput(cwd, ['branch', '--show-current']),
    gitOutput(cwd, ['status', '--porcelain']),
    gitOutput(cwd, ['rev-parse', '--short', 'HEAD']),
  ]);
  const changedFiles = dirty ? dirty.split('\n').filter(Boolean).length : 0;
  return {
    isRepo: true,
    branch: branch?.trim() || undefined,
    dirty: changedFiles > 0,
    changedFiles,
    lastCommit: lastCommit?.trim() || undefined,
  };
}

async function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore' });
  const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return exitCode === 0 ? output : undefined;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    },
  });
}

function defaultSyncSnapshot(values: Partial<DashboardSyncSnapshot> = {}): DashboardSyncSnapshot {
  const now = new Date().toISOString();
  return {
    status:
      values.status ?? (values.lastEvent?.reason === 'file-change' ? 'changed-on-disk' : 'synced'),
    watchedPaths: values.watchedPaths ?? [],
    watchWarnings: values.watchWarnings ?? [],
    warnings: values.warnings ?? [],
    lastEvent: values.lastEvent,
    activity: values.activity ?? [],
    loadStartedAt: values.loadStartedAt ?? now,
    loadFinishedAt: values.loadFinishedAt ?? now,
  };
}

async function readJsonPayload<T>(
  request: Request,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<T | Response> {
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) > maxBodyBytes) {
    return jsonResponse({ error: `request body exceeds ${maxBodyBytes} bytes` }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    return jsonResponse({ error: `request body exceeds ${maxBodyBytes} bytes` }, 413);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400);
  }
}

function validateWriteRequest(
  request: Request,
  security: DashboardSecurityContext | undefined,
): Response | undefined {
  if (security === undefined) return undefined;
  const token = request.headers.get('x-nectar-dashboard-token');
  if (token !== security.token) return jsonResponse({ error: 'dashboard token is required' }, 403);
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== security.origin) {
    return jsonResponse({ error: 'cross-origin dashboard write rejected' }, 403);
  }
  const referer = request.headers.get('referer');
  if (origin === null && referer !== null) {
    try {
      if (new URL(referer).origin !== security.origin) {
        return jsonResponse({ error: 'cross-origin dashboard write rejected' }, 403);
      }
    } catch {
      return jsonResponse({ error: 'invalid referer' }, 403);
    }
  }
  return undefined;
}

interface ChangeBusEventInput {
  reason: string;
  kind?: EditableKind | 'settings' | 'project';
  changedPath?: string;
}

export interface ChangeBus {
  broadcast(event: ChangeBusEventInput | string): void;
  snapshot(watch?: DashboardWatchMetadata): DashboardSyncSnapshot;
  stream(): Response;
}

export function createChangeBus(options: { debounceMs?: number } = {}): ChangeBus {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const activity: DashboardSyncEvent[] = [];
  let lastEvent: DashboardSyncEvent | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ChangeBusEventInput | undefined;
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const emit = (input: ChangeBusEventInput): void => {
    const event: DashboardSyncEvent = { ...input, at: new Date().toISOString() };
    lastEvent = event;
    activity.unshift(event);
    if (activity.length > ACTIVITY_LIMIT) activity.length = ACTIVITY_LIMIT;
    const payload = encoder.encode(`event: sync\ndata: ${JSON.stringify(event)}\n\n`);
    for (const client of clients) {
      try {
        client.enqueue(payload);
      } catch {
        clients.delete(client);
      }
    }
  };
  return {
    broadcast(event: ChangeBusEventInput | string) {
      const input = typeof event === 'string' ? { reason: event } : event;
      if (input.reason === 'file-change') {
        pending = input;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          if (pending) emit(pending);
          pending = undefined;
        }, debounceMs);
        return;
      }
      emit(input);
    },
    snapshot(watch?: DashboardWatchMetadata) {
      return defaultSyncSnapshot({
        watchedPaths: watch?.watchedPaths ?? [],
        watchWarnings: watch?.warnings ?? [],
        warnings: watch?.warnings ?? [],
        lastEvent,
        activity: [...activity],
      });
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
}): Promise<DashboardWatchMetadata & { watchers: FSWatcher[] }> {
  const config = await loadConfig({ cwd, configPath });
  const paths = [
    resolveConfigPath(cwd, configPath),
    absolutise(cwd, config.content.posts_dir),
    absolutise(cwd, config.content.pages_dir),
    absolutise(cwd, config.content.authors_dir),
    absolutise(cwd, config.content.tags_dir),
  ];
  const watchers: FSWatcher[] = [];
  const watchedPaths: string[] = [];
  const warnings: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      watchers.push(
        fsWatch(path, { recursive: true }, (_event, filename) => {
          changeBus.broadcast({
            reason: 'file-change',
            changedPath:
              filename === null || filename === undefined
                ? relativePath(cwd, path)
                : relativePath(cwd, join(path, String(filename))),
          });
        }),
      );
      watchedPaths.push(relativePath(cwd, path));
    } catch (err) {
      const warning = `Dashboard could not watch ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      warnings.push(warning);
      logger.warn(warning);
    }
  }
  return { watchers, watchedPaths, warnings };
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

export function renderDashboardHtml(token = ''): string {
  return renderDashboardShellHtml(token);
}
