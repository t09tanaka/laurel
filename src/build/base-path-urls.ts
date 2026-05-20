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

const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const URL_ATTRS = new Set([
  'action',
  'data-poster',
  'data-src',
  'href',
  'poster',
  'src',
  'xlink:href',
]);
const SRCSET_ATTRS = new Set(['data-srcset', 'imagesrcset', 'srcset']);
const ROOT_RELATIVE_PASSTHROUGH_PREFIXES = [
  '/.netlify/images',
  '/_vercel/image',
  '/cdn-cgi/image/',
];
const META_URL_NAMES = new Set([
  'og:image',
  'og:image:secure_url',
  'og:image:url',
  'og:url',
  'twitter:image',
  'twitter:image:src',
  'twitter:url',
]);

export function rewriteBasePathUrls(html: string, basePath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === '/' || !html.includes('<')) return html;

  const tags = scanTags(html);
  if (tags.length === 0) return html;

  let out = '';
  let cursor = 0;
  let touched = false;
  for (const tag of tags) {
    const rewritten = rewriteTag(tag, normalizedBase);
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

function rewriteTag(tag: TagSpan, basePath: string): string {
  const attrs = scanAttrs(tag.openTag);
  if (attrs.length === 0) return tag.openTag;

  const byName = new Map(attrs.map((attr) => [attr.name, attr]));
  const replacements = new Map<AttrSpan, string>();
  for (const attr of attrs) {
    if (URL_ATTRS.has(attr.name)) {
      rewriteUrlAttr(attr, replacements, basePath);
    } else if (SRCSET_ATTRS.has(attr.name)) {
      rewriteSrcsetAttr(attr, replacements, basePath);
    } else if (attr.name === 'style') {
      rewriteStyleAttr(attr, replacements, basePath);
    }
  }

  if (tag.name === 'meta' && isUrlMeta(byName)) {
    rewriteUrlAttr(byName.get('content'), replacements, basePath);
  }

  if (replacements.size === 0) return tag.openTag;
  return applyAttrReplacements(tag.openTag, replacements);
}

function rewriteUrlAttr(
  attr: AttrSpan | undefined,
  replacements: Map<AttrSpan, string>,
  basePath: string,
): void {
  if (!attr) return;
  const rewritten = prefixRootRelativeUrl(attr.value, basePath);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteSrcsetAttr(
  attr: AttrSpan,
  replacements: Map<AttrSpan, string>,
  basePath: string,
): void {
  const rewritten = rewriteSrcset(attr.value, basePath);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteStyleAttr(
  attr: AttrSpan,
  replacements: Map<AttrSpan, string>,
  basePath: string,
): void {
  const rewritten = rewriteCssUrls(attr.value, basePath);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteSrcset(value: string, basePath: string): string {
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
      const next = prefixRootRelativeUrl(url, basePath);
      if (next === url) return candidate;
      touched = true;
      return `${leading}${next}${descriptor ? ` ${descriptor}` : ''}${trailing}`;
    })
    .join(',');
  return touched ? rewritten : value;
}

function rewriteCssUrls(value: string, basePath: string): string {
  return value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi, (match, d, s, raw) => {
    const url = (d ?? s ?? raw ?? '').trim();
    const rewritten = prefixRootRelativeUrl(url, basePath);
    if (rewritten === url) return match;
    if (d !== undefined) return `url("${rewritten}")`;
    if (s !== undefined) return `url('${rewritten}')`;
    return `url(${rewritten})`;
  });
}

function prefixRootRelativeUrl(value: string, basePath: string): string {
  const decoded = decodeHtmlAttr(value);
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return value;
  if (ROOT_RELATIVE_PASSTHROUGH_PREFIXES.some((prefix) => decoded.startsWith(prefix))) {
    return value;
  }
  if (isAlreadyUnderBasePath(decoded, basePath)) return value;
  return `${basePath.slice(0, -1)}${decoded}`;
}

function isAlreadyUnderBasePath(value: string, basePath: string): boolean {
  const withoutTrailing = basePath.slice(0, -1);
  return value === withoutTrailing || value.startsWith(basePath);
}

function isUrlMeta(attrs: Map<string, AttrSpan>): boolean {
  const key = (attrs.get('property')?.value ?? attrs.get('name')?.value ?? '').toLowerCase();
  return META_URL_NAMES.has(key);
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

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/';
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}
