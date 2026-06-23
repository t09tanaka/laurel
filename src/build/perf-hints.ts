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

// Inject an LCP `<link rel="preload" as="image" fetchpriority="high">` for the
// first `fetchpriority="high"` <img> when the document has no such preload yet.
// This covers routes the ghost_head LCP preload skips — list / archive / tag /
// home feeds whose LCP is the first post-card image, and posts whose LCP is a
// promoted first content image rather than a feature_image. The preload carries
// the <img>'s own (or its <picture>'s preferred) srcset / sizes, so the browser
// preloads exactly the candidate it renders instead of double-downloading a
// different resolution. No-op when a high-priority image preload already exists
// (ghost_head emitted one and syncPriorityImagePreload aligns it) or when there
// is no high-priority <img> / no head anchor to insert before.
export function injectPriorityImagePreload(html: string): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  for (const tag of tags) {
    if (tag.kind === 'link' && isHighPriorityImagePreload(tag)) return html;
  }
  const image = firstHighPriorityImage(tags, html);
  if (!image) return html;
  const anchor = priorityPreloadInsertOffset(html, tags);
  if (anchor < 0) return html;
  const srcset = image.preferredSrcset ?? image.srcset;
  const sizes = image.preferredSizes ?? image.sizes;
  const parts = [
    '<link rel="preload" as="image"',
    `href="${escapeAttr(image.src)}"`,
    'fetchpriority="high"',
  ];
  if (srcset) parts.push(`imagesrcset="${escapeAttr(srcset)}"`);
  if (sizes) parts.push(`imagesizes="${escapeAttr(sizes)}"`);
  if (image.preferredType) parts.push(`type="${escapeAttr(image.preferredType)}"`);
  const link = `${parts.join(' ')}>`;
  return `${html.slice(0, anchor)}${link}${html.slice(anchor)}`;
}

// Where to splice the LCP preload: just before the first stylesheet <link> so
// the image fetch is queued ahead of CSS, falling back to `</head>`. Returns -1
// when the document has neither (a bare fragment), so the caller leaves it be.
function priorityPreloadInsertOffset(html: string, tags: readonly ScriptOrLink[]): number {
  for (const tag of tags) {
    if (tag.kind === 'link' && isStylesheet(tag)) return tag.start;
  }
  const headClose = html.search(/<\/head\s*>/i);
  return headClose;
}

export function syncPriorityImagePreload(html: string): string {
  const tags = scanLinkAndScriptTags(html);
  if (tags.length === 0) return html;
  // Prefer an explicit `fetchpriority="high"` <img> (e.g. Source's
  // feature-image.hbs). When the theme does not mark the feature <img> (e.g.
  // Casper's post.hbs), fall back to the <picture>-wrapped feature image that
  // matches the high-priority preload's own href — so the preload still aligns
  // with the rendered modern-format <source> instead of preloading the JPEG the
  // browser will never display.
  let image = firstHighPriorityImage(tags, html);
  if (!image) {
    const preloadHref = firstSyncablePreloadHref(tags);
    if (preloadHref) image = pictureImageMatchingHref(html, preloadHref);
  }
  if (!image) return html;
  // When the LCP <img> is wrapped in a <picture> (e.g. a theme feature_image
  // upgraded to per-format <source>s), align the preload with the preferred
  // <source> so the browser preloads the same modern-format bytes it renders
  // instead of double-downloading the <img> fallback. The href stays the <img>
  // src (the plain fallback for browsers that ignore imagesrcset).
  const useSrcset = image.preferredSrcset ?? image.srcset;
  const useSizes = image.preferredSizes ?? image.sizes;
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
    if (image.preferredType) next = replaceAttrValue(next, 'type', image.preferredType);
    const additions: string[] = [];
    if (useSrcset) additions.push(`imagesrcset="${escapeAttr(useSrcset)}"`);
    if (useSizes) additions.push(`imagesizes="${escapeAttr(useSizes)}"`);
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
  // Deferring (or module-converting) an external classic script moves its
  // execution to after the document is parsed. A classic inline `<script>`
  // cannot defer, so it still runs at parse time — earlier than a now-deferred
  // external script that precedes it. Themes that load a library externally and
  // use it from a following inline script (the classic jQuery pattern) would
  // break (`$ is not defined`). So we leave an external script's loading
  // attributes untouched when any classic inline script appears later in the
  // document, preserving the author's execution order. Data/`module` inline
  // scripts (JSON-LD, importmap, ES modules) do not run synchronously at parse
  // time and so never trigger this guard.
  const lastBlockingInlineStart = lastClassicInlineScriptStart(tags);
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
    if (lastBlockingInlineStart > tag.start) return null;
    if (scriptLooksLikeModule(src)) {
      return appendAttributes(tag.openTag, ' type="module"');
    }
    return appendAttributes(tag.openTag, ' defer');
  });
}

// Source offset of the last classic (parse-time-executing) inline `<script>`,
// or -1 when none exists. An inline script is a `<script>` with no `src`; it is
// "classic" when its `type` is absent/empty or a JavaScript MIME — `module`,
// `application/ld+json`, importmap, and other data blocks do not execute
// synchronously and so are not order-blocking.
function lastClassicInlineScriptStart(tags: readonly ScriptOrLink[]): number {
  let last = -1;
  for (const tag of tags) {
    if (tag.kind !== 'script') continue;
    if (extractAttrValue(tag.openTag, 'src')) continue;
    if (!scriptTypeIsClassic(extractAttrValue(tag.openTag, 'type'))) continue;
    if (tag.start > last) last = tag.start;
  }
  return last;
}

