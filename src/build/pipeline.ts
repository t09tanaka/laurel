import { rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isNonProductionBuild } from '~/config/deploy-environment.ts';
import { loadConfig } from '~/config/loader.ts';
import { type MarkdownTransformHook, loadContent } from '~/content/loader.ts';
import { validatePortalConfig } from '~/members/portal-validation.ts';
import { type LoadedPluginSet, loadPlugins } from '~/plugin/loader.ts';
import type { BuildContext, Plugin } from '~/plugin/types.ts';
import { createEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import { loadTheme } from '~/theme/loader.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { pLimit } from '~/util/concurrency.ts';
import { NectarError, isNectarError } from '~/util/errors.ts';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';
import { getNectarVersion } from '~/util/nectar-version.ts';
import { injectSkipLink } from './a11y.ts';
import { emitAlgoliaRecords, emitDocSearchCss } from './algolia.ts';
import { emitApacheHtaccess } from './apache.ts';
import { emitContentApiShadows } from './api.ts';
import { emitAssetManifest } from './asset-manifest.ts';
import { emitAzureStaticWebAppConfig } from './azure.ts';
import { normalizeBasePath } from './base-path.ts';
import { normalizeBaseUrl } from './base-url.ts';
import { emitBuildManifest, loadBuildManifest } from './build-manifest.ts';
import { emitCaddyfile } from './caddy.ts';
import { emitCardAssets } from './card-assets.ts';
import { emitCloudflareWorkersManifest } from './cloudflare-workers.ts';
import { emitCloudFrontResponseHeadersPolicy } from './cloudfront-response-headers.ts';
import { emitCname } from './cname.ts';
import { emitContentApiStubs } from './content-api.ts';
import { type HtmlOutput, copyAssets, copyContentAssets, writeHtmlBatch } from './emit.ts';
import {
  deploymentHeaderTargets,
  deploymentRoutingTargets,
  emitDeployTargets,
} from './emitters/registry.ts';
import { emitDefault404 } from './error-page.ts';
import { computeFavicons, copyFavicons } from './favicons.ts';
import { type SitemapKind, emitRss, emitSitemap } from './feeds.ts';
import { emitFirebaseJson } from './firebase.ts';
import { generateOgImages } from './generate-og-images.ts';
import { emitGithubPagesRedirects } from './github-pages.ts';
import { runPostBuildHook } from './hooks.ts';
import { emitHumans } from './humans.ts';
import {
  type ImageFormat,
  collapseDegenerateSrcset,
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
import { stripUnusedLightbox } from './lightbox.ts';
import { emitLunrIndex, emitLunrWidget } from './lunr.ts';
import {
  type BuildManifest,
  MANIFEST_VERSION,
  type ManifestEntry,
  computeGlobalHash,
  computeRouteHash,
  loadManifest,
  saveManifest,
} from './manifest.ts';
import { emitMeilisearchRecords } from './meilisearch.ts';
import { minifyHtmlOutputs } from './minify.ts';
import { emitNginxConf } from './nginx.ts';
import { emitNojekyll } from './nojekyll.ts';
import {
  clearDirContents,
  commitStagingDir,
  prepareStagingDir,
  resolveOutputDir,
} from './output-dir.ts';
import {
  injectStylesheetPreload,
  injectSubresourceIntegrity,
  removeRedundantScriptPreload,
} from './perf-hints.ts';
import { emitPortalRuntime } from './portal-runtime.ts';
import { rewritePortalLinks, rewriteRecommendationsButton } from './portal-shim.ts';
import { resolvePortalUrls } from './portal-urls.ts';
import { precompressOutput } from './precompress.ts';
import { preserveUserFiles } from './preserve.ts';
import { type Profiler, createProfiler, writeProfile } from './profile.ts';
import { rasterizeOgImages } from './rasterize-og-images.ts';
import { emitRecommendationsPage } from './recommendations-page.ts';
import { emitRedirectsComponent } from './redirects-emit.ts';
import { buildTrailingSlashRedirects, loadAllRedirects } from './redirects.ts';
import { emitRobots } from './robots.ts';
import { loadRoutesYaml, warnUnappliedSections } from './routes-yaml.ts';
import { planRoutes } from './routes.ts';
import {
  emitSearchJson,
  emitSearchShim,
  emitSearchUiCss,
  injectPagefindSkipMeta,
  injectSearchShimScript,
  runPagefind,
} from './search.ts';
import { copyStaticDir } from './static-passthrough.ts';
import { transformSubscribeForms } from './subscribe-forms.ts';

export interface BuildOptions {
  cwd: string;
  configPath?: string | undefined;
  outputDir?: string | undefined;
  basePath?: string | undefined;
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
  // Override for `[components.content_api].enabled`. Undefined leaves the
  // config value alone; `true` forces the JSON shadows under `dist/content/`
  // and `dist/ghost/api/content/` on; `false` forces them off. Exposed
  // through `--emit-content-api` (and `NECTAR_BUILD_EMIT_CONTENT_API=0`) so
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
  warningCount: number;
  renderedCount: number;
  skippedCount: number;
  dryRun: boolean;
  // Populated only when dryRun is true; lets the CLI print a per-route table
  // under --verbose without re-walking the route plan.
  routes?: DryRunRouteSummary[];
}

async function timed<T>(
  profiler: Profiler | null,
  phase: string,
  fn: () => Promise<T> | T,
  getBytes?: (result: T) => number | undefined,
): Promise<T> {
  if (!profiler) return await fn();
  const stop = profiler.start(phase);
  const result = await fn();
  const bytes = getBytes?.(result);
  stop(bytes !== undefined ? { bytes_emitted: bytes } : undefined);
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

export async function build({
  cwd,
  configPath,
  outputDir: outputDirOverride,
  basePath: basePathOverride,
  baseUrl: baseUrlOverride,
  profile,
  noAtomic,
  concurrency,
  dryRun,
  includeDrafts,
  force,
  emitContentApi,
  copyContentAssets,
  progress,
}: BuildOptions): Promise<BuildSummary> {
  resetWarningCount();
  const profiler = profile ? createProfiler() : null;
  // Emit the looser-policy warning before any other build output so it is
  // hard to miss in CI logs and obviously precedes the rendered route list.
  // Goes through `logger.warn` so `--strict` counts it as a warning and the
  // operator has to acknowledge that drafts shipped.
  if (includeDrafts === true) {
    logger.warn('Building with drafts');
  }
  const config = await withProgressPhase(progress, 'config', 'Loading config', () =>
    timed(profiler, 'config', () => loadConfig({ cwd, configPath })),
  );
  if (copyContentAssets !== undefined) {
    config.build.copy_content_assets = copyContentAssets;
  }
  const finalOutputDir = resolveOutputDir(cwd, outputDirOverride ?? config.build.output_dir);
  config.build.base_path = normalizeBasePath(basePathOverride ?? config.build.base_path);
  if (baseUrlOverride !== undefined) {
    config.site.url = normalizeBaseUrl(baseUrlOverride);
  }

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

  // Dry-run skips both staging and the final-dir clear: nothing is ever
  // written, so there is no half-built state to confine and no stale files
  // to clobber. Render targets `finalOutputDir` only as the nominal path used
  // for incremental-reuse reads from a previous real build.
  let outputDir: string;
  if (isDryRun) {
    outputDir = finalOutputDir;
  } else {
    // Stage the entire build into a sibling temp dir and swap it into place at
    // the end. Two reasons: (1) `nectar dev` will produce overlapping rebuilds
    // and a partially-cleared `dist/` lets readers (a browser, a deploy script)
    // see "index.html missing for 200ms"; staging confines the half-written
    // state to a path no one is watching. (2) On build failure the previous
    // good `dist/` is left untouched instead of being half-deleted.
    //
    // `--no-atomic` opts out: writes go straight into the final dir. Used as an
    // escape hatch for sandboxed runners where the staging-rename step is
    // blocked, at the cost of dropping the two protections above.
    outputDir = noAtomic ? finalOutputDir : await prepareStagingDir(finalOutputDir);
    if (noAtomic) {
      // Match the pre-staging behaviour so a previous build's stale files do
      // not bleed into this one. Wipes the previous manifest's on-disk HTML,
      // which forces a full rebuild — acceptable since `--no-atomic` is opt-in.
      await clearDirContents(finalOutputDir);
    }
  }

  try {
    return await runBuild({
      cwd,
      config,
      outputDir,
      finalOutputDir,
      profiler,
      previousManifest,
      previousBuildManifest,
      noAtomic: noAtomic === true,
      concurrency,
      dryRun: isDryRun,
      includeDrafts: includeDrafts === true,
      emitContentApi,
      progress,
    });
  } catch (err) {
    if (!isDryRun && !noAtomic) {
      await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }
}

async function runBuild({
  cwd,
  config,
  outputDir,
  finalOutputDir,
  profiler,
  previousManifest,
  previousBuildManifest,
  noAtomic,
  concurrency,
  dryRun,
  includeDrafts,
  emitContentApi,
  progress,
}: {
  cwd: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  outputDir: string;
  finalOutputDir: string;
  profiler: Profiler | null;
  previousManifest: BuildManifest | undefined;
  previousBuildManifest: Awaited<ReturnType<typeof loadBuildManifest>>;
  noAtomic: boolean;
  concurrency: number | undefined;
  dryRun: boolean;
  includeDrafts: boolean;
  emitContentApi: boolean | undefined;
  progress: BuildProgressReporter | undefined;
}): Promise<BuildSummary> {
  // Resolve Nectar's own version once up front; the build-manifest emitter at
  // the end of the pipeline embeds it into `build-manifest.json` for deploy
  // tooling to detect generator upgrades.
  const nectarVersion = await getNectarVersion();
  // Load `routes.yaml` first so it can shape both content URLs (tag/author
  // archives may be disabled or use custom paths) and the route plan.
  const { routesYaml, pluginSet, content, theme, imageVariantPlan, formatVariants } =
    await withProgressPhase(progress, 'content', 'Loading content and theme', async () => {
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

      const [content, theme] = await timed(profiler, 'load_content_and_theme', () =>
        Promise.all([
          loadContent({ cwd, config, routesYaml, includeDrafts, markdownTransforms }),
          loadTheme({ cwd, config }),
        ]),
      );

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
      return { routesYaml, pluginSet, content, theme, imageVariantPlan, formatVariants };
    });

  const imagesCfg = config.components.images;

  // OG image generation writes PNG/SVG files into outputDir, so dry-run skips
  // it. Themes consume `meta.image` set during route construction (above), not
  // anything emitted here, so skipping does not change the rendered HTML.
  if (!dryRun) {
    await timed(profiler, 'og_images', async () => {
      await rasterizeOgImages({ cwd, config, content, outputDir });
      await generateOgImages({ cwd, config, content, outputDir });
    });
  }

  const favicons = computeFavicons({ config, theme, cwd });
  const engine = createEngine({ config, content, theme, favicons, cwd });

  // Load Handlebars helpers declared inline via `[components.helpers].paths`.
  // Thin sugar over a plugin that calls `engine.registerHelper`; for anything
  // more involved than registering a couple of pure-function helpers, prefer
  // a real Plugin (which can also see the BuildContext and add hooks).
  await loadInlineHelpers(cwd, config.components.helpers.paths, engine);

  // BuildContext exposed to plugin hooks. `outputDir` is the *final* output
  // dir (where the site will eventually live), not the staging dir, so plugin
  // authors don't have to learn about Nectar's atomic-swap internals. The
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

  const routes = await withProgressPhase(progress, 'routes', 'Planning routes', async () => {
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
  });

  const subscribeConfig = config.components.subscribe;
  const recommendationsEnabled = config.recommendations.length > 0;
  // Diagnose malformed portal configs (e.g. `provider = "custom"` with no
  // `*_url` overrides) before the build silently emits dead Ghost-default
  // `#/portal/*` hrefs. Findings are surfaced through the shared warning
  // channel so they appear in the build summary alongside other config
  // misconfigurations. See `members/portal-validation.ts` for the policy.
  for (const finding of validatePortalConfig(config.components.portal)) {
    logger.warn(finding.message);
  }
  const portalUrls = resolvePortalUrls(config.components.portal);
  const htmlOutputs: HtmlOutput[] = [];
  let renderedBytes = 0;

  const globalHash = computeGlobalHash({ config, site: content.site, theme });
  const nextRoutes: Record<string, ManifestEntry> = {};
  const previousRoutes = previousManifest?.routes ?? {};
  let skippedCount = 0;
  let renderedCount = 0;

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
    outputPath: string;
    url: string;
    bytes: number;
    reused: boolean;
  };
  let completedRoutes = 0;
  const renderResults = await withProgressPhase(
    progress,
    'render',
    'Rendering routes',
    () =>
      Promise.all(
        routes.map((route) =>
          renderLimit(async (): Promise<RenderResult> => {
            const routeHash = computeRouteHash({ globalHash, route, theme });
            const previous = previousRoutes[route.url];
            const reusableEntry =
              previous && previous.hash === routeHash && previous.outputPath === route.outputPath
                ? previous
                : undefined;

            if (reusableEntry) {
              const previousFile = Bun.file(join(finalOutputDir, reusableEntry.outputPath));
              if (await previousFile.exists()) {
                const stop = profiler?.start('render', route.url);
                const html = await previousFile.text();
                const bytes = Buffer.byteLength(html, 'utf8');
                stop?.({ bytes_emitted: bytes });
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
                  outputPath: route.outputPath,
                  url: route.url,
                  bytes,
                  reused: true,
                };
              }
            }

            const stop = profiler?.start('render', route.url);
            try {
              // Per-route plugin hook. Sequential per route; routes still render
              // in parallel because each route's hook chain awaits independently.
              for (const plugin of pluginSet.plugins) {
                if (plugin.beforeRender) await plugin.beforeRender(pluginCtx, route);
              }
              let html = collapseDegenerateSrcset(
                rewritePortalLinks({
                  html: rewriteRecommendationsButton({
                    html: stripUnusedLightbox(
                      transformSubscribeForms(
                        injectSkipLink(engine.render(route), config.build.csp_nonce),
                        subscribeConfig,
                      ),
                    ),
                    basePath: config.build.base_path,
                    enabled: recommendationsEnabled,
                  }),
                  urls: portalUrls,
                }),
              );
              // Pagefind integration: inject the runtime shim script on any page
              // that has a `[data-ghost-search]` trigger, and tag non-public
              // post HTML with `<meta name="pagefind-skip">` so Pagefind drops
              // those pages from the public index. Both are no-ops unless the
              // search component is enabled with a pagefind-emitting engine.
              if (
                config.components.search.enabled &&
                (config.components.search.engine === 'pagefind' ||
                  config.components.search.engine === 'json+pagefind')
              ) {
                html = injectSearchShimScript(html, config.build.base_path, config.build.csp_nonce);
                const post = route.kind === 'post' ? route.data.post : undefined;
                if (post && post.visibility !== 'public') {
                  html = injectPagefindSkipMeta(html);
                }
              }
              // Resource-hint post-processing. Runs after every theme-side or
              // injected script/link has landed so we see the final document
              // shape, but before plugin afterRender so plugins can still react
              // to the rewritten head. dedupe_script_preload deletes the
              // `<link rel="preload" as="script">` that the Source theme ships
              // alongside its `<script>` (#528); preload_stylesheet adds a sibling
              // preload to bare `<link rel="stylesheet">` (#527, opt-in).
              if (config.performance.dedupe_script_preload) {
                html = removeRedundantScriptPreload(html);
              }
              if (config.performance.preload_stylesheet) {
                html = injectStylesheetPreload(html);
              }
              html = injectSubresourceIntegrity(
                html,
                theme.assets.values(),
                config.build.base_path,
              );
              // afterRender chain: each plugin sees the previous transform's
              // output (including the Pagefind shim above when enabled). Returning
              // anything other than a string is treated as a pass-through so a
              // plugin that just wants to observe the HTML can omit the return.
              for (const plugin of pluginSet.plugins) {
                if (!plugin.afterRender) continue;
                const next = await plugin.afterRender(pluginCtx, route, html);
                if (typeof next === 'string') html = next;
              }
              const bytes = Buffer.byteLength(html, 'utf8');
              stop?.({ bytes_emitted: bytes });
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
                outputPath: route.outputPath,
                url: route.url,
                bytes,
                reused: false,
              };
            } catch (err) {
              stop?.();
              throw wrapRenderError(err, route.url, route.template);
            }
          }),
        ),
      ),
    { totalRoutes: routes.length },
  );

  // Aggregate in route order so htmlOutputs (consumed by minify_html and
  // writeHtmlBatch) and the manifest stay deterministic regardless of which
  // chunk finished first.
  for (const result of renderResults) {
    nextRoutes[result.url] = { hash: result.routeHash, outputPath: result.outputPath };
    htmlOutputs.push(result.htmlOutput);
    renderedBytes += result.bytes;
    if (result.reused) skippedCount += 1;
    else renderedCount += 1;
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
    return {
      outputDir: finalOutputDir,
      routeCount: routes.length,
      assetCount: uniqueAssets.size,
      warningCount: getWarningCount(),
      renderedCount,
      skippedCount,
      dryRun: true,
      routes: routes.map((route, i) => {
        const result = renderResults[i];
        return {
          url: route.url,
          outputPath: route.outputPath,
          template: route.template,
          kind: route.kind,
          bytes: result?.bytes ?? 0,
          reused: result?.reused ?? false,
        };
      }),
    };
  }

  if (config.build.minify_html) {
    // Reused outputs already went through minification on the build that
    // emitted them; re-minifying would just pay the cost again and risk
    // skewing the stats line below.
    const toMinify = htmlOutputs.filter((o) => !o.reused);
    const stats = await timed(
      profiler,
      'minify_html',
      () => minifyHtmlOutputs(toMinify),
      (r) => r.outputBytes,
    );
    if (stats.minified && stats.inputBytes > 0) {
      const saved = stats.inputBytes - stats.outputBytes;
      const pct = ((saved / stats.inputBytes) * 100).toFixed(1);
      logger.info(
        `HTML minified: ${stats.inputBytes} -> ${stats.outputBytes} bytes (${pct}% smaller across ${toMinify.length} files)`,
      );
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

  if (!routes.some((r) => r.kind === 'error' && r.outputPath === '404.html')) {
    await timed(profiler, 'default_404', () =>
      emitDefault404({ config, content, outputDir, favicons }),
    );
  }

  if (recommendationsEnabled) {
    await timed(profiler, 'recommendations_page', () =>
      emitRecommendationsPage({ config, content, outputDir, favicons }),
    );
  }

  const assetCount = await withProgressPhase(progress, 'assets', 'Copying assets', async () => {
    let assetCount = 0;
    const assetSteps: Array<{ label: string; run: () => Promise<void> }> = [
      {
        label: 'Theme assets',
        run: async () => {
          assetCount = await timed(profiler, 'copy_assets', () => copyAssets(theme, outputDir));
        },
      },
      {
        label: 'Ghost card assets',
        run: async () => {
          await timed(profiler, 'card_assets', () =>
            emitCardAssets({ outputDir, cardAssets: theme.pkg.card_assets }),
          );
        },
      },
      {
        label: 'Favicons',
        run: async () => {
          await timed(profiler, 'copy_favicons', () => copyFavicons(favicons, outputDir));
        },
      },
      {
        label: 'Portal runtime',
        run: async () => {
          await timed(profiler, 'portal_runtime', () =>
            emitPortalRuntime({ outputDir, enabled: content.site.members_enabled }),
          );
        },
      },
    ];

    if (config.build.copy_content_assets) {
      assetSteps.push({
        label: 'Content assets',
        run: async () => {
          await timed(profiler, 'copy_content_assets', () =>
            copyContentAssets(cwd, config.content.assets_dir, outputDir, {
              maxImageBytes: config.build.max_image_bytes,
            }),
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
              generateImageVariants({ cwd, config, outputDir, plan: imageVariantPlan }),
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
  });

  if (config.components.sitemap.enabled) {
    await timed(profiler, 'sitemap', () =>
      emitSitemap({
        config,
        content,
        outputDir,
        // `indexable: false` excludes pagination tails (`/page/N/`,
        // `/tag/<slug>/page/N/`, `/author/<slug>/page/N/`) and the 404 from
        // sitemap discovery surfaces; routes without the flag default to
        // indexable. See #781.
        urls: routes
          .filter((r) => r.indexable !== false)
          .map((r) => ({ url: r.url, lastmod: r.lastmod, kind: routeKindToSitemapKind(r.kind) })),
      }),
    );
  }
  if (config.components.rss.enabled) {
    await timed(profiler, 'rss', () =>
      emitRss({
        config,
        content,
        outputDir,
        limit: config.components.rss.items,
      }),
    );
  }
  // `--emit-content-api` (BuildOptions.emitContentApi) overrides the config
  // gate per-build without forcing the operator to edit `nectar.toml`. The
  // override applies symmetrically to the SDK shadow tree (`emitContentApiShadows`)
  // and the flat-dump stubs (`emitContentApiStubs`) below.
  const contentApiEnabled = emitContentApi ?? config.components.content_api.enabled;
  if (contentApiEnabled) {
    await timed(profiler, 'content_api', () =>
      emitContentApiShadows({ config, content, outputDir }),
    );
  }
  if (config.components.robots.enabled) {
    await timed(profiler, 'robots', () => emitRobots({ cwd, config, outputDir }));
  }
  if (config.components.humans.enabled) {
    await timed(profiler, 'humans', () => emitHumans({ cwd, config, outputDir }));
  }
  if (config.components.search.enabled) {
    await timed(profiler, 'search_json', () => emitSearchJson({ config, content, outputDir }));
    // Emit the `[data-ghost-search]` runtime shim before Pagefind crawls,
    // so the shim itself lands in the staging dir alongside the index.
    await timed(profiler, 'search_shim', () => emitSearchShim({ config, outputDir }));
    // Pagefind walks the staged HTML and emits a `pagefind/` index. Run it
    // here (before `commitStagingDir`) so the index is part of the atomic
    // swap into `dist/` — never a half-indexed live deploy.
    await timed(profiler, 'pagefind', () => runPagefind({ config, outputDir }));
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
  await emitNojekyll({ outputDir });
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
  const deploymentArtifacts = {
    outputDir,
    config,
    routes,
    userRedirects,
    deployRedirects,
    autoNoindexProvider,
  };
  await emitDeployTargets(deploymentHeaderTargets, deploymentArtifacts);
  // Azure Static Web Apps config. Emitted unconditionally — the file is
  // azure-specific and inert on every other host, and a single nectar build
  // should be deployable to Azure without an extra config knob. Users who
  // need richer routing should drop a `staticwebapp.config.json` into the
  // static-passthrough dir, which overrides this default via the post-emit
  // passthrough step below.
  await emitAzureStaticWebAppConfig({ outputDir });
  await emitCloudFrontResponseHeadersPolicy({
    outputDir,
    headers: config.deploy.headers,
  });
  // Static content API dump: `dist/content/posts.json`,
  // `dist/content/settings.json`, plus CORS `_headers` (Netlify) and
  // `_headers.cf` (Cloudflare Pages) twin files announcing `/content/*` is
  // cross-origin-safe. Runs after the platform header emitters so it can
  // PREpend the CORS rule onto whatever cache/security headers those
  // emitters already wrote, rather than overwriting them.
  if (contentApiEnabled) {
    await timed(profiler, 'content_api_stubs', () =>
      emitContentApiStubs({
        content,
        outputDir,
        absoluteUrls: config.components.content_api.absolute_urls,
        postsPerPage: config.components.content_api.posts_per_page,
        basePath: config.build.base_path,
      }),
    );
  }
  // Component-level emit runs first so platform-specific emitters can layer
  // their own files (`_headers`, `vercel.json`, …) on top. The component emit
  // writes a baseline `_redirects` whenever rules exist and the toggle is on —
  // independent of deploy-target gates — so a Ghost migration retains its
  // redirect history regardless of which host the build targets.
  await emitRedirectsComponent({
    outputDir,
    rules: userRedirects,
    enabled: config.components.redirects.enabled,
    emitHtml: config.components.redirects.emit_html,
  });
  await emitGithubPagesRedirects({
    outputDir,
    rules: userRedirects,
    enabled: config.deploy.github_pages.redirects,
    basePath: config.build.base_path,
  });
  await emitCloudflareWorkersManifest({
    outputDir,
    enabled: config.deploy.cloudflare_workers.enabled,
    headers: config.deploy.headers,
    rules: deployRedirects,
  });
  await emitDeployTargets(deploymentRoutingTargets, deploymentArtifacts);
  await emitFirebaseJson({
    outputDir,
    enabled: config.deploy.firebase.enabled,
    headers: config.deploy.headers,
    rules: deployRedirects,
    trailingSlash: config.build.trailing_slash,
  });
  await emitApacheHtaccess({
    outputDir,
    enabled: config.deploy.apache.enabled,
    headers: config.deploy.headers,
    rules: deployRedirects,
  });
  await emitNginxConf({
    outputDir,
    enabled: config.deploy.nginx.enabled,
    headers: config.deploy.headers,
    rules: deployRedirects,
    root: config.deploy.nginx.root,
    serverName: config.deploy.nginx.server_name,
  });
  await emitCaddyfile({
    outputDir,
    enabled: config.deploy.caddy.enabled,
    headers: config.deploy.headers,
    rules: deployRedirects,
    root: config.deploy.caddy.root,
    siteAddress: config.deploy.caddy.site_address,
  });

  // Static passthrough runs as the final emit step so a file the user drops
  // under `<cwd>/<content.static_dir>/` wins over both theme assets and
  // generated platform files (`_headers`, `_redirects`, `robots.txt`, …).
  await timed(profiler, 'static_passthrough', () =>
    copyStaticDir({ cwd, staticDir: config.content.static_dir, outputDir }),
  );
  await timed(profiler, 'asset_manifest', () => emitAssetManifest({ outputDir, theme }));

  // Pre-compress text outputs (`.html`, `.css`, `.js`, `.json`, `.svg`, `.xml`,
  // `.txt`, `.map`) into `.br` + `.gz` siblings. Runs after every emitter so
  // the static-passthrough overrides land first and get compressed alongside
  // the generated tree, and *before* `emitBuildManifest` so the companion
  // files are part of the deploy manifest's hash list. Gated by
  // `[build].precompress` (default false; flip on for production deploys).
  if (config.build.precompress) {
    await timed(profiler, 'precompress', () => precompressOutput({ outputDir, enabled: true }));
  }

  if (profiler) {
    await writeProfile(outputDir, profiler);
  }

  const nextManifest: BuildManifest = {
    version: MANIFEST_VERSION,
    globalHash,
    routes: nextRoutes,
  };
  await saveManifest(outputDir, nextManifest);

  if (!noAtomic) {
    // Copy user-owned files (CNAME, .well-known/*, …) from the previous build's
    // final dir into staging so the upcoming atomic swap does not drop them.
    await preserveUserFiles({ cwd, finalOutputDir, stagingDir: outputDir });
  }

  // Emit the deploy-facing build manifest last so its file list reflects every
  // artifact in the tree — including incremental cache, preserved user files,
  // and platform descriptors. Excludes itself and its derived changed-paths
  // companion to avoid self-referential hashes. Runs before commitStagingDir
  // (atomic mode) so the manifest swaps in atomically with the rest of the
  // site; under --no-atomic it lands directly in finalOutputDir.
  await timed(profiler, 'build_manifest', () =>
    emitBuildManifest({
      outputDir,
      config,
      theme,
      routeCount: routes.length,
      assetCount,
      nectarVersion,
      previousBuildManifest,
    }),
  );

  if (!noAtomic) {
    await commitStagingDir(outputDir, finalOutputDir);
  }

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

  return {
    outputDir: finalOutputDir,
    routeCount: routes.length,
    assetCount,
    warningCount: getWarningCount(),
    renderedCount,
    skippedCount,
    dryRun: false,
  };
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
async function loadInlineHelpers(
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

function wrapRenderError(err: unknown, url: string, template: string): NectarError {
  const prefix = `failed to render ${url} (${template})`;
  if (isNectarError(err)) {
    return new NectarError({
      message: `${prefix}: ${err.message}`,
      file: err.file,
      line: err.line,
      col: err.col,
      hint: err.hint,
      cause: err.cause ?? err,
      code: err.code ?? 'render',
    });
  }
  return new NectarError({
    message: err instanceof Error ? `${prefix}: ${err.message}` : `${prefix}: ${String(err)}`,
    cause: err,
    code: 'render',
  });
}
