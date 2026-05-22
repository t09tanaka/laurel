import { assetPublicUrl } from '~/theme/assets.ts';
import type { ThemeAsset } from '~/theme/types.ts';

// Resource-hint and HTML post-process helpers covering tasks #527 (stylesheet
// preload) and #528 (deduplicate script preload). The ghost_head helper covers
// the per-route LCP preload (#147) and image-origin preconnect (#530), so the
// transforms here are limited to whole-document rewrites that do not depend on
// route data. All functions are pure HTML string transforms so they compose
// with arbitrary `.hbs` output and are safe to run after every other
// post-process pass.

// `<link rel="preload" as="script" href="X">` is redundant when an equivalent
// `<script src="X">` already exists in the document: deferred / sync script
// elements emit their own preload-equivalent request, and DevTools will show
// the same URL twice. Preserves any preload whose href has no corresponding
// `<script src>` (e.g. a route that lazy-loads via `import()` may rely on the
// preload to warm the cache before the dynamic import resolves).
export function removeRedundantScriptPreload(html: string): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  const scriptSrcs = collectScriptSrcs(tags);
  if (scriptSrcs.size === 0) return html;
  return rewriteTags(html, tags, (tag) => {
    if (tag.kind !== 'link') return null;
    if (!isScriptPreload(tag)) return null;
    const href = extractAttrValue(tag.openTag, 'href');
    if (!href) return null;
    return scriptSrcs.has(normaliseHref(href)) ? '' : null;
  });
}

// Inject a sibling `<link rel="preload" as="style" href="X">` for every
// `<link rel="stylesheet" href="X">` lacking one. Helps themes that did not
// hand-author the preload pattern; the Source theme already ships both so this
// is a no-op there. Inserts the preload immediately before the stylesheet so
// the order in the head reflects intent (preload first, the actual fetch /
// parse after).
export function injectStylesheetPreload(html: string): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  const preloadedStyleHrefs = collectStylePreloadHrefs(tags);
  // Track stylesheet hrefs we have already injected a preload for so two
  // `<link rel="stylesheet" href="X">` entries don't both pull in their own
  // preload sibling on the same page.
  const injected = new Set<string>();
  let out = '';
  let cursor = 0;
  let touched = false;
  for (const tag of tags) {
    if (tag.kind !== 'link') continue;
    if (!isStylesheet(tag)) continue;
    if (!shouldPreloadStylesheet(tag)) continue;
    const href = extractAttrValue(tag.openTag, 'href');
    if (!href) continue;
    const normalised = normaliseHref(href);
    if (preloadedStyleHrefs.has(normalised) || injected.has(normalised)) continue;
    out += html.slice(cursor, tag.start);
    out += `<link rel="preload" as="style" href="${escapeAttr(href)}">`;
    cursor = tag.start;
    injected.add(normalised);
    touched = true;
  }
  if (!touched) return html;
  out += html.slice(cursor);
  return out;
}

export function syncPriorityImagePreload(html: string): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  const image = firstHighPriorityImage(tags);
  if (!image) return html;
  let synced = false;

  return rewriteTags(html, tags, (tag) => {
    if (tag.kind !== 'link') return null;
    if (synced) return null;
    if (!isHighPriorityImagePreload(tag)) return null;
    if (
      extractAttrValue(tag.openTag, 'imagesrcset') ||
      extractAttrValue(tag.openTag, 'imagesizes')
    ) {
      return null;
    }

    let next = replaceAttrValue(tag.openTag, 'href', image.src);
    const additions: string[] = [];
    if (image.srcset) additions.push(`imagesrcset="${escapeAttr(image.srcset)}"`);
    if (image.sizes) additions.push(`imagesizes="${escapeAttr(image.sizes)}"`);
    if (additions.length > 0) next = appendAttributes(next, ` ${additions.join(' ')}`);
    if (next === tag.openTag) return null;
    synced = true;
    return next;
  });
}

