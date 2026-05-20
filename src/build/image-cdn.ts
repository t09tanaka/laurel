import type { NectarConfig } from '~/config/schema.ts';

interface RewriteOptions {
  config: NectarConfig;
}

interface TagSpan {
  name: string;
  start: number;
  end: number;
  openTag: string;
}

interface AttrSpan {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'" | undefined;
}

interface ImageSource {
  path: string;
  absoluteUrl: string;
}

interface RewriteContext {
  width?: number | undefined;
}

const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const IMAGE_META_NAMES = new Set([
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
]);

export function rewriteImageCdnUrls(html: string, { config }: RewriteOptions): string {
  if (!config.image_cdn.enabled || !html.includes('<')) return html;
  const tags = scanTags(html);
  if (tags.length === 0) return html;

  let out = '';
  let cursor = 0;
  let touched = false;
  for (const tag of tags) {
    const rewritten = rewriteTag(tag, config);
    if (rewritten === tag.openTag) continue;
    out += html.slice(cursor, tag.start);
    out += rewritten;
    cursor = tag.end;
    touched = true;
  }
  if (!touched) return html;
  out += html.slice(cursor);
  return out;
}

function rewriteTag(tag: TagSpan, config: NectarConfig): string {
  if (tag.name !== 'img' && tag.name !== 'source' && tag.name !== 'link' && tag.name !== 'meta') {
    return tag.openTag;
  }
  const attrs = scanAttrs(tag.openTag);
  const byName = new Map(attrs.map((attr) => [attr.name, attr]));
  const replacements = new Map<AttrSpan, string>();

  if (tag.name === 'img') {
    const width = parsePositiveInt(byName.get('width')?.value);
    rewriteAttr(byName.get('src'), replacements, config, { width });
    rewriteSrcsetAttr(byName.get('srcset'), replacements, config);
  } else if (tag.name === 'source') {
    rewriteSrcsetAttr(byName.get('srcset'), replacements, config);
  } else if (tag.name === 'link') {
    if (isImagePreload(byName)) {
      rewriteAttr(byName.get('href'), replacements, config, {});
    }
  } else if (tag.name === 'meta' && isImageMeta(byName)) {
    rewriteAttr(byName.get('content'), replacements, config, {});
  }

  if (replacements.size === 0) return tag.openTag;
  return applyAttrReplacements(tag.openTag, replacements);
}

