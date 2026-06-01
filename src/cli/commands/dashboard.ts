import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { type Dirent, type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import slugify from 'slugify';
import {
  CARD_ASSETS_CSS_PATH,
  CARD_ASSETS_JS_PATH,
  isCardAssetsEnabled,
  renderCardAssetsCss,
  renderCardAssetsJs,
} from '~/build/card-assets.ts';
import { type ContentImageAssetPlan, planContentImageAssets } from '~/build/emit.ts';
import { computeFavicons } from '~/build/favicons.ts';
import {
  type ImageFormat,
  collapseDegenerateSrcsetIntoContent,
  injectImageDimensionsIntoContent,
  injectImagePictureSourcesIntoContent,
  injectImageSrcsetIntoContent,
  isSharpAvailable,
  planImageVariants,
} from '~/build/images.ts';
import { loadInlineHelpers } from '~/build/pipeline.ts';
import { resolvePortalUrls } from '~/build/portal-urls.ts';
import { loadRedirects } from '~/build/redirects.ts';
import { renderRouteHtml } from '~/build/route-render.ts';
import { loadRoutesYaml, resolveCollections, resolveRouteEntries } from '~/build/routes-yaml.ts';
import { planRoutes } from '~/build/routes.ts';
import { findOutdatedSkills } from '~/cli/skill/check-updates.ts';
import { exportComponentsBundle, importComponentsBundle } from '~/components-bundle/index.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import {
  type ApprovalState,
  readApprovalState,
  sameContentFingerprint,
  writeApprovalReceipt,
} from '~/content/approvals.ts';
import { rewriteComponentSlugInBody, splitFrontmatterRaw } from '~/content/component-references.ts';
import { COMPONENT_SLUG_PATTERN } from '~/content/components.ts';
import { formatContentSource } from '~/content/format.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { type MarkdownTransformHook, loadContent } from '~/content/loader.ts';
import type {
  Author,
  ComponentSnippet,
  ContentGraph,
  ContentSourceFingerprint,
  Page,
  Post,
  Tag,
} from '~/content/model.ts';
import { exportEntryBundle, importEntryBundle } from '~/entry-bundle/index.ts';
import {
  type ImportSummary,
  ON_CONFLICT_VALUES,
  type OnConflict,
  importGhostExport,
} from '~/ghost/import.ts';
import { type LoadedPluginSet, loadPlugins } from '~/plugin/loader.ts';
import type { BuildContext } from '~/plugin/types.ts';
import { type NectarEngine, createEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import { loadTheme, resolveThemeRoot } from '~/theme/loader.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { createCleanupRegistry } from '~/util/cleanup.ts';
import { logger } from '~/util/logger.ts';
import { getNectarVersion } from '~/util/nectar-version.ts';
import { absolutise, resolveContentSlugPath } from '../content-paths.ts';
import { createBuildStreamResponse, createExportZipResponse } from '../dashboard/build-runner.ts';
import { DASHBOARD_BUNDLE_ASSETS } from '../dashboard/bundled-assets.ts';
import { createGhostImportStreamResponse } from '../dashboard/ghost-import-runner.ts';
import { renderDashboardHtml as renderDashboardShellHtml } from '../dashboard/html.ts';
import {
  dashboardPreviewImageOutputDir,
  enqueueDashboardImageVariantGeneration,
} from '../dashboard/image-variant-queue.ts';
import { fetchOgp } from '../dashboard/ogp.ts';
import {
  type AutoBuildResult,
  type RuntimeBundleAssets,
  maybeAutoBuildDashboardBundle,
} from '../dashboard/source-bundle.ts';
import {
  type TaxonomyCascadeSnapshot,
  cascadeRemoveTaxonomyReferences,
} from '../dashboard/taxonomy-cascade.ts';
import { rewriteThemeCss } from '../dashboard/theme-css-rewriter.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DASHBOARD_SPEC } from '../specs.ts';
import { renameAuthor } from './authors.ts';
import { rewriteFrontmatterSlug } from './content.ts';
import { type CheckResult, runChecks } from './doctor.ts';
import { inferServeContentType } from './serve.ts';
import {
  countContentFiles,
  emitStartupEvent,
  findActiveConfigDisplay,
  formatContentCounts,
  renderBanner,
  renderNotice,
  renderSimpleReady,
  writeBlock,
} from './startup-banner.ts';
import { renameTag } from './tags.ts';

const DEFAULT_PORT = 4322;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 100;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const ACTIVITY_LIMIT = 50;
const WATCH_DEBOUNCE_MS = 100;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SITE_SETTINGS_FIELDS = [
  'title',
  'description',
  'url',
  'locale',
  'timezone',
  'accent_color',
  'icon',
  'twitter',
  'facebook',
  'linkedin',
  'bluesky',
  'mastodon',
  'threads',
  'tiktok',
  'youtube',
  'instagram',
  'github',
  'og_image',
  'codeinjection_head',
  'codeinjection_foot',
];
// Companion fields the /api/settings/site PATCH route accepts that live
// outside the [site] section. Currently just the gate that controls
// whether site-wide AND per-post `codeinjection_*` fields are honored.
// Surfaced through the same endpoint because the dashboard Code Injection
// panel needs to toggle it atomically with its head/foot save.
const SITE_PATCH_BUILD_FIELDS = ['allow_code_injection'];
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const DASHBOARD_PREVIEW_SANDBOX_POLICY: DashboardPreviewSandboxPolicy = {
  mode: 'iframe-sandbox',
  attributes: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox'],
  allowScripts: true,
  allowSameOrigin: false,
  note: 'Markdown previews render through the active theme in a sandboxed iframe without allow-same-origin, so theme scripts cannot read or operate the dashboard document.',
};

type EditableKind = 'posts' | 'pages' | 'authors' | 'tags' | 'components';
type DashboardContentKind = 'posts' | 'pages';
type DashboardSort = 'created_desc' | 'created_asc' | 'updated_desc' | 'title_asc';

interface DashboardStateOptions {
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

interface DashboardStateQuery {
  kind?: DashboardContentKind;
  status?: string;
  search?: string;
  sort?: DashboardSort;
}

interface DashboardStatusCounts {
  all: number;
  draft: number;
  published: number;
  needsReview: number;
}

export interface DashboardList<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  query: DashboardStateQuery;
  statusCounts?: DashboardStatusCounts;
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
  approval: ApprovalState | null;
}

export type DashboardPreviewState = 'current' | 'stale' | 'missing' | 'build-required';

export interface DashboardPreviewSandboxPolicy {
  mode: 'iframe-sandbox';
  attributes: string[];
  allowScripts: boolean;
  allowSameOrigin: false;
  note: string;
}

interface DashboardPreviewArtifact {
  state: DashboardPreviewState;
  label: string;
  route: string;
  openUrl: string;
  artifactPath: string | null;
  artifactMtimeMs: number | null;
  sourcePath: string | null;
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
  source: 'file' | 'generated';
  materializePath: string;
}

// Per-component summary surfaced on the dashboard list and the post/page
// editor insert menu. The editor needs the payload to render `{slug}` as
// a non-editable preview without fetching every component lazily.
export interface DashboardComponentSummary {
  slug: string;
  description: string;
  css: string;
  html: string;
  hasCss: boolean;
  hasHtml: boolean;
  path: string;
  fingerprint: ContentSourceFingerprint;
}

type DashboardCardMode =
  | 'editable'
  | 'read-only'
  | 'cli-action'
  | 'dangerous-cli-only'
  | 'scope-note';
type DashboardCardStatus = 'ok' | 'warn' | 'danger' | 'info';
type DashboardCardCategory =
  | 'general'
  | 'content'
  | 'theme'
  | 'build'
  | 'structure'
  | 'operations'
  | 'advanced';
type DashboardCardSourceKind = 'config' | 'theme' | 'content' | 'runtime' | 'cli' | 'docs';

interface DashboardCardValue {
  label: string;
  value: string;
  status?: DashboardCardStatus;
}

interface DashboardSettingsCard {
  id: string;
  category: DashboardCardCategory;
  section: string;
  title: string;
  summary: string;
  source: string;
  sourceKind: DashboardCardSourceKind;
  mode: DashboardCardMode;
  status: DashboardCardStatus;
  values: DashboardCardValue[];
  command?: string;
}

export interface DashboardThemeOption {
  name: string;
  path: string;
  active: boolean;
  /* Pulled from the theme's package.json so the dashboard can surface a
   * human-readable description and version next to the bare directory
   * name. Both are optional — themes without a valid package.json
   * (older or test fixtures) simply render with name only. */
  description?: string;
  version?: string;
}

// Surfaced via `/api/state` so the dashboard can show a top-of-page warning
// when `[theme]` in `nectar.toml` points at a directory that does not exist.
// Mirrors the `Theme directory not found` `NectarError` that `loadTheme()`
// raises at build time so the operator gets the same actionable hint inside
// the dashboard instead of having to drop to the CLI.
export interface DashboardThemeStatus {
  missing: boolean;
  // Path the loader would look at, relative to cwd when it sits inside it,
  // otherwise the absolute path. Mirrors the `cloneTarget` heuristic in
  // `src/theme/loader.ts` so the message lines up with the CLI.
  expectedPath: string;
  // Populated when `missing` is true. Ready-to-run `git clone` command that
  // vendors the default Source theme into the expected path.
  cloneCommand?: string;
  // Populated when `missing` is true. Human-readable message — used as the
  // banner headline.
  message?: string;
  // Populated when `missing` is true. Longer, hint-style explanation pulled
  // from the same copy `NectarError` emits.
  hint?: string;
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

interface DashboardAssetReference {
  value: string;
  kind: 'none' | 'remote' | 'data' | 'asset' | 'project' | 'external';
  exists: boolean | null;
  path: string | null;
  publicPath: string | null;
  markdown: string | null;
  warning: string | null;
}

interface DashboardAssetInventory {
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

interface DashboardBulkActionDescriptor {
  id: DashboardBulkAction;
  label: string;
  danger: boolean;
  requiresConfirmation: boolean;
}

type DashboardBulkAction = 'set-status' | 'add-tag' | 'remove-tag' | 'touch-updated-at';

interface DashboardBulkTarget {
  kind: DashboardContentKind;
  slug: string;
  fingerprint: ContentSourceFingerprint;
}

type DashboardBulkResult =
  | {
      ok: true;
      changed: Array<{ kind: DashboardContentKind; slug: string; path: string }>;
      skipped: Array<{ kind: DashboardContentKind; slug: string; reason: string }>;
    }
  | { ok: false; reason: 'invalid-action' | 'invalid-payload' };

interface DashboardTrashEntry {
  id: string;
  slug: string;
  kind: EditableKind | null;
  originalPath: string;
  trashPath: string;
  metadataPath: string;
  trashedAt: string;
  purgeAfter: string;
  restoreBlocked: boolean;
  // Posts/pages whose frontmatter referenced a deleted tag/author and were
  // rewritten as part of the cascade. Each carries the pre-edit file text so
  // Undo can put the reference back verbatim. Empty/absent for posts, pages,
  // components, and for taxonomies nothing referenced.
  affectedFiles?: Array<{ path: string; previousText: string }>;
}

interface DashboardTrashInventory {
  path: string;
  exists: boolean;
  entries: DashboardTrashEntry[];
}

interface DashboardContentTemplate {
  id: string;
  name: string;
  kind: DashboardContentKind | 'any';
  source: 'builtin' | 'project';
  description: string;
}

interface DashboardInternalLink {
  kind: DashboardContentKind;
  slug: string;
  title: string;
  url: string;
  path: string;
  markdown: string;
}

interface DashboardSlugRenamePreview {
  currentSlug: string;
  currentUrl: string;
  redirectFrom: string;
  redirectTo: string;
}

interface DashboardSyncEvent {
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

interface DashboardContentWarning {
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
    // Raw `[site].icon` from nectar.toml so the dashboard favicon control can
    // round-trip the configured path/URL. The build's favicon emission
    // (src/build/favicons.ts) is the consumer; this just surfaces the source.
    icon: string;
    social: DashboardSocialSettings;
    // Site-wide default Open Graph / social-share image written to
    // `[site].og_image`. Used by {{ghost_head}} as the og:image / twitter:image
    // fallback when a route has no per-post feature/og/twitter image.
    ogImage: string;
    // Mirrors Ghost's site-wide "Code injection" head/foot fields so the
    // dashboard's Code Injection panel can hydrate from the same `[site]`
    // table it writes back to. Reflects the raw config value regardless of
    // whether `build.allow_code_injection` is currently true — the panel
    // shows what's on disk so an operator can flip the gate by saving.
    codeinjectionHead: string;
    codeinjectionFoot: string;
    allowCodeInjection: boolean;
  };
  posts: DashboardList<DashboardContentSummary>;
  pages: DashboardList<DashboardContentSummary>;
  authors: DashboardList<DashboardTaxonomySummary>;
  tags: DashboardList<DashboardTaxonomySummary>;
  components: DashboardList<DashboardComponentSummary>;
  settings: {
    configPath: string;
    fingerprint: ContentSourceFingerprint;
    contentDirs: {
      posts: string;
      pages: string;
      authors: string;
      tags: string;
      components: string;
      assets: string;
    };
    outputDir: string;
    theme: {
      name: string;
      dir: string;
      available: DashboardThemeOption[];
      status: DashboardThemeStatus;
    };
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

export interface DashboardSocialSettings {
  twitter: string;
  facebook: string;
  linkedin: string;
  bluesky: string;
  mastodon: string;
  threads: string;
  tiktok: string;
  youtube: string;
  instagram: string;
  github: string;
}

interface DashboardContentItem {
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

type DashboardWriteResult =
  | { ok: true; fingerprint: ContentSourceFingerprint; changedPath: string }
  | {
      ok: false;
      reason: 'conflict';
      changedPath: string;
      current: DashboardContentItem;
      conflict: DashboardConflictDiff;
    }
  | { ok: false; reason: 'not-found' | 'invalid-kind' | 'forbidden'; changedPath?: string };

interface DashboardSettings {
  configPath: string;
  fingerprint: ContentSourceFingerprint;
  site: {
    title: string;
    description: string;
    url: string;
    locale: string;
    timezone: string;
    accentColor: string;
    icon: string;
    social: DashboardSocialSettings;
    ogImage: string;
    codeinjectionHead: string;
    codeinjectionFoot: string;
    allowCodeInjection: boolean;
  };
  theme: {
    name: string;
    dir: string;
    available: DashboardThemeOption[];
    status: DashboardThemeStatus;
  };
}

type DashboardSettingsWriteResult =
  | { ok: true; fingerprint: ContentSourceFingerprint; changedPath: string }
  | { ok: false; reason: 'conflict'; changedPath: string; current: DashboardSettings }
  | {
      ok: false;
      reason: 'invalid-theme';
      changedPath: string;
      current: DashboardSettings;
      theme: string;
    };

interface DashboardComponentReferenceRewriteSummary {
  // Number of post / page files whose body was modified.
  filesChanged: number;
  // Total `{old}` occurrences replaced across all rewritten files.
  occurrencesRewritten: number;
}

type DashboardSlugRenameResult =
  | {
      ok: true;
      kind: EditableKind;
      oldSlug: string;
      newSlug: string;
      oldPath: string;
      newPath: string;
      redirectAppended: string | null;
      redirectSuggestion: DashboardSlugRenamePreview;
      // Only populated for `kind === 'components'`. Null for other
      // kinds, or `{filesChanged: 0, occurrencesRewritten: 0}` when
      // the rename was a no-op for post / page bodies.
      rewrittenReferences?: DashboardComponentReferenceRewriteSummary | null;
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

type DashboardTrashResult =
  | {
      ok: true;
      entry: DashboardTrashEntry;
    }
  | {
      ok: false;
      reason: 'conflict' | 'not-found' | 'already-exists' | 'invalid-kind' | 'forbidden';
      current?: DashboardContentItem;
    };

interface DashboardConflictDiff {
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

export interface DashboardGhostImportPayload {
  file?: string;
  dryRun?: boolean;
  onConflict?: OnConflict;
  outputDir?: string;
  assetsDir?: string;
  downloadImages?: boolean;
  sourceUrl?: string;
  keepCodeInjection?: boolean;
  keepHtml?: boolean;
  maxFileSizeBytes?: number;
  maxPostHtmlSizeBytes?: number;
  maxImageSizeBytes?: number;
}

interface DashboardGhostImportResult {
  ok: true;
  mode: 'dry-run' | 'apply';
  target: string;
  summary: ImportSummary;
}

interface DashboardWatchMetadata {
  watchedPaths: string[];
  warnings: string[];
}

interface DashboardSecurityContext {
  origin: string;
  token: string;
  lanExposed: boolean;
}

type DashboardServerMode = 'dev' | 'prod';

interface DashboardRequestContext {
  cwd: string;
  configPath?: string;
  changeBus: ChangeBus;
  watch?: DashboardWatchMetadata;
  security?: DashboardSecurityContext;
  maxBodyBytes?: number;
  mode?: DashboardServerMode;
  runtimeBundleAssets?: RuntimeBundleAssets;
}

type DashboardTaxonomyFileResult =
  | {
      ok: true;
      kind: 'authors' | 'tags';
      slug: string;
      path: string;
      fingerprint: ContentSourceFingerprint;
    }
  | { ok: false; reason: 'not-found' | 'already-exists' | 'invalid-kind' | 'forbidden' };

interface StartDashboardServerOptions {
  cwd: string;
  configPath?: string;
  port: number;
  host: string;
  mode: DashboardServerMode;
  runtimeBundleAssets?: RuntimeBundleAssets;
}

interface DashboardServerHandle {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export async function startDashboardServer(
  options: StartDashboardServerOptions,
): Promise<DashboardServerHandle> {
  const { cwd, configPath, port, host, mode, runtimeBundleAssets } = options;
  await loadConfig({ cwd, configPath });
  const changeBus = createChangeBus();
  const watchSetup = await watchDashboardFiles({ cwd, configPath, changeBus });
  const token = createDashboardToken();
  const lanExposed = isLanExposedHost(host);

  const buildCtx = (request: Request): DashboardRequestContext => ({
    cwd,
    configPath,
    changeBus,
    watch: watchSetup,
    mode,
    runtimeBundleAssets,
    security: {
      origin: new URL(request.url).origin,
      token,
      lanExposed,
    },
  });

  // Bun 1.3.14's fullstack dev server has a known SourceMapStore memory
  // bug that can segfault the process after many HMR cycles, inside
  // `bake.DevServer.SourceMapStore.addWeakRef` while serving a JS bundle
  // (oven-sh/bun#23617 and related). Bun does not expose a public option
  // to disable source maps for `development: true`, so there is no
  // in-process workaround -- if the dev server crashes mid-session, just
  // restart `nectar dashboard --dev`. The prod (HMR-off) branch below is
  // not affected.
  const server =
    mode === 'dev'
      ? Bun.serve({
          port,
          hostname: host,
          idleTimeout: 255,
          development: { hmr: true, console: true },
          routes: await buildDevRoutes(),
          async fetch(request) {
            return handleDashboardRequest(request, buildCtx(request));
          },
        })
      : Bun.serve({
          port,
          hostname: host,
          idleTimeout: 255,
          async fetch(request) {
            return handleDashboardRequest(request, buildCtx(request));
          },
        });

  const boundPort = server.port ?? port;
  return {
    port: boundPort,
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${boundPort}/`,
    stop: async () => {
      for (const watcher of watchSetup.watchers) watcher.close();
      server.stop(true);
    },
  };
}

async function buildDevRoutes(): Promise<Record<string, Bun.HTMLBundle>> {
  // Load the dev-shell HTML as a Bun route value. The path is resolved at
  // runtime so that `bun build` (which produces the CLI bundle) does not
  // pick this file up as a secondary build entrypoint.
  const htmlPath = new URL('../dashboard/web/dashboard.html', import.meta.url).href;
  const { default: shell } = (await import(htmlPath)) as { default: Bun.HTMLBundle };
  return {
    '/': shell,
    '/posts': shell,
    '/pages': shell,
    '/components': shell,
    '/authors': shell,
    '/tags': shell,
    '/settings': shell,
    '/settings/design': shell,
    '/settings/integration': shell,
    '/settings/migration': shell,
    '/migration': shell,
    '/posts/new': shell,
    '/pages/new': shell,
    '/components/new': shell,
    '/authors/new': shell,
    '/tags/new': shell,
    '/posts/:slug/edit': shell,
    '/pages/:slug/edit': shell,
    '/components/:slug/edit': shell,
    '/authors/:slug/edit': shell,
    '/tags/:slug/edit': shell,
  };
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
  const mode: DashboardServerMode = parsed.values.dev === true ? 'dev' : 'prod';

  // Banner first so the user sees what is about to spin up (version, site,
  // theme, content counts, which bundle path is serving the dashboard JS).
  // The actual server starts below; the Ready block then carries the URL
  // only once the bind succeeds.
  let bannerConfig: NectarConfig;
  try {
    bannerConfig = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
  const version = await getNectarVersion();
  const counts = await countContentFiles(cwd, {
    posts_dir: bannerConfig.content.posts_dir,
    pages_dir: bannerConfig.content.pages_dir,
    components_dir: bannerConfig.content.components_dir,
    authors_dir: bannerConfig.content.authors_dir,
    tags_dir: bannerConfig.content.tags_dir,
  });
  const modeLabel = mode === 'dev' ? 'dashboard (dev, HMR)' : 'dashboard (prod)';
  let runtimeBundleAssets: RuntimeBundleAssets | undefined;
  let autoBuild: AutoBuildResult | undefined;
  if (mode === 'prod') {
    autoBuild = await maybeAutoBuildDashboardBundle({
      noBuild: parsed.values['no-build'] === true,
    });
    runtimeBundleAssets = autoBuild.assets;
  }
  const bundleLabel =
    mode === 'dev'
      ? 'bun fullstack dev server (HMR)'
      : autoBuild?.status === 'built'
        ? 'built from source (web/**)'
        : autoBuild?.status === 'fresh'
          ? 'dist/dashboard-bundle/ (embedded; source unchanged)'
          : autoBuild?.status === 'failed'
            ? 'dist/dashboard-bundle/ (embedded; auto-build failed)'
            : 'dist/dashboard-bundle/ (pre-built)';
  const siteDirLabel = cwd.split('/').pop() || cwd;
  writeBlock(
    renderBanner({
      version,
      mode: modeLabel,
      rows: [
        ['Site', siteDirLabel],
        ['Config', findActiveConfigDisplay(cwd, configPath)],
        ['Theme', bannerConfig.theme.name],
        ['Content', formatContentCounts(counts)],
        ['Bundle', bundleLabel],
      ],
    }),
  );
  emitStartupEvent('dashboard.start', { mode, port, host });

  let handle: DashboardServerHandle;
  try {
    handle = await startDashboardServer({ cwd, configPath, port, host, mode, runtimeBundleAssets });
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  const cleanup = createCleanupRegistry();
  cleanup.register(() => handle.stop(), { name: 'dashboard-server' });

  const configuredSiteUrl =
    typeof bannerConfig.site.url === 'string' ? bannerConfig.site.url : undefined;
  writeBlock(renderSimpleReady({ url: handle.url, siteUrl: configuredSiteUrl }));

  if (isLanExposedHost(host)) {
    writeBlock(
      renderNotice(
        'warning',
        'Exposed on LAN. Keep this URL private — the dashboard can write local project files.',
      ),
    );
  }
  if (mode === 'dev') {
    // Surface the known SourceMapStore segfault (oven-sh/bun#23617 and
    // related) at startup so contributors who hit it during a long HMR
    // session know it is upstream Bun, not Nectar, and that restarting the
    // dev server is the right recovery. The full backstory lives next to
    // the Bun.serve call in startDashboardServer.
    writeBlock(
      renderNotice(
        'warning',
        'Bun 1.3.14 dev server can segfault after many HMR cycles (oven-sh/bun#23617). Restart this command if it happens.',
      ),
    );
  }
  if (autoBuild?.status === 'failed') {
    writeBlock(
      renderNotice(
        'warning',
        `Dashboard auto-build from source failed; serving the embedded bundle. ${autoBuild.detail ?? ''}`.trim(),
      ),
    );
  }
  if (autoBuild?.status === 'built') {
    writeBlock(
      renderNotice(
        'info',
        'Rebuilt the dashboard frontend from source. Use --dev for live hot reload.',
      ),
    );
  }
  const outdatedSkills = await findOutdatedSkills(cwd);
  if (outdatedSkills.length > 0) {
    writeBlock(
      renderNotice(
        'info',
        `${outdatedSkills.length} skill ${outdatedSkills.length === 1 ? 'update' : 'updates'} available — run \`nectar skill install\` to apply.`,
      ),
    );
  }
  emitStartupEvent('dashboard.ready', {
    mode,
    url: handle.url,
    port: handle.port,
    ...counts,
    siteUrl: configuredSiteUrl,
    lanExposed: isLanExposedHost(host),
    skillUpdatesAvailable: outdatedSkills.length,
  });

  if (parsed.values.open === true) {
    openBrowser(handle.url);
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

  const { status: _statusForCounts, ...queryWithoutStatus } = query;
  const postsSearched = applyContentQuery(
    graph.posts.map((post) => postSummary(cwd, post, graph, config)),
    'posts',
    queryWithoutStatus,
  );
  const postsStatusCounts = countSummariesByStatus(postsSearched);
  const posts = filterContentByStatus(postsSearched, query.status);
  const pageSummaries = await Promise.all(
    graph.pages.map(async (item) => {
      const summary = pageSummary(cwd, item, graph, config);
      return {
        ...summary,
        approval: await readApprovalState({
          cwd,
          kind: 'pages',
          slug: summary.slug,
          path: summary.path,
          fingerprint: summary.preview.contentFingerprint,
        }),
      };
    }),
  );
  const pagesSearched = applyContentQuery(pageSummaries, 'pages', queryWithoutStatus);
  const pagesStatusCounts = countSummariesByStatus(pagesSearched);
  const pages = filterContentByStatus(pagesSearched, query.status);
  const paginatedPosts = await withPreviewArtifacts(config, {
    ...paginate(posts, postPage, safePerPage, query),
    statusCounts: postsStatusCounts,
  });
  const paginatedPages = await withPreviewArtifacts(config, {
    ...paginate(pages, pagePage, safePerPage, query),
    statusCounts: pagesStatusCounts,
  });
  const previewFreshness = countPreviewFreshness([
    ...paginatedPosts.items,
    ...paginatedPages.items,
  ]);
  const loadFinishedAt = new Date().toISOString();
  const syncSnapshot = sync ?? defaultSyncSnapshot({ loadStartedAt, loadFinishedAt });
  const git = await readGitStatus(cwd);
  const settingsFingerprint = await settingsFingerprintFor(cwd, configPath);
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
      // From `config.site` (not `graph.site`) to round-trip the on-disk value.
      icon: typeof config.site.icon === 'string' ? config.site.icon : '',
      social: dashboardSocialSettings(config.site),
      ogImage: typeof config.site.og_image === 'string' ? config.site.og_image : '',
      // Read from `config.site` rather than `graph.site` so the dashboard can
      // still edit the values when the operator hasn't flipped
      // `build.allow_code_injection` on yet — `graph.site.codeinjection_*` is
      // wiped to undefined by the gate, but the file content is what we want
      // to round-trip.
      codeinjectionHead:
        typeof config.site.codeinjection_head === 'string' ? config.site.codeinjection_head : '',
      codeinjectionFoot:
        typeof config.site.codeinjection_foot === 'string' ? config.site.codeinjection_foot : '',
      allowCodeInjection: config.build.allow_code_injection === true,
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
    components: paginate(
      await Promise.all((graph.components ?? []).map(async (c) => componentSummary(cwd, c))),
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
        components: config.content.components_dir,
        assets: config.content.assets_dir,
      },
      outputDir: config.build.output_dir,
      theme: {
        name: config.theme.name,
        dir: config.theme.dir,
        available: await listDashboardThemes(cwd, config.theme.dir, config.theme.name),
        status: computeDashboardThemeStatus(cwd, config.theme.dir, config.theme.name),
      },
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
    fingerprint: await settingsFingerprintFor(cwd, configPath),
    site: {
      title: config.site.title,
      description: config.site.description,
      url: config.site.url,
      locale: config.site.locale,
      timezone: config.site.timezone,
      accentColor: config.site.accent_color,
      icon: typeof config.site.icon === 'string' ? config.site.icon : '',
      social: dashboardSocialSettings(config.site),
      ogImage: typeof config.site.og_image === 'string' ? config.site.og_image : '',
      codeinjectionHead:
        typeof config.site.codeinjection_head === 'string' ? config.site.codeinjection_head : '',
      codeinjectionFoot:
        typeof config.site.codeinjection_foot === 'string' ? config.site.codeinjection_foot : '',
      allowCodeInjection: config.build.allow_code_injection === true,
    },
    theme: {
      name: config.theme.name,
      dir: config.theme.dir,
      available: await listDashboardThemes(cwd, config.theme.dir, config.theme.name),
      status: computeDashboardThemeStatus(cwd, config.theme.dir, config.theme.name),
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
    fingerprint: await settingsFingerprintFor(cwd, configPath),
    changedPath: relativePath(cwd, filePath),
  };
}

export async function writeDashboardThemeSettings({
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
  const name = typeof updates.name === 'string' ? updates.name.trim() : '';
  const exists = current.theme.available.some((theme) => theme.name === name);
  if (!name || !exists) {
    return {
      ok: false,
      reason: 'invalid-theme',
      changedPath: current.configPath,
      current,
      theme: name,
    };
  }
  await writeThemeSettingsFile(filePath, { name });
  return {
    ok: true,
    fingerprint: await settingsFingerprintFor(cwd, configPath),
    changedPath: relativePath(cwd, filePath),
  };
}

export async function handleDashboardRequest(
  request: Request,
  ctx: DashboardRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (
      request.method === 'GET' &&
      ([
        '/',
        '/posts',
        '/pages',
        '/components',
        '/authors',
        '/tags',
        '/settings',
        '/settings/design',
        '/settings/integration',
        '/settings/migration',
        '/migration',
      ].includes(url.pathname) ||
        /^\/(?:posts|pages|components|authors|tags)\/new$/.test(url.pathname) ||
        /^\/(?:posts|pages|components|authors|tags)\/[^/]+\/edit$/.test(url.pathname))
    ) {
      return htmlResponse(renderDashboardHtml());
    }
    if (
      request.method === 'GET' &&
      (url.pathname === '/assets/dashboard.js' || url.pathname === '/assets/dashboard.css')
    ) {
      return serveDashboardBundleAsset(url.pathname, ctx.runtimeBundleAssets);
    }
    if (request.method === 'GET' && url.pathname === '/api/themes/active/css') {
      return serveActiveThemeScopedCss({ cwd: ctx.cwd, configPath: ctx.configPath });
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
    if (request.method === 'GET' && url.pathname === '/api/dashboard/bootstrap') {
      const blocked = validateSameOrigin(request, ctx.security, 'forbidden');
      if (blocked) return blocked;
      return jsonResponse({
        token: ctx.security?.token ?? '',
        mode: ctx.mode ?? 'prod',
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/build') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      // Broadcast once the build settles so any other dashboard tab
      // re-reads disk and picks up the new dist/.
      return createBuildStreamResponse({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        onComplete: ({ ok }) => {
          if (ok) ctx.changeBus.broadcast({ reason: 'build-complete', kind: 'project' });
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/build/export.zip') {
      return createExportZipResponse({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
      });
    }
    if (
      request.method === 'GET' &&
      (url.pathname === '/preview/content' || url.pathname === '/preview/artifact')
    ) {
      const route = stringParam(url, 'route') ?? '/';
      return serveDashboardContentPreview({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        route,
      });
    }
    if (request.method === 'GET') {
      const asset = await serveDashboardPreviewAsset({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        pathname: url.pathname,
      });
      if (asset) return asset;
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
        rewriteReferences?: boolean;
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
        rewriteReferences: payload.rewriteReferences !== false,
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
    const contentTrashMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/([^/]+)\/trash$/);
    if (request.method === 'POST' && contentTrashMatch) {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const kind = parseEditableKind(contentTrashMatch[1] ?? '');
      const slug = decodeURIComponent(contentTrashMatch[2] ?? '');
      if (kind === undefined || !SLUG_RE.test(slug)) {
        return jsonResponse({ error: 'invalid content path' }, 400);
      }
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
    if (request.method === 'POST' && url.pathname === '/api/import/ghost') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      // Accept either JSON (legacy local-path) or multipart upload.
      const contentType = request.headers.get('content-type') ?? '';
      let payload: DashboardGhostImportPayload;
      let stagedPath: string | undefined;
      if (contentType.startsWith('multipart/')) {
        const form = await request.formData().catch(() => null);
        const file = form?.get('file');
        if (!(file instanceof File)) {
          return jsonResponse({ error: 'file field is required (multipart/form-data)' }, 400);
        }
        const MAX_BYTES = 200 * 1024 * 1024;
        if (file.size > MAX_BYTES) {
          return jsonResponse({ error: 'ghost export exceeds 200MB limit' }, 413);
        }
        // Parse + validate scalar fields *before* staging the upload so a bad
        // request doesn't leak a file under .nectar/ (the unlink() in finally
        // below only runs after stagedPath is set inside the try-block).
        const rawDownloadImages = form?.get('downloadImages');
        const downloadImages =
          typeof rawDownloadImages === 'string'
            ? rawDownloadImages === 'true'
              ? true
              : rawDownloadImages === 'false'
                ? false
                : undefined
            : undefined;
        const rawMaxImageSize = form?.get('maxImageSizeBytes');
        let maxImageSizeBytes: number | undefined;
        if (typeof rawMaxImageSize === 'string' && rawMaxImageSize.trim().length > 0) {
          const parsed = Number(rawMaxImageSize);
          if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
            return jsonResponse({ error: 'maxImageSizeBytes must be a non-negative integer' }, 400);
          }
          maxImageSizeBytes = parsed;
        }
        const safe = (file.name || 'ghost-export').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
        stagedPath = resolve(ctx.cwd, '.nectar', `import-ghost-${Date.now()}-${safe}`);
        await mkdir(dirname(stagedPath), { recursive: true });
        await Bun.write(stagedPath, new Uint8Array(await file.arrayBuffer()));
        payload = {
          file: stagedPath,
          dryRun: String(form?.get('dryRun') ?? 'true') !== 'false',
          onConflict:
            (form?.get('onConflict') as DashboardGhostImportPayload['onConflict']) ?? 'skip',
          outputDir: (form?.get('outputDir') as string | null) ?? undefined,
          downloadImages,
          maxImageSizeBytes,
          sourceUrl: (form?.get('sourceUrl') as string | null) ?? undefined,
        };
      } else {
        const json = await readJsonPayload<DashboardGhostImportPayload>(request, ctx.maxBodyBytes);
        if (json instanceof Response) return json;
        payload = json;
      }
      // Multipart uploads come from the dashboard UI and benefit from the
      // streaming progress feed — the per-image download events drive the
      // full-screen import overlay. JSON callers (CLI parity / scripted
      // imports) keep the single-shot JSON response so existing consumers
      // don't have to learn the NDJSON framing.
      if (contentType.startsWith('multipart/')) {
        return createGhostImportStreamResponse({
          cwd: ctx.cwd,
          payload,
          stagedPath,
          onComplete: ({ ok }) => {
            if (ok && payload.dryRun === false) {
              ctx.changeBus.broadcast({ reason: 'dashboard-import', kind: 'project' });
              enqueueDashboardImageVariantGeneration({
                cwd: ctx.cwd,
                configPath: ctx.configPath,
                reason: 'Ghost import',
              });
            }
          },
        });
      }
      try {
        const result = await runDashboardGhostImport({ cwd: ctx.cwd, payload });
        if (result.mode === 'apply') {
          ctx.changeBus.broadcast({ reason: 'dashboard-import', kind: 'project' });
          enqueueDashboardImageVariantGeneration({
            cwd: ctx.cwd,
            configPath: ctx.configPath,
            reason: 'Ghost import',
          });
        }
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
      } finally {
        if (stagedPath) await unlink(stagedPath).catch(() => {});
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/bundles/export') {
      const kind = stringParam(url, 'kind');
      const slug = stringParam(url, 'slug');
      if (kind !== 'post' && kind !== 'page') {
        return jsonResponse({ error: 'kind must be post or page' }, 400);
      }
      if (!slug) {
        return jsonResponse({ error: 'slug is required' }, 400);
      }
      if (!SLUG_RE.test(slug)) {
        return jsonResponse({ error: 'invalid slug' }, 400);
      }
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      try {
        const { zip } = await exportEntryBundle({ cwd: ctx.cwd, config, kind, slug });
        return new Response(zip, {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${slug}.nectar.zip"`,
          },
        });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 404);
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/bundles/import') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) {
        return jsonResponse({ error: 'file field is required (multipart/form-data)' }, 400);
      }
      const MAX_BYTES = 50 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        return jsonResponse({ error: 'entry bundle exceeds 50MB limit' }, 413);
      }
      const dryRun = String(form?.get('dryRun') ?? 'true') !== 'false';
      const rawOnConflict = form?.get('onConflict');
      const onConflict: 'skip' | 'overwrite' | 'rename' =
        rawOnConflict === 'overwrite' || rawOnConflict === 'rename' ? rawOnConflict : 'skip';
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      try {
        const result = await importEntryBundle({
          cwd: ctx.cwd,
          config,
          zip: new Uint8Array(await file.arrayBuffer()),
          onConflict,
          dryRun,
        });
        if (result.written) {
          ctx.changeBus.broadcast({
            reason: 'bundle-import',
            kind: result.kind === 'post' ? 'posts' : 'pages',
          });
        }
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/components/bundle/export') {
      // Bulk handoff of reusable component snippets. `slugs` (comma-separated)
      // selects a subset; omitting it exports every component. Read-only, so a
      // plain GET (anchor download) is fine — no write gate needed.
      const slugsRaw = stringParam(url, 'slugs');
      const slugs = slugsRaw
        ? slugsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      if (slugs?.some((s) => !COMPONENT_SLUG_PATTERN.test(s))) {
        return jsonResponse({ error: 'invalid component slug' }, 400);
      }
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      try {
        const { zip, missing, omittedAssets } = await exportComponentsBundle({
          cwd: ctx.cwd,
          config,
          slugs,
        });
        const headers: Record<string, string> = {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="components.nectar.zip"',
        };
        // Surface format-valid-but-nonexistent slugs to programmatic callers:
        // exportComponentsBundle returns a partial zip (it only throws when
        // *every* requested slug is missing), so without this header an API
        // client has no way to learn that a requested component was skipped.
        if (missing.length > 0) headers['x-nectar-missing-components'] = missing.join(',');
        // Likewise surface assets that a component references but could not be
        // bundled (missing / unsafe / symlinked) so the receiver knows an image
        // will be absent.
        if (omittedAssets.length > 0) {
          headers['x-nectar-omitted-assets'] = omittedAssets.join(',');
        }
        return new Response(zip, { headers });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 404);
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/components/bundle/import') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) {
        return jsonResponse({ error: 'file field is required (multipart/form-data)' }, 400);
      }
      const MAX_BYTES = 50 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        return jsonResponse({ error: 'components bundle exceeds 50MB limit' }, 413);
      }
      const dryRun = String(form?.get('dryRun') ?? 'true') !== 'false';
      const rawOnConflict = form?.get('onConflict');
      const onConflict: 'skip' | 'overwrite' | 'rename' =
        rawOnConflict === 'overwrite' || rawOnConflict === 'rename' ? rawOnConflict : 'skip';
      // Optional allowlist: the editor can untick snippets in the preview so
      // only a subset of the bundle lands. Absent/empty means import everything.
      const slugsRaw = form?.get('slugs');
      const slugs =
        typeof slugsRaw === 'string' && slugsRaw.length > 0
          ? slugsRaw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      if (slugs?.some((s) => !COMPONENT_SLUG_PATTERN.test(s))) {
        return jsonResponse({ error: 'invalid component slug' }, 400);
      }
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      try {
        const result = await importComponentsBundle({
          cwd: ctx.cwd,
          config,
          zip: new Uint8Array(await file.arrayBuffer()),
          onConflict,
          dryRun,
          slugs,
        });
        if (result.written > 0) {
          ctx.changeBus.broadcast({ reason: 'components-bundle-import', kind: 'components' });
        }
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
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
    /* OGP metadata fetch — proxied through the server so the browser
     * never makes the outbound request directly (SSRF-gated by
     * validateWriteRequest + IP classification inside fetchOgp). Failures
     * are returned as HTTP 200 with ok:false so the client treats all
     * error kinds uniformly without leaking SSRF signal via status code. */
    if (request.method === 'POST' && url.pathname === '/api/ogp') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const body = await request.json().catch(() => null);
      const targetUrl =
        typeof (body as { url?: unknown })?.url === 'string' ? (body as { url: string }).url : '';
      const result = await fetchOgp(targetUrl, {
        fetch: (u, init) => fetch(u, init),
        lookup: async (host) => {
          const { address } = await dnsLookup(host);
          return address;
        },
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        maxRedirects: 3,
      });
      return jsonResponse(result, 200);
    }
    /* Image upload — multipart/form-data with one `file` field. The
     * file is written under content/images/ with a slug-safe name and
     * the returned path can be inlined into Markdown as
     * `![alt](/content/images/<name>)`. */
    if (request.method === 'POST' && url.pathname === '/api/images') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) {
        return jsonResponse({ error: 'file field is required (multipart/form-data)' }, 400);
      }
      const ALLOWED = new Set([
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'image/avif',
        // .ico is accepted primarily so the Settings favicon control can
        // upload a classic favicon; browsers report it as either of these.
        'image/x-icon',
        'image/vnd.microsoft.icon',
      ]);
      if (!ALLOWED.has(file.type)) {
        return jsonResponse({ error: `unsupported image type "${file.type || 'unknown'}"` }, 415);
      }
      const MAX_BYTES = 8 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        return jsonResponse({ error: 'image exceeds 8MB limit' }, 413);
      }
      const ts = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14);
      const safe =
        (file.name || 'pasted')
          .toLowerCase()
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || 'image';
      const ext =
        file.type === 'image/jpeg'
          ? 'jpg'
          : file.type === 'image/svg+xml'
            ? 'svg'
            : file.type === 'image/x-icon' || file.type === 'image/vnd.microsoft.icon'
              ? 'ico'
              : (file.type.split('/')[1] ?? 'bin');
      const filename = `${ts}-${safe}.${ext}`;
      const targetDir = resolve(ctx.cwd, 'content', 'images');
      await mkdir(targetDir, { recursive: true });
      const targetPath = resolve(targetDir, filename);
      const buf = new Uint8Array(await file.arrayBuffer());
      await Bun.write(targetPath, buf);
      const relPath = `/content/images/${filename}`;
      ctx.changeBus.broadcast({
        reason: 'image-upload',
        kind: 'project',
        changedPath: relPath,
      });
      enqueueDashboardImageVariantGeneration({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        reason: 'image upload',
      });
      return jsonResponse({ ok: true, path: relPath, name: filename, size: file.size }, 201);
    }
    /* Theme upload — POST /api/themes/upload accepts a multipart
     * .zip and extracts it into <themes-dir>/<safe-name>/ via the
     * system `unzip` command. The extracted top-level folder name is
     * used as the theme name (sanitised); if the user supplied a
     * `name` field in the form, that wins. */
    if (request.method === 'POST' && url.pathname === '/api/themes/upload') {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) {
        return jsonResponse({ error: 'file field is required (multipart/form-data)' }, 400);
      }
      const ALLOWED_TYPES = new Set([
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
      ]);
      if (!ALLOWED_TYPES.has(file.type) && !/\.zip$/i.test(file.name || '')) {
        return jsonResponse(
          { error: `expected a .zip archive, got "${file.type || 'unknown'}"` },
          415,
        );
      }
      const MAX_BYTES = 50 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        return jsonResponse({ error: 'theme archive exceeds 50MB limit' }, 413);
      }
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const themesRoot = isAbsolute(config.theme.dir)
        ? config.theme.dir
        : resolve(ctx.cwd, config.theme.dir);
      const rawName =
        String(form?.get('name') ?? '').trim() || (file.name || 'theme').replace(/\.zip$/i, '');
      const safeName = rawName
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 64);
      if (!safeName) return jsonResponse({ error: 'invalid theme name' }, 400);
      const destDir = resolve(themesRoot, safeName);
      if (!destDir.startsWith(`${themesRoot}/`) && destDir !== themesRoot) {
        return jsonResponse({ error: 'theme path escapes themes directory' }, 400);
      }
      await mkdir(themesRoot, { recursive: true });
      // Stage the upload to a tmp file, then extract via `unzip -o`.
      const tmpZip = resolve(themesRoot, `.upload-${Date.now()}-${safeName}.zip`);
      const buf = new Uint8Array(await file.arrayBuffer());
      await Bun.write(tmpZip, buf);
      try {
        await mkdir(destDir, { recursive: true });
        const proc = Bun.spawn(['unzip', '-o', '-q', tmpZip, '-d', destDir], {
          stderr: 'pipe',
          stdout: 'pipe',
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          const err = await new Response(proc.stderr).text();
          return jsonResponse(
            { error: `unzip failed (exit ${exitCode}): ${err.slice(0, 400)}` },
            500,
          );
        }
        // If the archive wrapped everything in a single top-level
        // folder, hoist it so the theme lives directly under destDir.
        const entries = await readdir(destDir);
        const visible = entries.filter((name) => !name.startsWith('.'));
        if (visible.length === 1) {
          const onlyChild = resolve(destDir, visible[0] ?? '');
          const stat = await Bun.file(onlyChild)
            .stat()
            .catch(() => null);
          if (stat?.isDirectory()) {
            const children = await readdir(onlyChild);
            for (const child of children) {
              await rename(resolve(onlyChild, child), resolve(destDir, child));
            }
            await rmdir(onlyChild).catch(() => {});
          }
        }
      } finally {
        await unlink(tmpZip).catch(() => {});
      }
      // Activate the uploaded theme by writing [theme].name so that
      // preview/build pick it up immediately, without forcing the
      // operator to re-select it from the themes list.
      const configFilePath = resolveConfigPath(ctx.cwd, ctx.configPath);
      await writeThemeSettingsFile(configFilePath, { name: safeName });
      ctx.changeBus.broadcast({
        reason: 'theme-upload',
        kind: 'settings',
        changedPath: destDir,
      });
      return jsonResponse({ ok: true, name: safeName, dir: destDir, active: true }, 201);
    }
    const approvalMatch = url.pathname.match(/^\/api\/approvals\/pages\/([^/]+)$/);
    if (request.method === 'POST' && approvalMatch) {
      const blocked = validateWriteRequest(request, ctx.security);
      if (blocked) return blocked;
      const slug = decodeURIComponent(approvalMatch[1] ?? '');
      if (!SLUG_RE.test(slug)) return jsonResponse({ error: 'invalid page slug' }, 400);
      const payload = await readJsonPayload<{
        fingerprint?: ContentSourceFingerprint;
        approvedBy?: string;
      }>(request, ctx.maxBodyBytes);
      if (payload instanceof Response) return payload;
      if (!payload.fingerprint) return jsonResponse({ error: 'fingerprint is required' }, 400);
      const config = await loadConfig({ cwd: ctx.cwd, configPath: ctx.configPath });
      const current = await readDashboardContentItem({ cwd: ctx.cwd, config, kind: 'pages', slug });
      if (!sameContentFingerprint(current.fingerprint, payload.fingerprint)) {
        return jsonResponse({ ok: false, reason: 'conflict', current }, 409);
      }
      const raw = await readFile(resolve(ctx.cwd, current.path), 'utf8');
      const result = await writeApprovalReceipt({
        cwd: ctx.cwd,
        kind: 'pages',
        slug,
        path: current.path,
        fingerprint: current.fingerprint,
        approvedBy: payload.approvedBy,
        markdown: raw,
      });
      ctx.changeBus.broadcast({
        reason: 'page-approval-write',
        kind: 'pages',
        changedPath: result.changedPath,
      });
      return jsonResponse({ ok: true, ...result }, 201);
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
      const typeError = findSettingsTypeErrors(payload.updates);
      if (typeError) return jsonResponse(typeError, 400);
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
    if (request.method === 'PATCH' && url.pathname === '/api/settings/theme') {
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
      const invalidSettingsFields = findInvalidThemeSettingsFields(payload.updates);
      if (invalidSettingsFields.length > 0) {
        return jsonResponse(
          { error: 'unknown theme settings fields', fields: invalidSettingsFields },
          400,
        );
      }
      const result = await writeDashboardThemeSettings({
        cwd: ctx.cwd,
        configPath: ctx.configPath,
        expectedFingerprint: payload.fingerprint,
        updates: payload.updates,
      });
      if (!result.ok) return jsonResponse(result, result.reason === 'conflict' ? 409 : 400);
      ctx.changeBus.broadcast({
        reason: 'theme-settings-write',
        kind: 'settings',
        changedPath: result.changedPath,
      });
      return jsonResponse(result);
    }
    return notFoundResponse(request);
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function runDashboardGhostImport({
  cwd,
  payload,
}: {
  cwd: string;
  payload: DashboardGhostImportPayload;
}): Promise<DashboardGhostImportResult> {
  const file = typeof payload.file === 'string' ? payload.file.trim() : '';
  if (!file) throw new Error('file is required');
  const onConflict = payload.onConflict ?? 'skip';
  if (!ON_CONFLICT_VALUES.includes(onConflict)) {
    throw new Error(`invalid onConflict: ${String(payload.onConflict)}`);
  }
  const dryRun = payload.dryRun !== false;
  const outputDir = cleanOptionalString(payload.outputDir);
  const summary = await importGhostExport({
    cwd,
    file,
    onConflict,
    dryRun,
    outputDir,
    assetsDir: cleanOptionalString(payload.assetsDir),
    downloadImages: payload.downloadImages === true,
    sourceUrl: cleanOptionalString(payload.sourceUrl),
    keepCodeInjection: payload.keepCodeInjection === true,
    keepHtml: payload.keepHtml === true,
    maxFileSizeBytes: optionalNonNegativeInteger(payload.maxFileSizeBytes, 'maxFileSizeBytes'),
    maxPostHtmlSizeBytes: optionalNonNegativeInteger(
      payload.maxPostHtmlSizeBytes,
      'maxPostHtmlSizeBytes',
    ),
    maxImageSizeBytes: optionalNonNegativeInteger(payload.maxImageSizeBytes, 'maxImageSizeBytes'),
  });
  return {
    ok: true,
    mode: dryRun ? 'dry-run' : 'apply',
    target: outputDir ?? 'content/',
    summary,
  };
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
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
  if (kind === 'authors' || kind === 'tags' || kind === 'components') {
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
      if (status !== 'published' && status !== 'draft') {
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

// Walk `dir` recursively and yield every regular `.md` file path.
// Tolerant: dirs that don't exist or can't be read return nothing
// rather than throwing — the rename flow doesn't want to fail because
// a sibling content dir was momentarily missing.
async function* walkMarkdownFiles(dir: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(full);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) yield full;
  }
}

// Walk posts + pages, rewrite `{oldSlug}` → `{newSlug}` in each body
// (skipping code regions per the renderer's contract), and write back
// only the files that actually changed. Returns aggregate counts so
// the dashboard can surface "renamed; rewrote N references in M files".
async function rewriteComponentReferencesInContent({
  cwd,
  config,
  oldSlug,
  newSlug,
}: {
  cwd: string;
  config: NectarConfig;
  oldSlug: string;
  newSlug: string;
}): Promise<DashboardComponentReferenceRewriteSummary> {
  let filesChanged = 0;
  let occurrencesRewritten = 0;
  const roots = [config.content.posts_dir, config.content.pages_dir].map((d) => absolutise(cwd, d));
  for (const root of roots) {
    for await (const file of walkMarkdownFiles(root)) {
      const raw = await readFile(file, 'utf8');
      const { frontmatter, body } = splitFrontmatterRaw(raw);
      const result = rewriteComponentSlugInBody(body, oldSlug, newSlug);
      if (result.count === 0) continue;
      await writeFile(file, frontmatter + result.body, 'utf8');
      filesChanged += 1;
      occurrencesRewritten += result.count;
    }
  }
  return { filesChanged, occurrencesRewritten };
}

export async function renameDashboardContentSlug({
  cwd,
  config,
  kind,
  oldSlug,
  newSlug,
  expectedFingerprint,
  redirect,
  rewriteReferences,
}: {
  cwd: string;
  config: NectarConfig;
  kind: EditableKind;
  oldSlug: string;
  newSlug: string;
  expectedFingerprint: ContentSourceFingerprint;
  redirect?: boolean;
  // Only meaningful for `kind === 'components'`. Defaults to `true`
  // so the dashboard rename UX automatically keeps post / page bodies
  // in sync; CLI / scripted callers can pass `false` to opt out.
  rewriteReferences?: boolean;
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
  // For components, keep `{old}` references in post / page bodies in
  // sync with the rename so the build-side expander doesn't start
  // emitting `missing` warnings for what used to be a live snippet.
  // Other kinds (authors, tags) have their own dedicated rewriters
  // earlier in this function; posts and pages have no inbound
  // shortcode references so the summary stays null.
  const rewrittenReferences =
    kind === 'components' && rewriteReferences !== false
      ? await rewriteComponentReferencesInContent({
          cwd,
          config,
          oldSlug,
          newSlug: normalizedNewSlug,
        })
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
    rewrittenReferences,
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
  kind: EditableKind;
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
  // A tag/author is also reconstructed from any post that references it, so
  // removing only the file would leave a "generated" stub in the dashboard.
  // Strip the reference from every post/page frontmatter and remember the
  // pre-edit text so a later restore can put both the file and the references
  // back. Posts/pages/components never cascade.
  const cascadeSnapshots: TaxonomyCascadeSnapshot[] =
    kind === 'tags' || kind === 'authors'
      ? await cascadeRemoveTaxonomyReferences({
          cwd,
          config,
          kind,
          slug,
          serialize: serializeContentSource,
        })
      : [];
  const metadata = {
    slug,
    kind,
    original_path: current.path,
    trash_path: relativePath(cwd, trashPath),
    trashed_at: trashedAt,
    purge_after: purgeAfter,
    ...(cascadeSnapshots.length > 0
      ? {
          affected_files: cascadeSnapshots.map((snapshot) => ({
            path: relativePath(cwd, snapshot.path),
            previous_text: snapshot.previousText,
          })),
        }
      : {}),
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
  // Put back the post/page frontmatter the cascade rewrote. Best-effort: if a
  // referencing file was since edited or removed we skip it with a warning
  // rather than failing the whole restore — the taxonomy file is already back.
  for (const file of entry.affectedFiles ?? []) {
    const target = resolve(cwd, file.path);
    if (!isInsidePath(cwd, target)) continue;
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.previousText, 'utf8');
    } catch (err) {
      logger.warn(
        `Could not restore ${file.path} reference: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
    approval: null,
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
    approval: null,
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
    state: 'current',
    label: 'Markdown preview',
    route,
    openUrl: '',
    artifactPath: null,
    artifactMtimeMs: null,
    sourcePath: contentFingerprint?.path ?? null,
    contentFingerprint,
    detail: 'Preview renders the saved Markdown through the active theme without reading dist.',
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
    source: editable ? 'file' : 'generated',
    materializePath: `${
      kind === 'authors' ? config.content.authors_dir : config.content.tags_dir
    }/${item.slug}.md`,
  };
}

async function componentSummary(
  cwd: string,
  component: ComponentSnippet,
): Promise<DashboardComponentSummary> {
  return {
    slug: component.slug,
    description: component.description,
    css: component.css,
    html: component.html,
    hasCss: component.css.length > 0,
    hasHtml: component.html.length > 0,
    path: component.source.path,
    fingerprint: await optionalFingerprintFor(cwd, join(cwd, component.source.path)),
  };
}

function countSummariesByStatus(items: DashboardContentSummary[]): DashboardStatusCounts {
  const counts: DashboardStatusCounts = {
    all: items.length,
    draft: 0,
    published: 0,
    needsReview: 0,
  };
  for (const item of items) {
    if (item.status === 'draft') counts.draft += 1;
    else if (item.status === 'published') counts.published += 1;
    else if (item.status === 'needs-review') counts.needsReview += 1;
  }
  return counts;
}

function filterContentByStatus(
  items: DashboardContentSummary[],
  status: string | undefined,
): DashboardContentSummary[] {
  if (status === undefined) return items;
  return items.filter((item) => item.status === status);
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
  config: NectarConfig,
  list: DashboardList<DashboardContentSummary>,
): Promise<DashboardList<DashboardContentSummary>> {
  return {
    ...list,
    items: await Promise.all(
      list.items.map(async (item) => ({
        ...item,
        preview: await resolveDashboardPreviewArtifact(config, item),
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
  config: NectarConfig,
  item: DashboardContentSummary,
): Promise<DashboardPreviewArtifact> {
  const route = routePathFromContentUrl(item.url, config);
  const openUrl = `/preview/content?route=${encodeURIComponent(route)}`;
  return {
    ...item.preview,
    state: item.preview.contentFingerprint ? 'current' : 'missing',
    label: item.preview.contentFingerprint ? 'Markdown preview' : 'Preview unavailable',
    route,
    openUrl,
    sourcePath: item.preview.contentFingerprint?.path ?? item.path,
    detail: item.preview.contentFingerprint
      ? 'Preview renders the latest saved Markdown with the active theme and source assets; dist remains the prebuilt deploy output.'
      : 'No saved Markdown source is available for this preview.',
  };
}

async function serveDashboardContentPreview({
  cwd,
  configPath,
  route,
}: {
  cwd: string;
  configPath?: string;
  route: string;
}): Promise<Response> {
  const preview = await renderDashboardContentPreview({ cwd, configPath, route });
  if (!preview) return new Response('Preview route not found', { status: 404 });
  return new Response(preview.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
}

interface DashboardPreviewRenderContext {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  engine: NectarEngine;
  routes: RouteContext[];
  pluginSet: LoadedPluginSet;
  pluginCtx: BuildContext;
  contentImagePlan: ContentImageAssetPlan;
}

async function renderDashboardContentPreview({
  cwd,
  configPath,
  route,
}: {
  cwd: string;
  configPath?: string;
  route: string;
}): Promise<{ html: string; route: RouteContext } | undefined> {
  const ctx = await loadDashboardPreviewRenderContext({ cwd, configPath });
  const target = findDashboardPreviewRoute(ctx.routes, route);
  if (!target) return undefined;
  const html = await renderRouteHtml({
    cwd,
    config: ctx.config,
    content: ctx.content,
    theme: ctx.theme,
    engine: ctx.engine,
    route: target,
    plugins: ctx.pluginSet.plugins,
    pluginCtx: ctx.pluginCtx,
    contentImagePlan: ctx.contentImagePlan,
    portalUrls: resolvePortalUrls(ctx.config.components.portal),
    recommendationsEnabled: ctx.config.recommendations.length > 0,
  });
  return {
    html: await filterUnavailablePreviewPictureSources(html, { cwd, config: ctx.config }),
    route: target,
  };
}

async function loadDashboardPreviewRenderContext({
  cwd,
  configPath,
}: {
  cwd: string;
  configPath?: string;
}): Promise<DashboardPreviewRenderContext> {
  const config = await loadConfig({ cwd, configPath });
  const routesYaml = await loadRoutesYaml(cwd);
  const pluginSet = await loadPlugins({
    cwd,
    specs: config.plugins,
    autoDetect: config.plugin_auto_detect,
  });
  const markdownTransforms: MarkdownTransformHook[] = [];
  for (const plugin of pluginSet.plugins) {
    if (typeof plugin.transformMarkdown === 'function') {
      const fn = plugin.transformMarkdown.bind(plugin);
      markdownTransforms.push((input, ctx) => fn(input, ctx));
    }
  }
  const [content, theme] = await Promise.all([
    loadContent({
      cwd,
      config,
      routesYaml,
      includeDrafts: true,
      includeFuturePosts: true,
      markdownTransforms,
      pageApprovalGate: true,
    }),
    loadTheme({ cwd, config }),
  ]);
  validateThemeCustom({ config, pkg: theme.pkg });
  injectImageDimensionsIntoContent({ content, cwd, config });
  const imageVariantPlan = await planImageVariants({ cwd, config });
  injectImageSrcsetIntoContent({ content, plan: imageVariantPlan });
  collapseDegenerateSrcsetIntoContent({ content });
  const imagesCfg = config.components.images;
  const formatVariants: readonly ImageFormat[] =
    imagesCfg.enabled && imagesCfg.formats.length > 0 && (await isSharpAvailable())
      ? imagesCfg.formats
      : [];
  if (formatVariants.length > 0) {
    injectImagePictureSourcesIntoContent({
      content,
      plan: imageVariantPlan,
      formats: formatVariants,
    });
  }
  const favicons = computeFavicons({ config, theme, cwd });
  const engine = createEngine({ config, content, theme, favicons, cwd });
  await loadInlineHelpers(cwd, config.components.helpers.paths, engine);
  const outputDir = isAbsolute(config.build.output_dir)
    ? config.build.output_dir
    : resolve(cwd, config.build.output_dir);
  const pluginCtx: BuildContext = { cwd, outputDir, config, content, theme, engine };
  await invokeDashboardPreviewHook(pluginSet, async (plugin) => {
    if (plugin.beforeBuild) await plugin.beforeBuild(pluginCtx);
  });
  await invokeDashboardPreviewHook(pluginSet, async (plugin) => {
    if (plugin.afterContentLoad) await plugin.afterContentLoad(pluginCtx, content);
  });
  const routes = planRoutes({ config, content, theme, routesYaml });
  const contentImagePlan = config.build.copy_content_assets
    ? await planContentImageAssets(cwd, config.content.assets_dir, {
        maxImageBytes: config.build.max_image_bytes,
        stripMetadata: config.components.images.strip_metadata,
      })
    : { entries: [], byRel: new Map() };
  return { config, content, theme, engine, routes, pluginSet, pluginCtx, contentImagePlan };
}

async function invokeDashboardPreviewHook(
  set: LoadedPluginSet,
  fn: (plugin: LoadedPluginSet['plugins'][number]) => Promise<void> | void,
): Promise<void> {
  for (const plugin of set.plugins) await fn(plugin);
}

function findDashboardPreviewRoute(
  routes: readonly RouteContext[],
  requested: string,
): RouteContext | undefined {
  const normalized = normalizePreviewRoutePath(requested);
  if (!normalized) return undefined;
  return routes.find((route) => normalizePreviewRoutePath(route.url) === normalized);
}

async function serveDashboardPreviewAsset({
  cwd,
  configPath,
  pathname,
}: {
  cwd: string;
  configPath?: string;
  pathname: string;
}): Promise<Response | undefined> {
  const config = await loadConfig({ cwd, configPath });
  const normalized = stripPreviewBasePath(safeDecodeRoutePath(pathname), config);
  if (normalized === `/${CARD_ASSETS_CSS_PATH}` || normalized === `/${CARD_ASSETS_JS_PATH}`) {
    const theme = await loadTheme({ cwd, config });
    if (!isCardAssetsEnabled(theme.pkg.card_assets)) return undefined;
    if (normalized === `/${CARD_ASSETS_CSS_PATH}`) {
      return cssResponse(renderCardAssetsCss(theme.pkg.card_assets));
    }
    return javascriptResponse(renderCardAssetsJs(theme.pkg.card_assets));
  }
  if (normalized.startsWith('/assets/')) {
    const theme = await loadTheme({ cwd, config });
    const rel = normalized.slice(1);
    const asset = [...theme.assets.values()].find(
      (item) => item.fingerprintedPath === rel || item.logicalPath === rel,
    );
    if (!asset) return undefined;
    return fileResponse(theme.rootDir, asset.sourcePath);
  }
  const contentAssetsPrefix = `/${config.content.assets_dir.replace(/^\/+|\/+$/g, '')}/`;
  if (normalized.startsWith(contentAssetsPrefix)) {
    const requestedRel = normalized.slice(contentAssetsPrefix.length);
    const generated = await dashboardPreviewGeneratedImageResponse({
      cwd,
      requestedRel,
    });
    if (generated) return generated;
    const rel = stripGhostImageTransformSegments(requestedRel);
    return fileResponse(
      resolve(cwd, config.content.assets_dir),
      resolve(cwd, config.content.assets_dir, rel),
    );
  }
  if (normalized.startsWith('/_images/')) {
    const plan = await planContentImageAssets(cwd, config.content.assets_dir, {
      maxImageBytes: config.build.max_image_bytes,
      stripMetadata: config.components.images.strip_metadata,
    });
    const outputRel = normalized.slice(1);
    const entry = plan.entries.find((item) => item.outputRel === outputRel);
    if (!entry) return undefined;
    return fileResponse(resolve(cwd, config.content.assets_dir), entry.sourcePath);
  }
  return undefined;
}

function stripPreviewBasePath(pathname: string, config: NectarConfig): string {
  const basePath = normalizeBasePathForPreview(config.build.base_path);
  if (basePath === '/') return pathname;
  if (pathname === basePath.slice(0, -1)) return '/';
  if (!pathname.startsWith(basePath)) return pathname;
  return `/${pathname.slice(basePath.length).replace(/^\/+/, '')}`;
}

function stripGhostImageTransformSegments(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (part === 'size' && parts[i + 1]?.startsWith('w')) {
      i += 1;
      continue;
    }
    if (part === 'format' && parts[i + 1]) {
      i += 1;
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

async function dashboardPreviewGeneratedImageResponse({
  cwd,
  requestedRel,
}: {
  cwd: string;
  requestedRel: string;
}): Promise<Response | undefined> {
  if (!isGhostImageTransformRel(requestedRel)) return undefined;
  return fileResponse(
    resolve(dashboardPreviewImageOutputDir(cwd), 'content/images'),
    resolve(dashboardPreviewImageOutputDir(cwd), 'content/images', requestedRel),
  );
}

function isGhostImageTransformRel(rel: string): boolean {
  if (rel === '' || rel.includes('..')) return false;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  return parts[0] === 'size' || parts[0] === 'format';
}

export async function filterUnavailablePreviewPictureSources(
  html: string,
  opts: { cwd: string; config: NectarConfig },
): Promise<string> {
  if (!html.includes('<source') || !html.includes('/content/images/')) return html;
  return html.replace(/<source\b([^>]*?)(\/?)>/gi, (match, attrsRaw: string) => {
    const attrs = parseHtmlAttrs(attrsRaw);
    const srcset = attrs.get('srcset');
    if (typeof srcset !== 'string' || srcset.trim() === '') return match;
    const urls = parsePreviewSrcsetUrls(srcset);
    if (urls.length === 0) return match;
    const localVariantUrls = urls.filter((candidate) =>
      previewContentImageVariantPath(candidate, opts),
    );
    if (localVariantUrls.length === 0) return match;
    const allExist = localVariantUrls.every((candidate) => {
      const filePath = previewContentImageVariantPath(candidate, opts);
      return filePath ? existsSync(filePath) : true;
    });
    return allExist ? match : '';
  });
}

function parsePreviewSrcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const space = part.search(/\s/);
      return space < 0 ? part : part.slice(0, space);
    });
}

const HTML_ATTR_RE =
  /([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseHtmlAttrs(attrsRaw: string): Map<string, string | true> {
  const out = new Map<string, string | true>();
  HTML_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null = HTML_ATTR_RE.exec(attrsRaw);
  while (match !== null) {
    const rawName = match[1];
    if (rawName) {
      out.set(rawName.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? true);
    }
    match = HTML_ATTR_RE.exec(attrsRaw);
  }
  return out;
}

function previewContentImageVariantPath(
  rawUrl: string,
  opts: { cwd: string; config: NectarConfig },
): string | undefined {
  const pathname = normalizePreviewLocalPathname(rawUrl, opts.config);
  if (!pathname) return undefined;
  const contentAssetsPrefix = `/${opts.config.content.assets_dir.replace(/^\/+|\/+$/g, '')}/`;
  if (!pathname.startsWith(contentAssetsPrefix)) return undefined;
  const rel = pathname.slice(contentAssetsPrefix.length);
  if (!rel.startsWith('size/') && !rel.startsWith('format/')) return undefined;
  if (rel === '' || rel.includes('..')) return undefined;
  const root = resolve(dashboardPreviewImageOutputDir(opts.cwd), 'content/images');
  const filePath = resolve(root, rel);
  const inside = relative(root, filePath);
  if (inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return filePath;
}

function normalizePreviewLocalPathname(rawUrl: string, config: NectarConfig): string | undefined {
  if (rawUrl.startsWith('//')) return undefined;
  let pathname = rawUrl.split(/[?#]/)[0] ?? '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathname)) {
    try {
      const parsed = new URL(rawUrl);
      const site = new URL(config.site.url);
      if (parsed.origin !== site.origin) return undefined;
      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  }
  if (!pathname.startsWith('/')) return undefined;
  return stripPreviewBasePath(safeDecodeRoutePath(pathname), config);
}

async function fileResponse(root: string, filePath: string): Promise<Response | undefined> {
  try {
    const [safeRoot, safeFile, info] = await Promise.all([
      realpath(root),
      realpath(filePath),
      stat(filePath),
    ]);
    if (!info.isFile() || !isInsidePath(safeRoot, safeFile)) return undefined;
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const contentType = inferServeContentType(safeFile);
    if (contentType) headers['Content-Type'] = contentType;
    return new Response(Bun.file(safeFile), { headers });
  } catch {
    return undefined;
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

function normalizePreviewRoutePath(route: string): string | undefined {
  const segments = safeRouteSegments(route);
  if (!segments) return undefined;
  if (segments.length === 0) return '/';
  const joined = `/${segments.join('/')}`;
  const last = segments[segments.length - 1] ?? '';
  return extname(last) ? joined : `${joined}/`;
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
      category: 'general',
      section: 'Site',
      title: 'Site identity',
      summary: 'Core public metadata written to [site].',
      source: configSource,
      sourceKind: 'config',
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
      category: 'content',
      section: 'Content paths',
      title: 'File-backed content directories',
      summary: 'Posts, pages, authors, tags, and assets remain the source of truth.',
      source: configSource,
      sourceKind: 'config',
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
      category: 'theme',
      section: 'Theme',
      title: 'Active theme and design surface',
      summary: themeInfo.error ?? 'Switch active theme from installed theme directories.',
      source: `${config.theme.dir}/${config.theme.name}`,
      sourceKind: 'theme',
      mode: 'editable',
      status: themeInfo.error ? 'danger' : 'ok',
      values: [
        { label: 'name', value: config.theme.name },
        { label: 'dir', value: config.theme.dir },
        {
          label: 'available',
          value: String(
            (await listDashboardThemes(cwd, config.theme.dir, config.theme.name)).length,
          ),
        },
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
      category: 'build',
      section: 'Build',
      title: 'Build output and URL shape',
      summary: 'Read-only build settings that affect generated files and public URLs.',
      source: configSource,
      sourceKind: 'config',
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
      category: 'structure',
      section: 'Site structure',
      title: 'Navigation',
      summary: 'Primary and secondary navigation are config-backed arrays.',
      source: configSource,
      sourceKind: 'config',
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
      category: 'structure',
      section: 'Site structure',
      title: 'Redirects manager',
      summary:
        operations.redirects.error ?? 'Canonical redirects.yaml inventory and validation state.',
      source: operations.redirects.path ?? 'redirects.yaml',
      sourceKind: 'config',
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
      category: 'structure',
      section: 'Site structure',
      title: 'Routes and collections',
      summary: operations.routes.error ?? 'routes.yaml collections are read-only in the dashboard.',
      source: operations.routes.path ?? 'routes.yaml',
      sourceKind: 'config',
      mode: 'read-only',
      status: operations.routes.error ? 'danger' : 'ok',
      values: [
        { label: 'routes', value: String(operations.routes.routes) },
        { label: 'collections', value: String(operations.routes.collections) },
      ],
    },
    {
      id: 'content-health',
      category: 'operations',
      section: 'Operations',
      title: 'Content health and readiness',
      summary: 'Doctor, link checks, taxonomy coverage, and stale draft signals.',
      source: 'CLI checks',
      sourceKind: 'cli',
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
      category: 'build',
      section: 'Build',
      title: 'Generated surfaces',
      summary: 'RSS, sitemap, site search, image processing, and cache status.',
      source: configSource,
      sourceKind: 'config',
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
      category: 'operations',
      section: 'Operations',
      title: 'Assets and images',
      summary: 'Content image references are checked against the configured assets directory.',
      source: operations.assets.dir,
      sourceKind: 'content',
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
      category: 'operations',
      section: 'Operations',
      title: 'Bulk actions, templates, and internal links',
      summary: 'Safe content operations remain fingerprint-gated and Markdown-first.',
      source: 'Dashboard API',
      sourceKind: 'runtime',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Trash and restore',
      summary:
        'Deleted content is moved to .nectar/trash with restore metadata; purge stays CLI-only.',
      source: operations.trash.path,
      sourceKind: 'content',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Deploy readiness',
      summary: 'Provider configuration is visible, but deploy execution stays CLI-only.',
      source: configSource,
      sourceKind: 'config',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Advanced and code injection',
      summary: 'Dangerous or experimental settings are grouped instead of scattered.',
      source: configSource,
      sourceKind: 'config',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Import, export, diagnostics',
      summary:
        'Ghost imports use a review-first dashboard action; other import/export workflows stay CLI-first.',
      source: 'CLI assets',
      sourceKind: 'cli',
      mode: 'dangerous-cli-only',
      status: 'info',
      values: [
        { label: 'ghost import', value: 'dashboard dry-run + apply' },
        { label: 'other import', value: 'import-wordpress via CLI' },
        { label: 'export', value: 'CLI only' },
        { label: 'diagnostics', value: 'redacted bundle via CLI' },
      ],
      command: 'nectar import-ghost <export.zip> --dry-run',
    },
    {
      id: 'dashboard-frontend-bundle',
      category: 'advanced',
      section: 'Advanced',
      title: 'Dashboard frontend bundle',
      summary:
        'The dashboard stays dependency-light: generated shell, style, script, state, and view-state helpers are TypeScript modules with no extra build step.',
      source: 'src/cli/dashboard',
      sourceKind: 'runtime',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Dashboard internationalization policy',
      summary:
        'Admin copy remains English in this local CLI surface until file-backed translation catalogs exist.',
      source: 'docs/admin-dashboard.md',
      sourceKind: 'docs',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Feature flags and telemetry',
      summary:
        'Progressive rollout is local and explicit. Telemetry is not collected by the dashboard.',
      source: 'local settings and docs',
      sourceKind: 'docs',
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
      category: 'advanced',
      section: 'Advanced',
      title: 'Members and newsletter scope',
      summary: operations.membersPolicy.note,
      source: configSource,
      sourceKind: 'config',
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
      category: 'operations',
      section: 'Operations',
      title: 'External editor and conflict policy',
      summary: operations.collaboration.safety,
      source: 'local filesystem',
      sourceKind: 'runtime',
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
      readCacheStats(resolve(cwd, '.nectar/cache')),
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
    label: 'Markdown preview',
    status: 'ok',
    detail: existsSync(join(cwd, config.build.output_dir))
      ? `Preview renders Markdown on demand; ${config.build.output_dir} remains the prebuilt deploy output.`
      : `Preview renders ${graph.posts.length + graph.pages.length} content item(s) from Markdown before any build output exists.`,
    command: 'nectar build',
  });
  return items;
}

function cliAssetLedger(): DashboardCliAsset[] {
  return [
    {
      command: 'build',
      adminSurface: 'Build readiness and prebuilt dist output',
      exposure: 'read-only',
      note: 'Show output_dir, base_path, and dry-run command examples without treating dist as the editor preview source.',
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
      note: 'Ghost import has a review-first local-path action; WordPress import and export remain CLI-only.',
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
          : kind === 'tags'
            ? config.content.tags_dir
            : config.content.components_dir;
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
  if (
    value === 'posts' ||
    value === 'pages' ||
    value === 'authors' ||
    value === 'tags' ||
    value === 'components'
  )
    return value;
  return undefined;
}

async function writeSiteSettingsFile(
  target: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const siteUpdates = new Map<string, TomlLiteral>();
  for (const key of SITE_SETTINGS_FIELDS) {
    const value = payload[key];
    if (typeof value === 'string') siteUpdates.set(key, { kind: 'string', value });
  }
  // `build.allow_code_injection` is intentionally an explicit boolean from
  // the dashboard, NOT auto-derived from head/foot non-emptiness. The same
  // gate controls per-post `codeinjection_head` / `codeinjection_foot` in
  // content frontmatter (see content/loader.ts:1627-1637), so an operator
  // typing a GA snippet must consciously opt in to "I also trust everyone
  // with content/ write access to ship raw HTML". The Code Injection panel
  // surfaces this as a checkbox and sends the boolean here.
  const allowInjectionFlag =
    typeof payload.allow_code_injection === 'boolean' ? payload.allow_code_injection : undefined;
  if (siteUpdates.size === 0 && allowInjectionFlag === undefined) return;
  const raw = existsSync(target) ? await readFile(target, 'utf8') : '';
  let next = siteUpdates.size > 0 ? updateTomlSection(raw, 'site', siteUpdates) : raw;
  if (allowInjectionFlag !== undefined) {
    next = updateTomlSection(
      next,
      'build',
      new Map<string, TomlLiteral>([
        ['allow_code_injection', { kind: 'raw', value: String(allowInjectionFlag) }],
      ]),
    );
  }
  await writeFile(target, next, 'utf8');
}

async function writeThemeSettingsFile(
  target: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const updates = new Map<string, TomlLiteral>();
  const value = payload.name;
  if (typeof value === 'string') updates.set('name', { kind: 'string', value });
  if (updates.size === 0) return;
  const raw = existsSync(target) ? await readFile(target, 'utf8') : '';
  await writeFile(target, updateTomlSection(raw, 'theme', updates), 'utf8');
}

function findInvalidSettingsFields(payload: Record<string, unknown>): string[] {
  const allowed = new Set<string>([...SITE_SETTINGS_FIELDS, ...SITE_PATCH_BUILD_FIELDS]);
  return Object.keys(payload).filter((key) => !allowed.has(key));
}

// Catch type-shaped payload bugs that the field allowlist alone misses.
// Without this, a client sending `allow_code_injection: "true"` would pass
// the name check, then be silently dropped by writeSiteSettingsFile's
// `typeof === 'boolean'` guard — leaving the operator with a 200 OK and
// no gate change.
function findSettingsTypeErrors(
  payload: Record<string, unknown>,
): { error: string; field: string; expected: string } | undefined {
  for (const key of SITE_SETTINGS_FIELDS) {
    const value = payload[key];
    if (value !== undefined && typeof value !== 'string') {
      return { error: 'invalid settings field type', field: key, expected: 'string' };
    }
  }
  if (
    payload.allow_code_injection !== undefined &&
    typeof payload.allow_code_injection !== 'boolean'
  ) {
    return {
      error: 'invalid settings field type',
      field: 'allow_code_injection',
      expected: 'boolean',
    };
  }
  return undefined;
}

function findInvalidThemeSettingsFields(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).filter((key) => key !== 'name');
}

function dashboardSocialSettings(site: Record<string, unknown>): DashboardSocialSettings {
  return {
    twitter: typeof site.twitter === 'string' ? site.twitter : '',
    facebook: typeof site.facebook === 'string' ? site.facebook : '',
    linkedin: typeof site.linkedin === 'string' ? site.linkedin : '',
    bluesky: typeof site.bluesky === 'string' ? site.bluesky : '',
    mastodon: typeof site.mastodon === 'string' ? site.mastodon : '',
    threads: typeof site.threads === 'string' ? site.threads : '',
    tiktok: typeof site.tiktok === 'string' ? site.tiktok : '',
    youtube: typeof site.youtube === 'string' ? site.youtube : '',
    instagram: typeof site.instagram === 'string' ? site.instagram : '',
    github: typeof site.github === 'string' ? site.github : '',
  };
}

// Mirrors the `Theme directory not found` `NectarError` raised by `loadTheme()`
// in `src/theme/loader.ts`, so the dashboard banner shows the same actionable
// hint an operator gets at `nectar build` time. Kept in lockstep with the
// loader copy on purpose — when the loader's hint changes, this should change
// with it.
export function computeDashboardThemeStatus(
  cwd: string,
  themeDir: string,
  themeName: string,
): DashboardThemeStatus {
  const rootDir = resolveThemeRoot(cwd, themeDir, themeName);
  if (existsSync(rootDir)) {
    return { missing: false, expectedPath: relativePath(cwd, rootDir) };
  }
  const relRoot = relative(cwd, rootDir);
  const expectedPath = relRoot && !relRoot.startsWith('..') ? relRoot : rootDir;
  return {
    missing: true,
    expectedPath,
    cloneCommand: `git clone https://github.com/TryGhost/Source ${expectedPath}`,
    message: `Theme "${themeName}" not found at ${expectedPath}.`,
    hint: 'Vendor a Ghost theme into this directory before previewing or building. For the default Source theme, run the clone command above. Other Ghost-compatible themes (Casper, Headline, Edition, Wave, Liebling, …) follow the same pattern.',
  };
}

async function listDashboardThemes(
  cwd: string,
  themesDir: string,
  activeTheme: string,
): Promise<DashboardThemeOption[]> {
  const root = isAbsolute(themesDir) ? themesDir : join(cwd, themesDir);
  if (!existsSync(root)) return [];
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const themes: DashboardThemeOption[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const themeRoot = join(root, entry.name);
    if (!(await isDashboardThemeDirectory(themeRoot))) continue;
    const meta = await readDashboardThemePackage(themeRoot);
    themes.push({
      name: entry.name,
      path: relativePath(cwd, themeRoot),
      active: entry.name === activeTheme,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.version ? { version: meta.version } : {}),
    });
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name));
}

async function isDashboardThemeDirectory(themeRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(themeRoot, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith('.hbs'));
  } catch {
    return false;
  }
}

/* Ghost themes ship a package.json with name/description/version. We surface
 * description + version on theme cards so an editor picking a theme has more
 * than the directory name to go on. Best-effort: missing file, malformed
 * JSON, or non-string fields all degrade silently to "no metadata". */
async function readDashboardThemePackage(
  themeRoot: string,
): Promise<{ description?: string; version?: string }> {
  const pkgPath = join(themeRoot, 'package.json');
  if (!existsSync(pkgPath)) return {};
  try {
    const raw = await readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const record = parsed as Record<string, unknown>;
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const version = typeof record.version === 'string' ? record.version.trim() : '';
    return {
      ...(description ? { description } : {}),
      ...(version ? { version } : {}),
    };
  } catch {
    return {};
  }
}

// TOML literal carrying a pre-encoded RHS. `kind: 'string'` is the common
// path — `value` is the raw user input and the writer wraps it via
// `tomlString`. `kind: 'raw'` is for non-string literals like booleans
// where `value` is already the final TOML token (`true`, `false`, a
// number, …) and must be spliced verbatim.
type TomlLiteral = { kind: 'string'; value: string } | { kind: 'raw'; value: string };

function renderTomlLiteral(literal: TomlLiteral): string {
  return literal.kind === 'string' ? tomlString(literal.value) : literal.value;
}

function updateTomlSection(
  raw: string,
  section: string,
  updates: Map<string, TomlLiteral>,
): string {
  const lines = raw ? raw.split(/\r?\n/) : [];
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    const inserted = [
      header,
      ...[...updates].map(([key, literal]) => `${key} = ${renderTomlLiteral(literal)}`),
      '',
    ];
    if (!raw.trim()) return `${inserted.join('\n')}`;
    return `${raw.replace(/\n*$/, '\n\n')}${inserted.join('\n')}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[\[?[^\]]+\]\]?\s*$/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  const seen = new Set<string>();
  for (let i = start + 1; i < end; i += 1) {
    const match = (lines[i] ?? '').match(/^(\s*)([A-Za-z0-9_-]+)(\s*=\s*).*/);
    if (!match) continue;
    const key = match[2] ?? '';
    const literal = updates.get(key);
    if (literal === undefined) continue;
    lines[i] = `${match[1] ?? ''}${key}${match[3] ?? ' = '}${renderTomlLiteral(literal)}`;
    seen.add(key);
  }
  const missing = [...updates].filter(([key]) => !seen.has(key));
  lines.splice(
    end,
    0,
    ...missing.map(([key, literal]) => `${key} = ${renderTomlLiteral(literal)}`),
  );
  return lines.join('\n').replace(/\n*$/, '\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function resolveConfigPath(cwd: string, configPath: string | undefined): string {
  const paths = resolveConfigPaths(cwd, configPath);
  return paths.at(-1) ?? resolve(cwd, 'nectar.toml');
}

function resolveConfigPaths(cwd: string, configPath: string | undefined): string[] {
  const paths = configPath
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const targets = paths && paths.length > 0 ? paths : ['nectar.toml'];
  return targets.map((target) => (isAbsolute(target) ? target : resolve(cwd, target)));
}

async function settingsFingerprintFor(
  cwd: string,
  configPath: string | undefined,
): Promise<ContentSourceFingerprint> {
  const paths = resolveConfigPaths(cwd, configPath);
  if (paths.length === 1)
    return optionalFingerprintFor(cwd, paths[0] ?? resolve(cwd, 'nectar.toml'));
  const fingerprints = await Promise.all(paths.map((path) => optionalFingerprintFor(cwd, path)));
  return {
    path: fingerprints.map((fingerprint) => fingerprint.path).join(','),
    mtimeMs: fingerprints.reduce((sum, fingerprint) => sum + fingerprint.mtimeMs, 0),
    size: fingerprints.reduce((sum, fingerprint) => sum + fingerprint.size, 0),
  };
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
  const kind = (typeof kindRaw === 'string' ? parseEditableKind(kindRaw) : undefined) ?? null;
  if (!slug || !originalPath || !trashPath || !trashedAt || !purgeAfter) return null;
  if (isAbsolute(originalPath) || isAbsolute(trashPath)) return null;
  const trashAbs = resolve(cwd, trashPath);
  const originalAbs = resolve(cwd, originalPath);
  if (!isInsidePath(resolve(cwd, '.nectar', 'trash'), trashAbs)) return null;
  if (!isInsidePath(cwd, originalAbs)) return null;
  const dirId = basename(dirname(metadataPath));
  const id = `${dirId}--${slug}`;
  const affectedFiles = parseAffectedFiles(cwd, metadata.affected_files);
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
    ...(affectedFiles.length > 0 ? { affectedFiles } : {}),
  };
}

// Validate the `affected_files` block from trash metadata. Each entry must be a
// cwd-relative path that stays inside the project (defends a hand-edited or
// tampered metadata file from writing outside the repo on restore).
function parseAffectedFiles(
  cwd: string,
  value: unknown,
): Array<{ path: string; previousText: string }> {
  if (!Array.isArray(value)) return [];
  const result: Array<{ path: string; previousText: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const path = stringValue(record.path);
    const previousText = record.previous_text;
    if (!path || typeof previousText !== 'string') continue;
    if (isAbsolute(path)) continue;
    if (!isInsidePath(cwd, resolve(cwd, path))) continue;
    result.push({ path, previousText });
  }
  return result;
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
  if (kind === 'components') {
    return serializeContentSource(
      { slug, description: title },
      // Two empty fenced blocks the dashboard editor will populate. We
      // keep them in the body (rather than as multi-line frontmatter
      // strings) so the file round-trips cleanly through any markdown
      // editor / git diff.
      '\n```css\n\n```\n\n```html\n\n```\n',
    );
  }
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

async function serveDashboardBundleAsset(
  pathname: string,
  override?: RuntimeBundleAssets,
): Promise<Response> {
  const asset =
    override?.[pathname] ??
    DASHBOARD_BUNDLE_ASSETS[pathname as keyof typeof DASHBOARD_BUNDLE_ASSETS];
  if (!asset) return new Response('Not Found', { status: 404 });
  if (asset.body === '') {
    return new Response(
      'Dashboard bundle is empty. Run `bun run build:dashboard-bundle` before starting the dashboard.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
  return new Response(asset.body, {
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
    },
  });
}

// In-memory cache for the scoped theme CSS keyed by the source file's
// path and mtime. The bookmark NodeView depends on this CSS to render a
// faithful preview; on a typical session it is requested once per page
// load, so the cache mostly skips a re-parse on bundle refresh / SPA
// navigation rather than a hot path.
let activeThemeCssCache: {
  path: string;
  mtimeMs: number;
  body: string;
} | null = null;

async function serveActiveThemeScopedCss({
  cwd,
  configPath,
}: {
  cwd: string;
  configPath?: string;
}): Promise<Response> {
  let config: NectarConfig;
  let themePkg: Awaited<ReturnType<typeof loadTheme>>['pkg'];
  try {
    config = await loadConfig({ cwd, configPath });
    const theme = await loadTheme({ cwd, config });
    themePkg = theme.pkg;
  } catch (err) {
    return cssNotice(
      `/* Nectar dashboard: failed to load nectar.toml or theme — ${(err as Error).message ?? 'unknown error'} */`,
    );
  }
  // The dashboard ships with the same `themes/` convention the build
  // pipeline uses (see `resolveThemeRoot`), so the rewriter source path
  // is just `<themeDir>/<themeName>/assets/built/screen.css` after
  // resolution.
  const themeRoot = resolveThemeRoot(cwd, config.theme.dir, config.theme.name);
  const screenCssPath = resolve(themeRoot, 'assets', 'built', 'screen.css');
  const screen = Bun.file(screenCssPath);
  if (!(await screen.exists())) {
    return cssNotice(
      `/* Nectar dashboard: active theme "${config.theme.name}" has no assets/built/screen.css; bookmark preview falls back to dashboard styles. */`,
    );
  }
  const stat = await screen.stat();
  if (
    activeThemeCssCache &&
    activeThemeCssCache.path === screenCssPath &&
    activeThemeCssCache.mtimeMs === stat.mtimeMs
  ) {
    return cssResponse(activeThemeCssCache.body);
  }
  const source = await screen.text();
  // Theme stylesheets only ship overrides for the Ghost card classes
  // (`.kg-bookmark-card .kg-bookmark-container { … }`). The shared base
  // CSS that gives kg-bookmark-card its flex layout / border / radius
  // is generated by src/build/card-assets.ts at build time and only
  // lands in `dist/assets/ghost-card-assets.css`. Prepend it here so
  // the in-editor preview is faithful even though the dashboard has
  // never run a build.
  const cardAssets = renderCardAssetsCss(themePkg.card_assets);
  const combined = `${cardAssets}\n${source}`;
  const rewritten = rewriteThemeCss(combined);
  activeThemeCssCache = { path: screenCssPath, mtimeMs: stat.mtimeMs, body: rewritten };
  return cssResponse(rewritten);
}

function cssResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function javascriptResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cssNotice(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // img-src allows https: so bookmark card thumbnails / favicons
      // fetched by OGP can render directly from the source CDN. The
      // dashboard's own JS/CSS/data fetches stay 'self'-only.
      'Content-Security-Policy':
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self'",
    },
  });
}

// 404 fallback. JSON for fetch / API clients, a small styled HTML page
// for browsers — so a direct GET to an unknown URL no longer drops the
// user onto an unstyled "Not Found" black page (was #1973).
function notFoundResponse(request: Request): Response {
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/html')) {
    return jsonResponse({ error: 'Not Found' }, 404);
  }
  const path = new URL(request.url).pathname;
  const safePath = path.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found · Nectar Dashboard</title><style>
:root { color-scheme: light; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f4ecd9; color: #2a241b; font-family: ui-serif, 'Iowan Old Style', Georgia, serif; }
main { max-width: 480px; padding: 48px 32px; text-align: left; }
.kicker { font-family: ui-serif, Georgia, serif; font-style: italic; font-size: 13px; color: #6a5d4a; margin: 0 0 6px; }
h1 { font-family: ui-serif, Georgia, serif; font-weight: 400; font-size: 44px; line-height: 1.1; margin: 0 0 16px; letter-spacing: -0.01em; }
p { font-size: 15px; line-height: 1.55; color: #4a4036; margin: 0 0 12px; }
code { font-family: ui-monospace, 'SF Mono', monospace; font-size: 13px; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; color: #2a241b; }
a { display: inline-block; margin-top: 20px; padding: 8px 14px; background: #1a1612; color: #f4ecd9; text-decoration: none; border-radius: 6px; font-size: 14px; font-family: ui-sans-serif, system-ui, sans-serif; }
a:hover { background: #2a241b; }
</style></head><body><main><p class="kicker">404</p><h1>That page isn't here.</h1><p>The URL <code>${safePath}</code> doesn't match any dashboard route.</p><p>Maybe the post was renamed, or you followed a stale link.</p><a href="/posts">Back to Posts</a></main></body></html>`;
  return new Response(body, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
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

function validateSameOrigin(
  request: Request,
  security: DashboardSecurityContext | undefined,
  rejectMessage: string,
): Response | undefined {
  if (security === undefined) return undefined;
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== security.origin) {
    return jsonResponse({ error: rejectMessage }, 403);
  }
  const referer = request.headers.get('referer');
  if (origin === null && referer !== null) {
    try {
      if (new URL(referer).origin !== security.origin) {
        return jsonResponse({ error: rejectMessage }, 403);
      }
    } catch {
      return jsonResponse({ error: 'invalid referer' }, 403);
    }
  }
  return undefined;
}

function validateWriteRequest(
  request: Request,
  security: DashboardSecurityContext | undefined,
): Response | undefined {
  if (security === undefined) return undefined;
  const token = request.headers.get('x-nectar-dashboard-token');
  if (token !== security.token) return jsonResponse({ error: 'dashboard token is required' }, 403);
  return validateSameOrigin(request, security, 'cross-origin dashboard write rejected');
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
    ...resolveConfigPaths(cwd, configPath),
    absolutise(cwd, config.content.posts_dir),
    absolutise(cwd, config.content.pages_dir),
    absolutise(cwd, config.content.authors_dir),
    absolutise(cwd, config.content.tags_dir),
  ].filter((path, index, self) => self.indexOf(path) === index);
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

export function renderDashboardHtml(): string {
  return renderDashboardShellHtml();
}