export function injectSubresourceIntegrity(
  html: string,
  assets: Iterable<ThemeAsset>,
  basePath: string,
): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  const integrityByUrl = buildIntegrityUrlMap(assets, basePath);
  if (integrityByUrl.size === 0) return html;

  return rewriteTags(html, tags, (tag) => {
    const attrName = tag.kind === 'script' ? 'src' : 'href';
    if (tag.kind === 'link' && !isSriLink(tag)) return null;
    const value = extractAttrValue(tag.openTag, attrName);
    if (!value) return null;
    const integrity = integrityByUrl.get(normaliseHref(value));
    if (!integrity) return null;
    if (extractAttrValue(tag.openTag, 'integrity')) return null;
    return appendSriAttrs(tag.openTag, integrity);
  });
}

export function normalizeResourceTagAttributes(html: string): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  return rewriteTags(html, tags, (tag) => {
    if (tag.kind === 'link') {
      if (!isStylesheet(tag)) return null;
      if (extractAttrValue(tag.openTag, 'type')) return null;
      return appendAttributes(tag.openTag, ' type="text/css"');
    }
    if (tag.kind !== 'script') return null;
    const src = extractAttrValue(tag.openTag, 'src');
    if (!src) return null;
    if (extractAttrValue(tag.openTag, 'type')) return null;
    if (hasBooleanAttr(tag.openTag, 'async')) return null;
    if (hasBooleanAttr(tag.openTag, 'defer')) return null;
    if (hasBooleanAttr(tag.openTag, 'nomodule')) return null;
    if (scriptLooksLikeModule(src)) {
      return appendAttributes(tag.openTag, ' type="module"');
    }
    return appendAttributes(tag.openTag, ' defer');
  });
}

export interface HtmlPreloadLink {
  href: string;
  as: string;
  crossorigin?: string;
  integrity?: string;
  type?: string;
}

