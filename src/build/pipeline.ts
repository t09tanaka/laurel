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
import { copyAssets, copyContentAssets, writeHtml } from './emit.ts';
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
import { emitNojekyll } from './nojekyll.ts';
import { clearDirContents, resolveOutputDir } from './output-dir.ts';
import { rasterizeOgImages } from './rasterize-og-images.ts';
import { emitRobots } from './robots.ts';
import { planRoutes } from './routes.ts';
import { transformSubscribeForms } from './subscribe-forms.ts';

export interface BuildOptions {
  cwd: string;
  configPath?: string | undefined;
  outputDir?: string | undefined;
  basePath?: string | undefined;
}

export interface BuildSummary {
  outputDir: string;
  routeCount: number;
  assetCount: number;
  warningCount: number;
}

export async function build({
  cwd,
  configPath,
  outputDir: outputDirOverride,
  basePath: basePathOverride,
}: BuildOptions): Promise<BuildSummary> {
  resetWarningCount();
  const config = await loadConfig({ cwd, configPath });
  const outputDir = resolveOutputDir(cwd, outputDirOverride ?? config.build.output_dir);
  config.build.base_path = normalizeBasePath(basePathOverride ?? config.build.base_path);
  await clearDirContents(outputDir);

  const [content, theme] = await Promise.all([
    loadContent({ cwd, config }),
    loadTheme({ cwd, config }),
  ]);

  validateThemeCustom({ config, pkg: theme.pkg });

  injectImageDimensionsIntoContent({ content, cwd, config });

  const imageVariantPlan = await planImageVariants({ cwd, config });
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

  await rasterizeOgImages({ cwd, config, content, outputDir });
  await generateOgImages({ cwd, config, content, outputDir });

  const favicons = computeFavicons({ config, theme, cwd });
  const engine = createEngine({ config, content, theme, favicons });
  const routes = planRoutes({ config, content, theme });

  const subscribeConfig = config.components.subscribe;
  for (const route of routes) {
    try {
      const html = stripUnusedLightbox(
        transformSubscribeForms(injectSkipLink(engine.render(route)), subscribeConfig),
      );
      await writeHtml(outputDir, route.outputPath, html);
    } catch (err) {
      throw wrapRenderError(err, route.url, route.template);
    }
  }

  if (!routes.some((r) => r.kind === 'error' && r.outputPath === '404.html')) {
    await emitDefault404({ config, content, outputDir, favicons });
  }

  const assetCount = await copyAssets(theme, outputDir);
  await copyFavicons(favicons, outputDir);
  if (config.build.copy_content_assets) {
    await copyContentAssets(cwd, config.content.assets_dir, outputDir, {
      maxImageBytes: config.build.max_image_bytes,
    });
    await generateImageVariants({ cwd, config, outputDir, plan: imageVariantPlan });
    if (formatVariants.length > 0) {
      await generateImageFormatVariants({ cwd, config, outputDir, plan: imageVariantPlan });
    }
  }

  if (config.components.sitemap.enabled) {
    await emitSitemap({
      config,
      content,
      outputDir,
      urls: routes
        .filter((r) => r.kind !== 'error')
        .map((r) => ({ url: r.url, lastmod: r.lastmod })),
    });
  }
  if (config.components.rss.enabled) {
    await emitRss({
      config,
      content,
      outputDir,
      limit: config.components.rss.items,
    });
  }
  if (config.components.content_api.enabled) {
    await emitContentApiShadows({ config, content, outputDir });
  }
  if (config.components.robots.enabled) {
    await emitRobots({ config, outputDir });
  }
  await emitNojekyll({ outputDir });
  await emitCname({
    outputDir,
    customDomain: config.deploy.github_pages.custom_domain,
  });
  await emitCloudflarePagesHeaders({
    outputDir,
    enabled: config.deploy.cloudflare_pages.enabled,
  });
  await emitCustomRedirects({
    outputDir,
    cwd,
    enabled: config.deploy.cloudflare_pages.enabled,
  });

  return {
    outputDir,
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
