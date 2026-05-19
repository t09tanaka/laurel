import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { type ImageDimensions, readImageDimensions } from '~/util/image-size.ts';

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
