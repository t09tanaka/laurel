import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isNonProductionBuild } from '~/config/deploy-environment.ts';
import { loadConfig } from '~/config/loader.ts';
import type { LaurelConfig } from '~/config/schema.ts';
import {
  type MarkdownTransformHook,
  type RawContentCache,
  createRawContentCache,
  loadContent,
} from '~/content/loader.ts';
import type { ContentGraph } from '~/content/model.ts';
import { SUBSCRIBE_NOOP_BUILD_WARNING } from '~/members/noop.ts';
import { validatePortalConfig } from '~/members/portal-validation.ts';
import { type LoadedPluginSet, loadPlugins } from '~/plugin/loader.ts';
import type { BuildContext, Plugin } from '~/plugin/types.ts';
import { createEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import { loadTheme } from '~/theme/loader.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { pLimit } from '~/util/concurrency.ts';
import { getLaurelVersion } from '~/util/laurel-version.ts';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';
import { emitAlgoliaRecords, emitDocSearchCss } from './algolia.ts';
import { emitApacheHtaccess } from './apache.ts';
import { emitContentApiShadows } from './api.ts';
import { emitAssetManifest } from './asset-manifest.ts';
import { findMissingAssetReferences, formatMissingAssetReference } from './asset-references.ts';
import { emitAzureStaticWebAppConfig } from './azure.ts';
import { normalizeBasePath } from './base-path.ts';
import { normalizeBaseUrl } from './base-url.ts';
import {
  type BuildManifestJson,
  type BuildManifestRoute,
  buildManifestRelPath,
  changedPathsRelPath,
  emitBuildManifest,
  legacyBuildManifestRelPath,
  loadBuildManifest,
} from './build-manifest.ts';
import { emitCaddyfile } from './caddy.ts';
import { CARD_ASSETS_CSS_PATH, CARD_ASSETS_JS_PATH, emitCardAssets } from './card-assets.ts';
import { CLOUDFLARE_WORKERS_MANIFEST_FILE } from './cloudflare-workers.ts';
import { emitCloudFrontResponseHeadersPolicy } from './cloudfront-response-headers.ts';
import { emitCname } from './cname.ts';
import { emitContentApiStubs } from './content-api.ts';
import { resolveContentImageUrl } from './content-image-urls.ts';
import {
  type RouteEarlyHints,
  buildEarlyHintsHeaderRules,
  buildKnownEarlyHintHrefs,
  collectRouteEarlyHints,
  earlyHintsArtifactPath,
  emitEarlyHintsArtifacts,
} from './early-hints.ts';
import {
  type ContentImageAssetPlan,
  type HtmlOutput,
  copyAssets,
  copyContentAssets,
  createThemeAssetCopyCache,
  planContentImageAssets,
  writeHtmlBatch,
} from './emit.ts';
import {
  type DeploymentProvider,
  deploymentHeaderTargets,
  deploymentRoutingTargets,
  emitDeployHeaders,
  emitDeployTargets,
} from './emitters/registry.ts';
import { emitDefault404 } from './error-page.ts';
import { computeFavicons, copyFavicons } from './favicons.ts';
import { FEDIVERSE_DISCOVERY_PATH, emitFediverseDiscovery } from './fediverse.ts';
import { emitFeedAlias } from './feed-alias.ts';
import { SITEMAP_MAX_URLS_PER_FILE, type SitemapKind, emitRss, emitSitemap } from './feeds.ts';
import { emitFirebaseJson } from './firebase.ts';
import { generateOgImages } from './generate-og-images.ts';
import { emitGithubPagesRedirects, githubPagesRedirectOutputPath } from './github-pages.ts';
import { type HeaderRule, collectContentApiHeaderRules } from './headers.ts';
import { runPostBuildHook } from './hooks.ts';
import { emitHumans } from './humans.ts';
import { collectImageAltWarnings, formatImageAltWarning } from './image-alt-lint.ts';
import {
  type ImageFormat,
  collapseDegenerateSrcsetIntoContent,
  generateImageFormatVariants,
  generateImageVariants,
  generateThemeImageSizeVariants,
  injectImageDimensionsIntoContent,
  injectImagePictureSourcesIntoContent,
  injectImageSrcsetIntoContent,
  isSharpAvailable,
  planImageVariants,
  resolveCacheDir,
} from './images.ts';
import { collectInlineScriptCspHashes, withInlineScriptCspHashes } from './inline-script-csp.ts';
import { emitLunrIndex, emitLunrWidget } from './lunr.ts';
import {
  type BuildManifest,
  type FeedManifestEntry,
  MANIFEST_VERSION,
  type ManifestEntry,
  collectRouteContentInputs,
  computeGeneratorSourceFingerprint,
  computeGlobalHash,
  computeManifestEntryIntegrity,
  computeRouteContentInputsFingerprint,
  computeRouteHash,
  computeThemeFingerprint,
  createRouteContentInputIndex,
  loadManifest,
  reusePreviousRouteHash,
  saveManifest,
} from './manifest.ts';
import { emitMeilisearchRecords } from './meilisearch.ts';
import { minifyHtmlOutputs } from './minify.ts';
import { emitNginxConf } from './nginx.ts';
import { emitNojekyll } from './nojekyll.ts';
import { cleanupStaleOutput, resolveBuildOutputDir, resolveOutputDir } from './output-dir.ts';
import { emitPaginationEnhanceShim, themeHasNativeInfiniteScroll } from './pagination-enhance.ts';
import { assignPostUrls } from './permalinks.ts';
import { PORTAL_MANIFEST_PATH, emitPortalManifest } from './portal-manifest.ts';
import { PORTAL_RUNTIME_PATH, emitPortalRuntime } from './portal-runtime.ts';
import { resolvePortalUrls } from './portal-urls.ts';
import { precompressOutput } from './precompress.ts';
import { loadPreservePatterns } from './preserve.ts';
import {
  type BuildStatsHelperHotspot,
  type BuildStatsRoute,
  type Profiler,
  buildStatsPath,
  createProfiler,
  writeProfile,
} from './profile.ts';
import { rasterizeOgImages } from './rasterize-og-images.ts';
import { emitRecommendationsPage } from './recommendations-page.ts';
import { emitRedirectsComponent } from './redirects-emit.ts';
import { type RedirectRule, buildTrailingSlashRedirects, loadAllRedirects } from './redirects.ts';
import { emitRobots } from './robots.ts';
import { isHtmlRoute, renderRouteHtml } from './route-render.ts';
import { loadRoutesYaml, resolveCollections, warnUnappliedSections } from './routes-yaml.ts';
import { planRoutes } from './routes.ts';
import {
  emitSearchJson,
  emitSearchShim,
  emitSearchUiCss,
  runPagefind,
  searchEngineUsesLaurelGhostSearchShim,
} from './search.ts';
import { copyStaticDir, resolveStaticPassthroughDirs } from './static-passthrough.ts';
import { containsSubscribeFormMarkup } from './subscribe-forms.ts';
import {
  findMissingThemeAssetReferences,
  formatMissingThemeAssetReference,
} from './theme-asset-references.ts';
import { emitTierWelcomePages } from './tier-welcome-pages.ts';
import { GENERATED_WEB_MANIFEST_PATH, emitWebManifest } from './web-manifest.ts';

// Hot path for `laurel dev`: lets the dev server hand previously-loaded state
// back to a fresh build() call. Config/theme reuse skips their load steps when
// the watcher knows those inputs have not changed; rawContentCache is a
// mutation-safe cache of normalized Markdown entries that loadContent clones
// into a fresh build-local content graph before image/srcset injectors run.
export interface ReusableBuildState {
  config?: LaurelConfig | undefined;
  theme?: ThemeBundle | undefined;
  rawContentCache?: RawContentCache | undefined;
}

export interface BuildOptions {
  cwd: string;
  configPath?: string | undefined;
  outputDir?: string | undefined;
  basePath?: string | undefined;
  // Override for `[build].emit_at_base_path`. Undefined leaves the config value
  // alone (which itself defaults to "true when base_path is a subpath"); `true`
  // / `false` are exposed through `--emit-at-base-path` / `--no-emit-at-base-path`
  // so a preview build can mirror (or flatten) the URL tree on disk without
  // editing laurel.toml.
  emitAtBasePath?: boolean | undefined;
  baseUrl?: string | undefined;
  profile?: boolean | undefined;
  noAtomic?: boolean | undefined;
  // Cap on parallel route renders. Undefined → availableParallelism() (CPU count).
  // Must be a positive integer; CLI validates before getting here.
  concurrency?: number | undefined;
  // When true, the build plans routes, loads templates, and renders every
  // route into memory but never touches the filesystem: no staging dir, no
  // asset copies, no manifest, no sitemap/RSS/etc. The returned summary
  // includes a per-route breakdown so the CLI can print it under --verbose.
  dryRun?: boolean | undefined;
  // When true, posts and pages with `status: draft` are included in the build
  // instead of being filtered out. Default is to exclude drafts so a forgotten
  // WIP can't accidentally ship; this flag is intended for preview deploys
  // where the operator explicitly wants drafts visible.
  includeDrafts?: boolean | undefined;
  // When true, the previous manifest is ignored and every route is re-rendered
  // from scratch. Default behaviour reuses HTML from the prior build when the
  // per-route hash matches; --force is the escape hatch for cases where the
  // incremental cache is suspected stale or corrupted.
  force?: boolean | undefined;
  // When false, skip deleting stale files from the output directory after the
  // current build finishes. This is useful for deploy targets that publish
  // hashed assets and handle their own cleanup lifecycle.
  clean?: boolean | undefined;
  // Override for `[components.content_api].enabled`. Undefined leaves the
  // config value alone; `true` forces the JSON shadows under `dist/content/`
  // and `dist/ghost/api/content/` on; `false` forces them off. Exposed
  // through `--emit-content-api` (and `LAUREL_BUILD_EMIT_CONTENT_API=0`) so
  // operators can preview / disable the SDK surface without editing the
  // config.
  emitContentApi?: boolean | undefined;
  // Override for `[build].copy_content_assets`. Undefined leaves config alone;
  // false is exposed through `--no-copy-content-assets` for CI jobs that only
  // need rendered HTML and theme assets.
  copyContentAssets?: boolean | undefined;
  // Optional CLI-facing progress callback. The build pipeline treats this as
  // best-effort telemetry: progress UI must never be able to fail a build.
  progress?: BuildProgressReporter | undefined;
  // When set, the build skips re-loading the corresponding inputs and uses the
  // provided objects or caches instead. Used by `laurel dev` to keep config /
  // theme in memory across rebuilds and to reuse unchanged raw content entries
  // while reconstructing a fresh content graph on every build. Reused config is
  // still subject to CLI overrides (basePath / baseUrl / copyContentAssets)
  // applied below in build().
  reuse?: ReusableBuildState | undefined;
  // When true, the returned BuildSummary includes the `reusable` field with the
  // loaded config + theme so the caller can hand them back on the next build.
  // Off by default to avoid retaining the theme bundle in memory for one-shot
  // CLI builds.
  captureReusable?: boolean | undefined;
}

export type BuildProgressPhase =
  | 'config'
  | 'output'
  | 'content'
  | 'routes'
  | 'render'
  | 'html'
  | 'assets'
  | 'metadata'
  | 'finalize';

export type BuildProgressEvent =
  | {
      type: 'phase-start' | 'phase-end';
      phase: BuildProgressPhase;
      label: string;
      totalRoutes?: number | undefined;
    }
  | {
      type: 'phase-status';
      phase: BuildProgressPhase;
      label: string;
    }
  | {
      type: 'routes-planned';
      totalRoutes: number;
    }
  | {
      type: 'route-rendered';
      completedRoutes: number;
      totalRoutes: number;
      route: string;
      reused: boolean;
    }
  | {
      type: 'asset-step';
      step: number;
      totalSteps: number;
      label: string;
    };

export type BuildProgressReporter = (event: BuildProgressEvent) => void;

// Route HTML can be tens of KB per page. Keep the render/write live set
// bounded independently from the route count while still amortising per-batch
// scheduling and directory work.
export const ROUTE_RENDER_BATCH_SIZE = 512;

export interface DryRunRouteSummary {
  url: string;
  outputPath: string;
  template: string;
  kind: RouteContext['kind'];
  bytes: number;
  reused: boolean;
}

export interface BuildSummary {
  outputDir: string;
  routeCount: number;
  assetCount: number;
  outputBytes?: number;
  profilePath?: string;
  peakRssBytes?: number;
  warningCount: number;
  renderedCount: number;
  skippedCount: number;
  dryRun: boolean;
  // Populated only when dryRun is true; lets the CLI print a per-route table
  // under --verbose without re-walking the route plan.
  routes?: DryRunRouteSummary[];
  slowestRoutes?: BuildStatsRoute[];
  helperHotspots?: BuildStatsHelperHotspot[];
  // Populated only when `captureReusable: true` was passed in BuildOptions.
  // Lets `laurel dev` re-feed the same config/theme/content cache back on the
  // next rebuild, skipping safe load work while preserving fresh graph objects.
  reusable?: {
    config: LaurelConfig;
    theme: ThemeBundle;
    rawContentCache: RawContentCache;
  };
}

async function timed<T>(
  profiler: Profiler | null,
  phase: string,
  fn: () => Promise<T> | T,
  getBytes?: (result: T) => number | undefined,
): Promise<T> {
  if (!profiler) return await fn();
  const stop = profiler.startPhase(phase);
  const result = await fn();
  const bytes = getBytes?.(result);
  stop(bytes !== undefined ? { bytes } : undefined);
  return result;
}

function notifyProgress(
  progress: BuildProgressReporter | undefined,
  event: BuildProgressEvent,
): void {
  if (!progress) return;
  try {
    progress(event);
  } catch {
    // Progress rendering is auxiliary. A broken terminal or test stub should
    // not change build success.
  }
}

function notifyProgressStatus(
  progress: BuildProgressReporter | undefined,
  phase: BuildProgressPhase,
  label: string,
): void {
  notifyProgress(progress, { type: 'phase-status', phase, label });
}

async function withProgressPhase<T>(
  progress: BuildProgressReporter | undefined,
  phase: BuildProgressPhase,
  label: string,
  fn: () => Promise<T> | T,
  opts: { totalRoutes?: number | undefined } = {},
): Promise<T> {
  notifyProgress(progress, { type: 'phase-start', phase, label, totalRoutes: opts.totalRoutes });
  try {
    return await fn();
  } finally {
    notifyProgress(progress, { type: 'phase-end', phase, label, totalRoutes: opts.totalRoutes });
  }
}

type SettledBuildTask<T> = Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;

function startSettledBuildTask<T>(fn: () => Promise<T> | T): SettledBuildTask<T> {
  return Promise.resolve()
    .then(fn)
    .then(
      (value) => ({ ok: true, value }) as const,
      (error) => ({ ok: false, error }) as const,
    );
}

async function awaitSettledBuildTask<T>(task: SettledBuildTask<T>): Promise<T> {
  const result = await task;
  if (!result.ok) throw result.error;
  return result.value;
}

// Maps the internal RouteKind taxonomy onto Ghost's four sitemap sections.
// home/index/custom land in 'pages' because they are page-like entry points
// from a crawler's perspective; sitemapindex pagination is keyed on this
// classification so the mapping is load-bearing once total URLs exceed
// SITEMAP_MAX_URLS_PER_FILE.
function routeKindToSitemapKind(kind: RouteContext['kind']): SitemapKind | undefined {
  switch (kind) {
    case 'post':
      return 'posts';
    case 'home':
    case 'index':
    case 'page':
    case 'custom':
      return 'pages';
    case 'tag':
      return 'tags';
    case 'author':
      return 'authors';
    default:
      return undefined;
  }
}

function isSitemapIndexableRoute(route: RouteContext): boolean {
  if (route.indexable === false) return false;
  return (route.data.pagination?.page ?? 1) <= 1;
}

function collectRouteContentTypeHeaderRules(
  routes: readonly RouteContext[],
  basePath: string,
): HeaderRule[] {
  const out: HeaderRule[] = [];
  for (const route of routes) {
    if (route.outputContentType === undefined || route.outputContentType === 'text/html') continue;
    out.push({
      pattern: routeOutputPatternWithBasePath(route.outputPath, basePath),
      headers: [{ key: 'Content-Type', value: route.outputContentType }],
    });
  }
  return out;
}

function routeOutputPatternWithBasePath(outputPath: string, basePath: string): string {
  const cleanBase = basePath === '/' ? '' : basePath.replace(/\/+$/, '');
  if (outputPath === 'index.html') return `${cleanBase}/`;
  const route =
    outputPath.endsWith('/index.html') || outputPath === 'index.html'
      ? outputPath.slice(0, -'index.html'.length)
      : outputPath;
  return `${cleanBase}/${route.replace(/^\/+/, '')}`;
}

export async function build({
  cwd,
  configPath,
  outputDir: outputDirOverride,
  basePath: basePathOverride,
  emitAtBasePath: emitAtBasePathOverride,
  baseUrl: baseUrlOverride,
  profile,
  noAtomic,
  concurrency,
  dryRun,
  includeDrafts,
  force,
  clean,
  emitContentApi,
  copyContentAssets,
  progress,
  reuse,
  captureReusable,
}: BuildOptions): Promise<BuildSummary> {
  resetWarningCount();
  const profiler = profile ? createProfiler({ sampleIntervalMs: 250 }) : null;
  // Emit the looser-policy warning before any other build output so it is
  // hard to miss in CI logs and obviously precedes the rendered route list.
  // Goes through `logger.warn` so `--strict` counts it as a warning and the
  // operator has to acknowledge that drafts shipped.
  if (includeDrafts === true) {
    logger.warn('Building with drafts');
  }
  // Reusing the previously-loaded config skips a small (~ms) cost on dev
  // rebuilds, but more importantly avoids racing with an in-flight edit on
  // laurel.toml. The dev server hands `reuse.config` in only when it has
  // confirmed laurel.toml itself did not change in this rebuild window.
  const config =
    reuse?.config ??
    (await withProgressPhase(progress, 'config', 'Loading config', () =>
      timed(profiler, 'load', () =>
        timed(profiler, 'config', () => loadConfig({ cwd, configPath })),
      ),
    ));
  if (copyContentAssets !== undefined) {
    config.build.copy_content_assets = copyContentAssets;
  }
  config.build.base_path = normalizeBasePath(basePathOverride ?? config.build.base_path);
  if (emitAtBasePathOverride !== undefined) {
    config.build.emit_at_base_path = emitAtBasePathOverride;
  }
  // When `emit_at_base_path` is on for a subpath deployment, nest the entire
  // output under the base_path segment (dist/blog/...) so the on-disk tree
  // mirrors the public URL tree and `aws s3 sync dist s3://bucket` yields keys
  // matching the `/blog/...` URLs. HTML/asset/sitemap URLs already carry
  // base_path and are unchanged; only the write target moves. Shared with
  // `laurel deploy` via resolveBuildOutputDir so the deploy preflight finds the
  // manifest in the same place the build wrote it.
  // `baseOutputDir` is the configured output root (dist); `finalOutputDir` is
  // where this build actually writes — nested under the base_path segment
  // (dist/blog) when emit_at_base_path is on. Stale cleanup reconciles against
  // baseOutputDir so sibling trees from a previous build at a different
  // base_path / layout are removed, not just stale files inside the current
  // emit subtree.
  const baseOutputDir = resolveOutputDir(cwd, outputDirOverride ?? config.build.output_dir);
  const finalOutputDir = resolveBuildOutputDir(
    cwd,
    outputDirOverride ?? config.build.output_dir,
    config.build.base_path,
    config.build.emit_at_base_path,
  );
  if (baseUrlOverride !== undefined) {
    config.site.url = normalizeBaseUrl(baseUrlOverride);
  }
  const rawContentCache =
    reuse?.rawContentCache ?? (captureReusable === true ? createRawContentCache() : undefined);

  // Read the previous manifest from the live output dir BEFORE staging so the
  // incremental decision and any reused-HTML reads see the last successful
  // build's tree, not the empty staging directory we are about to create.
  // `--force` skips this lookup so every route re-renders even when its hash
  // would otherwise have matched; useful as an escape hatch if the cache or
  // on-disk HTML appears stale.
  const { previousManifest, previousBuildManifest } = await withProgressPhase(
    progress,
    'output',
    'Preparing output',
    async () => ({
      previousManifest: force === true ? undefined : await loadManifest(finalOutputDir),
      previousBuildManifest: await loadBuildManifest(finalOutputDir),
    }),
  );

  const isDryRun = dryRun === true;

  // Dry-run skips filesystem writes entirely. Real builds write directly into
  // the final output directory and clean stale files by set difference after
  // the current build's outputs are known; this avoids deleting a large dist/
  // tree only to copy most of it back unchanged.
  let outputDir: string;
  if (isDryRun) {
    outputDir = finalOutputDir;
  } else {
    outputDir = finalOutputDir;
  }

  return await runBuild({
    cwd,
    config,
    outputDir,
    finalOutputDir,
    baseOutputDir,
    profiler,
    previousManifest,
    previousBuildManifest,
    noAtomic: noAtomic === true,
    concurrency,
    dryRun: isDryRun,
    includeDrafts: includeDrafts === true,
    force: force === true,
    clean: clean !== false,
    emitContentApi,
    progress,
    reuseTheme: reuse?.theme,
    rawContentCache,
    captureReusable: captureReusable === true,
  });
}

async function runBuild({
  cwd,
  config,
  outputDir,
  finalOutputDir,
  baseOutputDir,
  profiler,
  previousManifest,
  previousBuildManifest,
  noAtomic,
  concurrency,
  dryRun,
  includeDrafts,
  force,
  clean,
  emitContentApi,
  progress,
  reuseTheme,
  rawContentCache,
  captureReusable,
}: {
  cwd: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  outputDir: string;
  finalOutputDir: string;
  baseOutputDir: string;
  profiler: Profiler | null;
  previousManifest: BuildManifest | undefined;
  previousBuildManifest: Awaited<ReturnType<typeof loadBuildManifest>>;
  reuseTheme?: ThemeBundle | undefined;
  rawContentCache?: RawContentCache | undefined;
  captureReusable?: boolean | undefined;
  noAtomic: boolean;
  concurrency: number | undefined;
  dryRun: boolean;
  includeDrafts: boolean;
  force: boolean;
  clean: boolean;
  emitContentApi: boolean | undefined;
  progress: BuildProgressReporter | undefined;
}): Promise<BuildSummary> {
  // Resolve Laurel's own version once up front; the build-manifest emitter at
  // the end of the pipeline embeds it into `.laurel/manifest.json` for deploy
  // tooling to detect generator upgrades.
  const laurelVersion = await getLaurelVersion();
  const plannedOutputPaths = new Set<string>();
  const keepOutput = (path: string): void => {
    const normalized = normalizeOutputRelPath(path);
    if (normalized) plannedOutputPaths.add(normalized);
  };
  keepOutput('.laurel-manifest.json');
  keepOutput(buildManifestRelPath());
  keepOutput(changedPathsRelPath());
  keepOutput(FEDIVERSE_DISCOVERY_PATH);
  keepOutput(PORTAL_MANIFEST_PATH);
  keepOutput('staticwebapp.config.json');
  keepOutput('.nojekyll');
  if (profiler) keepOutput('.laurel-build-stats.json');
  // Load `routes.yaml` first so it can shape both content URLs (tag/author
  // archives may be disabled or use custom paths) and the route plan.
  const {
    routesYaml,
    pluginSet,
    content,
    theme,
    imageVariantPlan,
    formatVariants,
    favicons,
    engine,
  } = await timed(profiler, 'load', () =>
    withProgressPhase(progress, 'content', 'Loading content and theme', async () => {
      const routesYaml = await timed(profiler, 'routes_yaml', () => loadRoutesYaml(cwd));
      warnUnappliedSections(routesYaml);

      // Resolve plugin specs before the content loader runs so any
      // `transformMarkdown` declarations are visible to the loader's markdown
      // pipeline. Hooks that need the engine / content graph (`beforeBuild`,
      // `afterContentLoad`, …) are fired later — after `createEngine` returns —
      // so they can call `ctx.engine.registerHelper(...)`. Plugins that fail to
      // load surface a warning via `loadPlugins` and are skipped, never an abort.
      const pluginSet = await timed(profiler, 'plugins_load', () =>
        loadPlugins({
          cwd,
          specs: config.plugins,
          autoDetect: config.plugin_auto_detect,
        }),
      );
      const markdownTransforms: MarkdownTransformHook[] = [];
      for (const p of pluginSet.plugins) {
        if (typeof p.transformMarkdown === 'function') {
          const fn = p.transformMarkdown.bind(p);
          markdownTransforms.push((input, ctx) => fn(input, ctx));
        }
      }

      const [content, theme] = await timed(profiler, 'load_content_and_theme', () => {
        // `reuseTheme` is the dev-server fast path: when the watcher classifies
        // the rebuild as content-only / config-only, the previous theme bundle
        // is byte-equivalent to what `loadTheme` would return, so we hand it
        // straight through and skip the .hbs walk + locale parse + asset scan.
        notifyProgressStatus(progress, 'content', 'Loading theme…');
        const themePromise: Promise<ThemeBundle> = reuseTheme
          ? Promise.resolve(reuseTheme)
          : loadTheme({ cwd, config });
        notifyProgressStatus(progress, 'content', 'Indexing content…');
        const contentPromise = loadContent({
          cwd,
          config,
          routesYaml,
          includeDrafts,
          markdownTransforms,
          pageApprovalGate: true,
          rawContentCache,
          generatorVersion: laurelVersion,
        });
        return Promise.all([contentPromise, themePromise]);
      });

      validateThemeCustom({ config, pkg: theme.pkg });

      injectImageDimensionsIntoContent({ content, cwd, config });

      const imageVariantPlan = await timed(profiler, 'plan_image_variants', () =>
        planImageVariants({ cwd, config }),
      );
      injectImageSrcsetIntoContent({ content, plan: imageVariantPlan });
      // Strip degenerate srcsets in post/page HTML (e.g. SVG covers where every
      // injected entry resolves to the same URL). The rendered-HTML post-process
      // below catches the same pattern in theme HBS output. Issue #534.
      collapseDegenerateSrcsetIntoContent({ content });
      const imagesCfg = config.components.images;
      // Only rewrite `<img>` to `<picture>` when sharp will actually emit the
      // referenced variants — otherwise modern browsers would pick the WebP/AVIF
      // <source> and 404 instead of falling back to the original <img>.
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
      notifyProgressStatus(progress, 'content', 'Compiling templates…');
      const engine = await timed(profiler, 'compile_templates', () =>
        createEngine({ config, content, theme, favicons, cwd, profiler }),
      );
      return {
        routesYaml,
        pluginSet,
        content,
        theme,
        imageVariantPlan,
        formatVariants,
        favicons,
        engine,
      };
    }),
  );

  const imagesCfg = config.components.images;
  markPlannedOgImages({ config, content, cwd, keepOutput });
  markPlannedImageVariants({
    cwd,
    config,
    plan: imageVariantPlan,
    themeImageSizes: theme.pkg.image_sizes,
    formats: formatVariants,
    keepOutput,
  });

  // OG image generation writes PNG/SVG files into outputDir, so dry-run skips
  // it. Themes consume `meta.image` set during route construction (above), not
  // anything emitted here, so skipping does not change the rendered HTML.
  if (!dryRun) {
    await timed(profiler, 'og_images', async () => {
      await rasterizeOgImages({ cwd, config, content, outputDir });
      await generateOgImages({ cwd, config, content, outputDir });
    });
  }

  // Load Handlebars helpers declared inline via `[components.helpers].paths`.
  // Thin sugar over a plugin that calls `engine.registerHelper`; for anything
  // more involved than registering a couple of pure-function helpers, prefer
  // a real Plugin (which can also see the BuildContext and add hooks).
  await loadInlineHelpers(cwd, config.components.helpers.paths, engine);

  // BuildContext exposed to plugin hooks. `outputDir` is the *final* output
  // dir (where the site will eventually live), not the staging dir, so plugin
  // authors don't have to learn about Laurel's atomic-swap internals. The
  // engine, content, and theme references are live — plugins may mutate
  // helpers/templates during `beforeBuild`, which the render fan-out picks up.
  const pluginCtx: BuildContext = {
    cwd,
    outputDir: finalOutputDir,
    config,
    content,
    theme,
    engine,
  };

  // beforeBuild: registration time for custom helpers, content patches that
  // must precede route planning, etc. Sequential so registration order is
  // deterministic. A throwing hook aborts the build to fail loudly when a
  // plugin's assumptions are violated.
  await invokeHook(pluginSet, 'beforeBuild', async (plugin) => {
    if (plugin.beforeBuild) await plugin.beforeBuild(pluginCtx);
  });

  // afterContentLoad: lets plugins mutate the loaded content graph (e.g.
  // inject synthetic posts, attach derived fields). Fires *after*
  // beforeBuild so a plugin's helper registrations are visible to anything
  // it does to the graph here.
  await invokeHook(pluginSet, 'afterContentLoad', async (plugin) => {
    if (plugin.afterContentLoad) await plugin.afterContentLoad(pluginCtx, content);
  });

  for (const ref of findMissingAssetReferences({ cwd, config, content, outputDir })) {
    logger.warn(formatMissingAssetReference(ref));
  }
  for (const ref of findMissingThemeAssetReferences(theme)) {
    logger.warn(formatMissingThemeAssetReference(ref));
  }

  const routes = await timed(profiler, 'plan', () =>
    withProgressPhase(progress, 'routes', 'Planning routes', async () => {
      const baseRoutes = planRoutes({ config, content, theme, routesYaml });
      // Collect plugin-supplied extra routes and merge them after the built-in
      // planner so generators don't accidentally shadow native routes. Plugin
      // routes are appended in registration order; conflicts on the same
      // outputPath surface as a warning and the built-in wins.
      const extraRoutes: RouteContext[] = [];
      for (const plugin of pluginSet.plugins) {
        if (!plugin.routes) continue;
        try {
          const routes = await plugin.routes(pluginCtx);
          for (const r of routes) extraRoutes.push(r);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`plugin '${plugin.name}' routes() failed: ${msg}`);
        }
      }
      const seenOutputPaths = new Set(baseRoutes.map((r) => r.outputPath));
      const routes: RouteContext[] = [...baseRoutes];
      for (const r of extraRoutes) {
        if (seenOutputPaths.has(r.outputPath)) {
          logger.warn(
            `plugin route '${r.url}' collides with existing outputPath '${r.outputPath}'; skipping`,
          );
          continue;
        }
        seenOutputPaths.add(r.outputPath);
        routes.push(r);
      }
      notifyProgress(progress, { type: 'routes-planned', totalRoutes: routes.length });
      return routes;
    }),
  );

  const subscribeConfig = config.components.subscribe;
  let warnedSubscribeNoop = false;
  const warnSubscribeNoopIfNeeded = (html: string): void => {
    if (
      !warnedSubscribeNoop &&
      !content.site.members_invite_only &&
      subscribeConfig.provider === 'none' &&
      containsSubscribeFormMarkup(html)
    ) {
      warnedSubscribeNoop = true;
      logger.warn(SUBSCRIBE_NOOP_BUILD_WARNING);
    }
  };
  const recommendationsEnabled = config.recommendations.length > 0;
  // If the theme already ships infinite scroll, Laurel's enhancement shim must
  // stand down (running both double-fetches every next page and duplicates its
  // cards). Detected once here and threaded into render + the shim emit below.
  const paginationMode = config.components.pagination.mode;
  const themeOwnsInfiniteScroll =
    paginationMode !== 'links' && (await themeHasNativeInfiniteScroll(theme));
  // Derived once so the render-time injection gate and the emit gate below can't
  // diverge (e.g. if a plugin mutates config between the two reads).
  const emitPaginationEnhance = paginationMode !== 'links' && !themeOwnsInfiniteScroll;
  if (themeOwnsInfiniteScroll) {
    // Note for `load-more`: the theme's own (auto) infinite scroll is used
    // instead of Laurel's button — running both would double-load. The button
    // isn't available against a theme that ships always-on infinite scroll.
    logger.info(
      `Theme '${theme.name}' ships its own infinite scroll; using it instead of Laurel's pagination.mode = "${paginationMode}" enhancement (running both would fetch every next page twice).`,
    );
  }
  // Diagnose malformed portal configs (e.g. `provider = "custom"` with no
  // `*_url` overrides) before the build silently emits dead Ghost-default
  // `#/portal/*` hrefs. Findings are surfaced through the shared warning
  // channel so they appear in the build summary alongside other config
  // misconfigurations. See `members/portal-validation.ts` for the policy.
  for (const finding of validatePortalConfig(config.components.portal)) {
    logger.warn(finding.message);
  }
  const portalUrls = resolvePortalUrls(config.components.portal);

  const contentImagePlan: ContentImageAssetPlan = config.build.copy_content_assets
    ? await timed(profiler, 'plan_content_images', () =>
        planContentImageAssets(cwd, config.content.assets_dir, {
          maxImageBytes: config.build.max_image_bytes,
          stripMetadata: config.components.images.strip_metadata,
        }),
      )
    : { entries: [], byRel: new Map() };
  const contentImageAssets = contentImagePlan.entries
    .map((entry) => ({ rel: entry.rel, hash: entry.hash, outputRel: entry.outputRel }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
  const themeFingerprint = computeThemeFingerprint(theme);
  const generatorFingerprint = await timed(profiler, 'generator_fingerprint', () =>
    computeGeneratorSourceFingerprint(undefined, undefined, laurelVersion),
  );
  const globalHash = computeGlobalHash({
    config,
    site: content.site,
    theme,
    themeFingerprint,
    generatorFingerprint,
    contentImageAssets,
  });
  const nextRoutes: Record<string, ManifestEntry> = {};
  const nextFeeds: Record<string, FeedManifestEntry> = {};
  const previousRoutes = previousManifest?.routes ?? {};
  const previousFeeds = previousManifest?.feeds ?? {};
  let skippedCount = 0;
  let renderedCount = 0;
  const inlineScriptCspHashes = new Set<string>();
  const sitemapUrls = config.components.sitemap.enabled
    ? routes.filter(isSitemapIndexableRoute).map((r) => {
        const post = r.kind === 'post' ? r.data.post : undefined;
        return {
          url: r.url,
          lastmod: r.lastmod,
          kind: routeKindToSitemapKind(r.kind),
          images: post?.feature_image
            ? [
                {
                  url: resolveContentImageUrl(post.feature_image, config, contentImagePlan),
                  caption: post.feature_image_caption,
                },
              ]
            : undefined,
        };
      })
    : [];
  let earlyThemeAssetCopy: SettledBuildTask<number> | undefined;
  let earlyContentAssetCopy: SettledBuildTask<number> | undefined;
  let earlySitemapEmit: SettledBuildTask<void> | undefined;
  const themeAssetCopyCache = createThemeAssetCopyCache();
  if (!dryRun) {
    earlyThemeAssetCopy = startSettledBuildTask(() =>
      timed(profiler, 'copy_assets', () =>
        copyAssets(theme, outputDir, {
          cache: themeAssetCopyCache,
          previousOutputFiles: previousBuildManifest?.files,
        }),
      ),
    );
    if (config.build.copy_content_assets) {
      earlyContentAssetCopy = startSettledBuildTask(() =>
        timed(profiler, 'copy_content_assets', () =>
          copyContentAssets(cwd, config.content.assets_dir, outputDir, {
            maxImageBytes: config.build.max_image_bytes,
            stripMetadata: imagesCfg.strip_metadata,
            onOutputPath: keepOutput,
            contentImagePlan,
          }),
        ),
      );
    }
    if (config.components.sitemap.enabled) {
      markPlannedSitemapOutputs({ routes, keepOutput });
      earlySitemapEmit = startSettledBuildTask(() =>
        timed(profiler, 'sitemap', () =>
          emitSitemap({
            config,
            outputDir,
            previousFeeds,
            nextFeeds,
            // `indexable: false` excludes pagination tails (`/page/N/`,
            // `/tag/<slug>/page/N/`, `/author/<slug>/page/N/`) and the 404 from
            // sitemap discovery surfaces; routes without the flag default to
            // indexable. See #781.
            urls: sitemapUrls,
          }),
        ),
      );
    }
  }
  const earlyHintsEnabled = config.deploy.early_hints.enabled;
  const earlyHintHrefs = earlyHintsEnabled
    ? buildKnownEarlyHintHrefs(theme, config.build.base_path)
    : new Set<string>();
  const reusedHtmlBodyNeeded =
    earlyHintsEnabled ||
    (typeof config.deploy.headers.security.content_security_policy === 'string' &&
      config.deploy.headers.security.content_security_policy.length > 0);
  const routeEarlyHints: RouteEarlyHints[] = [];

  // Render fans out under a concurrency cap so a 1000-post site overlaps the
  // per-route `Bun.file().exists()` / `.text()` I/O for reused entries instead
  // of paying it serially. The default cap is CPU count because the fresh-render
  // path is CPU-bound on the single JS thread — going wider buys nothing. The
  // `--concurrency` CLI flag overrides this for memory-constrained CI runners
  // (lower) or experimentation; the CLI guarantees it's a positive integer.
  const renderConcurrency =
    concurrency !== undefined ? Math.max(1, concurrency) : Math.max(1, availableParallelism());
  const renderLimit = pLimit(renderConcurrency);
  type RenderResult = {
    htmlOutput: HtmlOutput;
    routeHash: string;
    contentFingerprint: string;
    outputPath: string;
    url: string;
    bytes: number;
    reused: boolean;
    earlyHints: RouteEarlyHints | null;
    contentInputs: ReturnType<typeof collectRouteContentInputs>;
  };
  let completedRoutes = 0;
  const renderedImageDimensionCache = new Map();
  const renderedImageLqipCache = new Map<string, string | null>();
  const routeContentInputIndex = createRouteContentInputIndex(content);
  const renderOneRoute = (route: RouteContext): Promise<RenderResult> =>
    renderLimit(async (): Promise<RenderResult> => {
      const contentInputs = collectRouteContentInputs(route, content, routeContentInputIndex);
      const contentFingerprint = computeRouteContentInputsFingerprint(contentInputs);
      const previous = previousRoutes[route.url];
      const routeHash =
        reusePreviousRouteHash({
          previous,
          previousGlobalHash: previousManifest?.globalHash,
          currentGlobalHash: globalHash,
          route,
          contentFingerprint,
          themeFingerprint,
          pluginsEnabled: pluginSet.plugins.length > 0,
        }) ??
        computeRouteHash({
          globalHash,
          route,
          theme,
          contentFingerprint,
          themeFingerprint,
        });
      const reusableEntry =
        previous &&
        previous.hash === routeHash &&
        previous.outputPath === route.outputPath &&
        previous.contentFingerprint === contentFingerprint &&
        previous.themeFingerprint === themeFingerprint
          ? previous
          : undefined;

      if (reusableEntry) {
        const previousFile = Bun.file(join(finalOutputDir, reusableEntry.outputPath));
        if (await previousFile.exists()) {
          const stop = profiler?.startRoute({
            url: route.url,
            outputPath: route.outputPath,
            template: route.template,
            kind: route.kind,
          });
          const html = reusedHtmlBodyNeeded ? await previousFile.text() : '';
          if (html && isHtmlRoute(route)) warnSubscribeNoopIfNeeded(html);
          const bytes = html ? Buffer.byteLength(html, 'utf8') : previousFile.size;
          stop?.({ bytes, reused: true });
          completedRoutes += 1;
          notifyProgress(progress, {
            type: 'route-rendered',
            completedRoutes,
            totalRoutes: routes.length,
            route: route.url,
            reused: true,
          });
          return {
            htmlOutput: { outputPath: route.outputPath, html, reused: true },
            routeHash,
            contentFingerprint,
            outputPath: route.outputPath,
            url: route.url,
            bytes,
            reused: true,
            earlyHints:
              html && earlyHintsEnabled && isHtmlRoute(route)
                ? collectRouteEarlyHints({
                    routeUrl: route.url,
                    outputPath: route.outputPath,
                    html,
                    knownHrefs: earlyHintHrefs,
                    maxLinks: config.deploy.early_hints.max_links,
                  })
                : null,
            contentInputs,
          };
        }
      }

      const stop = profiler?.startRoute({
        url: route.url,
        outputPath: route.outputPath,
        template: route.template,
        kind: route.kind,
      });
      try {
        const html = await renderRouteHtml({
          cwd,
          config,
          content,
          theme,
          engine,
          route,
          plugins: pluginSet.plugins,
          pluginCtx,
          contentImagePlan,
          formatVariants,
          portalUrls,
          recommendationsEnabled,
          themeOwnsInfiniteScroll,
          warnSubscribeNoop: warnSubscribeNoopIfNeeded,
          imageDimensionCache: renderedImageDimensionCache,
          imageLqipCache: renderedImageLqipCache,
        });
        const bytes = Buffer.byteLength(html, 'utf8');
        stop?.({ bytes, reused: false });
        completedRoutes += 1;
        notifyProgress(progress, {
          type: 'route-rendered',
          completedRoutes,
          totalRoutes: routes.length,
          route: route.url,
          reused: false,
        });
        return {
          htmlOutput: { outputPath: route.outputPath, html },
          routeHash,
          contentFingerprint,
          outputPath: route.outputPath,
          url: route.url,
          bytes,
          reused: false,
          earlyHints:
            earlyHintsEnabled && isHtmlRoute(route)
              ? collectRouteEarlyHints({
                  routeUrl: route.url,
                  outputPath: route.outputPath,
                  html,
                  knownHrefs: earlyHintHrefs,
                  maxLinks: config.deploy.early_hints.max_links,
                })
              : null,
          contentInputs,
        };
      } catch (err) {
        stop?.();
        throw err;
      }
    });

  const dryRunRoutes: DryRunRouteSummary[] = [];
  let minifyInputBytes = 0;
  let minifyOutputBytes = 0;
  let minifiedAnyBatch = false;
  const buildManifestRoutes: BuildManifestRoute[] = [];
  notifyProgress(progress, {
    type: 'phase-start',
    phase: 'render',
    label: 'Rendering routes',
    totalRoutes: routes.length,
  });
  try {
    for (let start = 0; start < routes.length; start += ROUTE_RENDER_BATCH_SIZE) {
      const batchRoutes = routes.slice(start, start + ROUTE_RENDER_BATCH_SIZE);
      const renderResults = await timed(profiler, 'render', () =>
        Promise.all(batchRoutes.map(renderOneRoute)),
      );

      const htmlOutputs: HtmlOutput[] = [];
      for (let i = 0; i < renderResults.length; i++) {
        const result = renderResults[i];
        const route = batchRoutes[i];
        if (result === undefined || route === undefined) {
          throw new Error('render batch entry missing');
        }
        const nextRouteEntry = {
          hash: result.routeHash,
          outputPath: result.outputPath,
          contentFingerprint: result.contentFingerprint,
          themeFingerprint,
          kind: route.kind,
          template: route.template,
          lastmod: route.lastmod ?? null,
        };
        nextRoutes[result.url] = {
          ...nextRouteEntry,
          integrity: computeManifestEntryIntegrity(nextRouteEntry),
        };
        buildManifestRoutes.push({
          url: result.url,
          output_path: result.outputPath,
          route_fingerprint: result.routeHash,
          content_fingerprint: result.contentFingerprint,
          theme_fingerprint: themeFingerprint,
          content_inputs: result.contentInputs,
          reused: result.reused,
        });
        htmlOutputs.push(result.htmlOutput);
        if (isHtmlRoute(route)) {
          for (const warning of collectImageAltWarnings(result.htmlOutput.html, {
            outputPath: result.outputPath,
            routeUrl: result.url,
          })) {
            logger.warn(formatImageAltWarning(warning));
          }
        }
        keepOutput(result.outputPath);
        if (result.reused) skippedCount += 1;
        else renderedCount += 1;
        if (dryRun) {
          dryRunRoutes.push({
            url: route.url,
            outputPath: route.outputPath,
            template: route.template,
            kind: route.kind,
            bytes: result.bytes,
            reused: result.reused,
          });
        }
        if (result.earlyHints) {
          routeEarlyHints.push(result.earlyHints);
          if (config.deploy.early_hints.artifacts) {
            keepOutput(earlyHintsArtifactPath(result.earlyHints.output_path));
          }
        }
      }

      if (dryRun) continue;

      if (config.build.minify_html) {
        // Reused outputs already went through minification on the build that
        // emitted them; re-minifying would just pay the cost again and risk
        // skewing the stats line below.
        const toMinify = htmlOutputs.filter((o, index) => {
          const route = batchRoutes[index];
          return !o.reused && route !== undefined && isHtmlRoute(route);
        });
        const stats = await timed(
          profiler,
          'minify_html',
          () => minifyHtmlOutputs(toMinify),
          (r) => r.outputBytes,
        );
        minifyInputBytes += stats.inputBytes;
        minifyOutputBytes += stats.outputBytes;
        minifiedAnyBatch ||= stats.minified;
      }

      for (let i = 0; i < htmlOutputs.length; i += 1) {
        const output = htmlOutputs[i];
        const route = batchRoutes[i];
        if (output === undefined) continue;
        if (route === undefined || !isHtmlRoute(route)) continue;
        for (const hash of collectInlineScriptCspHashes(output.html)) {
          inlineScriptCspHashes.add(hash);
        }
      }

      await withProgressPhase(progress, 'html', 'Writing HTML', () =>
        timed(
          profiler,
          'write_html',
          () => writeHtmlBatch(outputDir, htmlOutputs),
          () => htmlOutputs.reduce((sum, out) => sum + Buffer.byteLength(out.html, 'utf8'), 0),
        ),
      );
    }
  } finally {
    notifyProgress(progress, {
      type: 'phase-end',
      phase: 'render',
      label: 'Rendering routes',
      totalRoutes: routes.length,
    });
  }

  if (dryRun) {
    // Bail out after rendering: every step below this point writes to disk
    // (HTML batch, asset copies, sitemap/RSS/search/redirects/manifests, …)
    // and dry-run promises not to touch the filesystem. Asset count is the
    // unique theme-asset set that copyAssets *would* emit, computed the same
    // way (sourcePath|fingerprintedPath dedupe) so the summary line matches.
    const uniqueAssets = new Set<string>();
    for (const asset of theme.assets.values()) {
      uniqueAssets.add(`${asset.sourcePath}|${asset.fingerprintedPath}`);
    }
    const peakRssBytes = profiler?.memory.peakRssBytes;
    const slowestRoutes = profiler?.slowestRoutes;
    const helperHotspots = profiler?.helperHotspots;
    profiler?.dispose?.();
    return {
      outputDir: finalOutputDir,
      routeCount: routes.length,
      assetCount: uniqueAssets.size,
      ...(peakRssBytes !== undefined ? { peakRssBytes } : {}),
      warningCount: getWarningCount(),
      renderedCount,
      skippedCount,
      dryRun: true,
      routes: dryRunRoutes,
      ...(slowestRoutes && slowestRoutes.length > 0 ? { slowestRoutes: [...slowestRoutes] } : {}),
      ...(helperHotspots && helperHotspots.length > 0
        ? { helperHotspots: [...helperHotspots] }
        : {}),
      ...(captureReusable === true && rawContentCache
        ? { reusable: { config, theme, rawContentCache } }
        : {}),
    };
  }

  if (minifiedAnyBatch && minifyInputBytes > 0) {
    const saved = minifyInputBytes - minifyOutputBytes;
    const pct = ((saved / minifyInputBytes) * 100).toFixed(1);
    logger.info(
      `HTML minified: ${minifyInputBytes} -> ${minifyOutputBytes} bytes (${pct}% smaller across ${renderedCount} files)`,
    );
  }

  if (!routes.some((r) => r.kind === 'error' && r.outputPath === '404.html')) {
    keepOutput('404.html');
    await timed(profiler, 'default_404', () =>
      emitDefault404({ config, content, outputDir, favicons }),
    );
  }

  if (recommendationsEnabled) {
    keepOutput('recommendations/index.html');
    await timed(profiler, 'recommendations_page', () =>
      emitRecommendationsPage({ config, content, outputDir, favicons }),
    );
  }

  const tierWelcomeOutputs = await timed(profiler, 'tier_welcome_pages', () =>
    emitTierWelcomePages({
      config,
      outputDir,
      tiers: content.tiers,
      reservedOutputPaths: new Set(routes.map((route) => route.outputPath)),
    }),
  );
  for (const outputPath of tierWelcomeOutputs) keepOutput(outputPath);

  const assetCount = await timed(profiler, 'assetCopy', () =>
    withProgressPhase(progress, 'assets', 'Copying assets', async () => {
      let assetCount = 0;
      const assetSteps: Array<{ label: string; run: () => Promise<void> }> = [
        {
          label: 'Theme assets',
          run: async () => {
            assetCount = await awaitSettledBuildTask(
              earlyThemeAssetCopy ??
                startSettledBuildTask(() =>
                  timed(profiler, 'copy_assets', () =>
                    copyAssets(theme, outputDir, {
                      cache: themeAssetCopyCache,
                      previousOutputFiles: previousBuildManifest?.files,
                    }),
                  ),
                ),
            );
            for (const asset of theme.assets.values()) keepOutput(asset.fingerprintedPath);
          },
        },
        {
          label: 'Ghost card assets',
          run: async () => {
            const emitted = await timed(profiler, 'card_assets', () =>
              emitCardAssets({ outputDir, cardAssets: theme.pkg.card_assets }),
            );
            if (emitted) {
              keepOutput(CARD_ASSETS_CSS_PATH);
              keepOutput(CARD_ASSETS_JS_PATH);
            }
          },
        },
        {
          label: 'Favicons',
          run: async () => {
            await timed(profiler, 'copy_favicons', () => copyFavicons(favicons, outputDir));
            for (const copy of favicons.copies) keepOutput(copy.outputPath);
          },
        },
        {
          label: 'Web manifest',
          run: async () => {
            const emitted = await timed(profiler, 'web_manifest', () =>
              emitWebManifest({ outputDir, config, favicons }),
            );
            if (emitted) keepOutput(GENERATED_WEB_MANIFEST_PATH);
          },
        },
        {
          label: 'Portal runtime',
          run: async () => {
            const emitted = await timed(profiler, 'portal_runtime', () =>
              emitPortalRuntime({ outputDir, enabled: content.site.members_enabled }),
            );
            if (emitted) keepOutput(PORTAL_RUNTIME_PATH);
          },
        },
      ];

      if (config.build.copy_content_assets) {
        assetSteps.push({
          label: 'Content assets',
          run: async () => {
            await awaitSettledBuildTask(
              earlyContentAssetCopy ??
                startSettledBuildTask(() =>
                  timed(profiler, 'copy_content_assets', () =>
                    copyContentAssets(cwd, config.content.assets_dir, outputDir, {
                      maxImageBytes: config.build.max_image_bytes,
                      stripMetadata: imagesCfg.strip_metadata,
                      onOutputPath: keepOutput,
                      contentImagePlan,
                    }),
                  ),
                ),
            );
          },
        });
        // `[components.images].resize` (default true) is the kill-switch for the
        // sharp-backed resize pipeline. When false we still emit srcset URLs
        // pointing at `/content/images/size/wXXX/...`, but no actual variants
        // land on disk — the browser falls back to the original `src`. This is
        // the right choice when the project does not want a sharp dependency or
        // when image variants are produced by another step in the toolchain.
        if (imagesCfg.resize) {
          assetSteps.push({
            label: 'Responsive image variants',
            run: async () => {
              await timed(profiler, 'image_variants', () =>
                generateImageVariants({
                  cwd,
                  config,
                  outputDir,
                  plan: imageVariantPlan,
                  stripMetadata: imagesCfg.strip_metadata,
                }),
              );
            },
          });
          if (formatVariants.length > 0) {
            assetSteps.push({
              label: 'Image format variants',
              run: async () => {
                await timed(profiler, 'image_format_variants', () =>
                  generateImageFormatVariants({ cwd, config, outputDir, plan: imageVariantPlan }),
                );
              },
            });
          }
          // Materialise the variants referenced by `{{img_url ... size="<key>"}}`
          // and `{{img_url ... size="<key>" format="<fmt>"}}` (e.g. Source's
          // post-card srcsets for `feature_image`). Runs after the responsive-width
          // pass so an `m: { width: 600 }` and the default 600w variant share one
          // file. Cache is keyed by source content hash; format variants are emitted
          // only when sharp is available and at least one format is configured.
          assetSteps.push({
            label: 'Theme image size variants',
            run: async () => {
              await timed(profiler, 'theme_image_size_variants', () =>
                generateThemeImageSizeVariants({
                  cwd,
                  config,
                  outputDir,
                  themeImageSizes: theme.pkg.image_sizes,
                  cacheDir: resolveCacheDir(cwd, imagesCfg.cache_dir),
                  formats: formatVariants,
                  webpQuality: imagesCfg.webp_quality,
                  avifQuality: imagesCfg.avif_quality,
                  stripMetadata: imagesCfg.strip_metadata,
                }),
              );
            },
          });
        }
      }

      for (let i = 0; i < assetSteps.length; i++) {
        const step = assetSteps[i];
        if (step === undefined) throw new Error('asset step missing');
        notifyProgress(progress, {
          type: 'asset-step',
          step: i + 1,
          totalSteps: assetSteps.length,
          label: step.label,
        });
        await step.run();
      }
      return assetCount;
    }),
  );

  await timed(profiler, 'feedEmit', async () => {
    if (config.components.sitemap.enabled) {
      if (earlySitemapEmit) {
        await awaitSettledBuildTask(earlySitemapEmit);
      } else {
        markPlannedSitemapOutputs({ routes, keepOutput });
        await timed(profiler, 'sitemap', () =>
          emitSitemap({
            config,
            outputDir,
            previousFeeds,
            nextFeeds,
            // `indexable: false` excludes pagination tails (`/page/N/`,
            // `/tag/<slug>/page/N/`, `/author/<slug>/page/N/`) and the 404 from
            // sitemap discovery surfaces; routes without the flag default to
            // indexable. See #781.
            urls: sitemapUrls,
          }),
        );
      }
    }
    if (config.components.rss.enabled) {
      markPlannedRssOutputs({ config, content, routesYaml, keepOutput });
      await timed(profiler, 'rss', () =>
        emitRss({
          config,
          content,
          outputDir,
          limit: config.components.rss.items,
          routesYaml,
          previousFeeds,
          nextFeeds,
        }),
      );
      keepOutput('feed/index.html');
      await timed(profiler, 'feed_alias', () =>
        emitFeedAlias({
          outputDir,
          enabled: true,
          basePath: config.build.base_path,
        }),
      );
    }
  });
  // `--emit-content-api` (BuildOptions.emitContentApi) overrides the config
  // gate per-build without forcing the operator to edit `laurel.toml`. The
  // override applies symmetrically to the SDK shadow tree (`emitContentApiShadows`)
  // and the flat-dump stubs (`emitContentApiStubs`) below.
  const contentApiEnabled = emitContentApi ?? config.components.content_api.enabled;
  if (contentApiEnabled) {
    markPlannedContentApiShadowOutputs({ config, content, keepOutput });
    await timed(profiler, 'content_api', () =>
      emitContentApiShadows({ config, content, outputDir }),
    );
  }
  if (config.components.robots.enabled) {
    keepOutput('robots.txt');
    await timed(profiler, 'robots', () => emitRobots({ cwd, config, outputDir, theme }));
  }
  if (config.components.humans.enabled) {
    keepOutput('humans.txt');
    await timed(profiler, 'humans', () => emitHumans({ cwd, config, outputDir }));
  }
  if (config.components.search.enabled) {
    markPlannedSearchOutputs({ config, keepOutput });
    await timed(profiler, 'search_json', () => emitSearchJson({ config, content, outputDir }));
    // Emit the `[data-ghost-search]` runtime shim before Pagefind crawls,
    // so the shim itself lands in the staging dir alongside the index.
    await timed(profiler, 'search_shim', () => emitSearchShim({ config, outputDir }));
    // Pagefind walks the staged HTML and emits a `pagefind/` index. Run it
    // here (before `commitStagingDir`) so the index is part of the atomic
    // swap into `dist/` — never a half-indexed live deploy.
    const pagefindRan = await timed(profiler, 'pagefind', () => runPagefind({ config, outputDir }));
    if (pagefindRan) keepOutput('pagefind');
    await timed(profiler, 'lunr_index', () => emitLunrIndex({ config, content, outputDir }));
    await timed(profiler, 'lunr_widget', () => emitLunrWidget({ config, outputDir }));
    await timed(profiler, 'search_ui_css', () => emitSearchUiCss({ config, outputDir }));
    await timed(profiler, 'algolia_records', () =>
      emitAlgoliaRecords({ config, content, outputDir }),
    );
    await timed(profiler, 'algolia_docsearch_css', () => emitDocSearchCss({ config, outputDir }));
    await timed(profiler, 'meilisearch_records', () =>
      emitMeilisearchRecords({ config, content, outputDir }),
    );
  }
  // Pagination enhancement runs independently of search: the script tag is
  // injected per pagination.mode (see route-render), so the runtime file must be
  // emitted on the same condition or feed pages 404 on `/pagination/enhance.js`.
  // Skipped entirely when the theme owns infinite scroll — the shim isn't
  // injected then, so emitting the file would only leave a dead asset.
  if (emitPaginationEnhance) {
    keepOutput('pagination/enhance.js');
    await timed(profiler, 'pagination_enhance', () =>
      emitPaginationEnhanceShim({ config, outputDir }),
    );
  }
  await timed(profiler, 'fediverse_discovery', () => emitFediverseDiscovery({ config, outputDir }));
  await timed(profiler, 'portal_manifest', () =>
    emitPortalManifest({
      config,
      outputDir,
      urls: portalUrls,
      recommendationsEnabled,
    }),
  );
  keepOutput('.nojekyll');
  await emitNojekyll({ outputDir });
  if (config.deploy.github_pages.custom_domain) keepOutput('CNAME');
  await emitCname({
    outputDir,
    customDomain: config.deploy.github_pages.custom_domain,
  });
  const autoNoindexProvider = isNonProductionBuild(config)
    ? config.build.metadata.provider
    : undefined;
  // Load `redirects.yaml` once and hand the canonical rules to every deploy
  // emitter that consumes them. Cloudflare Pages and Netlify both consume
  // `_redirects` at the publish root; the Netlify emitter translates
  // `force: true` into the `!` status suffix Netlify needs. Vercel / Apache /
  // nginx emitters read from the same parsed list.
  const userRedirects = await loadAllRedirects(cwd);
  const deployRedirects = [
    ...userRedirects,
    ...buildTrailingSlashRedirects({
      routes,
      policy: config.build.trailing_slash,
      basePath: config.build.base_path,
    }),
  ];
  const deployHeaders = withInlineScriptCspHashes(config.deploy.headers, inlineScriptCspHashes);
  const deploymentConfig =
    deployHeaders === config.deploy.headers
      ? config
      : {
          ...config,
          deploy: {
            ...config.deploy,
            headers: deployHeaders,
          },
        };
  const deploymentArtifacts = {
    outputDir,
    config: deploymentConfig,
    routes,
    userRedirects,
    deployRedirects,
    autoNoindexProvider,
  };
  const contentApiHeaderRules = contentApiEnabled ? collectContentApiHeaderRules() : [];
  const routeContentTypeHeaderRules = collectRouteContentTypeHeaderRules(
    routes,
    config.build.base_path,
  );
  const earlyHintsHeaderRules =
    earlyHintsEnabled && config.deploy.early_hints.headers
      ? buildEarlyHintsHeaderRules(routeEarlyHints, config.build.base_path)
      : [];
  markPlannedDeploymentHeaderOutputs({ config, autoNoindexProvider, keepOutput });
  await emitDeployHeaders(deploymentHeaderTargets, deploymentArtifacts, [
    ...routeContentTypeHeaderRules,
    ...contentApiHeaderRules,
    ...earlyHintsHeaderRules,
  ]);
  if (earlyHintsEnabled && config.deploy.early_hints.artifacts) {
    await timed(profiler, 'early_hints', () =>
      emitEarlyHintsArtifacts({ outputDir, routes: routeEarlyHints }),
    );
  }
  // Azure Static Web Apps config. Emitted unconditionally — the file is
  // azure-specific and inert on every other host, and a single laurel build
  // should be deployable to Azure without an extra config knob. Users who
  // need richer routing should drop a `staticwebapp.config.json` into the
  // static-passthrough dir, which overrides this default via the post-emit
  // passthrough step below.
  keepOutput('staticwebapp.config.json');
  await emitAzureStaticWebAppConfig({ outputDir });
  keepOutput('.laurel/cloudfront-response-headers-policy.json');
  await emitCloudFrontResponseHeadersPolicy({
    outputDir,
    headers: deployHeaders,
  });
  // Static content API dump: `dist/content/posts.json`,
  // `dist/content/settings.json`, plus CORS `_headers` (Netlify) and
  // `_headers.cf` (Cloudflare Pages) twin files announcing `/content/*` is
  // cross-origin-safe. Runs after the platform header emitters so it can
  // PREpend the CORS rule onto whatever cache/security headers those
  // emitters already wrote, rather than overwriting them.
  if (contentApiEnabled) {
    markPlannedContentApiStubOutputs({ content, config, keepOutput });
    await timed(profiler, 'content_api_stubs', () =>
      emitContentApiStubs({
        content,
        outputDir,
        absoluteUrls: config.components.content_api.absolute_urls,
        postsPerPage: config.components.content_api.posts_per_page,
        basePath: config.build.base_path,
        emitHtaccess: config.components.content_api.emit_htaccess,
        emitKeyRegistry: config.components.content_api.emit_key_registry,
      }),
    );
  }
  // Component-level emit runs first so platform-specific emitters can layer
  // their own files (`_headers`, `vercel.json`, …) on top. The component emit
  // writes a baseline `_redirects` whenever rules exist and the toggle is on —
  // independent of deploy-target gates — so a Ghost migration retains its
  // redirect history regardless of which host the build targets.
  markPlannedRedirectOutputs({
    rules: userRedirects,
    enabled: config.components.redirects.enabled,
    emitHtml: config.components.redirects.emit_html,
    keepOutput,
  });
  await emitRedirectsComponent({
    outputDir,
    rules: userRedirects,
    enabled: config.components.redirects.enabled,
    emitHtml: config.components.redirects.emit_html,
  });
  markPlannedGithubPagesRedirectOutputs({
    rules: userRedirects,
    enabled: config.deploy.github_pages.redirects,
    basePath: config.build.base_path,
    keepOutput,
  });
  await emitGithubPagesRedirects({
    outputDir,
    rules: userRedirects,
    enabled: config.deploy.github_pages.redirects,
    basePath: config.build.base_path,
  });
  markPlannedDeploymentRoutingOutputs({ config, autoNoindexProvider, deployRedirects, keepOutput });
  await emitDeployTargets(deploymentRoutingTargets, deploymentArtifacts);
  if (config.deploy.firebase.enabled) keepOutput('firebase.json');
  await emitFirebaseJson({
    outputDir,
    enabled: config.deploy.firebase.enabled,
    headers: deployHeaders,
    rules: deployRedirects,
    trailingSlash: config.build.trailing_slash,
  });
  if (config.deploy.apache.enabled) keepOutput('.htaccess');
  await emitApacheHtaccess({
    outputDir,
    enabled: config.deploy.apache.enabled,
    headers: deployHeaders,
    rules: deployRedirects,
  });
  if (config.deploy.nginx.enabled) keepOutput('.laurel/nginx.conf');
  await emitNginxConf({
    outputDir,
    enabled: config.deploy.nginx.enabled,
    headers: deployHeaders,
    rules: deployRedirects,
    root: config.deploy.nginx.root,
    serverName: config.deploy.nginx.server_name,
  });
  if (config.deploy.caddy.enabled) keepOutput('.laurel/Caddyfile');
  await emitCaddyfile({
    outputDir,
    enabled: config.deploy.caddy.enabled,
    headers: deployHeaders,
    rules: deployRedirects,
    root: config.deploy.caddy.root,
    siteAddress: config.deploy.caddy.site_address,
  });

  // Static passthrough runs as the final emit step so ordinary files the user
  // drops under `<cwd>/<content.static_dir>/` win over generated output. When
  // the default `static/` directory is absent, `public/` is accepted as the
  // same top-level convention. Deploy metadata files are protected below so
  // `_headers`, `_redirects`, `_routes-manifest.json`, and `vercel.json`
  // cannot silently replace generated platform artifacts.
  const generatedDeployArtifactPaths = [
    '_headers',
    '_redirects',
    CLOUDFLARE_WORKERS_MANIFEST_FILE,
    'vercel.json',
  ].filter((path) => plannedOutputPaths.has(path));
  await timed(profiler, 'static_passthrough', async () => {
    for (const staticDir of resolveStaticPassthroughDirs({
      cwd,
      staticDir: config.content.static_dir,
    })) {
      await copyStaticDir({
        cwd,
        staticDir,
        outputDir,
        onOutputPath: keepOutput,
        generatedConflict: {
          paths: generatedDeployArtifactPaths,
          force,
          merge: config.deploy.merge,
        },
      });
    }
  });
  keepOutput('.laurel/asset-manifest.json');
  await timed(profiler, 'asset_manifest', () => emitAssetManifest({ outputDir, theme }));

  if (clean) {
    const preservePatterns = noAtomic ? [] : await loadPreservePatterns(cwd);
    // Reconcile stale output at the output_dir scope, not just the (possibly
    // nested) emit dir. With emit_at_base_path the build writes into
    // output_dir/<segment>/ (dist/blog/); express the current build's paths
    // relative to output_dir so a sibling tree left by a previous build at a
    // different base_path (dist/blog2/), a flat layout (dist/index.html), or a
    // pre-0.1.10 build is removed too — otherwise `aws s3 sync output_dir`
    // re-uploads the orphan. The previous build's manifest is only a safe
    // set-difference shortcut when that build emitted to the SAME location: it
    // is loaded from finalOutputDir, so its presence means the emit dir is
    // unchanged. When the emit location changed there is no manifest there, so
    // previousBuildManifest is undefined and cleanup falls back to a full
    // output_dir tree scan that catches the orphaned siblings.
    const emitSegment = relative(baseOutputDir, finalOutputDir).split(sep).join('/');
    const prefix = emitSegment === '' || emitSegment === '.' ? '' : `${emitSegment}/`;
    const keepRelPaths =
      prefix === '' ? [...plannedOutputPaths] : [...plannedOutputPaths].map((p) => `${prefix}${p}`);
    const previousOutputFiles =
      prefix === ''
        ? previousBuildManifest?.files
        : previousBuildManifest?.files.map((f) => ({ path: `${prefix}${f.path}`, size: f.size }));
    await timed(profiler, 'stale_cleanup', () =>
      cleanupStaleOutput({
        outputDir: baseOutputDir,
        keepRelPaths,
        preservePatterns,
        previousOutputFiles,
      }),
    );
  }

  // Pre-compress text outputs (`.html`, `.css`, `.js`, `.json`, `.svg`, `.xml`,
  // `.txt`, `.map`) into `.br` + `.gz` siblings. Runs after every emitter so
  // the static-passthrough overrides land first and get compressed alongside
  // the generated tree, and *before* `emitBuildManifest` so the companion
  // files are part of the deploy manifest's hash list. Gated by
  // `[build].precompress` (`off` | `brotli` | `gzip` | `both`; default `off`,
  // flip on for production deploys).
  if (config.build.precompress !== 'off') {
    await timed(profiler, 'precompress', () =>
      precompressOutput({ outputDir, format: config.build.precompress }),
    );
  }

  const profilePath = profiler ? buildStatsPath(finalOutputDir) : undefined;
  let peakRssBytes: number | undefined;
  let slowestRoutes: readonly BuildStatsRoute[] | undefined;
  let helperHotspots: readonly BuildStatsHelperHotspot[] | undefined;
  if (profiler) {
    slowestRoutes = profiler.slowestRoutes;
    helperHotspots = profiler.helperHotspots;
    await writeProfile(outputDir, profiler, {
      outputDir: finalOutputDir,
      routeCount: routes.length,
      assetCount,
    });
    peakRssBytes = profiler.memory.peakRssBytes;
  }

  const nextManifest: BuildManifest = {
    version: MANIFEST_VERSION,
    globalHash,
    themeFingerprint,
    routes: nextRoutes,
    feeds: nextFeeds,
  };
  await saveManifest(outputDir, nextManifest);

  // Emit the deploy-facing build manifest last so its file list reflects every
  // artifact in the tree — including incremental cache, preserved user files,
  // and platform descriptors. Excludes itself and its derived changed-paths
  // companion to avoid self-referential hashes.
  const emittedBuildManifest = await timed(profiler, 'build_manifest', () =>
    emitBuildManifest({
      outputDir,
      config,
      theme,
      routeCount: routes.length,
      assetCount,
      laurelVersion,
      previousBuildManifest,
      routes: buildManifestRoutes,
    }),
  );

  // afterEmit fires once the site is fully on-disk at `finalOutputDir`.
  // Plugins that publish to external systems (Algolia push, search-index
  // upload, generated sidecar files) belong here. Errors warn-and-continue
  // because the site has already shipped to disk — failing the whole build
  // for a post-deploy webhook would punish the operator for one flaky
  // external service.
  await invokeHook(
    pluginSet,
    'afterEmit',
    async (plugin) => {
      if (plugin.afterEmit) await plugin.afterEmit(pluginCtx);
    },
    { warnOnError: true },
  );

  await runPostBuildHook({
    cwd,
    outputDir: finalOutputDir,
    command: config.hooks.post_build,
  });
  const outputBytes = await timed(profiler, 'output_size', () =>
    outputSizeFromBuildManifest(finalOutputDir, emittedBuildManifest),
  );

  return {
    outputDir: finalOutputDir,
    routeCount: routes.length,
    assetCount,
    outputBytes,
    ...(profilePath ? { profilePath } : {}),
    ...(peakRssBytes !== undefined ? { peakRssBytes } : {}),
    ...(slowestRoutes && slowestRoutes.length > 0 ? { slowestRoutes: [...slowestRoutes] } : {}),
    ...(helperHotspots && helperHotspots.length > 0 ? { helperHotspots: [...helperHotspots] } : {}),
    warningCount: getWarningCount(),
    renderedCount,
    skippedCount,
    dryRun: false,
    ...(captureReusable === true && rawContentCache
      ? { reusable: { config, theme, rawContentCache } }
      : {}),
  };
}

type KeepOutput = (path: string) => void;

async function outputSizeFromBuildManifest(
  outputDir: string,
  manifest: BuildManifestJson,
): Promise<number> {
  let total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  for (const rel of [buildManifestRelPath(), legacyBuildManifestRelPath(), changedPathsRelPath()]) {
    try {
      const file = await stat(join(outputDir, rel));
      if (file.isFile()) total += file.size;
    } catch (err) {
      if (!isFsErrnoCode(err, 'ENOENT')) throw err;
    }
  }
  return total;
}

function normalizeOutputRelPath(path: string): string | undefined {
  const normalized = (sep === '/' ? path : path.split(sep).join('/'))
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }
  return normalized;
}

function isFsErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === code;
}

