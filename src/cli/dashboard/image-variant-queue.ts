import { resolve } from 'node:path';
import {
  generateImageFormatVariants,
  generateImageVariants,
  generateThemeImageSizeVariants,
  isSharpAvailable,
  planImageVariants,
  resolveCacheDir,
} from '~/build/images.ts';
import { loadConfig } from '~/config/loader.ts';
import { loadTheme } from '~/theme/loader.ts';
import type { ThemeImageSize } from '~/theme/types.ts';
import { logger } from '~/util/logger.ts';

interface DashboardImageVariantOptions {
  cwd: string;
  configPath?: string | undefined;
  reason: string;
}

const activeQueues = new Map<string, Promise<void>>();
const requestedRuns = new Map<string, number>();

export function dashboardPreviewImageOutputDir(cwd: string): string {
  return resolve(cwd, '.nectar/cache/dashboard-preview-images');
}

export function enqueueDashboardImageVariantGeneration(opts: DashboardImageVariantOptions): void {
  const key = `${opts.cwd}\0${opts.configPath ?? ''}`;
  requestedRuns.set(key, (requestedRuns.get(key) ?? 0) + 1);
  if (activeQueues.has(key)) return;
  const next = drainDashboardImageVariantQueue(key, opts)
    .catch((err) => {
      logger.warn(
        `Dashboard image variant generation failed after ${opts.reason}: ${err instanceof Error ? err.message : String(err)}`,
      );
    })
    .finally(() => {
      activeQueues.delete(key);
    });
  activeQueues.set(key, next);
}

async function drainDashboardImageVariantQueue(
  key: string,
  opts: DashboardImageVariantOptions,
): Promise<void> {
  let processed = 0;
  while (processed < (requestedRuns.get(key) ?? 0)) {
    processed = requestedRuns.get(key) ?? processed;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await generateDashboardImageVariantsNow(opts);
  }
  requestedRuns.delete(key);
}

export async function generateDashboardImageVariantsNow(
  opts: DashboardImageVariantOptions,
): Promise<number> {
  const config = await loadConfig({ cwd: opts.cwd, configPath: opts.configPath });
  if (!config.build.copy_content_assets) return 0;
  const imagesCfg = config.components.images;
  if (!imagesCfg.resize) return 0;
  if (!(await isSharpAvailable())) return 0;

  const imageVariantPlan = await planImageVariants({ cwd: opts.cwd, config });
  let themeImageSizes: Record<string, ThemeImageSize> = {};
  try {
    const theme = await loadTheme({ cwd: opts.cwd, config });
    themeImageSizes = theme.pkg.image_sizes;
  } catch (err) {
    logger.debug(
      `Dashboard theme image variants skipped after ${opts.reason}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let generated = 0;
  generated += await generateImageVariants({
    cwd: opts.cwd,
    config,
    outputDir: dashboardPreviewImageOutputDir(opts.cwd),
    plan: imageVariantPlan,
    stripMetadata: imagesCfg.strip_metadata,
  });
  if (imagesCfg.enabled && imagesCfg.formats.length > 0) {
    generated += await generateImageFormatVariants({
      cwd: opts.cwd,
      config,
      outputDir: dashboardPreviewImageOutputDir(opts.cwd),
      plan: imageVariantPlan,
    });
  }
  generated += await generateThemeImageSizeVariants({
    cwd: opts.cwd,
    config,
    outputDir: dashboardPreviewImageOutputDir(opts.cwd),
    themeImageSizes,
    cacheDir: resolveCacheDir(opts.cwd, imagesCfg.cache_dir),
    formats: imagesCfg.enabled ? imagesCfg.formats : [],
    webpQuality: imagesCfg.webp_quality,
    avifQuality: imagesCfg.avif_quality,
    stripMetadata: imagesCfg.strip_metadata,
  });
  if (generated > 0) {
    logger.debug(`Generated ${generated} dashboard image variants after ${opts.reason}`);
  }
  return generated;
}
