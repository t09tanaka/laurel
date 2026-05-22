import { randomBytes } from 'node:crypto';
import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import slugify from 'slugify';
import { resolveOutputDir } from '~/build/output-dir.ts';
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
import { renameAuthor } from './authors.ts';
import { rewriteFrontmatterSlug } from './content.ts';
import { type CheckResult, runChecks } from './doctor.ts';
import { renameTag } from './tags.ts';

const DEFAULT_PORT = 4322;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 100;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const ACTIVITY_LIMIT = 50;
const WATCH_DEBOUNCE_MS = 100;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SITE_SETTINGS_FIELDS = ['title', 'description', 'url', 'locale', 'timezone', 'accent_color'];
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const DASHBOARD_PREVIEW_SANDBOX_POLICY: DashboardPreviewSandboxPolicy = {
  mode: 'iframe-sandbox',
  attributes: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox'],
  allowScripts: true,
  allowSameOrigin: false,
  note: 'Build artifact previews run in a sandboxed iframe without allow-same-origin, so theme scripts cannot read or operate the dashboard document.',
};

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
  featureImage: DashboardAssetReference;
  internalLink: DashboardInternalLink;
  renamePreview: DashboardSlugRenamePreview;
  preview: DashboardPreviewArtifact;
}

export type DashboardPreviewState = 'current' | 'stale' | 'missing' | 'build-required';

export interface DashboardPreviewSandboxPolicy {
  mode: 'iframe-sandbox';
  attributes: string[];
  allowScripts: boolean;
  allowSameOrigin: false;
  note: string;
}

