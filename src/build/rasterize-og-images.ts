import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
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

export interface RasterizeOgImagesOptions {
  cwd: string;
  config: NectarConfig;
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
    const featureImage = target.feature_image;
    if (!featureImage) continue;
    const sourcePath = resolveAssetPath(featureImage, assetsRoot);
    if (!sourcePath) continue;

    let pngUrl = cache.get(sourcePath);
    if (pngUrl === undefined) {
      pngUrl = await renderSvgToPng({
        sourcePath,
        featureImage,
        assetsRoot,
        outputDir,
        Resvg,
        width: config.components.opengraph.rasterize_width,
      });
      cache.set(sourcePath, pngUrl);
      if (pngUrl) count += 1;
    }

    if (pngUrl) target.og_image = pngUrl;
  }

  return count;
}

function collectTargets(content: ContentGraph): (Post | Page)[] {
  const out: (Post | Page)[] = [];
  for (const post of content.posts) {
    if (shouldRasterize(post)) out.push(post);
  }
  for (const page of content.pages) {
    if (shouldRasterize(page)) out.push(page);
  }
  return out;
}

function shouldRasterize(item: Post | Page): boolean {
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
  featureImage: string;
  assetsRoot: string;
  outputDir: string;
  Resvg: ResvgConstructor;
  width: number;
}

async function renderSvgToPng({
  sourcePath,
  featureImage,
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

  const featureBase = featureImage.split(/[?#]/)[0] ?? featureImage;
  const baseWithoutExt = featureBase.slice(0, featureBase.length - extname(featureBase).length);
  return `${baseWithoutExt}.og.png`;
}