function rewriteAttr(
  attr: AttrSpan | undefined,
  replacements: Map<AttrSpan, string>,
  config: NectarConfig,
  context: RewriteContext,
): void {
  if (!attr) return;
  const rewritten = rewriteImageUrl(attr.value, config, context);
  if (rewritten && rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteSrcsetAttr(
  attr: AttrSpan | undefined,
  replacements: Map<AttrSpan, string>,
  config: NectarConfig,
): void {
  if (!attr) return;
  const rewritten = rewriteSrcset(attr.value, config);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteSrcset(value: string, config: NectarConfig): string {
  if (/\bdata:/i.test(value)) return value;
  let touched = false;
  const rewritten = value
    .split(',')
    .map((candidate) => {
      const leading = candidate.match(/^\s*/)?.[0] ?? '';
      const trailing = candidate.match(/\s*$/)?.[0] ?? '';
      const core = candidate.trim();
      if (!core) return candidate;
      const firstWs = core.search(/\s/);
      const url = firstWs === -1 ? core : core.slice(0, firstWs);
      const descriptor = firstWs === -1 ? '' : core.slice(firstWs).trim();
      const width = parseSrcsetWidth(descriptor);
      const next = rewriteImageUrl(url, config, { width });
      if (!next || next === url) return candidate;
      touched = true;
      return `${leading}${next}${descriptor ? ` ${descriptor}` : ''}${trailing}`;
    })
    .join(',');
  return touched ? rewritten : value;
}

function rewriteImageUrl(
  raw: string,
  config: NectarConfig,
  context: RewriteContext,
): string | undefined {
  const source = resolveImageSource(raw, config);
  if (!source) return undefined;
  const width = context.width ?? config.image_cdn.default_width;
  switch (config.image_cdn.adapter) {
    case 'cloudflare':
      return buildCloudflareUrl(config, source, width);
    case 'netlify':
      return buildQueryAdapterUrl(config, '/.netlify/images', source, width, false);
    case 'vercel':
      return width ? buildQueryAdapterUrl(config, '/_next/image', source, width, true) : undefined;
    case 'cloudinary':
      return buildCloudinaryUrl(config, source, width);
    case 'imgproxy':
      return buildImgproxyUrl(config, source, width);
  }
}

function resolveImageSource(raw: string, config: NectarConfig): ImageSource | undefined {
  const decoded = decodeHtmlAttr(raw).trim();
  if (!decoded || decoded.startsWith('//')) return undefined;
  if (/^(data|blob):/i.test(decoded)) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !/^https?:/i.test(decoded)) return undefined;

  let url: URL;
  try {
    url = new URL(decoded, siteUrlBase(config.site.url));
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hash) return undefined;
  if (isAbsoluteHttpUrl(decoded) && !isSameSite(url, config.site.url)) return undefined;
  if (!isEligibleImagePath(url.pathname, config)) return undefined;
  return {
    path: `${url.pathname}${url.search}`,
    absoluteUrl: url.toString(),
  };
}

function buildCloudflareUrl(
  config: NectarConfig,
  source: ImageSource,
  width: number | undefined,
): string {
  const options = [`format=${config.image_cdn.format}`, `quality=${config.image_cdn.quality}`];
  if (width) options.push(`width=${width}`);
  return `${adapterBase(config)}${joinUrlPath('/cdn-cgi/image', options.join(','), source.path)}`;
}

function buildQueryAdapterUrl(
  config: NectarConfig,
  endpoint: string,
  source: ImageSource,
  width: number | undefined,
  requireWidth: boolean,
): string | undefined {
  if (requireWidth && !width) return undefined;
  const params = new URLSearchParams();
  params.set('url', source.path);
  if (width) params.set('w', String(width));
  params.set('q', String(config.image_cdn.quality));
  return `${adapterBase(config)}${endpoint}?${params.toString()}`;
}

function buildCloudinaryUrl(
  config: NectarConfig,
  source: ImageSource,
  width: number | undefined,
): string | undefined {
  const base = adapterBase(config);
  if (!base) return undefined;
  const transforms = [
    `f_${config.image_cdn.format}`,
    `q_${config.image_cdn.quality}`,
    ...(width ? [`w_${width}`] : []),
  ];
  return `${base}/image/fetch/${transforms.join(',')}/${encodeURIComponent(source.absoluteUrl)}`;
}

function buildImgproxyUrl(
  config: NectarConfig,
  source: ImageSource,
  width: number | undefined,
): string | undefined {
  const base = adapterBase(config);
  if (!base) return undefined;
  const options = [`q:${config.image_cdn.quality}`];
  if (width) options.unshift(`rs:fit:${width}:0`);
  if (config.image_cdn.format !== 'auto') options.push(`f:${config.image_cdn.format}`);
  const optionPath = options.length > 0 ? `${options.join('/')}/` : '';
  return `${base}/${config.image_cdn.signature}/${optionPath}plain/${encodeURIComponent(
    source.absoluteUrl,
  )}`;
}

function scanTags(html: string): TagSpan[] {
  const out: TagSpan[] = [];
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf('<', i);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    const next = start + 1;
    if (html.charCodeAt(next) === 0x2f || html.charCodeAt(next) === 0x21) {
      const end = skipPastTag(html, start);
      if (end <= start) break;
      i = end;
      continue;
    }
    const name = readTagName(html, next);
    if (!name) {
      const end = skipPastTag(html, start);
      if (end <= start) break;
      i = end;
      continue;
    }
    const end = skipPastTag(html, start);
    if (end <= start) break;
    out.push({ name, start, end, openTag: html.slice(start, end) });
    i = end;
  }
  return out;
}

function scanAttrs(tag: string): AttrSpan[] {
  const attrs: AttrSpan[] = [];
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null = ATTR_RE.exec(tag);
  while (match !== null) {
    const name = match[1];
    const rawValue = match[2];
    if (name && rawValue) {
      const rawStart = tag.indexOf(rawValue, match.index + name.length);
      const quote = rawValue[0] === '"' || rawValue[0] === "'" ? rawValue[0] : undefined;
      const valueStart = rawStart + (quote ? 1 : 0);
      const valueEnd = rawStart + rawValue.length - (quote ? 1 : 0);
      attrs.push({
        name: name.toLowerCase(),
        value: tag.slice(valueStart, valueEnd),
        valueStart,
        valueEnd,
        quote,
      });
    }
    match = ATTR_RE.exec(tag);
  }
  return attrs;
}

function applyAttrReplacements(tag: string, replacements: Map<AttrSpan, string>): string {
  let out = tag;
  const ordered = Array.from(replacements.entries()).sort(
    ([a], [b]) => b.valueStart - a.valueStart,
  );
  for (const [attr, value] of ordered) {
    out =
      out.slice(0, attr.valueStart) + formatAttrValue(value, attr.quote) + out.slice(attr.valueEnd);
  }
  return out;
}

function isImagePreload(attrs: Map<string, AttrSpan>): boolean {
  return (
    attrTokens(attrs.get('rel')?.value).has('preload') &&
    attrs.get('as')?.value.toLowerCase() === 'image'
  );
}

function isImageMeta(attrs: Map<string, AttrSpan>): boolean {
  const key = (attrs.get('property')?.value ?? attrs.get('name')?.value ?? '').toLowerCase();
  return IMAGE_META_NAMES.has(key);
}

function isEligibleImagePath(pathname: string, config: NectarConfig): boolean {
  const paths = [pathname];
  const basePath = normalizeBasePath(config.build.base_path);
  if (basePath !== '/' && pathname.startsWith(basePath)) {
    paths.push(`/${pathname.slice(basePath.length)}`);
  }
  return config.image_cdn.path_prefixes.some((prefix) => {
    const normalized = normalizePrefix(prefix);
    return paths.some((path) => path.startsWith(normalized));
  });
}

function normalizePrefix(prefix: string): string {
  const withLeading = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/';
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function attrTokens(value: string | undefined): Set<string> {
  return new Set((value ?? '').toLowerCase().split(/\s+/).filter(Boolean));
}

function parseSrcsetWidth(descriptor: string): number | undefined {
  const match = descriptor.match(/(?:^|\s)(\d+)w(?:\s|$)/);
  return match ? parsePositiveInt(match[1]) : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function adapterBase(config: NectarConfig): string {
  return (config.image_cdn.base_url ?? '').replace(/\/+$/, '');
}

function siteUrlBase(siteUrl: string): string {
  return siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isSameSite(url: URL, siteUrl: string): boolean {
  try {
    return url.host === new URL(siteUrl).host;
  } catch {
    return false;
  }
}

function joinUrlPath(...parts: string[]): string {
  return parts
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+/, '').replace(/\/+$/, ''),
    )
    .join('/');
}

function readTagName(html: string, at: number): string | undefined {
  let end = at;
  while (end < html.length && /[A-Za-z0-9:-]/.test(html[end] ?? '')) end++;
  if (end === at) return undefined;
  const boundary = html[end];
  if (boundary && !/\s|\/|>/.test(boundary)) return undefined;
  return html.slice(at, end).toLowerCase();
}

function skipPastTag(html: string, openLt: number): number {
  let i = openLt + 1;
  while (i < html.length) {
    const c = html.charCodeAt(i);
    if (c === 0x22 || c === 0x27) {
      const quote = c;
      i++;
      while (i < html.length && html.charCodeAt(i) !== quote) i++;
      if (i >= html.length) return openLt;
      i++;
      continue;
    }
    if (c === 0x3e) return i + 1;
    i++;
  }
  return openLt;
}

function decodeHtmlAttr(value: string): string {
  return value.replace(/&amp;|&#38;|&#x26;/gi, '&');
}

function formatAttrValue(value: string, quote: '"' | "'" | undefined): string {
  const escaped = escapeAttr(value, quote ?? '"');
  return quote ? escaped : `"${escaped}"`;
}

function escapeAttr(value: string, quote: '"' | "'"): string {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&#39;');
  return out;
}