export function collectHtmlPreloadLinks(html: string): HtmlPreloadLink[] {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return [];
  const out: HtmlPreloadLink[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (tag.kind !== 'link' || !isPreload(tag)) continue;
    const href = extractAttrValue(tag.openTag, 'href');
    const as = extractAttrValue(tag.openTag, 'as');
    if (!href || !as) continue;
    const entry: HtmlPreloadLink = { href, as };
    const crossorigin = extractAttrValue(tag.openTag, 'crossorigin');
    if (crossorigin !== undefined) entry.crossorigin = crossorigin;
    const integrity = extractAttrValue(tag.openTag, 'integrity');
    if (integrity !== undefined) entry.integrity = integrity;
    const type = extractAttrValue(tag.openTag, 'type');
    if (type !== undefined) entry.type = type;
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

interface ScriptOrLink {
  kind: 'script' | 'link' | 'img';
  // Byte offsets in the input string of the entire `<…>` open tag (link is
  // void so end equals the end of `>`; script includes only the open tag,
  // not the `</script>` close — preload removal targets `<script>` declarations
  // for src-matching, not their bodies, so the close is irrelevant).
  start: number;
  end: number;
  openTag: string;
}

// Cheap-and-correct-enough single-pass tag scanner. Only looks for `<link …>`,
// `<script …>`, and `<img …>` open tags; everything else is skipped. Quoted attribute
// values may contain `>` so we tokenise attribute-aware. Comments and CDATA
// are skipped wholesale. This is not a full HTML parser — it does not need to
// be — but it correctly handles the open-tag shapes Ghost themes emit.
function scanLinkAndScriptTags(html: string): ScriptOrLink[] {
  const out: ScriptOrLink[] = [];
  const len = html.length;
  let i = 0;
  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    // Skip HTML comments wholesale.
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      if (close === -1) break;
      i = close + 3;
      continue;
    }
    // Skip CDATA / doctype.
    if (html.startsWith('<![', lt) || html.startsWith('<!', lt)) {
      const close = html.indexOf('>', lt + 1);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    const next = lt + 1;
    if (next >= len) break;
    const ch = html.charCodeAt(next);
    const isLink = matchTagName(html, next, 'link');
    const isScript = matchTagName(html, next, 'script');
    const isImg = matchTagName(html, next, 'img');
    if (!isLink && !isScript && !isImg) {
      // `</…>` and other tags — advance to the next `>` while respecting quoted
      // attribute values so a `>` inside a string literal does not end the tag
      // prematurely.
      i = skipPastTag(html, lt);
      if (i <= lt) break;
      continue;
    }
    // Char after tag name must be whitespace or `>` to count as the tag name
    // boundary (avoids matching `<linkthing>` as `<link>`).
    const tagNameLen = isLink ? 4 : isImg ? 3 : 6;
    const boundary = html.charCodeAt(next + tagNameLen);
    if (
      ch !== 0 &&
      // boundary must be whitespace, `/`, or `>`
      boundary !== 0x20 &&
      boundary !== 0x09 &&
      boundary !== 0x0a &&
      boundary !== 0x0d &&
      boundary !== 0x2f &&
      boundary !== 0x3e
    ) {
      i = skipPastTag(html, lt);
      continue;
    }
    const tagEnd = skipPastTag(html, lt);
    if (tagEnd <= lt) break;
    out.push({
      kind: isLink ? 'link' : isImg ? 'img' : 'script',
      start: lt,
      end: tagEnd,
      openTag: html.slice(lt, tagEnd),
    });
    i = tagEnd;
  }
  return out;
}

function matchTagName(html: string, at: number, name: string): boolean {
  if (at + name.length > html.length) return false;
  for (let k = 0; k < name.length; k++) {
    const c = html.charCodeAt(at + k);
    const want = name.charCodeAt(k);
    // ASCII case-insensitive compare
    if (c !== want && c !== want - 32 && c !== want + 32) return false;
  }
  return true;
}

// Advance past a tag, respecting quoted attribute values. Returns the byte
// offset immediately after the closing `>`. Returns the input position when
// the tag is malformed (no closing `>`), so the caller can break the loop.
function skipPastTag(html: string, openLt: number): number {
  const len = html.length;
  let j = openLt + 1;
  while (j < len) {
    const c = html.charCodeAt(j);
    if (c === 0x22 /* " */ || c === 0x27 /* ' */) {
      const quote = c;
      j++;
      while (j < len && html.charCodeAt(j) !== quote) j++;
      if (j >= len) return openLt;
      j++;
      continue;
    }
    if (c === 0x3e /* > */) return j + 1;
    j++;
  }
  return openLt;
}

// Extract the value of a named attribute from an open-tag string.
// Supports double-quoted, single-quoted, and unquoted values. Case-insensitive
// on the attribute name; the returned value is verbatim (no HTML entity decode
// — the caller compares against verbatim hrefs from the same tree).
function extractAttrValue(tag: string, name: string): string | undefined {
  const lower = tag.toLowerCase();
  const needle = name.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) return undefined;
    // Must be preceded by whitespace or the opening `<tagname`. We accept any
    // whitespace as the separator; the regex-free walk keeps complexity low.
    const prev = at === 0 ? 0 : lower.charCodeAt(at - 1);
    if (
      at !== 0 &&
      prev !== 0x20 &&
      prev !== 0x09 &&
      prev !== 0x0a &&
      prev !== 0x0d &&
      prev !== 0x2f
    ) {
      i = at + needle.length;
      continue;
    }
    const after = at + needle.length;
    if (after >= lower.length) return undefined;
    let j = after;
    while (j < lower.length && isAttrWs(lower.charCodeAt(j))) j++;
    if (lower.charCodeAt(j) !== 0x3d /* = */) {
      // Boolean attribute (no value). Skip and continue searching.
      i = j;
      continue;
    }
    j++;
    while (j < lower.length && isAttrWs(lower.charCodeAt(j))) j++;
    if (j >= lower.length) return undefined;
    const q = lower.charCodeAt(j);
    if (q === 0x22 /* " */ || q === 0x27 /* ' */) {
      const end = tag.indexOf(q === 0x22 ? '"' : "'", j + 1);
      if (end === -1) return undefined;
      return tag.slice(j + 1, end);
    }
    // Unquoted value: terminated by whitespace or `>` (or `/>` for void).
    let end = j;
    while (end < lower.length) {
      const c = lower.charCodeAt(end);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x3e || c === 0x2f) break;
      end++;
    }
    return tag.slice(j, end);
  }
  return undefined;
}

