import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { createEngine } from '~/render/engine.ts';
import { loadTheme } from '~/theme/loader.ts';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';
import { injectSkipLink } from './a11y.ts';
import { emitContentApiShadows } from './api.ts';
import { copyAssets, copyContentAssets, writeHtml } from './emit.ts';
import { emitRss, emitSitemap } from './feeds.ts';
import { emitRobots } from './robots.ts';
import { planRoutes } from './routes.ts';

export interface BuildOptions {
  cwd: string;
  configPath?: string | undefined;
}

export interface BuildSummary {
  outputDir: string;
  routeCount: number;
  assetCount: number;
  warningCount: number;
}

export async function build({ cwd, configPath }: BuildOptions): Promise<BuildSummary> {
  resetWarningCount();
  const config = await loadConfig({ cwd, configPath });
  const outputDir = join(cwd, config.build.output_dir);
  await rm(outputDir, { recursive: true, force: true });

  const [content, theme] = await Promise.all([
    loadContent({ cwd, config }),
    loadTheme({ cwd, config }),
  ]);

  const engine = createEngine({ config, content, theme });
  const routes = planRoutes({ config, content, theme });

  for (const route of routes) {
    try {
      const html = injectSkipLink(engine.render(route));
      await writeHtml(outputDir, route.outputPath, html);
    } catch (err) {
      logger.error(`Failed to render ${route.url} (${route.template}):`);
      throw err;
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