function markPlannedSitemapOutputs(opts: {
  routes: readonly RouteContext[];
  keepOutput: KeepOutput;
}): void {
  const counts = new Map<SitemapKind, number>([
    ['posts', 0],
    ['pages', 0],
    ['tags', 0],
    ['authors', 0],
  ]);
  for (const route of opts.routes) {
    if (route.indexable === false) continue;
    const kind = routeKindToSitemapKind(route.kind) ?? 'pages';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  for (const kind of ['posts', 'pages', 'tags', 'authors'] as const) {
    const count = counts.get(kind) ?? 0;
    const pages = Math.max(1, Math.ceil(count / SITEMAP_MAX_URLS_PER_FILE));
    for (let page = 1; page <= pages; page++) {
      const suffix = page === 1 ? '' : `-${page}`;
      opts.keepOutput(`sitemap-${kind}${suffix}.xml`);
      opts.keepOutput(`sitemap-${kind}${suffix}.xml.gz`);
    }
  }
  opts.keepOutput('sitemap.xml');
  opts.keepOutput('sitemap.xml.gz');
}

function markPlannedRssOutputs(opts: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  content: ContentGraph;
  routesYaml: Awaited<ReturnType<typeof loadRoutesYaml>>;
  keepOutput: KeepOutput;
}): void {
  const perPage = Math.max(1, Math.min(opts.config.components.rss.items, 250));
  const pages = Math.max(1, Math.ceil(opts.content.posts.length / perPage));
  for (let page = 1; page <= pages; page++) {
    opts.keepOutput(page === 1 ? 'rss.xml' : `rss-${page}.xml`);
  }
  if (opts.config.components.rss.per_tag) {
    for (const tag of opts.content.tags) {
      if (tag.visibility !== 'public') continue;
      const posts = opts.content.postsByTag.get(tag.slug) ?? [];
      if (posts.length > 0) opts.keepOutput(`tag/${tag.slug}/rss/index.xml`);
    }
  }
  if (opts.config.components.rss.per_author) {
    for (const author of opts.content.authors) {
      const posts = opts.content.postsByAuthor.get(author.slug) ?? [];
      if (posts.length > 0) opts.keepOutput(`author/${author.slug}/rss/index.xml`);
    }
  }
  const collections = resolveCollections(opts.routesYaml);
  if (collections.length > 0) {
    const assignments = assignPostUrls(opts.content.posts, collections);
    for (const collection of collections) {
      if (collection.rss === false) continue;
      const postCount = opts.content.posts.filter(
        (post) => assignments.get(post.id)?.collection === collection,
      ).length;
      if (postCount === 0) continue;
      const pages = Math.max(1, Math.ceil(postCount / perPage));
      const basePath = collection.url.replace(/^\/+/, '').replace(/\/+$/, '');
      for (let page = 1; page <= pages; page++) {
        const relPath =
          page === 1
            ? basePath
              ? `${basePath}/rss/index.xml`
              : 'rss/index.xml'
            : basePath
              ? `${basePath}/rss/${page}/index.xml`
              : `rss/${page}/index.xml`;
        opts.keepOutput(relPath);
      }
    }
  }
}

