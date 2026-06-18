import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { type ImageDimensions, readImageDimensions } from '~/util/image-size.ts';
import type { LaurelEngine } from '../engine.ts';

const URL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;
const ASSETS_URL_MARKER = '/content/images/';

// Resolve a `/content/images/...` URL to the local source file under the
// configured assets_dir and read its intrinsic dimensions. Returns undefined
// for external/CDN/protocol-relative URLs, or when cwd/the file is unavailable,
// so callers fall back to their default URL shape instead of guessing. Pass a
// shared cache to avoid re-reading the same file across renders; a null entry
// records "probed and failed" so a missing/unparseable file isn't re-read.
export function probeLocalImage(
  engine: LaurelEngine,
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
