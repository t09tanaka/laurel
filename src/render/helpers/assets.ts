import type Handlebars from 'handlebars';
import { joinPath } from '~/theme/assets.ts';
import type { NectarEngine } from '../engine.ts';

export function registerAssetHelpers(engine: NectarEngine): void {
  const basePath = engine.config.build.base_path;

  engine.hb.registerHelper('asset', function assetHelper(path: unknown, options: Handlebars.HelperOptions) {
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
  });

  engine.hb.registerHelper('img_url', function imgUrlHelper(...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const inputs = args.slice(0, -1);
    const direct = inputs[0];
    const candidate = typeof direct === 'string' ? direct : extractImage(direct);
    if (!candidate) return '';
    const size = typeof options.hash.size === 'string' ? options.hash.size : undefined;
    const absolute = options.hash.absolute === true;
    let url = candidate;
    if (size && engine.theme.pkg.image_sizes[size] && !candidate.startsWith('http')) {
      const cleaned = candidate.replace(/^\//, '');
      url = `/${cleaned}`;
    }
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