function markPlannedImageVariants(opts: {
  cwd: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  plan: Awaited<ReturnType<typeof planImageVariants>>;
  themeImageSizes: Record<string, { width?: number | undefined; height?: number | undefined }>;
  formats: readonly ImageFormat[];
  keepOutput: KeepOutput;
}): void {
  for (const [rel, widths] of opts.plan) {
    for (const w of widths) {
      opts.keepOutput(`content/images/size/w${w}/${rel}`);
      for (const format of opts.config.components.images.formats) {
        opts.keepOutput(`content/images/size/w${w}/${rel}.${format}`);
      }
    }
  }

  const sizeSegments = Object.values(opts.themeImageSizes)
    .map((size) => buildThemeImageSizeSegmentForCleanup(size))
    .filter((segment) => segment.length > 0);
  if (sizeSegments.length === 0) return;
  const assetsRoot = resolve(opts.cwd, opts.config.content.assets_dir);
  if (!existsSync(assetsRoot)) return;
  for (const rel of new Bun.Glob('**/*').scanSync({ cwd: assetsRoot, onlyFiles: true })) {
    const normalizedRel = normalizeOutputRelPath(rel);
    if (!normalizedRel || !isRasterImage(normalizedRel)) continue;
    if (normalizedRel.startsWith('size/')) continue;
    for (const segment of sizeSegments) {
      opts.keepOutput(`content/images/size/${segment}/${normalizedRel}`);
      for (const format of opts.formats) {
        opts.keepOutput(`content/images/size/${segment}/format/${format}/${normalizedRel}`);
      }
    }
  }
}