export interface DashboardPreviewArtifact {
  state: DashboardPreviewState;
  label: string;
  route: string;
  openUrl: string;
  artifactPath: string | null;
  artifactMtimeMs: number | null;
  contentFingerprint: ContentSourceFingerprint | null;
  detail: string;
  sandbox: DashboardPreviewSandboxPolicy;
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
  assets: DashboardAssetInventory;
  bulkActions: DashboardBulkActionDescriptor[];
  trash: DashboardTrashInventory;
  contentTemplates: DashboardContentTemplate[];
  internalLinks: DashboardInternalLink[];
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

export interface DashboardAssetReference {
  value: string;
  kind: 'none' | 'remote' | 'data' | 'asset' | 'project' | 'external';
  exists: boolean | null;
  path: string | null;
  publicPath: string | null;
  markdown: string | null;
  warning: string | null;
}

export interface DashboardAssetInventory {
  dir: string;
  exists: boolean;
  files: number;
  images: number;
  bytes: number;
  featureImages: {
    referenced: number;
    missing: number;
  };
  markdownInsertPrefix: string;
}

export interface DashboardBulkActionDescriptor {
  id: DashboardBulkAction;
  label: string;
  danger: boolean;
  requiresConfirmation: boolean;
}

type DashboardBulkAction = 'set-status' | 'add-tag' | 'remove-tag' | 'touch-updated-at';

export interface DashboardBulkTarget {
  kind: DashboardContentKind;
  slug: string;
  fingerprint: ContentSourceFingerprint;
}

export type DashboardBulkResult =
  | {
      ok: true;
      changed: Array<{ kind: DashboardContentKind; slug: string; path: string }>;
      skipped: Array<{ kind: DashboardContentKind; slug: string; reason: string }>;
    }
  | { ok: false; reason: 'invalid-action' | 'invalid-payload' };

export interface DashboardTrashEntry {
  id: string;
  slug: string;
  kind: DashboardContentKind | null;
  originalPath: string;
  trashPath: string;
  metadataPath: string;
  trashedAt: string;
  purgeAfter: string;
  restoreBlocked: boolean;
}

export interface DashboardTrashInventory {
  path: string;
  exists: boolean;
  entries: DashboardTrashEntry[];
}

export interface DashboardContentTemplate {
  id: string;
  name: string;
  kind: DashboardContentKind | 'any';
  source: 'builtin' | 'project';
  description: string;
}

export interface DashboardInternalLink {
  kind: DashboardContentKind;
  slug: string;
  title: string;
  url: string;
  path: string;
  markdown: string;
}

export interface DashboardSlugRenamePreview {
  currentSlug: string;
  currentUrl: string;
  redirectFrom: string;
  redirectTo: string;
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
    freshness: Record<DashboardPreviewState, number>;
    previewSandbox: DashboardPreviewSandboxPolicy;
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
  assets: {
    featureImage: DashboardAssetReference;
    markdownImages: DashboardAssetReference[];
  };
  internalLinks: DashboardInternalLink[];
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

export type DashboardSlugRenameResult =
  | {
      ok: true;
      kind: EditableKind;
      oldSlug: string;
      newSlug: string;
      oldPath: string;
      newPath: string;
      redirectAppended: string | null;
      redirectSuggestion: DashboardSlugRenamePreview;
    }
  | {
      ok: false;
      reason:
        | 'conflict'
        | 'not-found'
        | 'already-exists'
        | 'invalid-kind'
        | 'invalid-slug'
        | 'forbidden';
      current?: DashboardContentItem;
      changedPath?: string;
    };

export type DashboardTrashResult =
  | {
      ok: true;
      entry: DashboardTrashEntry;
    }
  | {
      ok: false;
      reason: 'conflict' | 'not-found' | 'already-exists' | 'invalid-kind' | 'forbidden';
      current?: DashboardContentItem;
    };

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
    graph.posts.map((post) => postSummary(cwd, post, graph, config)),
    'posts',
    query,
  );
  const pages = applyContentQuery(
    graph.pages.map((item) => pageSummary(cwd, item, graph, config)),
    'pages',
    query,
  );
  const paginatedPosts = await withPreviewArtifacts(
    cwd,
    config,
    paginate(posts, postPage, safePerPage, query),
  );
  const paginatedPages = await withPreviewArtifacts(
    cwd,
    config,
    paginate(pages, pagePage, safePerPage, query),
  );
  const previewFreshness = countPreviewFreshness([
    ...paginatedPosts.items,
    ...paginatedPages.items,
  ]);
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
    posts: paginatedPosts,
    pages: paginatedPages,
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
      routeCount: previewFreshness.current + previewFreshness.stale,
      warnings: [],
      freshness: previewFreshness,
      previewSandbox: DASHBOARD_PREVIEW_SANDBOX_POLICY,
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
  const path = relativePath(cwd, filePath);
  return {
    kind,
    slug,
    path,
    fingerprint: await fingerprintFor(cwd, filePath),
    frontmatter: parsed.data,
    body: parsed.body,
    assets: {
      featureImage: assetReference(cwd, config, stringValue(parsed.data.feature_image)),
      markdownImages: markdownImageReferences(cwd, config, parsed.body),
    },
    internalLinks:
      kind === 'posts' || kind === 'pages' ? await listDashboardInternalLinks({ cwd, config }) : [],
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
    if (request.method === 'GET' && url.pathname === '/preview/artifact') {
      const route = stringParam(url, 'route') ?? '/';
      return serveDashboardPreviewArtifact({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        route,
      });
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
    const contentRenameMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/([^/]+)\/rename$/);
    if (request.method === 'POST' && contentRenameMatch) {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const kind = parseEditableKind(contentRenameMatch[1] ?? '');
      const slug = decodeURIComponent(contentRenameMatch[2] ?? '');
      if (kind === undefined || !SLUG_RE.test(slug)) {
        return jsonResponse({ error: 'invalid content path' }, 400);
      }
      const payload = await readJsonPayload<{
        fingerprint?: ContentSourceFingerprint;
        newSlug?: string;
        redirect?: boolean;
      }>(request, ctx.maxBodyBytes);
      if (payload instanceof Response) return payload;
      if (!payload.fingerprint || typeof payload.newSlug !== 'string') {
        return jsonResponse({ error: 'fingerprint and newSlug are required' }, 400);
      }
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const result = await renameDashboardContentSlug({
        cwd: ctx.cwd,
        config,
        kind,
        oldSlug: slug,
        newSlug: payload.newSlug,
        expectedFingerprint: payload.fingerprint,
        redirect: payload.redirect === true,
      });
      if (!result.ok && result.reason === 'conflict') return jsonResponse(result, 409);
      if (!result.ok && result.reason === 'already-exists') return jsonResponse(result, 409);
      if (!result.ok && result.reason === 'forbidden') return jsonResponse(result, 403);
      if (!result.ok && (result.reason === 'invalid-kind' || result.reason === 'invalid-slug')) {
        return jsonResponse(result, 400);
      }
      if (!result.ok) return jsonResponse(result, 404);
      ctx.changeBus.broadcast({
        reason: 'content-rename',
        kind,
        changedPath: result.newPath,
      });
      return jsonResponse(result);
    }
    const contentTrashMatch = url.pathname.match(/^\/api\/content\/(posts|pages)\/([^/]+)\/trash$/);
    if (request.method === 'POST' && contentTrashMatch) {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const kind = contentTrashMatch[1] as DashboardContentKind;
      const slug = decodeURIComponent(contentTrashMatch[2] ?? '');
      if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'invalid content path' }, 400);
      const payload = await readJsonPayload<{ fingerprint?: ContentSourceFingerprint }>(
        request,
        ctx.maxBodyBytes,
      );
      if (payload instanceof Response) return payload;
      if (!payload.fingerprint) return jsonResponse({ error: 'fingerprint is required' }, 400);
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const result = await trashDashboardContentItem({
        cwd: ctx.cwd,
        config,
        kind,
        slug,
        expectedFingerprint: payload.fingerprint,
        now: new Date(),
      });
      if (!result.ok && result.reason === 'conflict') return jsonResponse(result, 409);
      if (!result.ok && result.reason === 'forbidden') return jsonResponse(result, 403);
      if (!result.ok) return jsonResponse(result, 404);
      ctx.changeBus.broadcast({
        reason: 'content-trash',
        kind,
        changedPath: result.entry.originalPath,
      });
      return jsonResponse(result);
    }
    if (request.method === 'POST' && url.pathname === '/api/content/bulk') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const payload = await readJsonPayload<{
        action?: DashboardBulkAction;
        targets?: DashboardBulkTarget[];
        value?: string;
      }>(request, ctx.maxBodyBytes);
      if (payload instanceof Response) return payload;
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const result = await applyDashboardBulkAction({
        cwd: ctx.cwd,
        config,
        action: payload.action,
        targets: payload.targets,
        value: payload.value,
      });
      if (!result.ok) return jsonResponse(result, 400);
      ctx.changeBus.broadcast({ reason: 'content-bulk', kind: 'project' });
      return jsonResponse(result);
    }
    if (request.method === 'GET' && url.pathname === '/api/settings/site') {
      return jsonResponse(
        await readDashboardSettings({ cwd: ctx.cwd, configPath: ctx.configPath }),
      );
    }
    if (request.method === 'GET' && url.pathname === '/api/trash') {
      return jsonResponse(await listDashboardTrash({ cwd: ctx.cwd }));
    }
    const trashRestoreMatch = url.pathname.match(/^\/api\/trash\/([^/]+)\/restore$/);
    if (request.method === 'POST' && trashRestoreMatch) {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const result = await restoreDashboardTrashEntry({
        cwd: ctx.cwd,
        id: decodeURIComponent(trashRestoreMatch[1] ?? ''),
      });
      if (!result.ok && result.reason === 'already-exists') return jsonResponse(result, 409);
      if (!result.ok && result.reason === 'forbidden') return jsonResponse(result, 403);
      if (!result.ok) return jsonResponse(result, 404);
      ctx.changeBus.broadcast({
        reason: 'content-restore',
        kind: result.entry.kind ?? 'project',
        changedPath: result.entry.originalPath,
      });
      return jsonResponse(result);
    }
    if (request.method === 'GET' && url.pathname === '/api/internal-links') {
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const links = await listDashboardInternalLinks({ cwd: ctx.cwd, config });
      const query = stringParam(url, 'q')?.toLowerCase();
      return jsonResponse(
        query
          ? links.filter((link) =>
              [link.title, link.slug, link.url, link.path].some((value) =>
                value.toLowerCase().includes(query),
              ),
            )
          : links,
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
        template?: string;
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
  payload: { kind?: EditableKind; title?: string; slug?: string; template?: string };
}): Promise<{ ok: true; kind: EditableKind; slug: string; path: string }> {
  const kind = parseEditableKind(payload.kind ?? '');
  if (kind === undefined) throw new Error('invalid kind');
  if (kind === 'authors' || kind === 'tags') {
    if (payload.template && payload.template !== 'default') {
      throw new Error('templates are only available for posts and pages');
    }
  }
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
  const scaffold = await scaffoldDashboardContent({
    cwd,
    kind,
    title,
    slug,
    now,
    template: payload.template,
  });
  await writeFile(filePath, scaffold, 'utf8');
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

export async function applyDashboardBulkAction({
  cwd,
  config,
  action,
  targets,
  value,
}: {
  cwd: string;
  config: NectarConfig;
  action?: DashboardBulkAction;
  targets?: DashboardBulkTarget[];
  value?: string;
}): Promise<DashboardBulkResult> {
  if (
    action !== 'set-status' &&
    action !== 'add-tag' &&
    action !== 'remove-tag' &&
    action !== 'touch-updated-at'
  ) {
    return { ok: false, reason: 'invalid-action' };
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, reason: 'invalid-payload' };
  }
  const changed: Array<{ kind: DashboardContentKind; slug: string; path: string }> = [];
  const skipped: Array<{ kind: DashboardContentKind; slug: string; reason: string }> = [];
  const now = new Date().toISOString();
  for (const target of targets) {
    if (!isDashboardContentKind(target.kind) || !SLUG_RE.test(target.slug) || !target.fingerprint) {
      skipped.push({
        kind: isDashboardContentKind(target.kind) ? target.kind : 'posts',
        slug: target.slug ?? '',
        reason: 'invalid-target',
      });
      continue;
    }
    const current = await readDashboardContentItem({
      cwd,
      config,
      kind: target.kind,
      slug: target.slug,
    }).catch(() => undefined);
    if (!current) {
      skipped.push({ kind: target.kind, slug: target.slug, reason: 'not-found' });
      continue;
    }
    if (!sameFingerprint(current.fingerprint, target.fingerprint)) {
      skipped.push({ kind: target.kind, slug: target.slug, reason: 'conflict' });
      continue;
    }
    const frontmatter = { ...current.frontmatter };
    if (action === 'set-status') {
      const status = value?.trim();
      if (status !== 'published' && status !== 'draft' && status !== 'scheduled') {
        skipped.push({ kind: target.kind, slug: target.slug, reason: 'invalid-status' });
        continue;
      }
      frontmatter.status = status;
      frontmatter.updated_at = now;
    } else if (action === 'touch-updated-at') {
      frontmatter.updated_at = value?.trim() || now;
    } else {
      const tag = slugify(value ?? '', { lower: true, strict: true });
      if (!SLUG_RE.test(tag)) {
        skipped.push({ kind: target.kind, slug: target.slug, reason: 'invalid-tag' });
        continue;
      }
      const tags = stringArrayValue(frontmatter.tags);
      frontmatter.tags =
        action === 'add-tag'
          ? [...new Set([...tags, tag])]
          : tags.filter((existing) => existing !== tag);
      frontmatter.updated_at = now;
    }
    const result = await writeDashboardContentItem({
      cwd,
      config,
      kind: target.kind,
      slug: target.slug,
      expectedFingerprint: current.fingerprint,
      frontmatter,
      body: current.body,
    });
    if (result.ok) changed.push({ kind: target.kind, slug: target.slug, path: result.changedPath });
    else skipped.push({ kind: target.kind, slug: target.slug, reason: result.reason });
  }
  return { ok: true, changed, skipped };
}