function isAttrWs(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isScriptPreload(tag: ScriptOrLink): boolean {
  const rel = extractAttrValue(tag.openTag, 'rel');
  if (!rel || !rel.split(/\s+/).includes('preload')) return false;
  const asAttr = extractAttrValue(tag.openTag, 'as');
  return asAttr === 'script';
}

function isPreload(tag: ScriptOrLink): boolean {
  const rel = extractAttrValue(tag.openTag, 'rel');
  return !!rel && rel.split(/\s+/).includes('preload');
}

function isStylesheet(tag: ScriptOrLink): boolean {
  const rel = extractAttrValue(tag.openTag, 'rel');
  return !!rel && rel.split(/\s+/).includes('stylesheet');
}

function shouldPreloadStylesheet(tag: ScriptOrLink): boolean {
  const rel = extractAttrValue(tag.openTag, 'rel');
  if (!rel) return false;
  const tokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes('alternate')) return false;
  if (hasBooleanAttr(tag.openTag, 'disabled')) return false;
  const media = extractAttrValue(tag.openTag, 'media')?.trim().toLowerCase();
  return !media || media === 'all' || media === 'screen';
}

interface PriorityImage {
  src: string;
  srcset?: string | undefined;
  sizes?: string | undefined;
}

function firstHighPriorityImage(tags: readonly ScriptOrLink[]): PriorityImage | undefined {
  for (const tag of tags) {
    if (tag.kind !== 'img') continue;
    if (extractAttrValue(tag.openTag, 'fetchpriority')?.toLowerCase() !== 'high') continue;
    const src = extractAttrValue(tag.openTag, 'src');
    if (!src || /^(?:data|blob):/i.test(src)) continue;
    return {
      src,
      srcset: extractAttrValue(tag.openTag, 'srcset'),
      sizes: extractAttrValue(tag.openTag, 'sizes'),
    };
  }
  return undefined;
}

function isHighPriorityImagePreload(tag: ScriptOrLink): boolean {
  if (!isPreload(tag)) return false;
  const asAttr = extractAttrValue(tag.openTag, 'as');
  if (asAttr?.toLowerCase() !== 'image') return false;
  return extractAttrValue(tag.openTag, 'fetchpriority')?.toLowerCase() === 'high';
}

function isSriLink(tag: ScriptOrLink): boolean {
  if (isStylesheet(tag)) return true;
  const rel = extractAttrValue(tag.openTag, 'rel');
  if (!rel || !rel.split(/\s+/).includes('preload')) return false;
  const asAttr = extractAttrValue(tag.openTag, 'as');
  return asAttr === 'style' || asAttr === 'script';
}

function buildIntegrityUrlMap(assets: Iterable<ThemeAsset>, basePath: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const asset of assets) {
    if (!asset.integrity) continue;
    if (asset.fingerprintedPath === asset.logicalPath) continue;
    const url = assetPublicUrl(asset, basePath);
    out.set(url, asset.integrity);
    out.set(encodeUrlPath(url), asset.integrity);
  }
  return out;
}

function appendSriAttrs(tag: string, integrity: string): string {
  const crossorigin = extractAttrValue(tag, 'crossorigin') ? '' : ' crossorigin="anonymous"';
  const attrs = ` integrity="${escapeAttr(integrity)}"${crossorigin}`;
  return appendAttributes(tag, attrs);
}

function appendAttributes(tag: string, attrs: string): string {
  if (tag.endsWith('/>')) return `${tag.slice(0, -2)}${attrs}>`;
  return `${tag.slice(0, -1)}${attrs}>`;
}

interface AttrValueSpan {
  rawStart: number;
  rawEnd: number;
}

function replaceAttrValue(tag: string, name: string, value: string): string {
  const span = findAttrValueSpan(tag, name);
  if (!span) return appendAttributes(tag, ` ${name}="${escapeAttr(value)}"`);
  return `${tag.slice(0, span.rawStart)}"${escapeAttr(value)}"${tag.slice(span.rawEnd)}`;
}

