import { rm } from 'node:fs/promises';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { createEngine } from '~/render/engine.ts';
import { loadTheme } from '~/theme/loader.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { NectarError, isNectarError } from '~/util/errors.ts';
import { getWarningCount, resetWarningCount } from '~/util/logger.ts';
import { injectSkipLink } from './a11y.ts';
import { emitContentApiShadows } from './api.ts';
import { normalizeBasePath } from './base-path.ts';
import { emitCloudflarePagesHeaders } from './cloudflare-pages.ts';
import { emitCname } from './cname.ts';
import { emitCustomRedirects } from './custom-redirects.ts';
import { type HtmlOutput, copyAssets, copyContentAssets, writeHtmlBatch } from './emit.ts';
import { emitDefault404 } from './error-page.ts';
import { computeFavicons, copyFavicons } from './favicons.ts';
import { emitRss, emitSitemap } from './feeds.ts';
import { generateOgImages } from './generate-og-images.ts';
import {
  type ImageFormat,
  generateImageFormatVariants,
  generateImageVariants,
  injectImageDimensionsIntoContent,
  injectImagePictureSourcesIntoContent,
  injectImageSrcsetIntoContent,
  isSharpAvailable,
  planImageVariants,
} from './images.ts';
import { stripUnusedLightbox } from './lightbox.ts';
import { emitNetlifyHeaders, emitNetlifyRedirects } from './netlify.ts';
import { emitNojekyll } from './nojekyll.ts';
import { commitStagingDir, prepareStagingDir, resolveOutputDir } from './output-dir.ts';
import { rewriteRecommendationsButton } from './portal-shim.ts';
import { type Profiler, createProfiler, writeProfile } from './profile.ts';
import { rasterizeOgImages } from './rasterize-og-images.ts';
import { emitRecommendationsPage } from './recommendations-page.ts';
import { loadRedirects } from './redirects.ts';
import { emitRobots } from './robots.ts';
import { loadRoutesYaml, warnUnappliedSections } from './routes-yaml.ts';
import { planRoutes } from './routes.ts';
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
  // Stage the entire build into a sibling temp dir and swap it into place at
  // the end. Two reasons: (1) `nectar dev` will produce overlapping rebuilds
  // and a partially-cleared `dist/` lets readers (a browser, a deploy script)
  // see "index.html missing for 200ms"; staging confines the half-written
  // state to a path no one is watching. (2) On build failure the previous
  // good `dist/` is left untouched instead of being half-deleted.
  const outputDir = await prepareStagingDir(finalOutputDir);

  try {
    return await runBuild({ cwd, config, outputDir, finalOutputDir, profiler });
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
}: {
  cwd: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  outputDir: string;
  finalOutputDir: string;
  profiler: Profiler | null;
}): Promise<BuildSummary> {
  const [content, theme] = await timed(profiler, 'load_content_and_theme', () =>
    Promise.all([loadContent({ cwd, config }), loadTheme({ cwd, config })]),
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
  const engine = createEngine({ config, content, theme, favicons });
  const routesYaml = await timed(profiler, 'routes_yaml', () => loadRoutesYaml(cwd));
  warnUnappliedSections(routesYaml);
  const routes = planRoutes({ config, content, theme, routesYaml });

  const subscribeConfig = config.components.subscribe;
  const recommendationsEnabled = config.recommendations.length > 0;
  const htmlOutputs: HtmlOutput[] = [];
  let renderedBytes = 0;
  for (const route of routes) {
    const stop = profiler?.start('render', route.url);
    try {
      const html = rewriteRecommendationsButton({
        html: stripUnusedLightbox(
          transformSubscribeForms(injectSkipLink(engine.render(route)), subscribeConfig),
        ),
        basePath: config.build.base_path,
        enabled: recommendationsEnabled,
      });
      const bytes = Buffer.byteLength(html, 'utf8');
      renderedBytes += bytes;
      stop?.({ bytes_emitted: bytes });
      htmlOutputs.push({ outputPath: route.outputPath, html });
    } catch (err) {
      stop?.();
      throw wrapRenderError(err, route.url, route.template);
    }
  }
  await timed(
    profiler,
    'write_html',
    () => writeHtmlBatch(outputDir, htmlOutputs),
    () => renderedBytes,
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
  }

  if (config.components.sitemap.enabled) {
    await timed(profiler, 'sitemap', () =>
      emitSitemap({
        config,
        content,
        outputDir,
        urls: routes
          .filter((r) => r.kind !== 'error')
          .map((r) => ({ url: r.url, lastmod: r.lastmod })),
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
    await timed(profiler, 'robots', () => emitRobots({ config, outputDir }));
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

  if (profiler) {
    await writeProfile(outputDir, profiler);
  }

  await commitStagingDir(outputDir, finalOutputDir);

  return {
    outputDir: finalOutputDir,
    routeCount: routes.length,
    assetCount,
    warningCount: getWarningCount(),
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