export async function renameDashboardContentSlug({
  cwd,
  config,
  kind,
  oldSlug,
  newSlug,
  expectedFingerprint,
  redirect,
}: {
  cwd: string;
  config: NectarConfig;
  kind: EditableKind;
  oldSlug: string;
  newSlug: string;
  expectedFingerprint: ContentSourceFingerprint;
  redirect?: boolean;
}): Promise<DashboardSlugRenameResult> {
  const normalizedNewSlug = newSlug.trim();
  if (!SLUG_RE.test(oldSlug) || !SLUG_RE.test(normalizedNewSlug)) {
    return { ok: false, reason: 'invalid-slug' };
  }
  if (oldSlug === normalizedNewSlug) return { ok: false, reason: 'invalid-slug' };
  const current = await readDashboardContentItem({ cwd, config, kind, slug: oldSlug }).catch(
    () => undefined,
  );
  if (!current) return { ok: false, reason: 'not-found' };
  if (!sameFingerprint(current.fingerprint, expectedFingerprint)) {
    return { ok: false, reason: 'conflict', current, changedPath: current.path };
  }
  if (!(await isEditableRootInsideProject(cwd, config, kind))) {
    return { ok: false, reason: 'forbidden', changedPath: current.path };
  }

  if (kind === 'authors') {
    const dest = join(editableDir(cwd, config, kind), `${normalizedNewSlug}.md`);
    if (existsSync(dest))
      return { ok: false, reason: 'already-exists', changedPath: relativePath(cwd, dest) };
    await renameAuthor({
      cwd,
      postsDir: config.content.posts_dir,
      pagesDir: config.content.pages_dir,
      authorsDir: config.content.authors_dir,
      oldSlug,
      newSlug: normalizedNewSlug,
      dryRun: false,
    });
    return slugRenameSuccess(
      cwd,
      config,
      kind,
      oldSlug,
      normalizedNewSlug,
      current.path,
      dest,
      null,
    );
  }
  if (kind === 'tags') {
    const dest = join(editableDir(cwd, config, kind), `${normalizedNewSlug}.md`);
    if (existsSync(dest))
      return { ok: false, reason: 'already-exists', changedPath: relativePath(cwd, dest) };
    await renameTag({
      cwd,
      postsDir: config.content.posts_dir,
      pagesDir: config.content.pages_dir,
      tagsDir: config.content.tags_dir,
      oldSlug,
      newSlug: normalizedNewSlug,
      dryRun: false,
    });
    return slugRenameSuccess(
      cwd,
      config,
      kind,
      oldSlug,
      normalizedNewSlug,
      current.path,
      dest,
      null,
    );
  }

  const source = await resolveEditablePath(cwd, config, kind, oldSlug);
  if (source === undefined) return { ok: false, reason: 'not-found' };
  if (!(await isEditableRealPath(cwd, config, kind, source))) {
    return { ok: false, reason: 'forbidden', changedPath: relativePath(cwd, source) };
  }
  const dest = join(editableDir(cwd, config, kind), `${normalizedNewSlug}.md`);
  if (existsSync(dest))
    return { ok: false, reason: 'already-exists', changedPath: relativePath(cwd, dest) };
  const raw = await readFile(source, 'utf8');
  await writeFile(dest, rewriteFrontmatterSlug(raw, normalizedNewSlug), 'utf8');
  await unlink(source);
  const preview = renamePreviewFor(
    config,
    oldSlug,
    normalizedNewSlug,
    current.internalLinks[0]?.url,
  );
  const redirectAppended = redirect
    ? await appendDashboardRedirect(cwd, preview.redirectFrom, preview.redirectTo)
    : null;
  return {
    ok: true,
    kind,
    oldSlug,
    newSlug: normalizedNewSlug,
    oldPath: current.path,
    newPath: relativePath(cwd, dest),
    redirectAppended,
    redirectSuggestion: preview,
  };
}