function findAttrValueSpan(tag: string, name: string): AttrValueSpan | undefined {
  const lower = tag.toLowerCase();
  const needle = name.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) return undefined;
    const prev = at === 0 ? 0 : lower.charCodeAt(at - 1);
    if (
      at !== 0 &&
      prev !== 0x20 &&
      prev !== 0x09 &&
      prev !== 0x0a &&
      prev !== 0x0d &&
      prev !== 0x2f
    ) {
      i = at + needle.length;
      continue;
    }
    const after = at + needle.length;
    let j = after;
    while (j < lower.length && isAttrWs(lower.charCodeAt(j))) j++;
    if (lower.charCodeAt(j) !== 0x3d) {
      i = j;
      continue;
    }
    j++;
    while (j < lower.length && isAttrWs(lower.charCodeAt(j))) j++;
    if (j >= lower.length) return undefined;
    const q = lower.charCodeAt(j);
    if (q === 0x22 || q === 0x27) {
      const quote = q === 0x22 ? '"' : "'";
      const end = tag.indexOf(quote, j + 1);
      if (end === -1) return undefined;
      return { rawStart: j, rawEnd: end + 1 };
    }
    let end = j;
    while (end < lower.length) {
      const c = lower.charCodeAt(end);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x3e || c === 0x2f) {
        break;
      }
      end++;
    }
    return { rawStart: j, rawEnd: end };
  }
  return undefined;
}

function hasBooleanAttr(tag: string, name: string): boolean {
  const lower = tag.toLowerCase();
  const needle = name.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) return false;
    const prev = at === 0 ? 0 : lower.charCodeAt(at - 1);
    if (
      at !== 0 &&
      prev !== 0x20 &&
      prev !== 0x09 &&
      prev !== 0x0a &&
      prev !== 0x0d &&
      prev !== 0x2f
    ) {
      i = at + needle.length;
      continue;
    }
    const after = at + needle.length;
    const next = lower.charCodeAt(after);
    if (
      next === 0x20 ||
      next === 0x09 ||
      next === 0x0a ||
      next === 0x0d ||
      next === 0x2f ||
      next === 0x3e
    ) {
      return true;
    }
    i = after;
  }
  return false;
}

function scriptLooksLikeModule(src: string): boolean {
  const path = src.split('#')[0]?.split('?')[0] ?? src;
  return /\.mjs$/i.test(path);
}

function collectScriptSrcs(tags: readonly ScriptOrLink[]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    if (tag.kind !== 'script') continue;
    const src = extractAttrValue(tag.openTag, 'src');
    if (src) out.add(normaliseHref(src));
  }
  return out;
}

function collectStylePreloadHrefs(tags: readonly ScriptOrLink[]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    if (tag.kind !== 'link') continue;
    const rel = extractAttrValue(tag.openTag, 'rel');
    if (!rel || !rel.split(/\s+/).includes('preload')) continue;
    const asAttr = extractAttrValue(tag.openTag, 'as');
    if (asAttr !== 'style') continue;
    const href = extractAttrValue(tag.openTag, 'href');
    if (href) out.add(normaliseHref(href));
  }
  return out;
}

// Trim trailing whitespace and normalise the fragment so `built/foo.js` and
// `built/foo.js#x` are treated as the same asset. Query strings carry cache
// busters (the `{{asset}}` fingerprint) so we keep them as-is — two preloads
// that hash-differ are genuinely different files.
function normaliseHref(value: string): string {
  const trimmed = value.trim();
  const hashAt = trimmed.indexOf('#');
  return hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

const PERCENT_ESCAPE_RE = /%[0-9A-Fa-f]{2}/g;

// Rewrite the input string by visiting each scanned tag in source order and
// asking the caller for a replacement (empty string to drop, null to keep).
// Slicing is single-pass and avoids the quadratic cost of `String#replace` on
// large documents with many tags.
function rewriteTags(
  html: string,
  tags: readonly ScriptOrLink[],
  decide: (tag: ScriptOrLink) => string | null,
): string {
  let cursor = 0;
  let out = '';
  let touched = false;
  for (const tag of tags) {
    const replacement = decide(tag);
    if (replacement === null) continue;
    out += html.slice(cursor, tag.start);
    out += replacement;
    cursor = tag.end;
    touched = true;
  }
  if (!touched) return html;
  out += html.slice(cursor);
  return out;
}
