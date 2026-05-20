import type Handlebars from 'handlebars';
import { assetPublicUrl, joinPath } from '~/theme/assets.ts';
import type { ThemeImageSize } from '~/theme/types.ts';
import type { NectarEngine } from '../engine.ts';

export function registerAssetHelpers(engine: NectarEngine): void {
  const basePath = engine.config.build.base_path;

  engine.hb.registerHelper(
    'asset',
    function assetHelper(path: unknown, options?: Handlebars.HelperOptions) {
      const logical = String(path ?? '').replace(/^\//, '');
      const candidates = buildAssetCandidates(logical, options?.hash?.hasMinFile);
      for (const key of candidates) {
        const asset = engine.theme.assets.get(key);
        if (asset) {
          return new engine.hb.SafeString(encodeAssetUrl(assetPublicUrl(asset, basePath)));
        }
      }
      const resolved = `assets/${logical}`;
      return new engine.hb.SafeString(encodeAssetUrl(joinPath(basePath, resolved)));
    },
  );

  engine.hb.registerHelper('img_url', function imgUrlHelper(...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const inputs = args.slice(0, -1);
    const direct = inputs[0];
    const candidate = typeof direct === 'string' ? direct : extractImage(direct);
    if (!candidate) return '';
    const sizeKey = typeof options.hash.size === 'string' ? options.hash.size : undefined;
    const sizeDef = sizeKey ? engine.theme.pkg.image_sizes[sizeKey] : undefined;
    const formatKey =
      typeof options.hash.format === 'string' ? normalizeFormat(options.hash.format) : undefined;
    const absolute = options.hash.absolute === true;
    const siteUrl = engine.content.site.url;
    // applyTransformSegments only rewrites URLs whose path contains
    // `/content/images/`. That guard is sufficient: a Ghost CDN host serving
    // `https://CDN/content/images/foo.jpg` is exactly the case where injecting
    // `/content/images/size/wXXX/` is required (issue #463) — the CDN
    // understands the Ghost image-API URL shape regardless of host. Non-Ghost
    // external URLs (e.g. `https://images.unsplash.com/photo.jpg`,
    // protocol-relative `//foo/bar.jpg`, `data:` URIs) lack `/content/images/`
    // in their path so they fall through unchanged.
    const url = applyTransformSegments(candidate, sizeDef, formatKey);
    const sameOriginAsSite = isSameOriginAsSite(candidate, siteUrl);
    // absolute=true only re-resolves against siteUrl for paths/relative URLs
    // and same-origin absolute URLs. External absolute URLs (different host,
    // or non-http(s) schemes like data:) are returned as-is so we don't
    // rewrite their origin (issue #1132).
    if (absolute && sameOriginAsSite) {
      try {
        return new URL(url, siteUrl).toString();
      } catch {
        return url;
      }
    }
    return url;
  });
}

function buildAssetCandidates(logical: string, hasMinFile: unknown): string[] {
  const candidates: string[] = [];
  const minLogical = hasMinFile ? withMinFileVariant(logical) : undefined;
  if (minLogical) candidates.push(minLogical, `assets/${minLogical}`);
  candidates.push(logical, `assets/${logical}`);
  return candidates;
}

function withMinFileVariant(logical: string): string | undefined {
  const slash = logical.lastIndexOf('/');
  const filenameStart = slash + 1;
  const dot = logical.lastIndexOf('.');
  if (dot <= filenameStart) return undefined;
  if (logical.slice(filenameStart, dot).endsWith('.min')) return logical;
  return `${logical.slice(0, dot)}.min${logical.slice(dot)}`;
}

const SUPPORTED_FORMATS = new Set(['webp', 'avif', 'jpg', 'jpeg', 'png', 'gif']);

function normalizeFormat(value: string): string | undefined {
  const lower = value.toLowerCase();
  return SUPPORTED_FORMATS.has(lower) ? lower : undefined;
}

// Ghost-compat: rewrite `/content/images/...` URLs to include `size/wXXX[hYYY]/`
// and/or `format/<ext>/` segments so that `{{img_url ... size="x" format="webp"}}`
// produces canonical Ghost image-API URLs (e.g.
// `/content/images/size/w600/format/webp/cover.jpg`). Actual transcoding is a
// separate concern; this only emits the canonical URL shape.
//
// SVG sources are special: they are vector and scale losslessly in the browser,
// and the build-time resize pipeline (generateThemeImageSizeVariants) skips SVG
// because sharp cannot raster-resize them. Rewriting an SVG candidate to a
// `size/wXXX/...svg` URL would point at a file that never lands on disk, so we
// short-circuit and return the original URL. This makes hand-written theme
// srcsets like Source's `{{img_url feature_image size="s"}} 320w, … size="xxl"}} 2000w`
// degenerate (every entry resolves to the same URL); collapseDegenerateSrcset
// in the build pipeline strips the redundant srcset/sizes from the final HTML
// (issues #49 / #140 / #534).
function applyTransformSegments(
  candidate: string,
  sizeDef: ThemeImageSize | undefined,
  format: string | undefined,
): string {
  const sizeSegment = sizeDef ? buildSizeSegment(sizeDef) : '';
  if (!sizeSegment && !format) return candidate;
  if (isSvgSource(candidate)) return candidate;
  const marker = '/content/images/';
  const idx = candidate.indexOf(marker);
  if (idx < 0) return candidate;
  const before = candidate.slice(0, idx + marker.length);
  const after = candidate.slice(idx + marker.length);
  const hasSizeSegment = after.startsWith('size/');
  const hasFormatSegment = /(^|\/)format\//.test(after);
  let prefix = '';
  if (sizeSegment && !hasSizeSegment) prefix += `size/${sizeSegment}/`;
  if (format && !hasFormatSegment) prefix += `format/${format}/`;
  if (!prefix) return candidate;
  return `${before}${prefix}${after}`;
}

// Strip query/fragment before sniffing the extension so a URL like
// `/content/images/logo.svg?v=2` is still recognised as SVG.
function isSvgSource(candidate: string): boolean {
  const clean = candidate.split(/[?#]/)[0] ?? '';
  return clean.toLowerCase().endsWith('.svg');
}

function buildSizeSegment(size: ThemeImageSize): string {
  let s = '';
  if (size.width) s += `w${size.width}`;
  if (size.height) s += `h${size.height}`;
  return s;
}

// A candidate is "same-origin as the configured site" when it is either a
// path-relative URL (e.g. `/content/images/x.jpg`) or an absolute http(s) URL
// whose host matches siteUrl's host. Protocol-relative `//host/...` and
// non-http(s) schemes (`data:`, `mailto:`) are always treated as foreign so
// `absolute=true` does not rewrite their origin.
function isSameOriginAsSite(candidate: string, siteUrl: string): boolean {
  if (candidate.startsWith('//')) return false;
  if (!URL_SCHEME_RE.test(candidate)) return true;
  let candidateUrl: URL;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    return true;
  }
  if (candidateUrl.protocol !== 'http:' && candidateUrl.protocol !== 'https:') return false;
  try {
    const siteHost = new URL(siteUrl).host;
    return candidateUrl.host === siteHost;
  } catch {
    return false;
  }
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const PERCENT_ESCAPE_RE = /%[0-9A-Fa-f]{2}/g;

function encodeAssetUrl(url: string): string {
  const suffixIndex = url.search(/[?#]/);
  if (suffixIndex < 0) return encodeUrlPath(url);
  const path = url.slice(0, suffixIndex);
  const suffix = url.slice(suffixIndex);
  return encodeUrlPath(path) + encodeUrlSuffix(suffix);
}

function encodeUrlPath(path: string): string {
  return path.split('/').map(encodeUrlPathSegment).join('/');
}

function encodeUrlPathSegment(segment: string): string {
  let out = '';
  let cursor = 0;
  for (const match of segment.matchAll(PERCENT_ESCAPE_RE)) {
    out += encodeURIComponent(segment.slice(cursor, match.index));
    out += match[0];
    cursor = match.index + match[0].length;
  }
  out += encodeURIComponent(segment.slice(cursor));
  return out;
}

function encodeUrlSuffix(suffix: string): string {
  return encodeURI(suffix).replace(/['`]/g, (ch) => encodeURIComponent(ch));
}

function extractImage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as { feature_image?: unknown; profile_image?: unknown; url?: unknown };
  if (typeof obj.feature_image === 'string') return obj.feature_image;
  if (typeof obj.profile_image === 'string') return obj.profile_image;
  if (typeof obj.url === 'string') return obj.url;
  return undefined;
}