export async function trashDashboardContentItem({
  cwd,
  config,
  kind,
  slug,
  expectedFingerprint,
  now,
}: {
  cwd: string;
  config: NectarConfig;
  kind: DashboardContentKind;
  slug: string;
  expectedFingerprint: ContentSourceFingerprint;
  now: Date;
}): Promise<DashboardTrashResult> {
  const current = await readDashboardContentItem({ cwd, config, kind, slug }).catch(
    () => undefined,
  );
  if (!current) return { ok: false, reason: 'not-found' };
  if (!sameFingerprint(current.fingerprint, expectedFingerprint)) {
    return { ok: false, reason: 'conflict', current };
  }
  const source = await resolveEditablePath(cwd, config, kind, slug);
  if (source === undefined) return { ok: false, reason: 'not-found' };
  if (!(await isEditableRealPath(cwd, config, kind, source)))
    return { ok: false, reason: 'forbidden' };

  const trashedAt = now.toISOString();
  const purgeAfter = new Date(now.getTime() + TRASH_RETENTION_MS).toISOString();
  const trashDir = resolveDashboardTrashDir(cwd, now);
  const trashPath = join(trashDir, `${slug}.md`);
  const metadataPath = join(trashDir, `${slug}.meta.json`);
  await mkdir(trashDir, { recursive: true });
  await rename(source, trashPath);
  const metadata = {
    slug,
    kind,
    original_path: current.path,
    trash_path: relativePath(cwd, trashPath),
    trashed_at: trashedAt,
    purge_after: purgeAfter,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  const entry = trashEntryFromMetadata(cwd, metadataPath, metadata);
  if (!entry) return { ok: false, reason: 'forbidden' };
  return { ok: true, entry };
}

export async function listDashboardTrash({
  cwd,
}: {
  cwd: string;
}): Promise<DashboardTrashInventory> {
  const root = join(cwd, '.nectar', 'trash');
  if (!existsSync(root)) return { path: '.nectar/trash', exists: false, entries: [] };
  const entries: DashboardTrashEntry[] = [];
  for (const dirent of await readdir(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = join(root, dirent.name);
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.meta.json')) continue;
      try {
        const metadataPath = join(dir, file);
        const parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>;
        const entry = trashEntryFromMetadata(cwd, metadataPath, parsed);
        if (entry) entries.push(entry);
      } catch {
        // Ignore malformed trash metadata; `nectar content delete --purge` remains the repair path.
      }
    }
  }
  entries.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  return { path: '.nectar/trash', exists: true, entries };
}

export async function restoreDashboardTrashEntry({
  cwd,
  id,
}: {
  cwd: string;
  id: string;
}): Promise<DashboardTrashResult> {
  const inventory = await listDashboardTrash({ cwd });
  const entry = inventory.entries.find((item) => item.id === id);
  if (!entry) return { ok: false, reason: 'not-found' };
  if (entry.restoreBlocked || existsSync(resolve(cwd, entry.originalPath))) {
    return { ok: false, reason: 'already-exists' };
  }
  const trashPath = resolve(cwd, entry.trashPath);
  const originalPath = resolve(cwd, entry.originalPath);
  if (
    !isInsidePath(resolve(cwd, '.nectar', 'trash'), trashPath) ||
    !isInsidePath(cwd, originalPath)
  ) {
    return { ok: false, reason: 'forbidden' };
  }
  await mkdir(dirname(originalPath), { recursive: true });
  await rename(trashPath, originalPath);
  return { ok: true, entry: { ...entry, restoreBlocked: true } };
}

function postSummary(
  cwd: string,
  post: Post,
  graph: ContentGraph,
  config: NectarConfig,
): DashboardContentSummary {
  const source = graph.sources?.posts.get(post.id);
  return {
    slug: post.slug,
    title: post.title,
    status: post.status,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    publishedAt: post.published_at,
    path: contentPath(config.content.posts_dir, source),
    url: post.url,
    authors: post.authors.map((author) => author.name),
    authorSlugs: post.authors.map((author) => author.slug),
    tags: post.tags.map((tag) => tag.name),
    tagSlugs: post.tags.map((tag) => tag.slug),
    words: post.word_count,
    warnings: contentWarnings(post),
    featureImage: assetReference(cwd, config, post.feature_image),
    internalLink: internalLinkForSummary('posts', post),
    renamePreview: renamePreviewFor(config, post.slug, post.slug, post.url),
    preview: previewPlaceholder(post.url, contentFingerprint(config.content.posts_dir, source)),
  };
}

function pageSummary(
  cwd: string,
  page: Page,
  graph: ContentGraph,
  config: NectarConfig,
): DashboardContentSummary {
  const source = graph.sources?.pages.get(page.id);
  return {
    slug: page.slug,
    title: page.title,
    status: page.status,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
    publishedAt: page.published_at,
    path: contentPath(config.content.pages_dir, source),
    url: page.url,
    authors: page.authors.map((author) => author.name),
    authorSlugs: page.authors.map((author) => author.slug),
    tags: page.tags.map((tag) => tag.name),
    tagSlugs: page.tags.map((tag) => tag.slug),
    words: page.word_count,
    warnings: contentWarnings(page),
    featureImage: assetReference(cwd, config, page.feature_image),
    internalLink: internalLinkForSummary('pages', page),
    renamePreview: renamePreviewFor(config, page.slug, page.slug, page.url),
    preview: previewPlaceholder(page.url, contentFingerprint(config.content.pages_dir, source)),
  };
}

function internalLinkForSummary(
  kind: DashboardContentKind,
  item: Pick<Post | Page, 'slug' | 'title' | 'url'>,
): DashboardInternalLink {
  return {
    kind,
    slug: item.slug,
    title: item.title,
    url: item.url,
    path: '',
    markdown: `[${item.title || item.slug}](${item.url})`,
  };
}

export async function listDashboardInternalLinks({
  cwd,
  config,
}: {
  cwd: string;
  config: NectarConfig;
}): Promise<DashboardInternalLink[]> {
  const graph = await loadContent({
    cwd,
    config,
    includeDrafts: true,
    includeFuturePosts: true,
  });
  return [
    ...graph.posts.map((post) => ({
      ...internalLinkForSummary('posts', post),
      path: contentPath(config.content.posts_dir, graph.sources?.posts.get(post.id)),
    })),
    ...graph.pages.map((page) => ({
      ...internalLinkForSummary('pages', page),
      path: contentPath(config.content.pages_dir, graph.sources?.pages.get(page.id)),
    })),
  ].sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
}

function assetReference(
  cwd: string,
  config: NectarConfig,
  value: string | undefined,
): DashboardAssetReference {
  const raw = value?.trim() ?? '';
  if (!raw) return emptyAssetReference();
  if (/^https?:\/\//i.test(raw)) return remoteAssetReference(raw);
  if (/^data:/i.test(raw)) {
    return {
      value: raw,
      kind: 'data',
      exists: null,
      path: null,
      publicPath: raw,
      markdown: null,
      warning: 'Data URLs are allowed but cannot be validated against content assets.',
    };
  }

  const assetsDir = config.content.assets_dir.replace(/^\/+|\/+$/g, '');
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const publicRoot = `/${assetsDir}/`;
  const assetRel = raw.startsWith(publicRoot)
    ? raw.slice(publicRoot.length)
    : raw.startsWith('/')
      ? null
      : raw.replace(/^\.?\//, '');
  if (assetRel === null) {
    return {
      value: raw,
      kind: 'external',
      exists: null,
      path: null,
      publicPath: raw,
      markdown: null,
      warning: `Path is outside ${publicRoot}.`,
    };
  }
  const decoded = safeDecodePath(assetRel);
  if (decoded === null) {
    return {
      value: raw,
      kind: 'external',
      exists: false,
      path: null,
      publicPath: raw,
      markdown: null,
      warning: 'Asset path could not be decoded safely.',
    };
  }
  const filePath = resolve(assetsRoot, decoded);
  if (!isInsidePath(assetsRoot, filePath)) {
    return {
      value: raw,
      kind: 'external',
      exists: false,
      path: null,
      publicPath: raw,
      markdown: null,
      warning: 'Asset path escapes the configured assets directory.',
    };
  }
  const publicPath = `${publicRoot}${decoded.replaceAll('\\', '/')}`;
  return {
    value: raw,
    kind: 'asset',
    exists: existsSync(filePath),
    path: relativePath(cwd, filePath),
    publicPath,
    markdown: `![${basename(decoded, extname(decoded))}](${publicPath})`,
    warning: IMAGE_EXTENSIONS.has(extname(decoded).toLowerCase())
      ? null
      : 'Asset is not a known image type.',
  };
}

function markdownImageReferences(
  cwd: string,
  config: NectarConfig,
  body: string,
): DashboardAssetReference[] {
  const refs: DashboardAssetReference[] = [];
  const markdownImageRe = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(markdownImageRe)) {
    refs.push(assetReference(cwd, config, match[1]));
  }
  return refs;
}

function emptyAssetReference(): DashboardAssetReference {
  return {
    value: '',
    kind: 'none',
    exists: null,
    path: null,
    publicPath: null,
    markdown: null,
    warning: null,
  };
}

function remoteAssetReference(value: string): DashboardAssetReference {
  return {
    value,
    kind: 'remote',
    exists: null,
    path: null,
    publicPath: value,
    markdown: `![image](${value})`,
    warning: null,
  };
}

function renamePreviewFor(
  config: NectarConfig,
  oldSlug: string,
  newSlug: string,
  currentUrl: string | undefined,
): DashboardSlugRenamePreview {
  const basePath = normaliseBasePath(config.build.base_path);
  return {
    currentSlug: oldSlug,
    currentUrl: currentUrl ?? `${basePath}${oldSlug}/`,
    redirectFrom: `${basePath}${oldSlug}/`,
    redirectTo: `${basePath}${newSlug}/`,
  };
}

function contentFingerprint(
  dir: string,
  source: ContentSourceFingerprint | undefined,
): ContentSourceFingerprint | null {
  if (source === undefined) return null;
  return { ...source, path: contentPath(dir, source) };
}

function previewPlaceholder(
  route: string,
  contentFingerprint: ContentSourceFingerprint | null,
): DashboardPreviewArtifact {
  return {
    state: 'build-required',
    label: 'Build required',
    route,
    openUrl: '',
    artifactPath: null,
    artifactMtimeMs: null,
    contentFingerprint,
    detail: 'Run nectar build to create a saved output artifact for this file.',
    sandbox: DASHBOARD_PREVIEW_SANDBOX_POLICY,
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

async function withPreviewArtifacts(
  cwd: string,
  config: NectarConfig,
  list: DashboardList<DashboardContentSummary>,
): Promise<DashboardList<DashboardContentSummary>> {
  return {
    ...list,
    items: await Promise.all(
      list.items.map(async (item) => ({
        ...item,
        preview: await resolveDashboardPreviewArtifact(cwd, config, item),
      })),
    ),
  };
}

function countPreviewFreshness(
  items: DashboardContentSummary[],
): Record<DashboardPreviewState, number> {
  return items.reduce<Record<DashboardPreviewState, number>>(
    (counts, item) => {
      counts[item.preview.state] += 1;
      return counts;
    },
    { current: 0, stale: 0, missing: 0, 'build-required': 0 },
  );
}

async function resolveDashboardPreviewArtifact(
  cwd: string,
  config: NectarConfig,
  item: DashboardContentSummary,
): Promise<DashboardPreviewArtifact> {
  const route = routePathFromContentUrl(item.url, config);
  const openUrl = `/preview/artifact?route=${encodeURIComponent(route)}`;
  const outputRoot = resolveOutputDir(cwd, config.build.output_dir);
  const missingRoot = await outputRootStatus(cwd, outputRoot);
  if (missingRoot !== undefined) {
    return {
      ...item.preview,
      state: missingRoot.state,
      label: missingRoot.label,
      route,
      openUrl,
      detail: missingRoot.detail,
    };
  }
  const artifact = await findRouteHtmlArtifact(cwd, outputRoot, route, config.build.trailing_slash);
  if (artifact === undefined) {
    return {
      ...item.preview,
      state: 'missing',
      label: 'Preview missing',
      route,
      openUrl,
      detail: `No saved HTML artifact exists for ${route} in ${config.build.output_dir}.`,
    };
  }
  const contentMtimeMs = item.preview.contentFingerprint?.mtimeMs ?? 0;
  const stale = contentMtimeMs > 0 && artifact.mtimeMs + 1 < contentMtimeMs;
  return {
    ...item.preview,
    state: stale ? 'stale' : 'current',
    label: stale ? 'Preview stale' : 'Preview current',
    route,
    openUrl,
    artifactPath: artifact.relativePath,
    artifactMtimeMs: artifact.mtimeMs,
    detail: stale
      ? 'Saved source is newer than the built HTML artifact; run nectar build before treating preview as published output.'
      : 'Preview shows the latest saved build artifact, not unsaved editor changes.',
  };
}

async function serveDashboardPreviewArtifact({
  cwd,
  configPath,
  route,
}: {
  cwd: string;
  configPath?: string;
  route: string;
}): Promise<Response> {
  const config = await loadConfig({ cwd, configPath });
  const outputRoot = resolveOutputDir(cwd, config.build.output_dir);
  const rootStatus = await outputRootStatus(cwd, outputRoot);
  if (rootStatus !== undefined) return new Response(rootStatus.detail, { status: 404 });
  const artifact = await findRouteHtmlArtifact(cwd, outputRoot, route, config.build.trailing_slash);
  if (artifact === undefined) return new Response('Preview artifact not found', { status: 404 });
  const html = await readFile(artifact.absolutePath, 'utf8');
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
}

async function outputRootStatus(
  cwd: string,
  outputRoot: string,
): Promise<{ state: 'build-required' | 'missing'; label: string; detail: string } | undefined> {
  try {
    const [projectRoot, root, info] = await Promise.all([
      realpath(cwd),
      realpath(outputRoot),
      stat(outputRoot),
    ]);
    if (!info.isDirectory() || !isInsidePath(projectRoot, root)) {
      return {
        state: 'missing',
        label: 'Preview unavailable',
        detail: 'Configured build.output_dir is not a safe directory inside this project.',
      };
    }
    return undefined;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return {
        state: 'build-required',
        label: 'Build required',
        detail: 'No build output directory exists yet; run nectar build to create previews.',
      };
    }
    throw err;
  }
}

function routePathFromContentUrl(url: string, config: NectarConfig): string {
  let pathname = '/';
  try {
    pathname = new URL(url, config.site.url).pathname;
  } catch {
    pathname = url.startsWith('/') ? url : `/${url}`;
  }
  const decoded = safeDecodeRoutePath(pathname);
  const basePath = normalizeBasePathForPreview(config.build.base_path);
  if (basePath !== '/' && (decoded === basePath.slice(0, -1) || decoded.startsWith(basePath))) {
    return `/${decoded.slice(basePath.length).replace(/^\/+/, '')}` || '/';
  }
  return decoded;
}

function normalizeBasePathForPreview(basePath: string): string {
  const trimmed = basePath.trim();
  if (trimmed === '' || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

function safeDecodeRoutePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

async function findRouteHtmlArtifact(
  cwd: string,
  outputRoot: string,
  route: string,
  trailingSlash: NectarConfig['build']['trailing_slash'],
): Promise<{ absolutePath: string; relativePath: string; mtimeMs: number } | undefined> {
  const outputRootReal = await realpath(outputRoot);
  for (const candidate of routeHtmlCandidates(outputRoot, route, trailingSlash)) {
    if (!existsSync(candidate)) continue;
    const [targetReal, info] = await Promise.all([realpath(candidate), stat(candidate)]);
    if (!info.isFile() || !isInsidePath(outputRootReal, targetReal)) continue;
    return {
      absolutePath: targetReal,
      relativePath: relativePath(cwd, targetReal),
      mtimeMs: Math.round(info.mtimeMs * 1000) / 1000,
    };
  }
  return undefined;
}

function routeHtmlCandidates(
  outputRoot: string,
  route: string,
  trailingSlash: NectarConfig['build']['trailing_slash'],
): string[] {
  const segments = safeRouteSegments(route);
  if (segments === undefined) return [];
  if (segments.length === 0) return [join(outputRoot, 'index.html')];
  return trailingSlash === 'never'
    ? [join(outputRoot, `${segments.join('/')}.html`), join(outputRoot, ...segments, 'index.html')]
    : [join(outputRoot, ...segments, 'index.html'), join(outputRoot, `${segments.join('/')}.html`)];
}

function safeRouteSegments(route: string): string[] | undefined {
  const decoded = safeDecodeRoutePath(route);
  if (decoded.includes('\0')) return undefined;
  const normalized = decoded.startsWith('/') ? decoded : `/${decoded}`;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))) {
    return undefined;
  }
  return segments;
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
      id: 'assets-images',
      section: 'Operations',
      title: 'Assets and images',
      summary: 'Content image references are checked against the configured assets directory.',
      source: operations.assets.dir,
      mode: 'cli-action',
      status: operations.assets.featureImages.missing > 0 ? 'warn' : 'ok',
      values: [
        { label: 'asset files', value: String(operations.assets.files) },
        { label: 'images', value: String(operations.assets.images) },
        { label: 'feature images', value: String(operations.assets.featureImages.referenced) },
        { label: 'missing feature images', value: String(operations.assets.featureImages.missing) },
      ],
    },
    {
      id: 'content-operations',
      section: 'Operations',
      title: 'Bulk actions, templates, and internal links',
      summary: 'Safe content operations remain fingerprint-gated and Markdown-first.',
      source: 'Dashboard API',
      mode: 'cli-action',
      status: 'ok',
      values: [
        { label: 'bulk actions', value: String(operations.bulkActions.length) },
        { label: 'templates', value: String(operations.contentTemplates.length) },
        { label: 'internal links', value: String(operations.internalLinks.length) },
      ],
    },
    {
      id: 'trash-restore',
      section: 'Operations',
      title: 'Trash and restore',
      summary:
        'Deleted content is moved to .nectar/trash with restore metadata; purge stays CLI-only.',
      source: operations.trash.path,
      mode: 'dangerous-cli-only',
      status: operations.trash.entries.length > 0 ? 'warn' : 'info',
      values: [
        { label: 'trash entries', value: String(operations.trash.entries.length) },
        {
          label: 'blocked restores',
          value: String(operations.trash.entries.filter((entry) => entry.restoreBlocked).length),
        },
      ],
      command: 'nectar content delete --purge',
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
  const [doctor, cache, redirects, routes, assets, trash, contentTemplates, internalLinks] =
    await Promise.all([
      runChecks({ cwd, configPath, skipNetwork: true }),
      readCacheStats(resolve(cwd, '.nectar-cache')),
      readRedirectInventory(cwd),
      readRoutesInventory(cwd),
      readAssetInventory(cwd, config, [...posts, ...pages]),
      listDashboardTrash({ cwd }),
      listDashboardContentTemplates({ cwd }),
      listDashboardInternalLinks({ cwd, config }),
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
    assets,
    bulkActions: [
      {
        id: 'set-status',
        label: 'Set status',
        danger: false,
        requiresConfirmation: false,
      },
      { id: 'add-tag', label: 'Add tag', danger: false, requiresConfirmation: false },
      { id: 'remove-tag', label: 'Remove tag', danger: false, requiresConfirmation: false },
      {
        id: 'touch-updated-at',
        label: 'Touch updated_at',
        danger: false,
        requiresConfirmation: false,
      },
    ],
    trash,
    contentTemplates,
    internalLinks,
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

async function readAssetInventory(
  cwd: string,
  config: NectarConfig,
  content: DashboardContentSummary[],
): Promise<DashboardAssetInventory> {
  const root = absolutise(cwd, config.content.assets_dir);
  const scanned = existsSync(root) ? await scanAssetFiles(root) : { files: 0, images: 0, bytes: 0 };
  const featureImages = content
    .map((item) => item.featureImage)
    .filter((ref) => ref.kind !== 'none');
  return {
    dir: config.content.assets_dir,
    exists: existsSync(root),
    files: scanned.files,
    images: scanned.images,
    bytes: scanned.bytes,
    featureImages: {
      referenced: featureImages.length,
      missing: featureImages.filter((ref) => ref.exists === false).length,
    },
    markdownInsertPrefix: `/${config.content.assets_dir.replace(/^\/+|\/+$/g, '')}/`,
  };
}

async function scanAssetFiles(
  path: string,
): Promise<{ files: number; images: number; bytes: number }> {
  const info = await stat(path);
  if (info.isFile()) {
    const image = IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
    return { files: 1, images: image ? 1 : 0, bytes: info.size };
  }
  if (!info.isDirectory()) return { files: 0, images: 0, bytes: 0 };
  let files = 0;
  let images = 0;
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanAssetFiles(child);
      files += nested.files;
      images += nested.images;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      const childStat = await stat(child);
      files += 1;
      bytes += childStat.size;
      if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) images += 1;
    }
  }
  return { files, images, bytes };
}

export async function listDashboardContentTemplates({
  cwd,
}: {
  cwd: string;
}): Promise<DashboardContentTemplate[]> {
  const builtins: DashboardContentTemplate[] = [
    {
      id: 'default',
      name: 'Default draft',
      kind: 'any',
      source: 'builtin',
      description: 'A minimal draft with title, slug, dates, and status.',
    },
    {
      id: 'image-story',
      name: 'Image story',
      kind: 'posts',
      source: 'builtin',
      description: 'A post scaffold with feature image fields and an image placeholder.',
    },
    {
      id: 'landing-page',
      name: 'Landing page',
      kind: 'pages',
      source: 'builtin',
      description: 'A page scaffold for a static landing page.',
    },
    {
      id: 'changelog',
      name: 'Changelog',
      kind: 'posts',
      source: 'builtin',
      description: 'A terse release-note style post scaffold.',
    },
  ];
  const projectDir = join(cwd, '.nectar', 'templates', 'content');
  if (!existsSync(projectDir)) return builtins;
  const projectTemplates: DashboardContentTemplate[] = [];
  for (const entry of await readdir(projectDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = basename(entry.name, '.md');
    if (!SLUG_RE.test(id)) continue;
    projectTemplates.push({
      id: `project:${id}`,
      name: titleFromSlug(id),
      kind: 'any',
      source: 'project',
      description: `.nectar/templates/content/${entry.name}`,
    });
  }
  return [...builtins, ...projectTemplates.sort((a, b) => a.id.localeCompare(b.id))];
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => slugify(item, { lower: true, strict: true }))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => slugify(item.trim(), { lower: true, strict: true }))
      .filter(Boolean);
  }
  return [];
}

