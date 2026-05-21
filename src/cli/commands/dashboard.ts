import { randomBytes } from 'node:crypto';
import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import slugify from 'slugify';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { asString, parseFrontmatter } from '~/content/frontmatter.ts';
import { loadContent } from '~/content/loader.ts';
import { renderMarkdown } from '~/content/markdown.ts';
import type {
  Author,
  ContentGraph,
  ContentSourceFingerprint,
  Page,
  Post,
  Tag,
} from '~/content/model.ts';
import { createCleanupRegistry } from '~/util/cleanup.ts';
import { logger } from '~/util/logger.ts';
import { absolutise, resolveContentSlugPath } from '../content-paths.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DASHBOARD_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4322;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 100;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const ACTIVITY_LIMIT = 50;
const WATCH_DEBOUNCE_MS = 100;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SITE_SETTINGS_FIELDS = ['title', 'description', 'url', 'locale', 'timezone', 'accent_color'];
const NEWSLETTER_FRONTMATTER_KEYS = new Set([
  'email_subject',
  'email_card_segments',
  'send_email_when_published',
]);

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
  routePreview: string;
  excerpt: string;
  featureImage: string;
  visibility: string;
  authors: string[];
  tags: string[];
  words: number;
  readingTime: number;
  reviewState: 'ready' | 'needs-review';
}

export interface DashboardTaxonomySummary {
  slug: string;
  name: string;
  count: number;
  path: string;
  url: string;
  editable: boolean;
  missing: boolean;
  generated: boolean;
  orphaned: boolean;
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
    };
    outputDir: string;
    theme: string;
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
  workbench: DashboardWorkbench;
  preview: DashboardPreviewContract;
  generatedAt: string;
}

export interface DashboardContentItem {
  kind: EditableKind;
  slug: string;
  path: string;
  fingerprint: ContentSourceFingerprint;
  frontmatter: Record<string, unknown>;
  frontmatterSections: DashboardFrontmatterSection[];
  frontmatterFields: DashboardFrontmatterField[];
  preview: DashboardEditorPreview;
  seoPreview: DashboardSeoPreview;
  socialPreview: DashboardSocialPreview;
  reviewChecklist: DashboardReviewCheck[];
  outOfScopeFrontmatter: string[];
  editorMetrics: {
    words: number;
    readingTime: number;
    tkMarkers: number;
  };
  body: string;
}

interface DashboardWorkbench {
  customViews: { id: string; label: string; filter: string }[];
  bulkActions: { id: string; label: string; scope: string }[];
  contentTemplates: {
    id: string;
    label: string;
    kind: EditableKind;
    frontmatter: Record<string, unknown>;
    body: string;
  }[];
}

interface DashboardPreviewContract {
  activeTheme: string;
  source: 'saved-file';
  contract: string;
  buildArtifactRoot: string;
  devices: { id: string; label: string; width: number }[];
}

interface DashboardFrontmatterSection {
  id: string;
  label: string;
}

interface DashboardFrontmatterField {
  key: string;
  label: string;
  section: string;
  input: 'text' | 'textarea' | 'select' | 'checkbox' | 'list';
  value: unknown;
  options?: string[];
}

interface DashboardEditorPreview {
  source: 'saved-file';
  theme: string;
  routeUrl: string;
  buildArtifactPath: string;
  unsavedMarkdown: 'editor-only';
  note: string;
}

interface DashboardSeoPreview {
  title: string;
  description: string;
  canonicalUrl: string;
}

interface DashboardSocialPreview {
  title: string;
  description: string;
  image: string;
}

