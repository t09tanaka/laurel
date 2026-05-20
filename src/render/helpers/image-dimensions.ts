import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type Handlebars from 'handlebars';
import { type ImageDimensions, readImageDimensions } from '~/util/image-size.ts';
import type { NectarEngine } from '../engine.ts';

// Ghost's `image_dimensions` walks a fixed list of known image URL fields on
// the current context. Mirrors Ghost-Core's `image_dimensions.js` so themes
// that depend on the helper find the same `<field>_width`/`<field>_height`
// pairs they would on a real Ghost install.
const IMAGE_FIELDS = [
  'feature_image',
  'cover_image',
  'profile_image',
  'logo',
  'icon',
  'og_image',
  'twitter_image',
] as const;

const URL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;
const ASSETS_URL_MARKER = '/content/images/';

export function registerImageDimensionHelpers(engine: NectarEngine): void {
  // Per-engine cache keyed by absolute file path. Null entries record
  // "probed and failed" so a missing or unparseable file isn't re-read for
  // every render that references it.
  const cache = new Map<string, ImageDimensions | null>();

  engine.hb.registerHelper(
    'image_dimensions',
    function imageDimensionsHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = (this ?? {}) as Record<string, unknown>;
      const additions: Record<string, number> = {};
      for (const field of IMAGE_FIELDS) {
        const url = ctx[field];
        if (typeof url !== 'string' || !url) continue;
        const widthKey = `${field}_width`;
        const heightKey = `${field}_height`;
        const hasWidth = typeof ctx[widthKey] === 'number';
        const hasHeight = typeof ctx[heightKey] === 'number';
        if (hasWidth && hasHeight) continue;
        const dims = probeLocalImage(engine, url, cache);
        if (!dims) continue;
        if (!hasWidth) additions[widthKey] = dims.width;
        if (!hasHeight) additions[heightKey] = dims.height;
      }
      const extended = Object.keys(additions).length > 0 ? Object.assign({}, ctx, additions) : ctx;
      return options.fn(extended);
    },
  );
}

function probeLocalImage(
  engine: NectarEngine,
  url: string,
  cache: Map<string, ImageDimensions | null>,
): ImageDimensions | undefined {
  const cwd = engine.cwd;
  if (!cwd) return undefined;
  if (URL_PROTOCOL_RE.test(url)) return undefined;
  if (url.startsWith('//')) return undefined;
  const cleaned = url.split(/[?#]/)[0] ?? '';
  const idx = cleaned.indexOf(ASSETS_URL_MARKER);
  if (idx < 0) return undefined;
  const rest = cleaned.slice(idx + ASSETS_URL_MARKER.length);
  if (rest === '' || rest.includes('..')) return undefined;
  const assetsRoot = resolve(cwd, engine.config.content.assets_dir);
  const filePath = join(assetsRoot, rest);
  const rel = relative(assetsRoot, filePath);
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) return undefined;
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached ?? undefined;
  if (!existsSync(filePath)) {
    cache.set(filePath, null);
    return undefined;
  }
  const dims = readImageDimensions(filePath);
  cache.set(filePath, dims ?? null);
  return dims;
}