function isDashboardContentKind(value: unknown): value is DashboardContentKind {
  return value === 'posts' || value === 'pages';
}

function safeDecodePath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes('\0')) return null;
    return decoded;
  } catch {
    return null;
  }
}

function normaliseBasePath(base: string): string {
  if (!base || base === '/') return '/';
  const withLead = base.startsWith('/') ? base : `/${base}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

async function appendDashboardRedirect(cwd: string, from: string, to: string): Promise<string> {
  const file = join(cwd, 'redirects.yaml');
  const line = `- { from: "${from}", to: "${to}", status: 301 }\n`;
  if (existsSync(file)) {
    const existing = await readFile(file, 'utf8');
    const suffix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
    await writeFile(file, `${existing}${suffix}${line}`, 'utf8');
  } else {
    await writeFile(file, line, 'utf8');
  }
  return relativePath(cwd, file);
}

function slugRenameSuccess(
  cwd: string,
  config: NectarConfig,
  kind: EditableKind,
  oldSlug: string,
  newSlug: string,
  oldPath: string,
  newFile: string,
  redirectAppended: string | null,
): DashboardSlugRenameResult {
  return {
    ok: true,
    kind,
    oldSlug,
    newSlug,
    oldPath,
    newPath: relativePath(cwd, newFile),
    redirectAppended,
    redirectSuggestion: renamePreviewFor(config, oldSlug, newSlug, undefined),
  };
}

function timestampForTrashPath(now: Date): string {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function resolveDashboardTrashDir(cwd: string, now: Date): string {
  const trashRoot = join(cwd, '.nectar', 'trash');
  for (let offsetMs = 0; offsetMs < 1000; offsetMs += 1) {
    const candidate = join(trashRoot, timestampForTrashPath(new Date(now.getTime() + offsetMs)));
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('could not allocate a unique trash directory');
}

function trashEntryFromMetadata(
  cwd: string,
  metadataPath: string,
  metadata: Record<string, unknown>,
): DashboardTrashEntry | null {
  const slug = stringValue(metadata.slug);
  const originalPath = stringValue(metadata.original_path);
  const trashPath = stringValue(metadata.trash_path);
  const trashedAt = stringValue(metadata.trashed_at);
  const purgeAfter = stringValue(metadata.purge_after);
  const kindRaw = metadata.kind;
  const kind = kindRaw === 'posts' || kindRaw === 'pages' ? kindRaw : null;
  if (!slug || !originalPath || !trashPath || !trashedAt || !purgeAfter) return null;
  if (isAbsolute(originalPath) || isAbsolute(trashPath)) return null;
  const trashAbs = resolve(cwd, trashPath);
  const originalAbs = resolve(cwd, originalPath);
  if (!isInsidePath(resolve(cwd, '.nectar', 'trash'), trashAbs)) return null;
  if (!isInsidePath(cwd, originalAbs)) return null;
  const dirId = basename(dirname(metadataPath));
  const id = `${dirId}--${slug}`;
  return {
    id,
    slug,
    kind,
    originalPath,
    trashPath,
    metadataPath: relativePath(cwd, metadataPath),
    trashedAt,
    purgeAfter,
    restoreBlocked: existsSync(originalAbs),
  };
}

async function scaffoldDashboardContent({
  cwd,
  kind,
  title,
  slug,
  now,
  template,
}: {
  cwd: string;
  kind: EditableKind;
  title: string;
  slug: string;
  now: string;
  template?: string;
}): Promise<string> {
  if (kind === 'authors') return serializeContentSource({ slug, name: title }, '\n');
  if (kind === 'tags') return serializeContentSource({ slug, name: title }, '\n');
  const normalizedTemplate = template?.trim() || 'default';
  if (normalizedTemplate.startsWith('project:')) {
    const id = normalizedTemplate.slice('project:'.length);
    if (!SLUG_RE.test(id)) throw new Error('invalid template');
    const file = join(cwd, '.nectar', 'templates', 'content', `${id}.md`);
    if (!existsSync(file)) throw new Error(`template does not exist: ${normalizedTemplate}`);
    const raw = await readFile(file, 'utf8');
    return renderTemplateScaffold(raw, { title, slug, now, kind });
  }
  const base = { title, slug, date: now, created_at: now, updated_at: now, status: 'draft' };
  if (normalizedTemplate === 'image-story' && kind === 'posts') {
    return serializeContentSource(
      { ...base, feature_image: '', feature_image_alt: '' },
      '\nStart with the image, then write the story.\n',
    );
  }
  if (normalizedTemplate === 'landing-page' && kind === 'pages') {
    return serializeContentSource(
      { ...base, template: 'page' },
      '\n## Overview\n\nDescribe the page purpose here.\n',
    );
  }
  if (normalizedTemplate === 'changelog' && kind === 'posts') {
    return serializeContentSource(base, '\n## Changed\n\n- \n\n## Fixed\n\n- \n');
  }
  return serializeContentSource(base, '\n');
}

function renderTemplateScaffold(
  raw: string,
  values: { title: string; slug: string; now: string; kind: EditableKind },
): string {
  return raw
    .replaceAll('{{title}}', values.title)
    .replaceAll('{{slug}}', values.slug)
    .replaceAll('{{date}}', values.now)
    .replaceAll('{{created_at}}', values.now)
    .replaceAll('{{updated_at}}', values.now)
    .replaceAll('{{kind}}', values.kind);
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
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
