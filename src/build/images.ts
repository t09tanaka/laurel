import { existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { type ImageDimensions, readImageDimensions } from '~/util/image-size.ts';
import { logger } from '~/util/logger.ts';

export interface InjectImageDimensionsOptions {
  // Absolute filesystem path that the assets URL marker maps to. Images
  // resolved outside this root (path traversal, foreign hosts) are skipped.
  assetsRoot: string;
  // URL path prefix that identifies an in-repo image. Ghost exports always
  // serialise these as `/content/images/...`, so that is the default even when
  // `config.content.assets_dir` is renamed locally.
  marker?: string;
  // Per-call cache so the same src across multiple posts is probed once.
  // Null entries record "probed and failed" to avoid re-reading the file.
  cache?: Map<string, ImageDimensions | null>;
}

// Lighthouse penalises <img> without intrinsic width/height because the
// browser can't reserve layout space and triggers CLS. Ghost always emits
// both attributes; markdown `![alt](src)` does not. This walks the rendered
// HTML, probes each in-body image once, and injects `width="..." height="..."`
// where the src resolves to a local file under assetsRoot. Existing
// width/height on a tag are treated as authoritative and left alone.
export function injectImageDimensions(html: string, options: InjectImageDimensionsOptions): string {
  if (!html.includes('<img')) return html;
  const cache = options.cache ?? new Map<string, ImageDimensions | null>();
  const marker = options.marker ?? '/content/images/';
  return html.replace(/<img\b([^>]*?)(\/?)>/gi, (match, attrsRaw: string, selfClose: string) => {
    const attrs = parseImgAttrs(attrsRaw);
    if (attrs.has('width') || attrs.has('height')) return match;
    const src = attrs.get('src');
    if (typeof src !== 'string' || src === '') return match;
    const filePath = resolveLocalImagePath(src, marker, options.assetsRoot);
    if (!filePath) return match;
    const dims = probeDimensions(filePath, cache);
    if (!dims) return match;
    const spacer = attrsRaw.length === 0 || /\s$/.test(attrsRaw) ? '' : ' ';
    return `<img${attrsRaw}${spacer}width="${dims.width}" height="${dims.height}"${selfClose}>`;
  });
}

export interface InjectIntoContentOptions {
  content: ContentGraph;
  cwd: string;
  config: NectarConfig;
}

// Mutates `post.html` / `page.html` in-place. Sharing one cache across the
// whole graph keeps the cost linear in unique srcs, not total <img> tags.
export function injectImageDimensionsIntoContent({
  content,
  cwd,
  config,
}: InjectIntoContentOptions): void {
  const assetsRoot = join(cwd, config.content.assets_dir);
  const cache = new Map<string, ImageDimensions | null>();
  for (const post of content.posts) {
    post.html = injectImageDimensions(post.html, { assetsRoot, cache });
    if (post.feed_html && post.feed_html !== post.html) {
      post.feed_html = injectImageDimensions(post.feed_html, { assetsRoot, cache });
    }
  }
  for (const page of content.pages) {
    page.html = injectImageDimensions(page.html, { assetsRoot, cache });
  }
}

function probeDimensions(
  filePath: string,
  cache: Map<string, ImageDimensions | null>,
): ImageDimensions | undefined {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached ?? undefined;
  const dims = readImageDimensions(filePath);
  cache.set(filePath, dims ?? null);
  return dims;
}

function resolveLocalImagePath(
  src: string,
  marker: string,
  assetsRoot: string,
): string | undefined {
  // Reject anything that looks like a remote URL, data URI, or
  // protocol-relative reference before touching the filesystem.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return undefined;
  if (src.startsWith('//')) return undefined;
  const cleaned = src.split(/[?#]/)[0] ?? '';
  const idx = cleaned.indexOf(marker);
  if (idx < 0) return undefined;
  const rest = cleaned.slice(idx + marker.length);
  if (rest === '' || rest.includes('..')) return undefined;
  const filePath = join(assetsRoot, rest);
  const rel = relative(assetsRoot, filePath);
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) return undefined;
  if (!existsSync(filePath)) return undefined;
  return filePath;
}

const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseImgAttrs(s: string): Map<string, string | true> {
  const out = new Map<string, string | true>();
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null = ATTR_RE.exec(s);
  while (m !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    out.set(name, value ?? true);
    m = ATTR_RE.exec(s);
  }
  return out;
}

// Ghost's responsive variant breakpoints. Any width >= source is skipped so we
// never upscale. The browser falls back to the original `src` for viewports
// wider than the largest variant we emit.
export const DEFAULT_RESPONSIVE_WIDTHS: readonly number[] = [600, 1000, 1600, 2400];

// Default `sizes` attribute mirrors the Source theme's `kg-width-regular` rule
// (max 720px content column). Themes can override per-image via existing
// sizes attributes; we only inject when none is present.
export const DEFAULT_IMAGE_SIZES = '(min-width: 720px) 720px';

// Only formats that sharp can resize. SVG is intrinsically scalable so a
// variant pass would be busy-work; GIF can be animated and sharp drops frames
// by default, so we skip it rather than silently flatten.
const RASTER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

interface SharpInstance {
  resize(width: number): SharpInstance;
  toFile(path: string): Promise<{ width: number; height: number }>;
}

type SharpFactory = (input: string) => SharpInstance;

let cachedSharp: SharpFactory | null | undefined;
let warnedMissingSharp = false;

async function loadSharp(): Promise<SharpFactory | null> {
  if (cachedSharp !== undefined) return cachedSharp;
  try {
    const mod = (await import('sharp')) as { default: SharpFactory };
    cachedSharp = mod.default;
  } catch (err) {
    if (!warnedMissingSharp) {
      logger.warn(
        `Responsive image variants skipped: sharp is not installed (${err instanceof Error ? err.message : String(err)})`,
      );
      warnedMissingSharp = true;
    }
    cachedSharp = null;
  }
  return cachedSharp;
}

export interface PlanImageVariantsOptions {
  cwd: string;
  config: NectarConfig;
  widths?: readonly number[];
}

// Variant plan keyed by the path *relative to assets_dir* (forward-slash form,
// e.g. `2024/01/cover.jpg`). Values are the widths the plan promises to emit;
// callers can read it both to build srcset URLs and to drive actual resizing.
export type ImageVariantPlan = Map<string, number[]>;

// Walk the configured assets_dir, read each raster image's dimensions, and
// record which of the requested widths are smaller than the source. We split
// "plan" from "generate" so srcset injection can run before rendering even if
// sharp isn't installed.
export async function planImageVariants(opts: PlanImageVariantsOptions): Promise<ImageVariantPlan> {
  const widths = opts.widths ?? DEFAULT_RESPONSIVE_WIDTHS;
  const assetsRoot = join(opts.cwd, opts.config.content.assets_dir);
  const plan: ImageVariantPlan = new Map();
  if (!existsSync(assetsRoot)) return plan;

  const glob = new Bun.Glob('**/*');
  for await (const rel of glob.scan({ cwd: assetsRoot, onlyFiles: true })) {
    const ext = extname(rel).toLowerCase();
    if (!RASTER_EXTS.has(ext)) continue;
    const segments = rel.split(sep);
    // Skip files that already live under a variant subtree so re-builds don't
    // recursively generate `size/w600/size/w600/...`.
    if (segments[0] === 'size') continue;
    const filePath = join(assetsRoot, rel);
    const dims = readImageDimensions(filePath);
    if (!dims) continue;
    const applicable = widths.filter((w) => w < dims.width);
    if (applicable.length === 0) continue;
    plan.set(segments.join('/'), applicable);
  }
  return plan;
}

export interface GenerateImageVariantsOptions {
  cwd: string;
  config: NectarConfig;
  outputDir: string;
  plan: ImageVariantPlan;
}

// Materialise the planned variants under `<outputDir>/content/images/size/wXXX/`.
// Mirrors Ghost's URL contract (`/content/images/size/w600/foo.jpg`). Quietly
// returns 0 when sharp is unavailable so missing optional deps don't fail the
// build — srcset URLs in HTML will simply 404 in that case, which matches the
// pre-existing behaviour we were already living with.
export async function generateImageVariants(opts: GenerateImageVariantsOptions): Promise<number> {
  if (opts.plan.size === 0) return 0;
  const sharpFn = await loadSharp();
  if (!sharpFn) return 0;

  const assetsRoot = join(opts.cwd, opts.config.content.assets_dir);
  const outRoot = join(opts.outputDir, 'content/images');
  let count = 0;

  for (const [rel, widths] of opts.plan) {
    const sourcePath = join(assetsRoot, rel);
    if (!existsSync(sourcePath)) continue;
    for (const w of widths) {
      const outPath = join(outRoot, 'size', `w${w}`, rel);
      mkdirSync(dirname(outPath), { recursive: true });
      try {
        await sharpFn(sourcePath).resize(w).toFile(outPath);
        count += 1;
      } catch (err) {
        logger.warn(
          `Failed to generate variant w${w} for ${rel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return count;
}

export interface InjectImageSrcsetOptions {
  plan: ImageVariantPlan;
  marker?: string;
  sizesAttr?: string;
}

// Rewrite each `<img src="/content/images/...">` whose path is in the plan to
// carry srcset + sizes attributes pointing at the planned variants. Existing
// `srcset` is treated as authoritative (Ghost exports may have already
// computed one) and left alone. We also skip srcs that already point at a
// variant URL (`/content/images/size/wXXX/...`) so re-running the pass is a
// no-op.
export function injectImageSrcset(html: string, opts: InjectImageSrcsetOptions): string {
  if (!html.includes('<img') || opts.plan.size === 0) return html;
  const marker = opts.marker ?? '/content/images/';
  const sizesAttr = opts.sizesAttr ?? DEFAULT_IMAGE_SIZES;
  return html.replace(/<img\b([^>]*?)(\/?)>/gi, (match, attrsRaw: string, selfClose: string) => {
    const attrs = parseImgAttrs(attrsRaw);
    if (attrs.has('srcset')) return match;
    const src = attrs.get('src');
    if (typeof src !== 'string' || src === '') return match;
    const cleaned = src.split(/[?#]/)[0] ?? '';
    const idx = cleaned.indexOf(marker);
    if (idx < 0) return match;
    const after = cleaned.slice(idx + marker.length);
    if (after === '' || after.startsWith('size/') || after.includes('..')) return match;
    const widths = opts.plan.get(after);
    if (!widths || widths.length === 0) return match;
    const before = cleaned.slice(0, idx + marker.length);
    const entries = widths.map((w) => `${before}size/w${w}/${after} ${w}w`).join(', ');
    const spacer = attrsRaw.length === 0 || /\s$/.test(attrsRaw) ? '' : ' ';
    const sizesPart = attrs.has('sizes') ? '' : ` sizes="${sizesAttr}"`;
    return `<img${attrsRaw}${spacer}srcset="${entries}"${sizesPart}${selfClose}>`;
  });
}

export interface InjectImageSrcsetIntoContentOptions {
  content: ContentGraph;
  plan: ImageVariantPlan;
  sizesAttr?: string;
}

export function injectImageSrcsetIntoContent(opts: InjectImageSrcsetIntoContentOptions): void {
  if (opts.plan.size === 0) return;
  const inject = (html: string): string =>
    injectImageSrcset(html, { plan: opts.plan, sizesAttr: opts.sizesAttr });
  for (const post of opts.content.posts) {
    post.html = inject(post.html);
    if (post.feed_html && post.feed_html !== post.html) {
      post.feed_html = inject(post.feed_html);
    }
  }
  for (const page of opts.content.pages) {
    page.html = inject(page.html);
  }
}
