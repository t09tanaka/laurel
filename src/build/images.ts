import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { GALLERY_IMAGE_SIZES } from '~/content/gallery-images.ts';
import type { ContentGraph } from '~/content/model.ts';
import type { ThemeImageSize } from '~/theme/types.ts';
import { scanGlob } from '~/util/fs.ts';
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
  const assetsRoot = resolve(cwd, config.content.assets_dir);
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
export { GALLERY_IMAGE_SIZES };

// Only formats that sharp can resize. SVG is intrinsically scalable so a
// variant pass would be busy-work; GIF can be animated and sharp drops frames
// by default, so we skip it rather than silently flatten.
const RASTER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

interface SharpInstance {
  resize(width: number): SharpInstance;
  resize(opts: { width?: number; height?: number; withoutEnlargement?: boolean }): SharpInstance;
  toFile(path: string): Promise<{ width: number; height: number }>;
  webp(opts: { quality: number }): SharpInstance;
  avif(opts: { quality: number }): SharpInstance;
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

// Probe sharp without surfacing a second warning. Used by the pipeline to
// decide whether the `<picture>` rewrite is safe — if sharp will not run, the
// per-format variants never land on disk and rewriting `<img>` would point
// browsers at 404 sources instead of the original jpg/png.
export async function isSharpAvailable(): Promise<boolean> {
  return (await loadSharp()) !== null;
}

// Format variants only make sense when the source can plausibly shrink under
// modern encoders. jpg/png is the documented target (#481): webp sources would
// produce `foo.webp.webp` and avif sources do not benefit further.
const FORMAT_SOURCE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

function isFormatVariantSource(rel: string): boolean {
  return FORMAT_SOURCE_EXTS.has(extname(rel).toLowerCase());
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
  const assetsRoot = resolve(opts.cwd, opts.config.content.assets_dir);
  const plan: ImageVariantPlan = new Map();
  if (!existsSync(assetsRoot)) return plan;

  const rels = await scanGlob('**/*', { cwd: assetsRoot, onlyFiles: true });
  for (const rel of rels) {
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

  const assetsRoot = resolve(opts.cwd, opts.config.content.assets_dir);
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
  const withGallerySizes = html.replace(
    /(<div\b[^>]*class=(["'])[^"']*\bkg-gallery-image\b[^"']*\2[^>]*>\s*)<img\b([^>]*?)(\/?)>/gi,
    (match, prefix: string, _quote: string, attrsRaw: string, selfClose: string) =>
      `${prefix}${injectImageSrcsetTag(match.slice(prefix.length), attrsRaw, selfClose, {
        marker,
        plan: opts.plan,
        sizesAttr: GALLERY_IMAGE_SIZES,
        addSizesWhenSrcsetExists: true,
      })}`,
  );
  return withGallerySizes.replace(
    /<img\b([^>]*?)(\/?)>/gi,
    (match, attrsRaw: string, selfClose: string) =>
      injectImageSrcsetTag(match, attrsRaw, selfClose, {
        marker,
        plan: opts.plan,
        sizesAttr,
        addSizesWhenSrcsetExists: false,
      }),
  );
}

function injectImageSrcsetTag(
  match: string,
  attrsRaw: string,
  selfClose: string,
  opts: {
    plan: ImageVariantPlan;
    marker: string;
    sizesAttr: string;
    addSizesWhenSrcsetExists: boolean;
  },
): string {
  const attrs = parseImgAttrs(attrsRaw);
  if (attrs.has('srcset')) {
    if (!opts.addSizesWhenSrcsetExists || attrs.has('sizes')) return match;
    return appendImgAttrs(attrsRaw, `sizes="${opts.sizesAttr}"`, selfClose);
  }
  const src = attrs.get('src');
  if (typeof src !== 'string' || src === '') return match;
  const cleaned = src.split(/[?#]/)[0] ?? '';
  const idx = cleaned.indexOf(opts.marker);
  if (idx < 0) return match;
  const after = cleaned.slice(idx + opts.marker.length);
  if (after === '' || after.startsWith('size/') || after.includes('..')) return match;
  const widths = opts.plan.get(after);
  if (!widths || widths.length === 0) return match;
  const before = cleaned.slice(0, idx + opts.marker.length);
  const entries = widths.map((w) => `${before}size/w${w}/${after} ${w}w`).join(', ');
  const sizesPart = attrs.has('sizes') ? '' : ` sizes="${opts.sizesAttr}"`;
  return appendImgAttrs(attrsRaw, `srcset="${entries}"${sizesPart}`, selfClose);
}

function appendImgAttrs(attrsRaw: string, attrs: string, selfClose: string): string {
  const spacer = attrsRaw.length === 0 || /\s$/.test(attrsRaw) ? '' : ' ';
  return `<img${attrsRaw}${spacer}${attrs}${selfClose}>`;
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

// Ghost themes hard-code per-size srcset entries in their HBS templates (e.g.
// Source's `feature-image.hbs` lists s/m/l/xl/xxl in one srcset). When the
// source is an SVG (or any other image where `{{img_url ... size="x"}}` falls
// back to the original URL because no raster variant exists), every srcset
// entry resolves to the same URL — pointless bytes the browser must parse and
// then dedupe. This walks the rendered HTML, finds `<img srcset="…">` whose
// entries all share one URL after stripping descriptors, and removes the
// redundant `srcset` (plus the matching `sizes`). The single `src` attribute
// already in the tag is left untouched, which is exactly what we want for SVG.
// (issue #534)
export function collapseDegenerateSrcset(html: string): string {
  if (!html.includes('srcset')) return html;
  return html.replace(/<img\b([^>]*?)(\/?)>/gi, (match, attrsRaw: string, selfClose: string) => {
    const attrs = parseImgAttrs(attrsRaw);
    const srcset = attrs.get('srcset');
    if (typeof srcset !== 'string' || srcset === '') return match;
    const urls = parseSrcsetUrls(srcset);
    if (urls.length < 2) return match;
    const first = urls[0];
    for (const u of urls) {
      if (u !== first) return match;
    }
    // Strip srcset and the paired sizes attribute. sizes without srcset is
    // meaningless and would just confuse downstream linters; the original
    // `src` attribute (still in attrsRaw, which we have not touched) carries
    // the URL the browser needs.
    let next = stripAttr(attrsRaw, 'srcset');
    next = stripAttr(next, 'sizes');
    return `<img${next}${selfClose}>`;
  });
}

export interface CollapseDegenerateSrcsetIntoContentOptions {
  content: ContentGraph;
}

// Same dedupe pass applied to post/page HTML at content-graph time (so the
// rewrite is visible in feeds and lightbox payloads). The rendered-HTML pass in
// the build pipeline also calls collapseDegenerateSrcset, which catches srcset
// strings produced by theme HBS templates that never go through content.html.
export function collapseDegenerateSrcsetIntoContent(
  opts: CollapseDegenerateSrcsetIntoContentOptions,
): void {
  for (const post of opts.content.posts) {
    post.html = collapseDegenerateSrcset(post.html);
    if (post.feed_html && post.feed_html !== post.html) {
      post.feed_html = collapseDegenerateSrcset(post.feed_html);
    }
  }
  for (const page of opts.content.pages) {
    page.html = collapseDegenerateSrcset(page.html);
  }
}

// Split a srcset value into the raw URL portion of each entry, dropping the
// width/density descriptor. A descriptor-less entry (`foo.svg`) is treated as
// the URL itself. Whitespace between entries (including the newlines themes
// like to use for readability) is collapsed.
function parseSrcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const space = part.search(/\s/);
      return space < 0 ? part : part.slice(0, space);
    });
}

// Remove a single attribute (and its value) from a raw attribute string while
// preserving the surrounding whitespace shape, so the resulting tag still
// renders cleanly and self-closing forms keep their trailing space.
function stripAttr(attrsRaw: string, name: string): string {
  const re = new RegExp(`\\s*${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+)`, 'gi');
  return attrsRaw.replace(re, '');
}

export type ImageFormat = 'webp' | 'avif';

export interface GenerateImageFormatVariantsOptions {
  cwd: string;
  config: NectarConfig;
  outputDir: string;
  plan: ImageVariantPlan;
}

// Content-hash a source file so unchanged sources collide on the same cache
// filename. mtime is consulted only as the cheap miss-path: if the cached entry
// reports a matching mtimeMs we trust the recorded sha256 and skip re-hashing.
interface SourceCacheEntry {
  mtimeMs: number;
  sha256: string;
}
const sourceHashCache = new Map<string, SourceCacheEntry>();

function hashSourceFile(filePath: string): string {
  const stat = statSync(filePath);
  const cached = sourceHashCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  sourceHashCache.set(filePath, { mtimeMs: stat.mtimeMs, sha256 });
  return sha256;
}

export function resolveCacheDir(cwd: string, cacheDir: string): string {
  return isAbsolute(cacheDir) ? cacheDir : join(cwd, cacheDir);
}

// Emit `<original>.<format>` variants for every (width, format) pair the
// plan plus images config requests. Cache by source content hash so a rebuild
// that doesn't touch the file skips the (slow, especially for AVIF) sharp
// encode entirely and just copies the cached bytes into the output tree.
export async function generateImageFormatVariants(
  opts: GenerateImageFormatVariantsOptions,
): Promise<number> {
  const imagesCfg = opts.config.components.images;
  if (!imagesCfg.enabled) return 0;
  if (imagesCfg.formats.length === 0) return 0;
  if (opts.plan.size === 0) return 0;

  const sharpFn = await loadSharp();
  if (!sharpFn) return 0;

  const assetsRoot = resolve(opts.cwd, opts.config.content.assets_dir);
  const outRoot = join(opts.outputDir, 'content/images');
  const cacheDir = resolveCacheDir(opts.cwd, imagesCfg.cache_dir);
  mkdirSync(cacheDir, { recursive: true });

  let count = 0;
  for (const [rel, widths] of opts.plan) {
    if (!isFormatVariantSource(rel)) continue;
    const sourcePath = join(assetsRoot, rel);
    if (!existsSync(sourcePath)) continue;
    let sha: string;
    try {
      sha = hashSourceFile(sourcePath);
    } catch (err) {
      logger.warn(
        `Failed to hash ${rel} for format variants: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    for (const w of widths) {
      for (const format of imagesCfg.formats) {
        const cacheFile = join(cacheDir, `${sha}-w${w}.${format}`);
        const outPath = join(outRoot, 'size', `w${w}`, `${rel}.${format}`);
        mkdirSync(dirname(outPath), { recursive: true });
        if (!existsSync(cacheFile)) {
          try {
            const resized = sharpFn(sourcePath).resize(w);
            const withFormat =
              format === 'webp'
                ? resized.webp({ quality: imagesCfg.webp_quality })
                : resized.avif({ quality: imagesCfg.avif_quality });
            await withFormat.toFile(cacheFile);
          } catch (err) {
            logger.warn(
              `Failed to encode ${format} variant w${w} for ${rel}: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
        }
        try {
          copyFileSync(cacheFile, outPath);
          count += 1;
        } catch (err) {
          logger.warn(
            `Failed to copy ${format} variant w${w} for ${rel}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
  return count;
}

export interface InjectImagePictureSourcesOptions {
  plan: ImageVariantPlan;
  formats: readonly ImageFormat[];
  marker?: string;
  sizesAttr?: string;
}

// Wrap each `<img>` whose path is in the plan in a `<picture>` that lists
// per-format `<source>` entries before the original `<img>` fallback. AVIF
// comes first if requested so browsers that understand it use it; WebP next;
// the original same-format `<img srcset>` (set by injectImageSrcset) is the
// final fallback. Images already inside a `<picture>` or already pointing at a
// variant URL are left alone.
export function injectImagePictureSources(
  html: string,
  opts: InjectImagePictureSourcesOptions,
): string {
  if (!html.includes('<img')) return html;
  if (opts.plan.size === 0 || opts.formats.length === 0) return html;
  const marker = opts.marker ?? '/content/images/';
  const sizesAttr = opts.sizesAttr ?? DEFAULT_IMAGE_SIZES;

  const re = /<img\b([^>]*?)(\/?)>/gi;
  let result = '';
  let lastIdx = 0;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    const matchStart = m.index;
    const matchEnd = re.lastIndex;
    const attrsRaw = m[1];
    const lastOpen = html.lastIndexOf('<picture', matchStart);
    const lastClose = html.lastIndexOf('</picture>', matchStart);
    const insidePicture = lastOpen >= 0 && lastOpen > lastClose;
    let replacement = m[0];
    if (!insidePicture) {
      const attrs = parseImgAttrs(attrsRaw);
      const src = attrs.get('src');
      if (typeof src === 'string' && src !== '') {
        const cleaned = src.split(/[?#]/)[0] ?? '';
        const idx = cleaned.indexOf(marker);
        if (idx >= 0) {
          const after = cleaned.slice(idx + marker.length);
          if (
            after !== '' &&
            !after.startsWith('size/') &&
            !after.includes('..') &&
            isFormatVariantSource(after)
          ) {
            const widths = opts.plan.get(after);
            if (widths && widths.length > 0) {
              const before = cleaned.slice(0, idx + marker.length);
              const sizesValue =
                typeof attrs.get('sizes') === 'string' ? (attrs.get('sizes') as string) : sizesAttr;
              const sources = opts.formats
                .map((format) => {
                  const entries = widths
                    .map((w) => `${before}size/w${w}/${after}.${format} ${w}w`)
                    .join(', ');
                  return `<source type="image/${format}" srcset="${entries}" sizes="${sizesValue}">`;
                })
                .join('');
              replacement = `<picture>${sources}${m[0]}</picture>`;
            }
          }
        }
      }
    }
    result += html.slice(lastIdx, matchStart) + replacement;
    lastIdx = matchEnd;
    m = re.exec(html);
  }
  result += html.slice(lastIdx);
  return result;
}

export interface InjectImagePictureSourcesIntoContentOptions {
  content: ContentGraph;
  plan: ImageVariantPlan;
  formats: readonly ImageFormat[];
  sizesAttr?: string;
}

export function injectImagePictureSourcesIntoContent(
  opts: InjectImagePictureSourcesIntoContentOptions,
): void {
  if (opts.plan.size === 0 || opts.formats.length === 0) return;
  const inject = (html: string): string =>
    injectImagePictureSources(html, {
      plan: opts.plan,
      formats: opts.formats,
      sizesAttr: opts.sizesAttr,
    });
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

// Build the URL segment for a theme `image_sizes` entry the same way the
// `{{img_url}}` helper does (`w400`, `h800`, `w400h400`). Exported so build
// and render layers cannot drift apart: the on-disk path must equal the
// segment baked into rendered URLs.
export function buildThemeImageSizeSegment(size: ThemeImageSize): string {
  let s = '';
  if (typeof size.width === 'number' && size.width > 0) s += `w${size.width}`;
  if (typeof size.height === 'number' && size.height > 0) s += `h${size.height}`;
  return s;
}

export interface GenerateThemeImageSizeVariantsOptions {
  cwd: string;
  config: NectarConfig;
  outputDir: string;
  themeImageSizes: Record<string, ThemeImageSize>;
  // When provided, sharp-encoded variants are cached here keyed by source
  // content hash so unchanged sources skip re-encoding on subsequent builds.
  // Cache filename: `<sha>-<segment>[.<format>].<ext>`.
  cacheDir?: string;
  // When non-empty AND cacheDir is set, additionally emit per-format variants
  // at `/content/images/size/<segment>/format/<ext>/<rel>` for each jpg/png
  // source. Mirrors the URL `{{img_url ... size="x" format="webp"}}` produces.
  formats?: readonly ImageFormat[];
  webpQuality?: number;
  avifQuality?: number;
}

// Theme `image_sizes` (e.g. Source's xs/s/m/l/xl/xxl) are referenced via
// `{{img_url ... size="<key>"}}` and, for the per-format variant URLs Source
// uses in `<img srcset>` for `feature_image`, via
// `{{img_url ... size="<key>" format="webp"}}`. Both URL forms must be
// materialised on disk or the theme's `feature_image` srcsets 404 and browsers
// fall back to the full-resolution original (issues #116/#117).
//
// We emit one resized file per (source, size) pair using sharp and, when
// configured with formats + a cache_dir, additionally emit per-format variants
// at `/content/images/size/<segment>/format/<ext>/<rel>`. Caching is keyed by
// source content hash so subsequent builds copy bytes instead of re-encoding;
// the cache file's mtime survives across builds because it lives outside the
// staging `dist/`.
//
// Upscaling is skipped per-axis: if neither width nor height shrinks below the
// source, the size is dropped — the browser will fall back to the original via
// `<img src>` which is still the same file on disk.
export async function generateThemeImageSizeVariants(
  opts: GenerateThemeImageSizeVariantsOptions,
): Promise<number> {
  const entries = Object.entries(opts.themeImageSizes).filter(([, size]) => {
    const w = typeof size.width === 'number' ? size.width : 0;
    const h = typeof size.height === 'number' ? size.height : 0;
    return w > 0 || h > 0;
  });
  if (entries.length === 0) return 0;

  const assetsRoot = resolve(opts.cwd, opts.config.content.assets_dir);
  if (!existsSync(assetsRoot)) return 0;

  const sharpFn = await loadSharp();
  if (!sharpFn) return 0;

  const outRoot = join(opts.outputDir, 'content/images');
  const cacheDir = opts.cacheDir;
  const formats: readonly ImageFormat[] = opts.formats ?? [];
  const webpQuality = opts.webpQuality ?? 80;
  const avifQuality = opts.avifQuality ?? 50;
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });

  let count = 0;

  const rels = await scanGlob('**/*', { cwd: assetsRoot, onlyFiles: true });
  for (const rel of rels) {
    const ext = extname(rel).toLowerCase();
    if (!RASTER_EXTS.has(ext)) continue;
    const segments = rel.split(sep);
    if (segments[0] === 'size') continue;
    const sourcePath = join(assetsRoot, rel);
    const dims = readImageDimensions(sourcePath);
    if (!dims) continue;
    const normalizedRel = segments.join('/');

    // Hash the source once per build. Used as the cache key for every
    // (size, format) variant of this file; a single hash failure must not
    // stop the rest of the pipeline so we fall through to the uncached path.
    let sha: string | null = null;
    if (cacheDir) {
      try {
        sha = hashSourceFile(sourcePath);
      } catch (err) {
        logger.warn(
          `Failed to hash ${rel} for theme size variants: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    for (const [, size] of entries) {
      const segment = buildThemeImageSizeSegment(size);
      if (!segment) continue;
      if (!sizeShrinksSource(size, dims)) continue;

      // Base same-format variant. Mirrors `{{img_url ... size="<key>"}}`.
      const baseOutPath = join(outRoot, 'size', segment, normalizedRel);
      const baseCacheFile = cacheDir && sha ? join(cacheDir, `${sha}-${segment}${ext}`) : null;
      if (
        await encodeOrReuseThemeVariant({
          sharpFn,
          sourcePath,
          outPath: baseOutPath,
          size,
          cacheFile: baseCacheFile,
          format: null,
          webpQuality,
          avifQuality,
        })
      ) {
        count += 1;
      }

      // Per-format variants. Only jpg/png sources benefit: webp/avif sources
      // would degenerate (e.g. `cover.webp` re-encoded as webp). Caching is
      // required because AVIF encoding is the slowest step in the pipeline and
      // we don't want to re-pay it every build.
      if (cacheDir && sha && formats.length > 0 && isFormatVariantSource(normalizedRel)) {
        for (const format of formats) {
          const formatOutPath = join(outRoot, 'size', segment, 'format', format, normalizedRel);
          const formatCacheFile = join(cacheDir, `${sha}-${segment}.${format}`);
          if (
            await encodeOrReuseThemeVariant({
              sharpFn,
              sourcePath,
              outPath: formatOutPath,
              size,
              cacheFile: formatCacheFile,
              format,
              webpQuality,
              avifQuality,
            })
          ) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}

interface EncodeOrReuseThemeVariantOptions {
  sharpFn: SharpFactory;
  sourcePath: string;
  outPath: string;
  size: ThemeImageSize;
  cacheFile: string | null;
  format: ImageFormat | null;
  webpQuality: number;
  avifQuality: number;
}

async function encodeOrReuseThemeVariant(opts: EncodeOrReuseThemeVariantOptions): Promise<boolean> {
  const { sharpFn, sourcePath, outPath, size, cacheFile, format } = opts;
  // An earlier pass (planImageVariants width match, or copyContentAssets for
  // already-exported variants) may have placed this file. Don't re-encode.
  if (existsSync(outPath)) return true;

  mkdirSync(dirname(outPath), { recursive: true });

  if (cacheFile && existsSync(cacheFile)) {
    try {
      copyFileSync(cacheFile, outPath);
      return true;
    } catch (err) {
      logger.warn(
        `Failed to copy cached theme variant to ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  try {
    let pipeline = sharpFn(sourcePath).resize({
      width: typeof size.width === 'number' ? size.width : undefined,
      height: typeof size.height === 'number' ? size.height : undefined,
      withoutEnlargement: true,
    });
    if (format === 'webp') pipeline = pipeline.webp({ quality: opts.webpQuality });
    else if (format === 'avif') pipeline = pipeline.avif({ quality: opts.avifQuality });

    if (cacheFile) {
      mkdirSync(dirname(cacheFile), { recursive: true });
      await pipeline.toFile(cacheFile);
      copyFileSync(cacheFile, outPath);
    } else {
      await pipeline.toFile(outPath);
    }
    return true;
  } catch (err) {
    logger.warn(
      `Failed to generate theme size variant ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

function sizeShrinksSource(size: ThemeImageSize, dims: ImageDimensions): boolean {
  const wConstraint = typeof size.width === 'number' && size.width > 0;
  const hConstraint = typeof size.height === 'number' && size.height > 0;
  // Emit if at least one defined axis is strictly smaller than the source.
  // Equality is treated as "no shrink" — the browser would just download the
  // identical pixel count, so skipping saves disk and encode time.
  if (wConstraint && (size.width as number) < dims.width) return true;
  if (hConstraint && (size.height as number) < dims.height) return true;
  return false;
}
