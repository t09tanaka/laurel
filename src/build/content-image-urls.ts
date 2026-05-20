import type { NectarConfig } from '~/config/schema.ts';
import type { ContentImageAssetPlan } from './emit.ts';

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

interface RewriteOptions {
  config: NectarConfig;
  plan: ContentImageAssetPlan;
}

const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const URL_ATTRS = new Set(['data-poster', 'data-src', 'href', 'poster', 'src']);
const SRCSET_ATTRS = new Set(['data-srcset', 'imagesrcset', 'srcset']);
const IMAGE_META_NAMES = new Set([
  'og:image',
  'og:image:secure_url',
  'og:image:url',
  'twitter:image',
  'twitter:image:src',
]);

export function rewriteContentImageUrls(html: string, { config, plan }: RewriteOptions): string {
  if (plan.entries.length === 0 || !html.includes('/content/images/') || !html.includes('<')) {
    return html;
  }
  const tags = scanTags(html);
  if (tags.length === 0) return html;

  let out = '';
  let cursor = 0;
  let touched = false;
  for (const tag of tags) {
    const rewritten = rewriteTag(tag, config, plan);
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

function rewriteTag(tag: TagSpan, config: NectarConfig, plan: ContentImageAssetPlan): string {
  const attrs = scanAttrs(tag.openTag);
  if (attrs.length === 0) return tag.openTag;

  const byName = new Map(attrs.map((attr) => [attr.name, attr]));
  const replacements = new Map<AttrSpan, string>();
  for (const attr of attrs) {
    if (URL_ATTRS.has(attr.name)) {
      rewriteUrlAttr(attr, replacements, config, plan);
    } else if (SRCSET_ATTRS.has(attr.name)) {
      rewriteSrcsetAttr(attr, replacements, config, plan);
    } else if (attr.name === 'style') {
      rewriteStyleAttr(attr, replacements, config, plan);
    }
  }

  if (tag.name === 'meta' && isImageMeta(byName)) {
    rewriteUrlAttr(byName.get('content'), replacements, config, plan);
  }

  if (replacements.size === 0) return tag.openTag;
  return applyAttrReplacements(tag.openTag, replacements);
}

function rewriteUrlAttr(
  attr: AttrSpan | undefined,
  replacements: Map<AttrSpan, string>,
  config: NectarConfig,
  plan: ContentImageAssetPlan,
): void {
  if (!attr) return;
  const rewritten = rewriteImageUrl(attr.value, config, plan);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteSrcsetAttr(
  attr: AttrSpan,
  replacements: Map<AttrSpan, string>,
  config: NectarConfig,
  plan: ContentImageAssetPlan,
): void {
  const rewritten = rewriteSrcset(attr.value, config, plan);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteStyleAttr(
  attr: AttrSpan,
  replacements: Map<AttrSpan, string>,
  config: NectarConfig,
  plan: ContentImageAssetPlan,
): void {
  const rewritten = rewriteCssUrls(attr.value, config, plan);
  if (rewritten !== attr.value) replacements.set(attr, rewritten);
}

function rewriteSrcset(value: string, config: NectarConfig, plan: ContentImageAssetPlan): string {
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
      const next = rewriteImageUrl(url, config, plan);
      if (next === url) return candidate;
      touched = true;
      return `${leading}${next}${descriptor ? ` ${descriptor}` : ''}${trailing}`;
    })
    .join(',');
  return touched ? rewritten : value;
}

function rewriteCssUrls(value: string, config: NectarConfig, plan: ContentImageAssetPlan): string {
  return value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi, (match, d, s, raw) => {
    const url = (d ?? s ?? raw ?? '').trim();
    const rewritten = rewriteImageUrl(url, config, plan);
    if (rewritten === url) return match;
    if (d !== undefined) return `url("${rewritten}")`;
    if (s !== undefined) return `url('${rewritten}')`;
    return `url(${rewritten})`;
  });
}

function rewriteImageUrl(raw: string, config: NectarConfig, plan: ContentImageAssetPlan): string {
  const decoded = decodeHtmlAttr(raw).trim();
  if (!decoded || decoded.startsWith('//')) return raw;
  if (/^(data|blob|mailto|tel):/i.test(decoded)) return raw;

  const rootRelative = stripSiteOrigin(decoded, config) ?? decoded;
  const matched = matchContentImageUrl(rootRelative, config);
  if (!matched) return raw;

  const rawRel = matched.rel;
  const rel = safeDecodeURIComponent(rawRel);
  const entry = plan.byRel.get(rel) ?? plan.byRel.get(rawRel);
  if (!entry) return raw;

  const next = `${matched.prefix}/${entry.outputRel}${matched.suffix}`;
  if (rootRelative === decoded) return next;
  return `${siteOrigin(config)}${next}`;
}

function matchContentImageUrl(
  value: string,
  config: NectarConfig,
): { prefix: string; rel: string; suffix: string } | undefined {
  const basePath = normalizeBasePath(config.build.base_path);
  const prefixes = basePath === '/' ? [''] : [basePath.slice(0, -1), ''];
  for (const prefix of prefixes) {
    const marker = `${prefix}/content/images/`;
    if (!value.startsWith(marker)) continue;
    const rest = value.slice(marker.length);
    const suffixStart = rest.search(/[?#]/);
    const rel = suffixStart === -1 ? rest : rest.slice(0, suffixStart);
    const suffix = suffixStart === -1 ? '' : rest.slice(suffixStart);
    return { prefix, rel, suffix };
  }
  return undefined;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/';
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function stripSiteOrigin(value: string, config: NectarConfig): string | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== siteOrigin(config)) return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

function siteOrigin(config: NectarConfig): string {
  try {
    return new URL(config.site.url).origin;
  } catch {
    return '';
  }
}

function isImageMeta(attrs: Map<string, AttrSpan>): boolean {
  const key = (attrs.get('property')?.value ?? attrs.get('name')?.value ?? '').toLowerCase();
  return IMAGE_META_NAMES.has(key);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
    const end = findTagEnd(html, start + 1);
    if (end === -1) break;
    const openTag = html.slice(start, end + 1);
    const name = openTag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/)?.[1]?.toLowerCase();
    if (name && !openTag.startsWith('</')) {
      out.push({ name, start, end: end + 1, openTag });
    }
    i = end + 1;
  }
  return out;
}

function findTagEnd(html: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

function scanAttrs(tag: string): AttrSpan[] {
  const out: AttrSpan[] = [];
  ATTR_RE.lastIndex = 0;
  for (const match of tag.matchAll(ATTR_RE)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const rawValue = match[2];
    if (rawValue === undefined || match.index === undefined) continue;
    const quote = rawValue.startsWith('"') ? '"' : rawValue.startsWith("'") ? "'" : undefined;
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    const valueStart = match.index + match[0].lastIndexOf(rawValue) + (quote ? 1 : 0);
    const valueEnd = valueStart + value.length;
    out.push({ name, value, valueStart, valueEnd, quote });
  }
  return out;
}

function applyAttrReplacements(tag: string, replacements: Map<AttrSpan, string>): string {
  const spans = [...replacements.entries()].sort((a, b) => a[0].valueStart - b[0].valueStart);
  let out = '';
  let cursor = 0;
  for (const [attr, value] of spans) {
    out += tag.slice(cursor, attr.valueStart);
    out += escapeAttr(value, attr.quote);
    cursor = attr.valueEnd;
  }
  out += tag.slice(cursor);
  return out;
}

function escapeAttr(value: string, quote: '"' | "'" | undefined): string {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (quote === "'") out = out.replace(/'/g, '&#39;');
  else out = out.replace(/"/g, '&quot;');
  return out;
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