interface DashboardReviewCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
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
    workbench: dashboardWorkbench(),
    preview: dashboardPreviewContract(config),
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
  const graph = await loadContent({
    cwd,
    config,
    includeDrafts: true,
    includeFuturePosts: true,
  });
  const loaded = findLoadedEditable(graph, kind, slug);
  const routeUrl = toAbsoluteRouteUrl(config, loaded?.url ?? fallbackRouteUrl(config, kind, slug));
  const rendered = await renderMarkdown(parsed.body, { locale: graph.site.locale });
  const normalizedTitle =
    asString(parsed.data.title) ?? asString(parsed.data.name) ?? loadedTitle(loaded) ?? slug;
  const description =
    asString(parsed.data.meta_description) ??
    asString(parsed.data.og_description) ??
    asString(parsed.data.twitter_description) ??
    asString(parsed.data.custom_excerpt) ??
    asString(parsed.data.excerpt) ??
    loadedExcerpt(loaded) ??
    plainTextSnippet(rendered.plaintext);
  const featureImage =
    asString(parsed.data.og_image) ??
    asString(parsed.data.twitter_image) ??
    asString(parsed.data.feature_image) ??
    loadedFeatureImage(loaded) ??
    '';
  const tkMarkers = countTkMarkers(parsed.body);
  return {
    kind,
    slug,
    path: relativePath(cwd, filePath),
    fingerprint: await fingerprintFor(cwd, filePath),
    frontmatter: parsed.data,
    frontmatterSections: frontmatterSectionsFor(kind),
    frontmatterFields: frontmatterFieldsFor(kind, parsed.data),
    preview: {
      source: 'saved-file',
      theme: config.theme.name,
      routeUrl,
      buildArtifactPath: buildArtifactPath(cwd, config, routeUrl),
      unsavedMarkdown: 'editor-only',
      note: 'Theme preview opens the latest saved Markdown file; split preview renders the unsaved editor draft only.',
    },
    seoPreview: {
      title: asString(parsed.data.meta_title) ?? normalizedTitle,
      description,
      canonicalUrl: asString(parsed.data.canonical_url) ?? routeUrl,
    },
    socialPreview: {
      title:
        asString(parsed.data.og_title) ??
        asString(parsed.data.twitter_title) ??
        asString(parsed.data.meta_title) ??
        normalizedTitle,
      description,
      image: featureImage,
    },
    reviewChecklist: reviewChecklistFor({
      body: parsed.body,
      frontmatter: parsed.data,
      title: normalizedTitle,
      description,
      featureImage,
      tkMarkers,
    }),
    outOfScopeFrontmatter: Object.keys(parsed.data).filter((key) =>
      NEWSLETTER_FRONTMATTER_KEYS.has(key),
    ),
    editorMetrics: {
      words: rendered.word_count,
      readingTime: rendered.reading_time,
      tkMarkers,
    },
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
  const yamlText = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd();
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  await writeFile(filePath, `---\n${yamlText}\n---\n\n${normalizedBody}`, 'utf8');
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
          search: stringParam(url, 'search'),
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

export async function createDashboardContentItem({
  cwd,
  config,
  payload,
}: {
  cwd: string;
  config: NectarConfig;
  payload: {
    kind?: EditableKind;
    title?: string;
    slug?: string;
    cloneFrom?: { kind?: EditableKind; slug?: string };
    template?: 'blank' | 'post' | 'page';
  };
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
  const cloned = await cloneSourceContent({ cwd, config, cloneFrom: payload.cloneFrom });
  const frontmatter =
    cloned?.frontmatter ??
    (kind === 'authors'
      ? { slug, name: title }
      : kind === 'tags'
        ? { slug, name: title }
        : { title, slug, date: now, created_at: now, updated_at: now, status: 'draft' });
  if (kind === 'authors' || kind === 'tags') {
    frontmatter.slug = slug;
    frontmatter.name = title;
  } else {
    frontmatter.title = title;
    frontmatter.slug = slug;
    frontmatter.updated_at = now;
    frontmatter.status ??= 'draft';
  }
  const yamlText = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd();
  await writeFile(filePath, `---\n${yamlText}\n---\n\n${cloned?.body ?? ''}`, 'utf8');
  return { ok: true, kind, slug, path: relativePath(cwd, filePath) };
}

async function cloneSourceContent({
  cwd,
  config,
  cloneFrom,
}: {
  cwd: string;
  config: NectarConfig;
  cloneFrom?: { kind?: EditableKind; slug?: string };
}): Promise<{ frontmatter: Record<string, unknown>; body: string } | undefined> {
  const cloneKind = parseEditableKind(cloneFrom?.kind ?? '');
  const cloneSlug = cloneFrom?.slug ?? '';
  if (cloneKind === undefined || !SLUG_RE.test(cloneSlug)) return undefined;
  const source = await readDashboardContentItem({ cwd, config, kind: cloneKind, slug: cloneSlug });
  return { frontmatter: { ...source.frontmatter }, body: source.body };
}

function dashboardWorkbench(): DashboardWorkbench {
  return {
    customViews: [
      { id: 'all', label: 'All', filter: 'all content files' },
      { id: 'drafts', label: 'Drafts', filter: 'status:draft' },
      { id: 'scheduled', label: 'Scheduled', filter: 'status:scheduled' },
      { id: 'needs-review', label: 'Needs review', filter: 'missing excerpt, image alt, or TK' },
      { id: 'members', label: 'Members', filter: 'visibility:members|paid|tiers|filter' },
    ],
    bulkActions: [
      { id: 'set-draft', label: 'Set draft', scope: 'posts/pages' },
      { id: 'set-published', label: 'Set published', scope: 'posts/pages' },
      { id: 'duplicate', label: 'Duplicate', scope: 'single saved file' },
      { id: 'trash-note', label: 'Trash planned', scope: 'design placeholder; no file delete yet' },
    ],
    contentTemplates: [
      {
        id: 'post',
        label: 'Post draft',
        kind: 'posts',
        frontmatter: { status: 'draft', visibility: 'public' },
        body: '',
      },
      {
        id: 'page',
        label: 'Page draft',
        kind: 'pages',
        frontmatter: { status: 'draft' },
        body: '',
      },
    ],
  };
}

function dashboardPreviewContract(config: NectarConfig): DashboardPreviewContract {
  return {
    activeTheme: config.theme.name,
    source: 'saved-file',
    contract:
      'Theme preview opens the latest saved Markdown file; unsaved editor text only appears in split preview.',
    buildArtifactRoot: config.build.output_dir,
    devices: [
      { id: 'mobile', label: 'Mobile', width: 390 },
      { id: 'tablet', label: 'Tablet', width: 768 },
      { id: 'desktop', label: 'Desktop', width: 1180 },
    ],
  };
}

function findLoadedEditable(
  graph: ContentGraph,
  kind: EditableKind,
  slug: string,
): Post | Page | Author | Tag | undefined {
  return kind === 'posts'
    ? graph.bySlug.posts.get(slug)
    : kind === 'pages'
      ? graph.bySlug.pages.get(slug)
      : kind === 'authors'
        ? graph.bySlug.authors.get(slug)
        : graph.bySlug.tags.get(slug);
}

function loadedTitle(item: Post | Page | Author | Tag | undefined): string | undefined {
  if (!item) return undefined;
  return 'title' in item ? item.title : item.name;
}

function loadedExcerpt(item: Post | Page | Author | Tag | undefined): string | undefined {
  if (!item) return undefined;
  if ('custom_excerpt' in item) return item.custom_excerpt ?? item.excerpt;
  if ('description' in item) return item.description;
  return 'bio' in item ? item.bio : undefined;
}

function loadedFeatureImage(item: Post | Page | Author | Tag | undefined): string | undefined {
  if (!item) return undefined;
  if ('feature_image' in item) return item.feature_image;
  return 'profile_image' in item ? item.profile_image : undefined;
}

function fallbackRouteUrl(config: NectarConfig, kind: EditableKind, slug: string): string {
  const site = config.site.url.replace(/\/$/, '');
  if (kind === 'pages') return `${site}/${slug}/`;
  if (kind === 'authors') return `${site}/author/${slug}/`;
  if (kind === 'tags') return `${site}/tag/${slug}/`;
  return `${site}/${slug}/`;
}

function buildArtifactPath(cwd: string, config: NectarConfig, routeUrl: string): string {
  const route = new URL(toAbsoluteRouteUrl(config, routeUrl)).pathname
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
  const segments = route ? route.split('/') : [];
  return relativePath(
    cwd,
    join(absolutise(cwd, config.build.output_dir), ...segments, 'index.html'),
  );
}

function toAbsoluteRouteUrl(config: NectarConfig, routeUrl: string): string {
  if (/^https?:\/\//i.test(routeUrl)) return routeUrl;
  return `${config.site.url.replace(/\/$/, '')}/${routeUrl.replace(/^\/+/, '')}`;
}

function frontmatterSectionsFor(kind: EditableKind): DashboardFrontmatterSection[] {
  if (kind === 'authors' || kind === 'tags') {
    return [
      { id: 'identity', label: 'Identity' },
      { id: 'media', label: 'Media' },
      { id: 'seo-social', label: 'SEO / Social' },
    ];
  }
  return [
    { id: 'identity', label: 'Identity' },
    { id: 'publishing', label: 'Publishing' },
    { id: 'media', label: 'Media' },
    { id: 'seo-social', label: 'SEO / Social' },
    { id: 'access', label: 'Access' },
  ];
}

function frontmatterFieldsFor(
  kind: EditableKind,
  frontmatter: Record<string, unknown>,
): DashboardFrontmatterField[] {
  const fields: DashboardFrontmatterField[] = [
    field('slug', 'Slug', 'identity', 'text', frontmatter.slug),
  ];
  if (kind === 'authors' || kind === 'tags') {
    fields.unshift(field('name', 'Name', 'identity', 'text', frontmatter.name));
    fields.push(
      field('description', 'Description', 'identity', 'textarea', frontmatter.description),
    );
    fields.push(field('feature_image', 'Image', 'media', 'text', frontmatter.feature_image));
    fields.push(field('meta_title', 'SEO title', 'seo-social', 'text', frontmatter.meta_title));
    fields.push(
      field(
        'meta_description',
        'SEO description',
        'seo-social',
        'textarea',
        frontmatter.meta_description,
      ),
    );
    return fields.filter((item) => !NEWSLETTER_FRONTMATTER_KEYS.has(item.key));
  }
  fields.unshift(field('title', 'Title', 'identity', 'text', frontmatter.title));
  fields.push(
    field('status', 'Status', 'publishing', 'select', frontmatter.status ?? 'published', [
      'published',
      'draft',
      'scheduled',
    ]),
  );
  fields.push(
    field(
      'published_at',
      'Published',
      'publishing',
      'text',
      frontmatter.published_at ?? frontmatter.date,
    ),
  );
  fields.push(field('tags', 'Tags', 'identity', 'list', frontmatter.tags));
  fields.push(
    field('authors', 'Authors', 'identity', 'list', frontmatter.authors ?? frontmatter.author),
  );
  fields.push(field('feature_image', 'Feature image', 'media', 'text', frontmatter.feature_image));
  fields.push(
    field('feature_image_alt', 'Image alt', 'media', 'text', frontmatter.feature_image_alt),
  );
  fields.push(
    field(
      'custom_excerpt',
      'Excerpt',
      'seo-social',
      'textarea',
      frontmatter.custom_excerpt ?? frontmatter.excerpt,
    ),
  );
  fields.push(field('meta_title', 'SEO title', 'seo-social', 'text', frontmatter.meta_title));
  fields.push(
    field(
      'meta_description',
      'SEO description',
      'seo-social',
      'textarea',
      frontmatter.meta_description,
    ),
  );
  fields.push(field('og_title', 'Social title', 'seo-social', 'text', frontmatter.og_title));
  fields.push(
    field(
      'og_description',
      'Social description',
      'seo-social',
      'textarea',
      frontmatter.og_description,
    ),
  );
  fields.push(field('og_image', 'Social image', 'seo-social', 'text', frontmatter.og_image));
  fields.push(
    field('visibility', 'Visibility', 'access', 'select', frontmatter.visibility ?? 'public', [
      'public',
      'members',
      'paid',
      'tiers',
      'filter',
    ]),
  );
  fields.push(field('tiers', 'Tiers', 'access', 'list', frontmatter.tiers));
  return fields.filter((item) => !NEWSLETTER_FRONTMATTER_KEYS.has(item.key));
}

function field(
  key: string,
  label: string,
  section: string,
  input: DashboardFrontmatterField['input'],
  value: unknown,
  options?: string[],
): DashboardFrontmatterField {
  return { key, label, section, input, value, ...(options ? { options } : {}) };
}

function reviewChecklistFor({
  body,
  frontmatter,
  title,
  description,
  featureImage,
  tkMarkers,
}: {
  body: string;
  frontmatter: Record<string, unknown>;
  title: string;
  description: string;
  featureImage: string;
  tkMarkers: number;
}): DashboardReviewCheck[] {
  return [
    {
      id: 'title',
      label: 'Title',
      ok: title.trim().length > 0,
      detail: title.trim().length > 0 ? 'Set' : 'Missing title',
    },
    {
      id: 'excerpt',
      label: 'Excerpt',
      ok: description.trim().length >= 40,
      detail: description.trim().length >= 40 ? 'Ready' : 'Add a short summary',
    },
    {
      id: 'feature-image-alt',
      label: 'Image alt',
      ok: !featureImage || Boolean(asString(frontmatter.feature_image_alt)),
      detail:
        !featureImage || Boolean(asString(frontmatter.feature_image_alt))
          ? 'Ready'
          : 'Add alt text',
    },
    {
      id: 'tk-markers',
      label: 'TK markers',
      ok: tkMarkers === 0,
      detail: tkMarkers === 0 ? 'None' : `${tkMarkers} marker(s)`,
    },
    {
      id: 'body',
      label: 'Body',
      ok: body.trim().length > 0,
      detail: body.trim().length > 0 ? 'Draft has body text' : 'Empty body',
    },
  ];
}

function postNeedsReview({
  title,
  excerpt,
  featureImage,
  body,
}: {
  title: string;
  excerpt: string;
  featureImage: string;
  body: string;
}): boolean {
  return (
    !title || excerpt.length < 40 || (featureImage.length > 0 && !body) || countTkMarkers(body) > 0
  );
}

function plainTextSnippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function countTkMarkers(value: string): number {
  return (value.match(/\bTK\b/gi) ?? []).length;
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
    routePreview: toAbsoluteRouteUrl(config, post.url),
    excerpt: post.custom_excerpt ?? post.excerpt,
    featureImage: post.feature_image ?? '',
    visibility: post.visibility,
    authors: post.authors.map((author) => author.name),
    tags: post.tags.map((tag) => tag.name),
    words: post.word_count,
    readingTime: post.reading_time,
    reviewState: postNeedsReview({
      title: post.title,
      excerpt: post.custom_excerpt ?? post.excerpt,
      featureImage: post.feature_image ?? '',
      body: post.html,
    })
      ? 'needs-review'
      : 'ready',
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
    routePreview: toAbsoluteRouteUrl(config, page.url),
    excerpt: page.custom_excerpt ?? page.excerpt,
    featureImage: page.feature_image ?? '',
    visibility: page.visibility,
    authors: page.authors.map((author) => author.name),
    tags: page.tags.map((tag) => tag.name),
    words: page.word_count,
    readingTime: page.reading_time,
    reviewState: postNeedsReview({
      title: page.title,
      excerpt: page.custom_excerpt ?? page.excerpt,
      featureImage: page.feature_image ?? '',
      body: page.html,
    })
      ? 'needs-review'
      : 'ready',
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
  const editable = source !== undefined;
  return {
    slug: item.slug,
    name: item.name,
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
    return [item.slug, item.title, item.path, item.url, ...item.authors, ...item.tags].some(
      (value) => value.toLowerCase().includes(needle),
    );
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

function renderDashboardHtml(token: string): string {
  const escapedToken = JSON.stringify(token);
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nectar Dashboard</title>
<style>
:root{color-scheme:light;--paper:#f5f7f1;--ink:#20231f;--muted:#66706a;--line:#d6ddd3;--field:#fbfcf8;--green:#2f6f63;--rust:#b5532a;--blue:#305c7a;--gold:#c99b42;--shadow:0 18px 45px rgba(24,34,31,.12)}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#eef3ef 0%,#f8faf4 54%,#e4ece7 100%);background-attachment:fixed;color:var(--ink);font:14px/1.5 Avenir Next,Segoe UI,Helvetica Neue,sans-serif;letter-spacing:0}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(32,35,31,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(32,35,31,.028) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.08))}
button,input,textarea,select{font:inherit}button{cursor:pointer;border:0}.shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
.side{border-right:1px solid #111b17;padding:24px 18px;background:linear-gradient(180deg,#18221f,#22231f 58%,#111713);color:#f8fbf2;position:sticky;top:0;height:100vh}.brand{font-family:Georgia,serif;font-size:30px;line-height:1;margin-bottom:6px}.tagline{color:#afc1b8;font-size:12px;margin-bottom:30px}
.nav{display:grid;gap:6px}.nav button{width:100%;text-align:left;padding:11px 12px;border-radius:8px;background:transparent;color:#d9e2da}.nav button.active{background:#f8fbf2;color:#18221f;box-shadow:inset 3px 0 0 var(--gold)}.sync{position:absolute;bottom:18px;left:18px;right:18px;color:#afc1b8;font-size:12px}
.main{padding:26px;min-width:0}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px}.kicker{font-size:12px;color:var(--green);font-weight:800;text-transform:uppercase;letter-spacing:.08em}.title{font-family:Georgia,serif;font-size:42px;line-height:1.05;margin:3px 0}.sub{color:var(--muted);max-width:760px}
.actions,.toolbar,.views,.pager,.rowActions,.deviceBar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.btn{border-radius:8px;padding:10px 13px;background:var(--ink);color:#fff;box-shadow:0 7px 18px rgba(32,35,31,.13);white-space:nowrap}.btn.secondary,.views button{background:var(--field);color:var(--ink);border:1px solid var(--line);box-shadow:none}.btn:disabled{opacity:.46;cursor:not-allowed}.views button.active{background:#24332e;color:#fff}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.stat{background:rgba(251,252,248,.86);border:1px solid var(--line);border-radius:8px;padding:14px;box-shadow:var(--shadow)}.stat b{font-size:30px;font-family:Georgia,serif;display:block}.stat span{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:800}
.panel{background:rgba(251,252,248,.9);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);overflow:hidden;backdrop-filter:blur(10px)}.panelHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}.panelHead h2{margin:0;font-size:15px}.tableWrap{overflow:auto}.table{width:100%;border-collapse:collapse;min-width:820px}.table th,.table td{padding:12px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.table th{font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em}.table tr:hover td{background:#f2f7ee}.slug{font-family:Menlo,Consolas,monospace;font-size:12px;color:var(--blue)}.pill{display:inline-flex;border-radius:99px;background:#e5ead2;color:#334321;padding:3px 8px;font-size:12px}.pill.draft,.pill.needs-review{background:#f2ded6;color:#7b351c}.meta{color:var(--muted);font-size:12px}.excerpt{max-width:340px;color:#4d5b54}.pager{padding:14px 16px}
.editor{position:fixed;inset:0;background:#fbfcf8;display:none;grid-template-rows:auto 1fr auto;z-index:5}.editor.open{display:grid}.editorGrid{display:grid;grid-template-columns:minmax(240px,320px) minmax(360px,1fr) minmax(320px,460px);min-height:0}.editorCol{border-right:1px solid var(--line);padding:16px;overflow:auto;min-width:0}.editorCol:last-child{border-right:0}.editor textarea{width:100%;height:calc(100vh - 250px);min-height:360px;resize:vertical;border:1px solid var(--line);border-radius:8px;background:white;padding:14px;font-family:Menlo,Consolas,monospace;font-size:13px}.settingsGrid,.frontmatterGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}.frontmatterGrid{grid-template-columns:1fr;padding:0}.field{display:grid;gap:5px;margin-bottom:10px}.field span{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:800}.field input,.field select,.field textarea{border:1px solid var(--line);border-radius:8px;padding:10px;background:white;min-width:0}.field.wide{grid-column:1/-1}.sectionTitle{font-size:12px;font-weight:800;color:#27352f;margin:16px 0 8px;text-transform:uppercase}.notice{color:var(--rust);font-size:13px;min-height:20px}.previewFrame{border:1px solid var(--line);border-radius:8px;background:white;padding:18px;margin:10px auto;max-width:100%;min-height:190px}.previewFrame h1,.previewFrame h2{font-family:Georgia,serif}.previewBox{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px;margin-bottom:10px}.editorFooter{display:flex;justify-content:space-between;gap:12px;align-items:center;border-top:1px solid var(--line);padding:12px 16px}
@media (max-width:1100px){.editorGrid{grid-template-columns:1fr}.editorCol{border-right:0;border-bottom:1px solid var(--line)}.editor textarea{height:42vh}.table{min-width:720px}}
@media (max-width:860px){.shell{grid-template-columns:1fr}.side{position:static;height:auto}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.top{display:block}.main{padding:18px}.title{font-size:34px}}
</style>
</head>
<body>
<div class="shell">
  <aside class="side"><div class="brand">Nectar</div><div class="tagline">file-backed editorial dashboard</div><nav class="nav"><button data-view="posts" class="active">Posts</button><button data-view="pages">Pages</button><button data-view="authors">Authors</button><button data-view="tags">Tags</button><button data-view="settings">Settings</button></nav><div class="sync" id="sync">syncing from disk</div></aside>
  <main class="main"><div class="top"><div><div class="kicker" id="kicker">Local workspace</div><h1 class="title" id="siteTitle">Nectar Dashboard</h1><div class="sub" id="siteSub">Reading content files directly from this repository.</div></div><div class="actions"><button class="btn secondary" id="refresh">Refresh</button><button class="btn" id="newItem">New</button></div></div><section class="stats"><div class="stat"><b id="postCount">0</b><span>posts</span></div><div class="stat"><b id="pageCount">0</b><span>pages</span></div><div class="stat"><b id="authorCount">0</b><span>authors</span></div><div class="stat"><b id="tagCount">0</b><span>tags</span></div></section><section class="panel" id="content"></section></main>
</div>
<aside class="editor" id="editor"><div class="panelHead"><h2 id="editorTitle">Editor</h2><button class="btn secondary" id="closeEditor">Close</button></div><div class="editorGrid"><section class="editorCol"><div id="frontmatterPanel"></div></section><section class="editorCol"><div class="meta" id="editorMetrics"></div><textarea id="editBody"></textarea></section><section class="editorCol"><div id="previewPanel"></div></section></div><div class="editorFooter"><div class="notice" id="notice"></div><div class="actions"><button class="btn secondary" id="duplicateEditor">Duplicate</button><button class="btn" id="saveEditor">Save to file</button></div></div></aside>
<script>
const DASHBOARD_TOKEN=${escapedToken};
const WRITE_HEADERS={'content-type':'application/json','x-nectar-dashboard-token':DASHBOARD_TOKEN};
let state=null, view='posts', postsPage=1, pagesPage=1, current=null, activeWorkbenchView='all', activeDevice='desktop';
const $=(id)=>document.getElementById(id);
async function load(){ $('sync').textContent='reading files...'; const r=await fetch('/api/state?posts_page='+postsPage+'&pages_page='+pagesPage+'&per_page=12'); state=await r.json(); render(); $('sync').textContent='synced '+new Date(state.generatedAt).toLocaleTimeString(); }
function render(){ $('siteTitle').textContent=state.site.title; $('siteSub').textContent=state.site.description || state.site.url; $('postCount').textContent=state.posts.total; $('pageCount').textContent=state.pages.total; $('authorCount').textContent=state.authors.total; $('tagCount').textContent=state.tags.total; document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); if(view==='settings') return renderSettings(); if(view==='authors'||view==='tags') return renderTax(view); renderContent(view); }
function renderContent(kind){ const list=state[kind]; const items=list.items.filter(matchesWorkbenchView); $('kicker').textContent=kind+' / saved files'; $('newItem').style.display='inline-block'; $('content').innerHTML='<div class="panelHead"><div><h2>'+kind+'</h2><div class="meta">'+escapeHtml(state.preview.contract)+'</div></div><span class="meta">page '+list.page+' of '+list.pages+'</span></div><div class="toolbar" style="padding:12px 16px;border-bottom:1px solid var(--line)"><div class="views">'+state.workbench.customViews.map(v=>'<button class="btn secondary '+(activeWorkbenchView===v.id?'active':'')+'" data-workbench="'+v.id+'">'+escapeHtml(v.label)+'</button>').join('')+'</div><select id="bulkAction">'+state.workbench.bulkActions.map(a=>'<option value="'+escapeAttr(a.id)+'">'+escapeHtml(a.label)+'</option>').join('')+'</select></div><div class="tableWrap"><table class="table"><thead><tr><th>Title</th><th>Status</th><th>Preview</th><th>Excerpt</th><th>Path</th><th></th></tr></thead><tbody>'+items.map(item=>'<tr><td><b>'+escapeHtml(item.title)+'</b><div class="slug">'+escapeHtml(item.slug)+'</div><div class="meta">'+item.words+' words / '+item.readingTime+' min</div></td><td><span class="pill '+(item.status==='draft'?'draft':'')+'">'+escapeHtml(item.status)+'</span> <span class="pill '+(item.reviewState==='needs-review'?'needs-review':'')+'">'+escapeHtml(item.reviewState)+'</span></td><td><a class="slug" href="'+escapeAttr(item.routePreview)+'" target="_blank" rel="noreferrer">saved route</a><div class="meta">'+escapeHtml(item.visibility)+'</div></td><td class="excerpt">'+escapeHtml(item.excerpt||'No excerpt yet')+'</td><td class="meta">'+escapeHtml(item.path)+'</td><td><button class="btn secondary" data-edit="'+escapeAttr(item.slug)+'">Edit</button></td></tr>').join('')+'</tbody></table></div><div class="pager"><button class="btn secondary" id="prev" '+(list.page<=1?'disabled':'')+'>Prev</button><button class="btn secondary" id="next" '+(list.page>=list.pages?'disabled':'')+'>Next</button></div>'; document.querySelectorAll('[data-workbench]').forEach(b=>b.onclick=()=>{activeWorkbenchView=b.dataset.workbench;renderContent(kind);}); $('prev').onclick=()=>{ if(list.page<=1)return; if(kind==='posts') postsPage--; else pagesPage--; load(); }; $('next').onclick=()=>{ if(list.page>=list.pages)return; if(kind==='posts') postsPage++; else pagesPage++; load(); }; document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(kind,b.dataset.edit)); }
function matchesWorkbenchView(item){ if(activeWorkbenchView==='drafts')return item.status==='draft'; if(activeWorkbenchView==='scheduled')return item.status==='scheduled'; if(activeWorkbenchView==='needs-review')return item.reviewState==='needs-review'; if(activeWorkbenchView==='members')return item.visibility&&item.visibility!=='public'; return true; }
function renderTax(kind){ const list=state[kind]; $('kicker').textContent=kind+' · taxonomy files'; $('newItem').style.display='inline-block'; $('content').innerHTML='<div class="panelHead"><h2>'+kind+'</h2><span class="meta">'+list.total+' files</span></div><table class="table"><thead><tr><th>Name</th><th>Posts</th><th>Path</th><th>URL</th><th></th></tr></thead><tbody>'+list.items.map(item=>'<tr><td><b>'+escapeHtml(item.name)+'</b><div class="slug">'+item.slug+'</div></td><td>'+item.count+'</td><td class="meta">'+escapeHtml(item.path||'generated from content references')+'</td><td class="meta">'+escapeHtml(item.url)+'</td><td>'+(item.editable?'<button class="btn secondary" data-edit="'+item.slug+'">Edit</button>':'<button class="btn secondary" disabled>Missing file</button>')+'</td></tr>').join('')+'</tbody></table>'; document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(kind,b.dataset.edit)); }
function renderSettings(){ $('kicker').textContent='settings · nectar.toml'; $('newItem').style.display='none'; const s=state.settings; $('content').innerHTML='<div class="panelHead"><h2>Project settings</h2><span class="meta">'+escapeHtml(s.configPath)+'</span></div><div class="settingsGrid"><label class="field"><span>Site title</span><input id="setTitle" value="'+escapeAttr(state.site.title)+'"></label><label class="field"><span>Accent color</span><input id="setAccent" value="'+escapeAttr(state.site.accentColor)+'"></label><label class="field wide"><span>Description</span><input id="setDescription" value="'+escapeAttr(state.site.description)+'"></label><label class="field wide"><span>Site URL</span><input id="setUrl" value="'+escapeAttr(state.site.url)+'"></label><label class="field"><span>Theme</span><input value="'+escapeAttr(s.theme)+'" disabled></label><label class="field"><span>Output</span><input value="'+escapeAttr(s.outputDir)+'" disabled></label><label class="field"><span>Posts dir</span><input value="'+escapeAttr(s.contentDirs.posts)+'" disabled></label><label class="field"><span>Pages dir</span><input value="'+escapeAttr(s.contentDirs.pages)+'" disabled></label><div class="field wide"><span id="settingsNotice" class="notice"></span><button class="btn" id="saveSettings">Save settings</button></div></div>'; $('saveSettings').onclick=saveSettings; }
async function openEditor(kind,slug){ const r=await fetch('/api/content/'+kind+'/'+slug); current=await r.json(); $('editorTitle').textContent=current.path; $('editBody').value=current.body; $('notice').textContent=''; renderEditorPanels(); $('editor').classList.add('open'); }
function renderEditorPanels(){ if(!current)return; const sections=current.frontmatterSections||[]; $('frontmatterPanel').innerHTML=sections.map(section=>'<div class="sectionTitle">'+escapeHtml(section.label)+'</div>'+(current.frontmatterFields||[]).filter(f=>f.section===section.id).map(fieldControl).join('')).join('')+(current.outOfScopeFrontmatter.length?'<div class="notice">Newsletter/email frontmatter is preserved but not edited here: '+escapeHtml(current.outOfScopeFrontmatter.join(', '))+'</div>':''); $('editorMetrics').textContent=current.editorMetrics.words+' words / '+current.editorMetrics.readingTime+' min / TK '+current.editorMetrics.tkMarkers; renderPreviewPanel(); document.querySelectorAll('[data-fm]').forEach(el=>el.oninput=()=>{syncPreviewModels();renderPreviewPanel();}); $('editBody').oninput=()=>{syncPreviewModels();renderPreviewPanel();}; }
function fieldControl(f){ const v=f.input==='list'?listValue(f.value):String(f.value??''); if(f.input==='textarea')return '<label class="field"><span>'+escapeHtml(f.label)+'</span><textarea rows="3" data-fm="'+escapeAttr(f.key)+'">'+escapeHtml(v)+'</textarea></label>'; if(f.input==='select')return '<label class="field"><span>'+escapeHtml(f.label)+'</span><select data-fm="'+escapeAttr(f.key)+'">'+(f.options||[]).map(o=>'<option '+(o===v?'selected':'')+'>'+escapeHtml(o)+'</option>').join('')+'</select></label>'; if(f.input==='checkbox')return '<label class="field"><span>'+escapeHtml(f.label)+'</span><input type="checkbox" data-fm="'+escapeAttr(f.key)+'" '+(f.value?'checked':'')+'></label>'; return '<label class="field"><span>'+escapeHtml(f.label)+'</span><input data-fm="'+escapeAttr(f.key)+'" value="'+escapeAttr(v)+'"></label>'; }
function renderPreviewPanel(){ if(!current)return; const device=(state.preview.devices||[]).find(d=>d.id===activeDevice)||{width:1180,label:'Desktop'}; $('previewPanel').innerHTML='<div class="previewBox"><b>Saved theme preview</b><div class="meta">'+escapeHtml(current.preview.note)+'</div><p><a class="slug" href="'+escapeAttr(current.preview.routeUrl)+'" target="_blank" rel="noreferrer">'+escapeHtml(current.preview.routeUrl)+'</a></p><div class="meta">Artifact: '+escapeHtml(current.preview.buildArtifactPath)+'</div></div><div class="deviceBar">'+state.preview.devices.map(d=>'<button class="btn secondary '+(activeDevice===d.id?'active':'')+'" data-device="'+d.id+'">'+escapeHtml(d.label)+'</button>').join('')+'</div><div class="previewFrame" style="max-width:'+device.width+'px">'+markdownToHtml($('editBody').value)+'</div><div class="previewBox"><b>SEO</b><div class="slug">'+escapeHtml(current.seoPreview.title)+'</div><div class="meta">'+escapeHtml(current.seoPreview.canonicalUrl)+'</div><p>'+escapeHtml(current.seoPreview.description)+'</p></div><div class="previewBox"><b>Social</b><div>'+escapeHtml(current.socialPreview.title)+'</div><div class="meta">'+escapeHtml(current.socialPreview.description)+'</div><div class="slug">'+escapeHtml(current.socialPreview.image||'No image')+'</div></div><div class="previewBox"><b>Review</b>'+current.reviewChecklist.map(c=>'<div class="meta">'+(c.ok?'OK':'Needs work')+' / '+escapeHtml(c.label)+' / '+escapeHtml(c.detail)+'</div>').join('')+'</div>'; document.querySelectorAll('[data-device]').forEach(b=>b.onclick=()=>{activeDevice=b.dataset.device;renderPreviewPanel();}); }
function syncPreviewModels(){ if(!current)return; const fm=collectFrontmatter(); const title=fm.meta_title||fm.title||fm.name||current.seoPreview.title; const desc=fm.meta_description||fm.custom_excerpt||fm.excerpt||current.seoPreview.description; const socialTitle=fm.og_title||fm.twitter_title||title; current.seoPreview={...current.seoPreview,title:String(title||''),description:String(desc||'')}; current.socialPreview={...current.socialPreview,title:String(socialTitle||''),description:String(fm.og_description||fm.twitter_description||desc||''),image:String(fm.og_image||fm.twitter_image||fm.feature_image||'')}; }
function collectFrontmatter(){ const fm={...current.frontmatter}; document.querySelectorAll('[data-fm]').forEach(el=>{ const key=el.dataset.fm; const field=(current.frontmatterFields||[]).find(f=>f.key===key); let value=el.type==='checkbox'?el.checked:el.value; if(field&&field.input==='list')value=String(value).split(',').map(s=>s.trim()).filter(Boolean); if(value===''||(Array.isArray(value)&&value.length===0))delete fm[key]; else fm[key]=value; }); return fm; }
async function saveEditor(){ if(!current)return; const fm=collectFrontmatter(); if(current.kind==='posts'||current.kind==='pages')fm.updated_at=new Date().toISOString(); const r=await fetch('/api/content/'+current.kind+'/'+current.slug,{method:'PUT',headers:WRITE_HEADERS,body:JSON.stringify({fingerprint:current.fingerprint,frontmatter:fm,body:$('editBody').value})}); const data=await r.json(); if(r.status===409){ current=data.current; $('notice').textContent='This file changed on disk. Reloaded latest saved file; review before saving.'; $('editBody').value=current.body; renderEditorPanels(); return; } if(!r.ok){ $('notice').textContent=data.error||'Could not save file'; return; } current=null; $('editor').classList.remove('open'); await load(); }
async function duplicateCurrent(){ if(!current)return; const title=prompt('Title for duplicate', String((current.frontmatter.title||current.frontmatter.name||current.slug)+' copy')); if(!title)return; const slug=prompt('Slug for duplicate', slugifyClient(title)); if(!slug)return; const r=await fetch('/api/content',{method:'POST',headers:WRITE_HEADERS,body:JSON.stringify({kind:current.kind,title,slug,cloneFrom:{kind:current.kind,slug:current.slug}})}); if(!r.ok){ alert((await r.json()).error||'Could not duplicate file'); return; } current=null; $('editor').classList.remove('open'); await load(); }
async function saveSettings(){ const updates={title:$('setTitle').value,description:$('setDescription').value,url:$('setUrl').value,accent_color:$('setAccent').value}; const r=await fetch('/api/settings/site',{method:'PATCH',headers:WRITE_HEADERS,body:JSON.stringify({fingerprint:state.settings.fingerprint,updates})}); const data=await r.json(); if(r.status===409){ $('settingsNotice').textContent='nectar.toml changed on disk. Reloaded latest settings; review before saving.'; await load(); return; } if(!r.ok){ $('settingsNotice').textContent=data.error||'Could not save settings'; return; } await load(); if($('settingsNotice')) $('settingsNotice').textContent='Saved to nectar.toml'; }
async function createItem(){ const title=prompt('Title or name'); if(!title)return; const kind=view==='settings'?'posts':view; const r=await fetch('/api/content',{method:'POST',headers:WRITE_HEADERS,body:JSON.stringify({kind,title})}); if(!r.ok){ alert((await r.json()).error||'Could not create file'); return; } await load(); }
function markdownToHtml(md){ return '<div>'+escapeHtml(md).replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>').replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>').replace(/\\n\\n+/g,'</p><p>').replace(/^/,'<p>').replace(/$/,'</p>')+'</div>'; }
function listValue(v){ return Array.isArray(v)?v.join(', '):String(v??''); } function slugifyClient(v){ return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'untitled'; }
function date(v){ return new Date(v).toLocaleDateString(); } function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); } function escapeAttr(v){ return escapeHtml(v).replace(/"/g,'&quot;'); }
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{view=b.dataset.view;activeWorkbenchView='all';load();}); $('refresh').onclick=load; $('newItem').onclick=createItem; $('closeEditor').onclick=()=>$('editor').classList.remove('open'); $('saveEditor').onclick=saveEditor; $('duplicateEditor').onclick=duplicateCurrent;
new EventSource('/api/events').addEventListener('sync',()=>load()); load();
</script>
</body>
</html>`;
}
