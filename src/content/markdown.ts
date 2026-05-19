import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import sanitizeHtml, { type IOptions } from 'sanitize-html';
import { promoteImagesToFigures } from './figure-images.ts';

const marked = new Marked({ gfm: true, breaks: false });
marked.use(gfmHeadingId());

export interface RenderedMarkdown {
  html: string;
  plaintext: string;
  word_count: number;
  reading_time: number;
}

export interface RenderMarkdownOptions {
  // When true, raw HTML in the markdown is passed through verbatim. Only enable
  // for fully trusted authors — raw <script>, event handlers, or javascript:
  // URLs would otherwise reach readers as stored XSS.
  unsafe?: boolean;
  // BCP-47 locale used to segment word_count. CJK scripts have no ASCII
  // whitespace between words, so a locale-aware segmenter is the only way to
  // get meaningful counts.
  locale?: string;
}

const sanitizeOptions: IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'figure',
    'figcaption',
    'picture',
    'source',
    'video',
    'audio',
    'track',
    'details',
    'summary',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['id', 'class', 'lang', 'dir', 'title'],
    a: ['href', 'name', 'target', 'rel', 'hreflang'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    source: ['src', 'srcset', 'type', 'media', 'sizes'],
    video: ['src', 'poster', 'controls', 'preload', 'width', 'height', 'muted', 'loop'],
    audio: ['src', 'controls', 'preload', 'loop'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
    source: ['http', 'https'],
    video: ['http', 'https'],
    audio: ['http', 'https'],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

export function sanitizeRenderedHtml(html: string): string {
  return sanitizeHtml(html, sanitizeOptions);
}

export async function renderMarkdown(
  body: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderedMarkdown> {
  const expanded = expandKoenigShortcodes(body);
  const raw = await marked.parse(expanded);
  const promoted = promoteImagesToFigures(raw);
  const html = options.unsafe ? promoted : sanitizeRenderedHtml(promoted);
  const plaintext = htmlToPlaintext(html);
  const word_count = countWords(plaintext, options.locale);
  const reading_time = Math.max(1, Math.round(word_count / 275));
  return { html, plaintext, word_count, reading_time };
}

// `nectar import-ghost` round-trips Ghost's Koenig cards through Turndown by
// emitting self-describing shortcodes (see `src/ghost/turndown-rules.ts`).
// Without an expansion step here, the shortcode survives as literal text in
// the rendered HTML, the theme's `kg-bookmark-card` CSS never matches, and the
// reader sees a meaningless `{{< bookmark ... />}}` paragraph instead of the
// rich card. Expand bookmark shortcodes back into the HTML structure Ghost's
// themes (Source, Casper, etc.) target.
const BOOKMARK_SHORTCODE_RE =
  /\{\{<\s+bookmark((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

export function expandKoenigShortcodes(markdown: string): string {
  return markdown.replace(BOOKMARK_SHORTCODE_RE, (_match, attrsStr: string) =>
    renderBookmarkHtml(parseShortcodeAttrs(attrsStr)),
  );
}

const ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;

function parseShortcodeAttrs(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null = ATTR_RE.exec(attrsStr);
  while (match !== null) {
    attrs[match[1]] = unescapeShortcodeAttr(match[2]);
    match = ATTR_RE.exec(attrsStr);
  }
  return attrs;
}

// Mirror of `escapeAttr` in turndown-rules.ts: `\\` → `\`, `\"` → `"`. The
// `\\(.)` form consumes both escapes left-to-right so `\\\"` (escaped backslash
// followed by escaped quote) decodes correctly to `\"`.
function unescapeShortcodeAttr(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBookmarkHtml(attrs: Record<string, string>): string {
  const url = attrs.url ?? '';
  if (!url) return '';

  const title = attrs.title ?? '';
  const description = attrs.description ?? '';
  const author = attrs.author ?? '';
  const publisher = attrs.publisher ?? '';
  const icon = attrs.icon ?? '';
  const thumbnail = attrs.thumbnail ?? '';
  const caption = attrs.caption ?? '';

  const titleHtml = title ? `<div class="kg-bookmark-title">${escapeHtmlAttr(title)}</div>` : '';
  const descHtml = description
    ? `<div class="kg-bookmark-description">${escapeHtmlAttr(description)}</div>`
    : '';

  const iconHtml = icon
    ? `<img class="kg-bookmark-icon" src="${escapeHtmlAttr(icon)}" alt="" />`
    : '';
  const authorHtml = author
    ? `<span class="kg-bookmark-author">${escapeHtmlAttr(author)}</span>`
    : '';
  const publisherHtml = publisher
    ? `<span class="kg-bookmark-publisher">${escapeHtmlAttr(publisher)}</span>`
    : '';
  const metadataInner = `${iconHtml}${authorHtml}${publisherHtml}`;
  const metadataHtml = metadataInner
    ? `<div class="kg-bookmark-metadata">${metadataInner}</div>`
    : '';

  const contentHtml = `<div class="kg-bookmark-content">${titleHtml}${descHtml}${metadataHtml}</div>`;
  const thumbnailHtml = thumbnail
    ? `<div class="kg-bookmark-thumbnail"><img src="${escapeHtmlAttr(thumbnail)}" alt="" /></div>`
    : '';

  const anchor = `<a class="kg-bookmark-container" href="${escapeHtmlAttr(url)}">${contentHtml}${thumbnailHtml}</a>`;
  const figcaption = caption ? `<figcaption>${escapeHtmlAttr(caption)}</figcaption>` : '';

  return `\n\n<figure class="kg-card kg-bookmark-card">${anchor}${figcaption}</figure>\n\n`;
}

function htmlToPlaintext(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Whitespace tokenisation returns 1 for an entire CJK essay because Japanese,
// Chinese, and Korean don't put spaces between words. Intl.Segmenter with
// granularity:'word' uses ICU's locale-aware word boundaries, so reading_time
// stays meaningful regardless of script.
function countWords(text: string, locale: string | undefined): number {
  if (!text) return 0;
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) count += 1;
  }
  return count;
}

// Take the first `words` word-like segments from `text` and return the
// original slice up to the end of that last word. Preserves natural spacing
// for Latin scripts and works for CJK where words run together without spaces.
export function truncateByWords(text: string, words: number, locale: string | undefined): string {
  if (!text || words <= 0) return '';
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  let count = 0;
  let end = 0;
  for (const seg of segmenter.segment(text)) {
    if (!seg.isWordLike) continue;
    count += 1;
    end = seg.index + seg.segment.length;
    if (count >= words) break;
  }
  return count === 0 ? '' : text.slice(0, end);
}