function markPlannedOgImages(opts: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  content: ContentGraph;
  cwd: string;
  keepOutput: KeepOutput;
}): void {
  if (opts.config.components.og_images.enabled && opts.config.components.og_images.template) {
    for (const item of [...opts.content.posts, ...opts.content.pages]) {
      if (!item.og_image && !item.twitter_image && !item.feature_image) {
        opts.keepOutput(`content/images/og/${item.slug}.png`);
      }
    }
  }
  if (!opts.config.components.opengraph.rasterize_svg) return;
  const assetsRoot = resolve(opts.cwd, opts.config.content.assets_dir);
  for (const item of [...opts.content.posts, ...opts.content.pages]) {
    const featureImage = item.feature_image;
    if (!featureImage) continue;
    const marker = '/content/images/';
    const clean = featureImage.split(/[?#]/)[0] ?? '';
    const idx = clean.indexOf(marker);
    if (idx < 0 || !clean.toLowerCase().endsWith('.svg')) continue;
    const rel = clean.slice(idx + marker.length);
    if (!rel || rel.includes('..')) continue;
    const source = join(assetsRoot, rel);
    if (!existsSync(source)) continue;
    const withoutExt = rel.slice(0, rel.length - extname(rel).length);
    opts.keepOutput(`content/images/${withoutExt}.og.png`);
  }
}

function markPlannedContentApiShadowOutputs(opts: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  content: ContentGraph;
  keepOutput: KeepOutput;
}): void {
  const base = 'ghost/api/content';
  for (const resource of ['posts', 'pages', 'authors', 'tags', 'tiers', 'newsletters'] as const) {
    opts.keepOutput(`${base}/${resource}.json`);
    opts.keepOutput(`${base}/${resource}/index.json`);
  }
  opts.keepOutput(`${base}/settings.json`);
  opts.keepOutput(`${base}/settings/index.json`);
  const posts = opts.content.posts.filter((p) => p.status === 'published');
  const pages = opts.content.pages.filter((p) => p.status === 'published');
  const pageCount = Math.max(
    1,
    Math.ceil(posts.length / opts.config.components.content_api.posts_per_page),
  );
  for (let page = 1; page <= pageCount; page++) {
    opts.keepOutput(`${base}/posts/page/${page}.json`);
    opts.keepOutput(`${base}/posts/page/${page}/index.json`);
  }
  opts.keepOutput(`${base}/posts/featured.json`);
  opts.keepOutput(`${base}/posts/featured/index.json`);
  for (const post of posts) {
    opts.keepOutput(`${base}/posts/${post.id}.json`);
    opts.keepOutput(`${base}/posts/${post.id}/index.json`);
    opts.keepOutput(`${base}/posts/slug/${post.slug}.json`);
    opts.keepOutput(`${base}/posts/slug/${post.slug}/index.json`);
  }
  for (const page of pages) {
    opts.keepOutput(`${base}/pages/${page.id}.json`);
    opts.keepOutput(`${base}/pages/${page.id}/index.json`);
    opts.keepOutput(`${base}/pages/slug/${page.slug}.json`);
    opts.keepOutput(`${base}/pages/slug/${page.slug}/index.json`);
  }
  for (const author of opts.content.authors) {
    opts.keepOutput(`${base}/authors/slug/${author.slug}.json`);
    opts.keepOutput(`${base}/authors/slug/${author.slug}/index.json`);
  }
  for (const tag of opts.content.tags) {
    opts.keepOutput(`${base}/tags/slug/${tag.slug}.json`);
    opts.keepOutput(`${base}/tags/slug/${tag.slug}/index.json`);
    opts.keepOutput(`${base}/posts/tag/${tag.slug}.json`);
    opts.keepOutput(`${base}/posts/tag/${tag.slug}/index.json`);
  }
  opts.keepOutput('.well-known/ghost.json');
  opts.keepOutput('_redirects');
}

function markPlannedContentApiStubOutputs(opts: {
  content: ContentGraph;
  config: Awaited<ReturnType<typeof loadConfig>>;
  keepOutput: KeepOutput;
}): void {
  for (const resource of ['posts', 'pages', 'tags', 'authors', 'tiers', 'newsletters'] as const) {
    opts.keepOutput(`content/${resource}.json`);
    opts.keepOutput(`content/${resource}/index.json`);
  }
  opts.keepOutput('content/settings.json');
  opts.keepOutput('content/settings/index.json');
  const posts = opts.content.posts.filter((p) => p.status === 'published');
  const pages = opts.content.pages.filter((p) => p.status === 'published');
  const pageCount = Math.max(
    1,
    Math.ceil(posts.length / opts.config.components.content_api.posts_per_page),
  );
  for (let page = 1; page <= pageCount; page++) {
    opts.keepOutput(`content/posts/page/${page}.json`);
    opts.keepOutput(`content/posts/page/${page}/index.json`);
  }
  opts.keepOutput('content/posts/featured.json');
  opts.keepOutput('content/posts/featured/index.json');
  for (const post of posts) {
    opts.keepOutput(`content/posts/${post.id}.json`);
    opts.keepOutput(`content/posts/${post.id}/index.json`);
    opts.keepOutput(`content/posts/slug/${post.slug}.json`);
    opts.keepOutput(`content/posts/slug/${post.slug}/index.json`);
  }
  for (const page of pages) {
    opts.keepOutput(`content/pages/${page.id}.json`);
    opts.keepOutput(`content/pages/${page.id}/index.json`);
    opts.keepOutput(`content/pages/slug/${page.slug}.json`);
    opts.keepOutput(`content/pages/slug/${page.slug}/index.json`);
  }
  for (const tag of opts.content.tags) {
    opts.keepOutput(`content/posts/tag/${tag.slug}.json`);
    opts.keepOutput(`content/posts/tag/${tag.slug}/index.json`);
  }
  opts.keepOutput('_headers');
  opts.keepOutput('_headers.cf');
  opts.keepOutput('.well-known/ghost.json');
  if (opts.config.components.content_api.emit_htaccess) {
    opts.keepOutput('content/.htaccess');
  }
}

function markPlannedSearchOutputs(opts: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  keepOutput: KeepOutput;
}): void {
  const cfg = opts.config.components.search;
  if (
    cfg.engine === 'json' ||
    cfg.engine === 'json+pagefind' ||
    cfg.engine === 'json+lunr' ||
    cfg.engine === 'json+sodo-search'
  ) {
    opts.keepOutput('content/search.json');
  }
  if (searchEngineUsesLaurelGhostSearchShim(cfg.engine)) {
    opts.keepOutput('search/ghost-search.js');
  }
  if (cfg.engine === 'lunr' || cfg.engine === 'json+lunr') {
    opts.keepOutput('search-index.json');
    opts.keepOutput('search/widget.js');
    opts.keepOutput('search/lunr.min.js');
  }
  opts.keepOutput('search/search.css');
  if (cfg.emit_algolia_records) {
    opts.keepOutput('.laurel/algolia-records.json');
    opts.keepOutput('search/algolia-docsearch.css');
  }
  if (cfg.emit_meilisearch_records) {
    opts.keepOutput('.laurel/meilisearch-records.json');
  }
}

