import type Handlebars from 'handlebars';
import { joinPath } from '~/theme/assets.ts';
import type { ThemeImageSize } from '~/theme/types.ts';
import type { NectarEngine } from '../engine.ts';

export function registerAssetHelpers(engine: NectarEngine): void {
  const basePath = engine.config.build.base_path;

  engine.hb.registerHelper(
    'asset',
    function assetHelper(path: unknown, options: Handlebars.HelperOptions) {
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
      const url = joinPath(basePath, resolved);
      return new engine.hb.SafeString(escapeHtml(url + (options.hash.hasMinFile ? '' : '')));
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
    const absolute = options.hash.absolute === true;
    const url = applySizeSegment(candidate, sizeDef);
    if (absolute) {
      try {
        return new URL(url, engine.content.site.url).toString();
      } catch {
        return url;
      }
    }
    return url;
  });
}

// Ghost-compat: rewrite `/content/images/...` URLs to include a `size/wXXX[hYYY]/`
// segment so that `{{img_url ... size="x"}}` produces distinct URLs per size
// (otherwise srcset entries collapse to the same source). Actual image resizing
// is a separate concern; this only emits the canonical sized-URL shape.
function applySizeSegment(candidate: string, sizeDef: ThemeImageSize | undefined): string {
  if (!sizeDef) return candidate;
  const segment = buildSizeSegment(sizeDef);
  if (!segment) return candidate;
  const marker = '/content/images/';
  const idx = candidate.indexOf(marker);
  if (idx < 0) return candidate;
  const before = candidate.slice(0, idx + marker.length);
  const after = candidate.slice(idx + marker.length);
  if (after.startsWith('size/')) return candidate;
  return `${before}size/${segment}/${after}`;
}

function buildSizeSegment(size: ThemeImageSize): string {
  let s = '';
  if (size.width) s += `w${size.width}`;
  if (size.height) s += `h${size.height}`;
  return s;
}

function extractImage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as { feature_image?: unknown; profile_image?: unknown; url?: unknown };
  if (typeof obj.feature_image === 'string') return obj.feature_image;
  if (typeof obj.profile_image === 'string') return obj.profile_image;
  if (typeof obj.url === 'string') return obj.url;
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