const CLASSIC_SCRIPT_TYPES = new Set([
  '',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/x-javascript',
  'text/jscript',
]);

function scriptTypeIsClassic(type: string | undefined): boolean {
  if (type === undefined) return true;
  const essence = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return CLASSIC_SCRIPT_TYPES.has(essence);
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
  // When the <img> is wrapped in a <picture>, the preferred <source>'s srcset /
  // type / sizes so the preload can target the rendered modern-format bytes.
  preferredSrcset?: string | undefined;
  preferredType?: string | undefined;
  preferredSizes?: string | undefined;
}

function firstHighPriorityImage(
  tags: readonly ScriptOrLink[],
  html: string,
): PriorityImage | undefined {
  for (const tag of tags) {
    if (tag.kind !== 'img') continue;
    if (extractAttrValue(tag.openTag, 'fetchpriority')?.toLowerCase() !== 'high') continue;
    const src = extractAttrValue(tag.openTag, 'src');
    if (!src || /^(?:data|blob):/i.test(src)) continue;
    const image: PriorityImage = {
      src,
      srcset: extractAttrValue(tag.openTag, 'srcset'),
      sizes: extractAttrValue(tag.openTag, 'sizes'),
    };
    const preferred = enclosingPictureSource(html, tag.start);
    if (preferred) {
      image.preferredSrcset = preferred.srcset;
      image.preferredType = preferred.type;
      image.preferredSizes = preferred.sizes;
    }
    return image;
  }
  return undefined;
}

// When an <img> at `imgStart` sits inside an open <picture>, return the first
// <source>'s srcset / type / sizes — the most-preferred format the browser will
// render. Returns undefined when the <img> is not picture-wrapped or the first
// <source> carries no srcset.
function enclosingPictureSource(
  html: string,
  imgStart: number,
): { srcset: string; type?: string; sizes?: string } | undefined {
  const open = html.lastIndexOf('<picture', imgStart);
  if (open < 0) return undefined;
  const close = html.lastIndexOf('</picture>', imgStart);
  if (close > open) return undefined;
  const sourceMatch = /<source\b[^>]*>/i.exec(html.slice(open, imgStart));
  if (!sourceMatch) return undefined;
  const sourceTag = sourceMatch[0];
  const srcset = extractAttrValue(sourceTag, 'srcset');
  if (!srcset) return undefined;
  return {
    srcset,
    type: extractAttrValue(sourceTag, 'type'),
    sizes: extractAttrValue(sourceTag, 'sizes'),
  };
}

// The href of the first high-priority image preload that has not already been
// given explicit `imagesrcset`/`imagesizes` candidates — i.e. the one
// syncPriorityImagePreload would rewrite. Used to locate the feature image when
// the theme does not flag it with `fetchpriority="high"`.
function firstSyncablePreloadHref(tags: readonly ScriptOrLink[]): string | undefined {
  for (const tag of tags) {
    if (tag.kind !== 'link' || !isHighPriorityImagePreload(tag)) continue;
    if (
      extractAttrValue(tag.openTag, 'imagesrcset') ||
      extractAttrValue(tag.openTag, 'imagesizes')
    ) {
      continue;
    }
    const href = extractAttrValue(tag.openTag, 'href');
    if (href && !/^(?:data|blob):/i.test(href)) return href;
  }
  return undefined;
}

// Locate the <picture>-wrapped <img> that renders the preload's feature image
// (matched by the content-image rel shared between the preload href and the
// <img> src/srcset) and return it as the alignment target. Returns undefined
// when no matching picture-wrapped image exists, so a plain (non-picture)
// feature image leaves the preload untouched.
function pictureImageMatchingHref(html: string, href: string): PriorityImage | undefined {
  const baseRel = featureImageBaseRel(href);
  if (!baseRel) return undefined;
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null = imgRe.exec(html);
  while (m !== null) {
    const openTag = m[0];
    if (openTag.includes(baseRel)) {
      const preferred = enclosingPictureSource(html, m.index);
      const src = extractAttrValue(openTag, 'src');
      if (preferred && src && !/^(?:data|blob):/i.test(src)) {
        return {
          src,
          srcset: extractAttrValue(openTag, 'srcset'),
          sizes: extractAttrValue(openTag, 'sizes'),
          preferredSrcset: preferred.srcset,
          preferredType: preferred.type,
          preferredSizes: preferred.sizes,
        };
      }
    }
    m = imgRe.exec(html);
  }
  return undefined;
}

// The content-image rel (path under `/content/images/`, minus any `size/<seg>/`
// or `format/<fmt>/` segments) that both a feature image preload href and the
// rendered <img> variant URLs share, e.g. `2024/01/cover.jpg`. Returns
// undefined for non-content-image hrefs (remote/CDN/data URLs).
function featureImageBaseRel(href: string): string | undefined {
  const clean = href.split(/[?#]/)[0] ?? '';
  const idx = clean.indexOf('/content/images/');
  if (idx < 0) return undefined;
  let rel = clean.slice(idx + '/content/images/'.length);
  rel = rel.replace(/^size\/[^/]+\//, '').replace(/^format\/[^/]+\//, '');
  if (rel === '' || rel.includes('..')) return undefined;
  return rel;
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