function markPlannedDeploymentHeaderOutputs(opts: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  autoNoindexProvider: DeploymentProvider | undefined;
  keepOutput: KeepOutput;
}): void {
  if (
    opts.config.deploy.cloudflare_pages.enabled ||
    opts.autoNoindexProvider === 'cloudflare_pages'
  ) {
    opts.keepOutput('_headers');
  }
  if (opts.config.deploy.netlify.enabled || opts.autoNoindexProvider === 'netlify') {
    opts.keepOutput('_headers');
  }
  if (opts.config.deploy.cloudflare_workers.enabled) {
    opts.keepOutput(CLOUDFLARE_WORKERS_MANIFEST_FILE);
  }
}

function markPlannedDeploymentRoutingOutputs(opts: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  autoNoindexProvider: DeploymentProvider | undefined;
  deployRedirects: readonly RedirectRule[];
  keepOutput: KeepOutput;
}): void {
  if (opts.config.deploy.cloudflare_pages.enabled) {
    opts.keepOutput('_routes.json');
    if (opts.deployRedirects.length > 0) opts.keepOutput('_redirects');
  }
  if (opts.config.deploy.netlify.enabled && opts.deployRedirects.length > 0) {
    opts.keepOutput('_redirects');
  }
  if (opts.config.deploy.vercel.enabled || opts.autoNoindexProvider === 'vercel') {
    opts.keepOutput('vercel.json');
  }
}

