import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// SVG og:image previews are rejected or shown as broken on Facebook, LinkedIn,
// Slack, and X. When a post/page's feature_image is an SVG and no explicit
// og_image override is set, we rasterise the SVG to a PNG sibling and point
// og:image at the PNG so social previews actually render.
//
// The rasteriser uses @resvg/resvg-js, which is declared as an optional
// dependency so install does not fail on platforms without a prebuilt binary.
// If the module is unavailable we warn once and emit the SVG as-is (the
// existing broken behaviour); we never abort the build over a missing
// optional dep.

interface ResvgConstructor {
  new (
    svg: Buffer | string,
    opts: { fitTo: { mode: 'width'; value: number }; font?: { loadSystemFonts: boolean } },
  ): {
    render(): { asPng(): Buffer; width: number; height: number };
  };
}

let cachedResvg: ResvgConstructor | null | undefined;

async function loadResvg(): Promise<ResvgConstructor | null> {
  if (cachedResvg !== undefined) return cachedResvg;
  try {
    const mod = (await import('@resvg/resvg-js')) as { Resvg: ResvgConstructor };
    cachedResvg = mod.Resvg;
  } catch (err) {
    logger.warn(
      `OG image rasterisation skipped: @resvg/resvg-js is not installed (${err instanceof Error ? err.message : String(err)})`,
    );
    cachedResvg = null;
  }
  return cachedResvg;
}

interface RasterizeOgImagesOptions {
  cwd: string;
  config: LaurelConfig;
  content: ContentGraph;
  outputDir: string;
}

export async function rasterizeOgImages({
  cwd,
  config,
  content,
  outputDir,
}: RasterizeOgImagesOptions): Promise<number> {
  if (!config.components.opengraph.enabled) return 0;
  if (!config.components.opengraph.rasterize_svg) return 0;

  const targets = collectTargets(content);
  if (targets.length === 0) return 0;

  const Resvg = await loadResvg();
  if (!Resvg) return 0;

  const assetsRoot = resolve(cwd, config.content.assets_dir);
  const cache = new Map<string, string | null>();
  let count = 0;

  for (const target of targets) {
    const sourcePath = resolveAssetPath(target.sourceImage, assetsRoot);
    if (!sourcePath) continue;

    let pngUrl = cache.get(sourcePath);
    if (pngUrl === undefined) {
      pngUrl = await renderSvgToPng({
        sourcePath,
        sourceImage: target.sourceImage,
        assetsRoot,
        outputDir,
        Resvg,
        width: config.components.opengraph.rasterize_width,
      });
      cache.set(sourcePath, pngUrl);
      if (pngUrl) count += 1;
    }

    if (pngUrl) target.apply(pngUrl);
  }

  return count;
}

interface RasterizeTarget {
  sourceImage: string;
  apply(pngUrl: string): void;
}

function collectTargets(content: ContentGraph): RasterizeTarget[] {
  const out: RasterizeTarget[] = [];
  for (const post of content.posts) {
    if (shouldRasterizePostOrPage(post)) {
      out.push({
        sourceImage: post.feature_image,
        apply: (pngUrl) => {
          post.og_image = pngUrl;
        },
      });
    }
  }
  for (const page of content.pages) {
    if (shouldRasterizePostOrPage(page)) {
      out.push({
        sourceImage: page.feature_image,
        apply: (pngUrl) => {
          page.og_image = pngUrl;
        },
      });
    }
  }

  const siteOgImage = content.site.og_image;
  const siteTwitterImage = content.site.twitter_image;
  if (siteOgImage && isSvgUrl(siteOgImage)) {
    out.push({
      sourceImage: siteOgImage,
      apply: (pngUrl) => {
        content.site.og_image = pngUrl;
        if (siteTwitterImage === siteOgImage) content.site.twitter_image = pngUrl;
      },
    });
  } else if (siteTwitterImage && isSvgUrl(siteTwitterImage)) {
    out.push({
      sourceImage: siteTwitterImage,
      apply: (pngUrl) => {
        content.site.twitter_image = pngUrl;
      },
    });
  }
  return out;
}

function shouldRasterizePostOrPage(
  item: Post | Page,
): item is (Post | Page) & { feature_image: string } {
  if (item.og_image) return false;
  const feature = item.feature_image;
  if (!feature) return false;
  return isSvgUrl(feature);
}

function isSvgUrl(url: string): boolean {
  const pathPart = url.split('?')[0]?.split('#')[0] ?? '';
  return pathPart.toLowerCase().endsWith('.svg');
}

// Only rasterise SVGs that live under the configured assets root. Remote
// URLs and absolute filesystem paths are out of scope: the SSG cannot
// reliably fetch arbitrary URLs at build time, and absolute paths would
// let an author escape the assets sandbox.
function resolveAssetPath(featureImage: string, assetsRoot: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(featureImage)) return undefined;
  const marker = '/content/images/';
  const idx = featureImage.indexOf(marker);
  if (idx < 0) return undefined;
  const rest = featureImage.slice(idx + marker.length).split(/[?#]/)[0] ?? '';
  if (rest === '' || rest.includes('..')) return undefined;
  const filePath = join(assetsRoot, rest);
  const rel = relative(assetsRoot, filePath);
  if (rel.startsWith('..') || rel.includes(`..${'/'}`)) return undefined;
  return filePath;
}

interface RenderArgs {
  sourcePath: string;
  sourceImage: string;
  assetsRoot: string;
  outputDir: string;
  Resvg: ResvgConstructor;
  width: number;
}

async function renderSvgToPng({
  sourcePath,
  sourceImage,
  assetsRoot,
  outputDir,
  Resvg,
  width,
}: RenderArgs): Promise<string | null> {
  let svg: Buffer;
  try {
    svg = readFileSync(sourcePath);
  } catch (err) {
    logger.warn(
      `OG image rasterisation skipped for ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  let png: Buffer;
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { loadSystemFonts: false },
    });
    png = resvg.render().asPng();
  } catch (err) {
    logger.warn(
      `OG image rasterisation failed for ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  const rel = relative(assetsRoot, sourcePath);
  const relWithoutExt = rel.slice(0, rel.length - extname(rel).length);
  const outputRel = join('content/images', `${relWithoutExt}.og.png`);
  const outputPath = join(outputDir, outputRel);
  await ensureDir(dirname(outputPath));
  await writeFile(outputPath, png);

  const featureBase = sourceImage.split(/[?#]/)[0] ?? sourceImage;
  const baseWithoutExt = featureBase.slice(0, featureBase.length - extname(featureBase).length);
  return `${baseWithoutExt}.og.png`;
}
