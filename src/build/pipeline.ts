import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { createEngine } from '~/render/engine.ts';
import { loadTheme } from '~/theme/loader.ts';
import { NectarError, isNectarError } from '~/util/errors.ts';
import { getWarningCount, resetWarningCount } from '~/util/logger.ts';
import { injectSkipLink } from './a11y.ts';
import { emitContentApiShadows } from './api.ts';
import { normalizeBasePath } from './base-path.ts';
import { copyAssets, copyContentAssets, writeHtml } from './emit.ts';
import { emitRss, emitSitemap } from './feeds.ts';
import { injectImageDimensionsIntoContent } from './images.ts';
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

  injectImageDimensionsIntoContent({ content, cwd, config });

  await rasterizeOgImages({ cwd, config, content, outputDir });

  const engine = createEngine({ config, content, theme });
  const routes = planRoutes({ config, content, theme });

  const subscribeConfig = config.components.subscribe;
  for (const route of routes) {
    try {
      const html = transformSubscribeForms(injectSkipLink(engine.render(route)), subscribeConfig);
      await writeHtml(outputDir, route.outputPath, html);
    } catch (err) {
      throw wrapRenderError(err, route.url, route.template);
    }
  }

  const assetCount = await copyAssets(theme, outputDir);
  if (config.build.copy_content_assets) {
    await copyContentAssets(cwd, config.content.assets_dir, outputDir);
  }

  if (config.components.sitemap.enabled) {
    await emitSitemap({
      config,
      content,
      outputDir,
      urls: routes.map((r) => r.url),
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