function markPlannedRedirectOutputs(opts: {
  rules: readonly RedirectRule[];
  enabled: boolean;
  emitHtml: boolean;
  keepOutput: KeepOutput;
}): void {
  if (!opts.enabled) return;
  if (opts.rules.length > 0) opts.keepOutput('_redirects');
  if (!opts.emitHtml) return;
  for (const rule of opts.rules) {
    const rel = rule.from.replace(/^\/+/, '');
    if (!rel || rel.includes('..') || rel.includes('\\')) continue;
    opts.keepOutput(`${rel.replace(/\/+$/, '')}/index.html`);
  }
}

function markPlannedGithubPagesRedirectOutputs(opts: {
  rules: readonly RedirectRule[];
  enabled: boolean;
  basePath: string;
  keepOutput: KeepOutput;
}): void {
  if (!opts.enabled) return;
  for (const rule of opts.rules) {
    const outputPath = githubPagesRedirectOutputPath(rule.from, opts.basePath);
    if (outputPath) opts.keepOutput(outputPath);
  }
}

function buildThemeImageSizeSegmentForCleanup(size: {
  width?: number | undefined;
  height?: number | undefined;
}): string {
  let segment = '';
  if (typeof size.width === 'number' && size.width > 0) segment += `w${size.width}`;
  if (typeof size.height === 'number' && size.height > 0) segment += `h${size.height}`;
  return segment;
}

