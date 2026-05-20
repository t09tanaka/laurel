import renderHtml from 'dom-serializer';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import sanitizeHtml, { type IOptions } from 'sanitize-html';
import { stripGhostUrlPlaceholder } from '~/ghost/url-placeholder.ts';
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
  // BCP-47 locale used to segment word_count and pick the reading_time rule.
  // CJK scripts have no ASCII whitespace between words, so a locale-aware
  // segmenter is the only way to get meaningful counts; ja/zh/ko also switch
  // reading_time from words-per-minute to characters-per-minute.
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
    'iframe',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['id', 'class', 'lang', 'dir', 'title'],
    a: ['href', 'name', 'target', 'rel', 'hreflang'],
    iframe: [
      'src',
      'width',
      'height',
      'allow',
      'allowfullscreen',
      'frameborder',
      'title',
      'loading',
      'referrerpolicy',
    ],
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    source: ['src', 'srcset', 'type', 'media', 'sizes'],
    video: [
      'src',
      'poster',
      'controls',
      'preload',
      'width',
      'height',
      'muted',
      'loop',
      'playsinline',
    ],
    audio: ['src', 'controls', 'preload', 'loop'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    div: ['style', 'data-rating'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedStyles: {
    div: {
      '--aspect-ratio': [/^\d+(?:\.\d+)?$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
    source: ['http', 'https'],
    video: ['http', 'https'],
    audio: ['http', 'https'],
    iframe: ['https'],
  },
  allowedIframeHostnames: [
    'www.youtube.com',
    'www.youtube-nocookie.com',
    'player.vimeo.com',
    'open.spotify.com',
  ],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
};

export function sanitizeRenderedHtml(html: string): string {
  return sanitizeHtml(html, sanitizeOptions);
}

// Ghost stores `feature_image_caption` as inline HTML and most upstream Ghost
// themes (Source, Casper, etc.) render it through Handlebars triple-stash
// `{{{feature_image_caption}}}`. A contributor PR that adds
// `feature_image_caption: "<script>…</script>"` would ship persistent XSS to
// every reader. Sanitise at load time so the stored value is safe regardless of
// whether the active theme escapes it or not. Restrict to the small set of
// inline tags Ghost's Koenig editor actually emits for captions — block-level
// or media tags here would be a layout bug anyway.
const captionSanitizeOptions: IOptions = {
  allowedTags: ['a', 'em', 'strong', 'b', 'i', 'code', 'br', 'sup', 'sub', 'span'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    '*': ['class', 'lang', 'dir'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

export function sanitizeInlineCaptionHtml(html: string): string {
  return sanitizeHtml(html, captionSanitizeOptions);
}

export async function renderMarkdown(
  body: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderedMarkdown> {
  const expanded = expandKoenigShortcodes(stripGhostUrlPlaceholder(body));
  const raw = await marked.parse(expanded);
  const promoted = promoteImagesToFigures(raw);
  const newsletterStripped = stripEmailCtaCards(promoted);
  const sanitized = options.unsafe ? newsletterStripped : sanitizeRenderedHtml(newsletterStripped);
  const html = enforceKoenigCardSpacingContract(sanitized);
  const plaintext = htmlToPlaintext(html);
  const word_count = countWords(plaintext, options.locale);
  const reading_time = computeReadingTime(plaintext, options.locale, word_count);
  return { html, plaintext, word_count, reading_time };
}

export function enforceKoenigCardSpacingContract(html: string): string {
  if (!html.includes('kg-card')) return html;

  const doc = parseDocument(html, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  });
  const strippedIds = stripIdsFromKoenigCards(doc.children);
  const unwrapped = unwrapTopLevelKoenigCardWrappers(doc.children);
  if (!strippedIds && !unwrapped.changed) return html;
  doc.children = unwrapped.nodes;
  relinkSiblings(doc.children);
  return renderHtml(doc.children, { decodeEntities: false });
}

function stripIdsFromKoenigCards(nodes: ChildNode[]): boolean {
  let changed = false;
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (hasClass(node, 'kg-card')) {
      if (node.attribs.id !== undefined) {
        const { id: _id, ...attribs } = node.attribs;
        node.attribs = attribs;
        changed = true;
      }
    }
    changed = stripIdsFromKoenigCards(node.children) || changed;
  }
  return changed;
}

function unwrapTopLevelKoenigCardWrappers(nodes: ChildNode[]): {
  nodes: ChildNode[];
  changed: boolean;
} {
  let changed = false;
  const next = nodes.map((node) => {
    const card = topLevelSoleKoenigCard(node);
    if (!card || card === node) return node;
    card.parent = node.parent;
    changed = true;
    return card;
  });
  return { nodes: next, changed };
}

function topLevelSoleKoenigCard(node: ChildNode): Element | null {
  if (!isElement(node)) return null;
  if (hasClass(node, 'kg-card')) return node;

  const significant = node.children.filter((child) => !isBlankTextOrComment(child));
  if (significant.length !== 1) return null;

  const only = significant[0];
  return only && isElement(only) ? topLevelSoleKoenigCard(only) : null;
}

function isElement(node: ChildNode): node is Element {
  return 'attribs' in node && 'children' in node;
}

function hasClass(node: Element, className: string): boolean {
  return (node.attribs.class ?? '').split(/\s+/).includes(className);
}

function isBlankTextOrComment(node: ChildNode): boolean {
  if ('data' in node) return node.data.trim() === '';
  return false;
}

function relinkSiblings(nodes: ChildNode[]): void {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    node.prev = nodes[i - 1] ?? null;
    node.next = nodes[i + 1] ?? null;
  }
}

// Ghost's editor emits three newsletter-related card wrappers that need
// different web-build treatment:
//   - `kg-email-cta-card`: email-only CTA. The same content is rendered into
//     the newsletter email but should never reach the web (Ghost hides it
//     server-side; in a static build we strip at render time so anonymous web
//     readers never see "Get this in your inbox" duplicated below every post).
//   - `kg-signup-card`: portal signup widget. Already passes through sanitize-
//     html (see tests/content/cards.test.ts); the theme (or an optional portal
//     adapter) hydrates the form scaffold. No post-process needed here.
//   - `kg-paywall-card`: Koenig's drag-in paywall marker. The loader's paywall
//     pass (`src/content/paywall.ts`) already cuts on the `<!--kg-card-begin:
//     paywall-->` comment Ghost emits alongside this div, so we leave the div
//     alone here and let sanitize-html preserve the class hook for themes that
//     want to style the boundary.
// Strip is implemented via a balanced `<div>` walker rather than a regex so a
// nested `<div>` inside the CTA card (e.g. a `<div class="kg-button-card">`)
// doesn't terminate the match prematurely.
const EMAIL_CTA_OPEN_RE = /<div\b[^>]*\bclass\s*=\s*"([^"]*\bkg-email-cta-card\b[^"]*)"[^>]*>/gi;

export function stripEmailCtaCards(html: string): string {
  if (!html.includes('kg-email-cta-card')) return html;
  let out = '';
  let cursor = 0;
  EMAIL_CTA_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = EMAIL_CTA_OPEN_RE.exec(html);
  while (match !== null) {
    out += html.slice(cursor, match.index);
    const close = findMatchingDivClose(html, match.index + match[0].length);
    if (close < 0) {
      // Unbalanced markup — bail out and leave the rest verbatim rather than
      // truncate the body. sanitize-html will close the div safely.
      out += html.slice(match.index);
      return out;
    }
    cursor = close;
    EMAIL_CTA_OPEN_RE.lastIndex = close;
    match = EMAIL_CTA_OPEN_RE.exec(html);
  }
  out += html.slice(cursor);
  return out;
}

const DIV_TAG_RE = /<\/?div\b[^>]*>/gi;

function findMatchingDivClose(html: string, from: number): number {
  DIV_TAG_RE.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null = DIV_TAG_RE.exec(html);
  while (m !== null) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth += 1;
    }
    m = DIV_TAG_RE.exec(html);
  }
  return -1;
}

// `nectar import-ghost` round-trips Ghost's Koenig cards through Turndown by
// emitting self-describing shortcodes (see `src/ghost/turndown-rules.ts`).
// Without an expansion step here, the shortcode survives as literal text in
// the rendered HTML, the theme's `kg-bookmark-card` CSS never matches, and the
// reader sees a meaningless `{{< bookmark ... />}}` paragraph instead of the
// rich card. Expand bookmark / callout / button shortcodes back into the
// HTML structure Ghost's themes (Source, Casper, etc.) target.
const BOOKMARK_SHORTCODE_RE =
  /\{\{<\s+bookmark((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;
const LIQUID_BOOKMARK_SHORTCODE_RE =
  /\{%\s+bookmark((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}/g;

// Inline `{{< embed url="…" provider="…" />}}`. The import pipeline emits this
// for Ghost `kg-embed-card` figures so renderMarkdown can rebuild the static
// iframe providers that do not require per-post script injection.
const EMBED_SHORTCODE_RE = /\{\{<\s+embed((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

const FIGURE_SHORTCODE_RE = /\{\{<\s+figure((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

// Block-form shortcode: `{{< toggle heading="…" >}}body markdown{{< /toggle >}}`.
// The body is non-greedy so consecutive toggles in the same document each get
// their own match, and `[\s\S]` lets the body span line breaks.
const TOGGLE_SHORTCODE_RE =
  /\{\{<\s+toggle((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/toggle\s*>\}\}/g;

// Block-form `{{< callout emoji="💡" color="blue" >}}body markdown{{< /callout >}}`.
// Ghost themes (Casper, Source) target `kg-callout-card` + an optional
// `kg-callout-card-{color}` modifier and an inner `.kg-callout-emoji` /
// `.kg-callout-text` split.
const CALLOUT_SHORTCODE_RE =
  /\{\{<\s+callout((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/callout\s*>\}\}/g;

// Block-form `{{< button href="…" align="center" style="accent" >}}Label{{< /button >}}`.
// Themes target `kg-button-card` with optional `kg-align-{align}` on the card
// and `kg-btn-{style}` on the anchor itself.
const BUTTON_SHORTCODE_RE =
  /\{\{<\s+button((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/button\s*>\}\}/g;
const BUTTON_STATEMENT_RE = /\{%\s+button((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}/g;

// Block-form `{{< gallery caption="…" >}}{{< gallery-row >}}{{< gallery-image src=… />}}…{{< /gallery-row >}}…{{< /gallery >}}`.
// We unwrap the gallery to a single `kg-gallery-card` figure containing one
// `.kg-gallery-row` per row and `.kg-gallery-image` wrappers around each
// `<img>`, matching Casper / Source's gallery layout CSS exactly. The caption
// becomes a `<figcaption>` outside the container, as Ghost emits.
const GALLERY_SHORTCODE_RE =
  /\{\{<\s+gallery((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/gallery\s*>\}\}/g;
const GALLERY_ROW_RE =
  /\{\{<\s+gallery-row((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/gallery-row\s*>\}\}/g;
const GALLERY_IMAGE_RE =
  /\{\{<\s+gallery-image((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

const FILE_SHORTCODE_RE = /\{\{<\s+file((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

const AUDIO_SHORTCODE_RE = /\{\{<\s+audio((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

const VIDEO_SHORTCODE_RE =
  /\{\{<\s+video((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/video\s*>\}\}/g;
const VIDEO_SELF_CLOSING_SHORTCODE_RE =
  /\{\{<\s+video((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;
const VIDEO_TRACK_SHORTCODE_RE =
  /\{\{<\s+video-track((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

const PRODUCT_SHORTCODE_RE = /\{\{<\s+product((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

export function expandKoenigShortcodes(markdown: string): string {
  return markdown
    .replace(BOOKMARK_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderBookmarkHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(LIQUID_BOOKMARK_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderBookmarkHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(EMBED_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderEmbedHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(FIGURE_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderFigureHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(TOGGLE_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderToggleHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(CALLOUT_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderCalloutHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(BUTTON_STATEMENT_RE, (_match, attrsStr: string) => {
      const attrs = parseShortcodeAttrs(attrsStr);
      return renderButtonHtml(attrs, attrs.text ?? '');
    })
    .replace(BUTTON_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderButtonHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(GALLERY_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderGalleryHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(FILE_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderFileHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(AUDIO_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderAudioHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(VIDEO_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderVideoHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(VIDEO_SELF_CLOSING_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderVideoHtml(parseShortcodeAttrs(attrsStr), ''),
    )
    .replace(PRODUCT_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderProductHtml(parseShortcodeAttrs(attrsStr)),
    );
}

const ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;

function parseShortcodeAttrs(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null = ATTR_RE.exec(attrsStr);
  while (match !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      attrs[key] = unescapeShortcodeAttr(value);
    }
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

function hasCaptionClass(caption: string): string {
  return caption ? ' kg-card-hascaption' : '';
}

const KOENIG_WIDTHS = new Set(['regular', 'wide', 'full']);

function koenigWidthClass(attrs: Record<string, string>): string {
  return ` kg-width-${koenigWidth(attrs)}`;
}

function koenigWidth(attrs: Record<string, string>): string {
  return (
    normalizeKoenigWidth(attrs.width) ??
    normalizeKoenigWidth(attrs.size) ??
    normalizeKoenigWidth(attrs.cardWidth) ??
    'regular'
  );
}

function normalizeKoenigWidth(raw: string | undefined): string | null {
  const normalized = (raw ?? '').trim().replace(/^kg-width-/, '');
  return KOENIG_WIDTHS.has(normalized) ? normalized : null;
}

function mediaWidthAttr(attrs: Record<string, string>): string {
  const width = attrs.width;
  return width && !normalizeKoenigWidth(width) ? `width="${escapeHtmlAttr(width)}"` : '';
}

function mediaWidthValue(attrs: Record<string, string>, fallback: string): string {
  const width = attrs.width;
  return width && !normalizeKoenigWidth(width) ? width : fallback;
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

  return `\n\n<figure class="kg-card kg-bookmark-card${koenigWidthClass(attrs)}${hasCaptionClass(caption)}">${anchor}${figcaption}</figure>\n\n`;
}

function renderFigureHtml(attrs: Record<string, string>): string {
  const src = attrs.src ?? '';
  if (!src) return '';
  const caption = attrs.caption ?? '';
  const imgAttrs = [
    'class="kg-image"',
    `src="${escapeHtmlAttr(src)}"`,
    `alt="${escapeHtmlAttr(attrs.alt ?? '')}"`,
    mediaWidthAttr(attrs),
    attrs.height ? `height="${escapeHtmlAttr(attrs.height)}"` : '',
    attrs.srcset ? `srcset="${escapeHtmlAttr(attrs.srcset)}"` : '',
    attrs.sizes ? `sizes="${escapeHtmlAttr(attrs.sizes)}"` : '',
  ]
    .filter((s) => s !== '')
    .join(' ');
  const image = `<img ${imgAttrs} />`;
  const inner = attrs.href ? `<a href="${escapeHtmlAttr(attrs.href)}">${image}</a>` : image;
  const figcaption = caption ? `<figcaption>${escapeHtmlAttr(caption)}</figcaption>` : '';
  return `\n\n<figure class="kg-card kg-image-card${koenigWidthClass(attrs)}${hasCaptionClass(caption)}">${inner}${figcaption}</figure>\n\n`;
}

type StaticEmbed = {
  src: string;
  title: string;
  width: string;
  height: string;
  allow: string;
};

function renderEmbedHtml(attrs: Record<string, string>): string {
  const url = attrs.url ?? '';
  if (!url) return '';

  const embed = staticEmbedFromUrl(url, attrs.provider);
  const caption = attrs.caption ?? '';
  const figcaption = caption ? `<figcaption>${escapeHtmlAttr(caption)}</figcaption>` : '';
  const cardClass = `kg-card kg-embed-card${koenigWidthClass(attrs)}${hasCaptionClass(caption)}`;
  if (!embed) {
    return `\n\n<figure class="${cardClass}"><a href="${escapeHtmlAttr(url)}">${escapeHtmlAttr(url)}</a>${figcaption}</figure>\n\n`;
  }

  const title = attrs.title || embed.title;
  const width = mediaWidthValue(attrs, embed.width);
  const height = attrs.height || embed.height;
  const iframe = `<iframe src="${escapeHtmlAttr(embed.src)}" title="${escapeHtmlAttr(title)}" width="${escapeHtmlAttr(width)}" height="${escapeHtmlAttr(height)}" loading="lazy" frameborder="0" allow="${escapeHtmlAttr(embed.allow)}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return `\n\n<figure class="${cardClass}">${iframe}${figcaption}</figure>\n\n`;
}

function staticEmbedFromUrl(rawUrl: string, providerHint: string | undefined): StaticEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const provider = normalizeEmbedProvider(providerHint) || providerFromUrl(url);
  switch (provider) {
    case 'youtube':
      return youtubeEmbed(url);
    case 'vimeo':
      return vimeoEmbed(url);
    case 'spotify':
      return spotifyEmbed(url);
    default:
      return null;
  }
}

function normalizeEmbedProvider(provider: string | undefined): string {
  return (provider ?? '').trim().toLowerCase();
}

function providerFromUrl(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || host.endsWith('.youtube.com') || host === 'youtube.com') {
    return 'youtube';
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
  if (host === 'open.spotify.com') return 'spotify';
  return '';
}

function youtubeEmbed(url: URL): StaticEmbed | null {
  const id = youtubeVideoId(url);
  if (!id) return null;
  const start = youtubeStartSeconds(url.searchParams.get('start') || url.searchParams.get('t'));
  const src = new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`);
  if (start > 0) src.searchParams.set('start', String(start));
  return {
    src: src.toString(),
    title: 'YouTube video',
    width: '560',
    height: '315',
    allow:
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  };
}

function youtubeVideoId(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be')
    return safeEmbedPathToken(url.pathname.split('/').filter(Boolean)[0] ?? '');
  if (url.pathname.startsWith('/embed/')) {
    return safeEmbedPathToken(url.pathname.split('/').filter(Boolean)[1] ?? '');
  }
  if (url.pathname.startsWith('/shorts/')) {
    return safeEmbedPathToken(url.pathname.split('/').filter(Boolean)[1] ?? '');
  }
  return safeEmbedPathToken(url.searchParams.get('v') ?? '');
}

function youtubeStartSeconds(value: string | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function vimeoEmbed(url: URL): StaticEmbed | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[0] === 'video' ? parts[1] : parts[0];
  const safeId = safeEmbedPathToken(id ?? '');
  if (!safeId) return null;
  return {
    src: `https://player.vimeo.com/video/${encodeURIComponent(safeId)}`,
    title: 'Vimeo video',
    width: '640',
    height: '360',
    allow: 'autoplay; fullscreen; picture-in-picture; clipboard-write',
  };
}

function spotifyEmbed(url: URL): StaticEmbed | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const embedIndex = parts[0] === 'embed' ? 1 : 0;
  const type = safeEmbedPathToken(parts[embedIndex] ?? '');
  const id = safeEmbedPathToken(parts[embedIndex + 1] ?? '');
  if (!type || !id) return null;
  const src = new URL(`https://open.spotify.com/embed/${type}/${id}`);
  const theme = url.searchParams.get('theme');
  if (theme === '0' || theme === '1') src.searchParams.set('theme', theme);
  return {
    src: src.toString(),
    title: 'Spotify embed',
    width: '100%',
    height: type === 'track' || type === 'episode' ? '152' : '352',
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
  };
}

function safeEmbedPathToken(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

// Render a Koenig toggle card as a native <details>/<summary> pair. Ghost's
// editor produces a `<div class="kg-toggle-card">` that relies on a separate
// `kg-toggle.js` to flip `data-kg-toggle-state` on click — we don't bundle
// that script, so the card would render permanently collapsed with no way to
// expand. `<details>` is the browser-native equivalent and needs no JS while
// keeping the same Koenig class hooks so Ghost themes' existing CSS still
// applies. The blank lines around `body` keep CommonMark parsing the inner
// markdown as block content rather than as raw HTML.
function renderToggleHtml(attrs: Record<string, string>, body: string): string {
  const heading = attrs.heading ?? '';
  const headingHtml = heading
    ? `<h4 class="kg-toggle-heading-text">${escapeHtmlAttr(heading)}</h4>`
    : '';
  const summary = `<summary class="kg-toggle-heading">${headingHtml}</summary>`;
  const innerMarkdown = body.trim();
  const contentBlock = `<div class="kg-toggle-content">\n\n${innerMarkdown}\n\n</div>`;
  return `\n\n<details class="kg-card kg-toggle-card${koenigWidthClass(attrs)}">\n${summary}\n${contentBlock}\n</details>\n\n`;
}

// Restrict callout color tokens to the kebab-case set Ghost ships so attacker-
// controlled frontmatter cannot inject arbitrary class names (e.g.
// `color="foo onclick=alert"` -> `kg-callout-card-foo onclick=alert`). Anything
// outside the alphabet is silently dropped.
const KOENIG_TOKEN_RE = /^[a-z][a-z0-9-]*$/;

function renderCalloutHtml(attrs: Record<string, string>, body: string): string {
  const emoji = attrs.emoji ?? '';
  const color = attrs.color ?? '';
  const colorClass = KOENIG_TOKEN_RE.test(color) ? ` kg-callout-card-${color}` : '';
  const emojiHtml = emoji ? `<div class="kg-callout-emoji">${escapeHtmlAttr(emoji)}</div>` : '';
  const innerMarkdown = body.trim();
  const textHtml = `<div class="kg-callout-text">\n\n${innerMarkdown}\n\n</div>`;
  return `\n\n<div class="kg-card kg-callout-card${koenigWidthClass(attrs)}${colorClass}">\n${emojiHtml}\n${textHtml}\n</div>\n\n`;
}

function renderButtonHtml(attrs: Record<string, string>, body: string): string {
  const href = attrs.href ?? '';
  if (!href) return '';
  const align = attrs.align ?? '';
  const style = attrs.style ?? '';
  const alignClass = KOENIG_TOKEN_RE.test(align) ? ` kg-align-${align}` : '';
  const styleClass = KOENIG_TOKEN_RE.test(style) ? ` kg-btn-${style}` : 'kg-btn-accent';
  const label = (attrs.text ?? body).trim();
  // Ghost's button card uses an explicit double-class on the anchor: `kg-btn`
  // (layout / hover) + `kg-btn-{style}` (color). When style is missing the
  // theme defaults to the accent variant, so keep that fallback inline.
  const finalStyle = styleClass.trim() ? styleClass : 'kg-btn-accent';
  return `\n\n<div class="kg-card kg-button-card${koenigWidthClass(attrs)}${alignClass}"><a href="${escapeHtmlAttr(href)}" class="kg-btn ${finalStyle.trim()}">${escapeHtmlAttr(label)}</a></div>\n\n`;
}

function renderGalleryHtml(attrs: Record<string, string>, body: string): string {
  const caption = attrs.caption ?? '';
  const rows: string[] = [];
  let rowMatch: RegExpExecArray | null;
  const rowRe = new RegExp(GALLERY_ROW_RE.source, GALLERY_ROW_RE.flags);
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((rowMatch = rowRe.exec(body)) !== null) {
    const rowBody = rowMatch[2] ?? '';
    const images: string[] = [];
    let imgMatch: RegExpExecArray | null;
    const imgRe = new RegExp(GALLERY_IMAGE_RE.source, GALLERY_IMAGE_RE.flags);
    // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
    while ((imgMatch = imgRe.exec(rowBody)) !== null) {
      const ia = parseShortcodeAttrs(imgMatch[1] ?? '');
      if (!ia.src) continue;
      const widthAttr = ia.width ? ` width="${escapeHtmlAttr(ia.width)}"` : '';
      const heightAttr = ia.height ? ` height="${escapeHtmlAttr(ia.height)}"` : '';
      images.push(
        `<div class="kg-gallery-image"><img src="${escapeHtmlAttr(ia.src)}" alt="${escapeHtmlAttr(ia.alt ?? '')}"${widthAttr}${heightAttr} loading="lazy" /></div>`,
      );
    }
    if (images.length > 0) {
      rows.push(`<div class="kg-gallery-row">${images.join('')}</div>`);
    }
  }
  if (rows.length === 0) return '';
  const container = `<div class="kg-gallery-container">${rows.join('')}</div>`;
  const figcaption = caption ? `<figcaption>${escapeHtmlAttr(caption)}</figcaption>` : '';
  return `\n\n<figure class="kg-card kg-gallery-card${koenigWidthClass(attrs)}${hasCaptionClass(caption)}">${container}${figcaption}</figure>\n\n`;
}

function renderFileHtml(attrs: Record<string, string>): string {
  const src = attrs.href ?? attrs.src ?? '';
  if (!src) return '';
  const titleHtml = attrs.title
    ? `<div class="kg-file-card-title">${escapeHtmlAttr(attrs.title)}</div>`
    : '';
  const description = attrs.description ?? attrs.caption ?? '';
  const captionHtml = description
    ? `<div class="kg-file-card-caption">${escapeHtmlAttr(description)}</div>`
    : '';
  const filenameHtml = attrs.name
    ? `<div class="kg-file-card-filename">${escapeHtmlAttr(attrs.name)}</div>`
    : '';
  const filesizeHtml = attrs.size
    ? `<div class="kg-file-card-filesize">${escapeHtmlAttr(attrs.size)}</div>`
    : '';
  return `\n\n<div class="kg-card kg-file-card${koenigWidthClass(attrs)}"><a class="kg-file-card-container" href="${escapeHtmlAttr(src)}">${titleHtml}${captionHtml}${filenameHtml}${filesizeHtml}</a></div>\n\n`;
}

function renderAudioHtml(attrs: Record<string, string>): string {
  const src = attrs.src ?? '';
  if (!src) return '';
  const thumbnailHtml = attrs.thumbnail
    ? `<img src="${escapeHtmlAttr(attrs.thumbnail)}" alt="" class="kg-audio-thumbnail" />`
    : '';
  const titleHtml = attrs.title
    ? `<div class="kg-audio-title">${escapeHtmlAttr(attrs.title)}</div>`
    : '';
  const durationHtml = attrs.duration
    ? `<div class="kg-audio-duration">${escapeHtmlAttr(attrs.duration)}</div>`
    : '';
  return `\n\n<div class="kg-card kg-audio-card${koenigWidthClass(attrs)}">${thumbnailHtml}<audio src="${escapeHtmlAttr(src)}" preload="metadata" controls></audio>${titleHtml}${durationHtml}</div>\n\n`;
}

function renderVideoHtml(attrs: Record<string, string>, body: string): string {
  const src = attrs.src ?? '';
  if (!src) return '';
  const videoAttrs = [
    `src="${escapeHtmlAttr(src)}"`,
    attrs.poster ? `poster="${escapeHtmlAttr(attrs.poster)}"` : '',
    mediaWidthAttr(attrs),
    attrs.height ? `height="${escapeHtmlAttr(attrs.height)}"` : '',
    attrs.preload ? `preload="${escapeHtmlAttr(attrs.preload)}"` : '',
    truthyShortcodeAttr(attrs.controls) ? 'controls' : '',
    truthyShortcodeAttr(attrs.loop) ? 'loop' : '',
    truthyShortcodeAttr(attrs.muted) ? 'muted' : '',
    truthyShortcodeAttr(attrs.playsinline) ? 'playsinline' : '',
  ]
    .filter((s) => s !== '')
    .join(' ');
  const tracks = renderVideoTracksHtml(body);
  const aspectStyle =
    attrs.aspect && /^\d+(?:\.\d+)?$/.test(attrs.aspect)
      ? ` style="--aspect-ratio: ${escapeHtmlAttr(attrs.aspect)}"`
      : '';
  const figcaption = attrs.caption
    ? `<figcaption>${escapeHtmlAttr(attrs.caption)}</figcaption>`
    : '';
  return `\n\n<figure class="kg-card kg-video-card${koenigWidthClass(attrs)}${hasCaptionClass(attrs.caption ?? '')}"><div class="kg-video-container"${aspectStyle}><video ${videoAttrs}>${tracks}</video></div>${figcaption}</figure>\n\n`;
}

function renderVideoTracksHtml(body: string): string {
  const tracks: string[] = [];
  let match: RegExpExecArray | null;
  const trackRe = new RegExp(VIDEO_TRACK_SHORTCODE_RE.source, VIDEO_TRACK_SHORTCODE_RE.flags);
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = trackRe.exec(body)) !== null) {
    const attrs = parseShortcodeAttrs(match[1] ?? '');
    if (!attrs.src) continue;
    const trackAttrs = [
      `src="${escapeHtmlAttr(attrs.src)}"`,
      attrs.kind ? `kind="${escapeHtmlAttr(attrs.kind)}"` : '',
      attrs.srclang ? `srclang="${escapeHtmlAttr(attrs.srclang)}"` : '',
      attrs.label ? `label="${escapeHtmlAttr(attrs.label)}"` : '',
      truthyShortcodeAttr(attrs.default) ? 'default' : '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    tracks.push(`<track ${trackAttrs} />`);
  }
  return tracks.join('');
}

function renderProductHtml(attrs: Record<string, string>): string {
  const title = attrs.title ?? '';
  const description = attrs.description ?? '';
  const image = attrs.image ?? '';
  const buttonHref = attrs['button-href'] ?? '';
  const buttonText = attrs['button-text'] ?? '';
  if (!title && !description && !image && !buttonHref) return '';
  const imageHtml = image
    ? `<img class="kg-product-card-image" src="${escapeHtmlAttr(image)}" alt="" />`
    : '';
  const titleHtml = title
    ? `<div class="kg-product-card-title">${escapeHtmlAttr(title)}</div>`
    : '';
  const descriptionHtml = description
    ? `<div class="kg-product-card-description">${escapeHtmlAttr(description)}</div>`
    : '';
  const ratingHtml =
    attrs.rating && /^\d+(?:\.\d+)?$/.test(attrs.rating)
      ? `<div class="kg-product-card-rating" data-rating="${escapeHtmlAttr(attrs.rating)}"></div>`
      : '';
  const buttonHtml =
    buttonHref && buttonText
      ? `<a class="kg-product-card-button kg-product-card-btn-accent" href="${escapeHtmlAttr(buttonHref)}">${escapeHtmlAttr(buttonText)}</a>`
      : '';
  return `\n\n<div class="kg-card kg-product-card${koenigWidthClass(attrs)}"><div class="kg-product-card-container">${imageHtml}${titleHtml}${descriptionHtml}${ratingHtml}${buttonHtml}</div></div>\n\n`;
}

function truthyShortcodeAttr(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === '';
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

// Ghost's 275 wpm rate is calibrated for whitespace-separated languages. For
// CJK scripts the meaningful unit is the character (kanji/kana/hanzi/hangul
// syllable), and typical silent reading speed is around 500 characters per
// minute. We pick the rule from the configured site locale so a single nectar
// build emits one consistent reading_time per locale.
const CJK_LANGS = new Set(['ja', 'zh', 'ko']);
const WORDS_PER_MINUTE = 275;
const CHARS_PER_MINUTE = 500;

function isCjkLocale(locale: string | undefined): boolean {
  if (!locale) return false;
  const lang = locale.split(/[-_]/, 1)[0]?.toLowerCase() ?? '';
  return CJK_LANGS.has(lang);
}

function countReadingChars(text: string, locale: string | undefined): number {
  if (!text) return 0;
  const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
  let count = 0;
  for (const seg of segmenter.segment(text)) {
    if (/^\s+$/.test(seg.segment)) continue;
    count += 1;
  }
  return count;
}

function computeReadingTime(
  plaintext: string,
  locale: string | undefined,
  wordCount: number,
): number {
  if (isCjkLocale(locale)) {
    const chars = countReadingChars(plaintext, locale);
    return Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  }
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
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
