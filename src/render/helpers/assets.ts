import type Handlebars from 'handlebars';
import { joinPath } from '~/theme/assets.ts';
import type { ThemeImageSize } from '~/theme/types.ts';
import type { NectarEngine } from '../engine.ts';

export function registerAssetHelpers(engine: NectarEngine): void {
  const basePath = engine.config.build.base_path;

  engine.hb.registerHelper('asset', function assetHelper(path: unknown) {
    const logical = String(path ?? '').replace(/^\//, '');
    const candidates = [logical, `assets/${logical}`];
    let resolved: string | undefined;
    for (const key of candidates) {
      const asset = engine.theme.assets.get(key);
      if (asset) {
        resolved = asset.fingerprintedPath;
        break;
      }
    }
    if (!resolved) resolved = `assets/${logical}`;
    // Return a plain string so Handlebars applies its context-aware HTML
    // escape (covers &, <, >, ", ', `). Wrapping in SafeString would skip
    // that and let a filename like `a"><script>x</script>.css` break out
    // of an `href="…"` attribute.
    return joinPath(basePath, resolved);
  });

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
    // External URLs (different host, or non-http(s) schemes like data:) must not
    // be rewritten — Nectar only controls resizing for its own /content/images/.
    // Applying size/format segments to an external host produces a broken URL
    // that the remote service cannot serve.
    const external = isExternalUrl(candidate, siteUrl);
    const url = external ? candidate : applyTransformSegments(candidate, sizeDef, formatKey);
    if (absolute && !external) {
      try {
        return new URL(url, siteUrl).toString();
      } catch {
        return url;
      }
    }
    return url;
  });
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
function applyTransformSegments(
  candidate: string,
  sizeDef: ThemeImageSize | undefined,
  format: string | undefined,
): string {
  const sizeSegment = sizeDef ? buildSizeSegment(sizeDef) : '';
  if (!sizeSegment && !format) return candidate;
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

function buildSizeSegment(size: ThemeImageSize): string {
  let s = '';
  if (size.width) s += `w${size.width}`;
  if (size.height) s += `h${size.height}`;
  return s;
}

// A URL is "external" when it has its own scheme/host and that host differs
// from the configured site URL. Protocol-relative `//host/...` is also treated
// as external. Non-http(s) schemes (e.g. `data:`, `mailto:`) are always
// external since they don't share an origin with siteUrl. Failures in parsing
// siteUrl fall back to treating any URL with a scheme as external — safer than
// rewriting something we can't reason about.
function isExternalUrl(candidate: string, siteUrl: string): boolean {
  if (candidate.startsWith('//')) return true;
  if (!URL_SCHEME_RE.test(candidate)) return false;
  let candidateUrl: URL;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }
  if (candidateUrl.protocol !== 'http:' && candidateUrl.protocol !== 'https:') return true;
  try {
    const siteHost = new URL(siteUrl).host;
    return candidateUrl.host !== siteHost;
  } catch {
    return true;
  }
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function extractImage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as { feature_image?: unknown; profile_image?: unknown; url?: unknown };
  if (typeof obj.feature_image === 'string') return obj.feature_image;
  if (typeof obj.profile_image === 'string') return obj.profile_image;
  if (typeof obj.url === 'string') return obj.url;
  return undefined;
}