function isRasterImage(path: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(path).toLowerCase());
}

// Iterate the loaded plugin set in registration order and invoke a hook on
// each one. By default a throwing hook propagates so the build fails loudly;
// `warnOnError` flips that to log + continue (used for `afterEmit`, which
// runs after the site is already on-disk).
async function invokeHook(
  set: LoadedPluginSet,
  label: string,
  fn: (plugin: Plugin) => Promise<void> | void,
  opts: { warnOnError?: boolean } = {},
): Promise<void> {
  for (const plugin of set.plugins) {
    try {
      await fn(plugin);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.warnOnError) {
        logger.warn(`plugin '${plugin.name}' ${label} hook failed: ${msg}`);
        continue;
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}

// Resolve each entry in `[components.helpers].paths` against the project root,
// dynamic-import it, and register every named function export as a Handlebars
// helper on the engine. Accepts a `default` export shaped `{ name, fn }` or
// `Record<string, Function>` for modules that prefer not to use named exports.
// A path that fails to import warns and is skipped so a broken helper file
// never bricks the build.
export async function loadInlineHelpers(
  cwd: string,
  paths: readonly string[],
  engine: ReturnType<typeof createEngine>,
): Promise<void> {
  if (paths.length === 0) return;
  for (const rawPath of paths) {
    const abs = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
    const importPath = pathToFileURL(abs).href;
    try {
      const mod = (await import(importPath)) as Record<string, unknown>;
      let registered = 0;
      // Default export shaped as either a single { name, fn } pair or a flat
      // map of helpers. Inspect both shapes; named exports are also walked
      // below so a single file can mix both styles.
      const def = mod.default;
      if (def && typeof def === 'object') {
        if (
          'name' in (def as Record<string, unknown>) &&
          'fn' in (def as Record<string, unknown>) &&
          typeof (def as { fn: unknown }).fn === 'function' &&
          typeof (def as { name: unknown }).name === 'string'
        ) {
          const single = def as { name: string; fn: (...args: unknown[]) => unknown };
          engine.registerHelper?.(single.name, single.fn);
          registered += 1;
        } else {
          for (const [key, value] of Object.entries(def as Record<string, unknown>)) {
            if (typeof value === 'function') {
              engine.registerHelper?.(key, value as (...args: unknown[]) => unknown);
              registered += 1;
            }
          }
        }
      }
      for (const [key, value] of Object.entries(mod)) {
        if (key === 'default') continue;
        if (typeof value === 'function') {
          engine.registerHelper?.(key, value as (...args: unknown[]) => unknown);
          registered += 1;
        }
      }
      if (registered === 0) {
        logger.warn(`helpers file '${rawPath}' registered no helpers (no function exports found)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`failed to load helpers from '${rawPath}': ${msg}`);
    }
  }
}
