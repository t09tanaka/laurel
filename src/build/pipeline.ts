import { rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { createEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import { loadTheme } from '~/theme/loader.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { pLimit } from '~/util/concurrency.ts';
import { NectarError, isNectarError } from '~/util/errors.ts';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';
import { injectSkipLink } from './a11y.ts';
import { emitAlgoliaRecords, emitDocSearchCss } from './algolia.ts';
import { emitContentApiShadows } from './api.ts';
import { normalizeBasePath } from './base-path.ts';
import { emitCloudflarePagesHeaders } from './cloudflare-pages.ts';
import { emitCname } from './cname.ts';
import { emitCustomRedirects } from './custom-redirects.ts';
import { type HtmlOutput, copyAssets, copyContentAssets, writeHtmlBatch } from './emit.ts';
import { emitDefault404 } from './error-page.ts';
import { computeFavicons, copyFavicons } from './favicons.ts';
import { type SitemapKind, emitRss, emitSitemap } from './feeds.ts';
import { generateOgImages } from './generate-og-images.ts';
import {
  type ImageFormat,
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
import { emitNetlifyHeaders, emitNetlifyRedirects } from './netlify.ts';
import { emitNginxConf } from './nginx.ts';
import { emitNojekyll } from './nojekyll.ts';
import { commitStagingDir, prepareStagingDir, resolveOutputDir } from './output-dir.ts';
import { rewritePortalLinks, rewriteRecommendationsButton } from './portal-shim.ts';
import { resolvePortalUrls } from './portal-urls.ts';
import { preserveUserFiles } from './preserve.ts';
import { type Profiler, createProfiler, writeProfile } from './profile.ts';
import { rasterizeOgImages } from './rasterize-og-images.ts';
import { emitRecommendationsPage } from './recommendations-page.ts';
import { loadRedirects } from './redirects.ts';
import { emitRobots } from './robots.ts';
import { loadRoutesYaml, warnUnappliedSections } from './routes-yaml.ts';
import { planRoutes } from './routes.ts';
import { emitSearchJson, runPagefind } from './search.ts';
import { copyStaticDir } from './static-passthrough.ts';
import { transformSubscribeForms } from './subscribe-forms.ts';
import { emitVercelJson } from './vercel.ts';

export interface BuildOptions {
  cwd: string;
  configPath?: string | undefined;
  outputDir?: string | undefined;
  basePath?: string | undefined;
  profile?: boolean | undefined;
}

export interface BuildSummary {
  outputDir: string;
  routeCount: number;
  assetCount: number;
  warningCount: number;
  renderedCount: number;
  skippedCount: number;
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
  profile,
}: BuildOptions): Promise<BuildSummary> {
  resetWarningCount();
  const profiler = profile ? createProfiler() : null;
  const config = await timed(profiler, 'config', () => loadConfig({ cwd, configPath }));
  const finalOutputDir = resolveOutputDir(cwd, outputDirOverride ?? config.build.output_dir);
  config.build.base_path = normalizeBasePath(basePathOverride ?? config.build.base_path);

  // Read the previous manifest from the live output dir BEFORE staging so the
  // incremental decision and any reused-HTML reads see the last successful
  // build's tree, not the empty staging directory we are about to create.
  const previousManifest = await loadManifest(finalOutputDir);

  // Stage the entire build into a sibling temp dir and swap it into place at
  // the end. Two reasons: (1) `nectar dev` will produce overlapping rebuilds
  // and a partially-cleared `dist/` lets readers (a browser, a deploy script)
  // see "index.html missing for 200ms"; staging confines the half-written
  // state to a path no one is watching. (2) On build failure the previous
  // good `dist/` is left untouched instead of being half-deleted.
  const outputDir = await prepareStagingDir(finalOutputDir);

  try {
    return await runBuild({
      cwd,
      config,
      outputDir,
      finalOutputDir,
      profiler,
      previousManifest,
    });
  } catch (err) {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
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
}: {
  cwd: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  outputDir: string;
  finalOutputDir: string;
  profiler: Profiler | null;
  previousManifest: BuildManifest | undefined;
}): Promise<BuildSummary> {
  // Load `routes.yaml` first so it can shape both content URLs (tag/author
  // archives may be disabled or use custom paths) and the route plan.
  const routesYaml = await timed(profiler, 'routes_yaml', () => loadRoutesYaml(cwd));
  warnUnappliedSections(routesYaml);
  const [content, theme] = await timed(profiler, 'load_content_and_theme', () =>
    Promise.all([loadContent({ cwd, config, routesYaml }), loadTheme({ cwd, config })]),
  );

  validateThemeCustom({ config, pkg: theme.pkg });

  injectImageDimensionsIntoContent({ content, cwd, config });

  const imageVariantPlan = await timed(profiler, 'plan_image_variants', () =>
    planImageVariants({ cwd, config }),
  );
  injectImageSrcsetIntoContent({ content, plan: imageVariantPlan });
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

  await timed(profiler, 'og_images', async () => {
    await rasterizeOgImages({ cwd, config, content, outputDir });
    await generateOgImages({ cwd, config, content, outputDir });
  });

  const favicons = computeFavicons({ config, theme, cwd });
  const engine = createEngine({ config, content, theme, favicons, cwd });
  const routes = planRoutes({ config, content, theme, routesYaml });

  const subscribeConfig = config.components.subscribe;
  const recommendationsEnabled = config.recommendations.length > 0;
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
  // of paying it serially. The cap is CPU count because the fresh-render path
  // is CPU-bound on the single JS thread — going wider buys nothing.
  const renderConcurrency = Math.max(1, availableParallelism());
  const renderLimit = pLimit(renderConcurrency);
  type RenderResult = {
    htmlOutput: HtmlOutput;
    routeHash: string;
    outputPath: string;
    url: string;
    bytes: number;
    reused: boolean;
  };
  const renderResults = await Promise.all(
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
          const html = rewritePortalLinks({
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
          });
          const bytes = Buffer.byteLength(html, 'utf8');
          stop?.({ bytes_emitted: bytes });
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

  await timed(
    profiler,
    'write_html',
    () => writeHtmlBatch(outputDir, htmlOutputs),
    () => htmlOutputs.reduce((sum, out) => sum + Buffer.byteLength(out.html, 'utf8'), 0),
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

  const assetCount = await timed(profiler, 'copy_assets', () => copyAssets(theme, outputDir));
  await timed(profiler, 'copy_favicons', () => copyFavicons(favicons, outputDir));
  if (config.build.copy_content_assets) {
    await timed(profiler, 'copy_content_assets', () =>
      copyContentAssets(cwd, config.content.assets_dir, outputDir, {
        maxImageBytes: config.build.max_image_bytes,
      }),
    );
    await timed(profiler, 'image_variants', () =>
      generateImageVariants({ cwd, config, outputDir, plan: imageVariantPlan }),
    );
    if (formatVariants.length > 0) {
      await timed(profiler, 'image_format_variants', () =>
        generateImageFormatVariants({ cwd, config, outputDir, plan: imageVariantPlan }),
      );
    }
    // Materialise the variants referenced by `{{img_url ... size="<key>"}}`
    // and `{{img_url ... size="<key>" format="<fmt>"}}` (e.g. Source's
    // post-card srcsets for `feature_image`). Runs after the responsive-width
    // pass so an `m: { width: 600 }` and the default 600w variant share one
    // file. Cache is keyed by source content hash; format variants are emitted
    // only when sharp is available and at least one format is configured.
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
  }

  if (config.components.sitemap.enabled) {
    await timed(profiler, 'sitemap', () =>
      emitSitemap({
        config,
        content,
        outputDir,
        urls: routes
          .filter((r) => r.kind !== 'error')
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
  if (config.components.content_api.enabled) {
    await timed(profiler, 'content_api', () =>
      emitContentApiShadows({ config, content, outputDir }),
    );
  }
  if (config.components.robots.enabled) {
    await timed(profiler, 'robots', () => emitRobots({ cwd, config, outputDir }));
  }
  if (config.components.search.enabled) {
    await timed(profiler, 'search_json', () => emitSearchJson({ config, content, outputDir }));
    // Pagefind walks the staged HTML and emits a `pagefind/` index. Run it
    // here (before `commitStagingDir`) so the index is part of the atomic
    // swap into `dist/` — never a half-indexed live deploy.
    await timed(profiler, 'pagefind', () => runPagefind({ config, outputDir }));
    await timed(profiler, 'lunr_index', () => emitLunrIndex({ config, content, outputDir }));
    await timed(profiler, 'lunr_widget', () => emitLunrWidget({ config, outputDir }));
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
  await emitCloudflarePagesHeaders({
    outputDir,
    enabled: config.deploy.cloudflare_pages.enabled,
    headers: config.deploy.headers,
  });
  await emitNetlifyHeaders({
    outputDir,
    enabled: config.deploy.netlify.enabled,
    headers: config.deploy.headers,
  });
  // Load `redirects.yaml` once and hand the canonical rules to every emitter
  // that consumes them. Cloudflare Pages and Netlify both consume `_redirects`
  // at the publish root; the Netlify emitter translates `force: true` into the
  // `!` status suffix Netlify needs. Vercel / Apache / nginx / S3 emitters
  // will read from the same parsed list when added.
  const redirects = await loadRedirects(cwd);
  await emitCustomRedirects({
    outputDir,
    rules: redirects,
    enabled: config.deploy.cloudflare_pages.enabled,
  });
  await emitNetlifyRedirects({
    outputDir,
    rules: redirects,
    enabled: config.deploy.netlify.enabled,
  });
  await emitVercelJson({
    outputDir,
    enabled: config.deploy.vercel.enabled,
    headers: config.deploy.headers,
    rules: redirects,
  });
  await emitNginxConf({
    outputDir,
    enabled: config.deploy.nginx.enabled,
    headers: config.deploy.headers,
    rules: redirects,
    root: config.deploy.nginx.root,
    serverName: config.deploy.nginx.server_name,
  });

  // Static passthrough runs as the final emit step so a file the user drops
  // under `<cwd>/<content.static_dir>/` wins over both theme assets and
  // generated platform files (`_headers`, `_redirects`, `robots.txt`, …).
  await timed(profiler, 'static_passthrough', () =>
    copyStaticDir({ cwd, staticDir: config.content.static_dir, outputDir }),
  );

  if (profiler) {
    await writeProfile(outputDir, profiler);
  }

  const nextManifest: BuildManifest = {
    version: MANIFEST_VERSION,
    globalHash,
    routes: nextRoutes,
  };
  await saveManifest(outputDir, nextManifest);

  // Copy user-owned files (CNAME, .well-known/*, …) from the previous build's
  // final dir into staging so the upcoming atomic swap does not drop them.
  await preserveUserFiles({ cwd, finalOutputDir, stagingDir: outputDir });

  await commitStagingDir(outputDir, finalOutputDir);

  return {
    outputDir: finalOutputDir,
    routeCount: routes.length,
    assetCount,
    warningCount: getWarningCount(),
    renderedCount,
    skippedCount,
  };
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
    });
  }
  return new NectarError({
    message: err instanceof Error ? `${prefix}: ${err.message}` : `${prefix}: ${String(err)}`,
    cause: err,
  });
}
