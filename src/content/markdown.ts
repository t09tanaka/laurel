import renderHtml from 'dom-serializer';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import sanitizeHtml, { type IOptions } from 'sanitize-html';
import { codeToHtml } from 'shiki';
import { stripGhostUrlPlaceholder } from '~/ghost/url-placeholder.ts';
import { NectarError, suggestClosest } from '~/util/errors.ts';
import { promoteImagesToFigures } from './figure-images.ts';
import { GALLERY_IMAGE_SIZES } from './gallery-images.ts';

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
  // Extra images outside the HTML body. Ghost's reading_time helper counts
  // feature_image in addition to inline body images.
  additionalImages?: number;
  // When there is no feature_image, the first promoted in-body image is the
  // likely LCP candidate and should not inherit the below-the-fold lazy default.
  prioritizeFirstImage?: boolean;
}

export interface KoenigShortcodeDiagnostic {
  shortcode: string;
  expectedClose: string;
  line: number;
  col?: number;
}

export interface KoenigShortcodeValidationDiagnostic {
  shortcode: string;
  line: number;
  col: number;
  message: string;
  hint?: string;
}

const sanitizeOptions: IOptions = {
  nonBooleanAttributes: sanitizeHtml.defaults.nonBooleanAttributes.filter(
    (attribute) => attribute !== 'download',
  ),
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
    'form',
    'input',
    'button',
    'iframe',
    'svg',
    'path',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['id', 'class', 'lang', 'dir', 'title'],
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
    img: [
      'src',
      'srcset',
      'sizes',
      'alt',
      'title',
      'width',
      'height',
      'loading',
      'fetchpriority',
      'decoding',
    ],
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
    figure: ['class', 'data-nectar-embed-provider'],
    details: ['open'],
    pre: ['class', 'style', 'tabindex'],
    code: ['class', 'style'],
    span: ['class', 'style'],
    h2: ['style', 'data-text-color'],
    h3: ['style', 'data-text-color'],
    p: ['style', 'data-text-color'],
    form: ['class', 'data-members-form', 'data-nectar-subscribe', 'method'],
    input: [
      'class',
      'type',
      'name',
      'required',
      'placeholder',
      'value',
      'data-members-email',
      'data-members-name',
      'data-members-label',
    ],
    button: ['class', 'type', 'data-members-submit'],
    div: [
      'style',
      'data-rating',
      'data-kg-background-image',
      'data-background-color',
      'data-accent-color',
    ],
    a: [
      'href',
      'name',
      'target',
      'rel',
      'hreflang',
      'download',
      'style',
      'data-button-color',
      'data-button-text-color',
    ],
    svg: ['viewbox', 'aria-hidden', 'focusable'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedStyles: {
    pre: {
      color: [/^#[0-9a-f]{3,8}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i],
    },
    code: {
      color: [/^#[0-9a-f]{3,8}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i],
    },
    span: {
      color: [/^#[0-9a-f]{3,8}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i],
      'font-style': [/^italic$/],
      'font-weight': [/^(?:bold|[1-9]00)$/],
      'text-decoration': [/^underline$/],
    },
    div: {
      '--aspect-ratio': [/^\d+(?:\.\d+)?$/],
      'background-image': [/^url\((?:https?:\/\/|\/(?!\/))[^)]+\)$/],
      '--bg-image-position': [/^\d{1,3}% \d{1,3}%$/],
      '--bg-image-color': [/^#[0-9a-f]{3,8}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i],
      color: [/^#[0-9a-f]{3,8}$/i],
    },
    h2: {
      color: [/^#[0-9a-f]{3,8}$/i],
    },
    h3: {
      color: [/^#[0-9a-f]{3,8}$/i],
    },
    p: {
      color: [/^#[0-9a-f]{3,8}$/i],
    },
    a: {
      color: [/^#[0-9a-f]{3,8}$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i],
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

function renderInlineCaptionMarkdown(caption: string): string {
  const html = marked.parseInline(caption, { async: false }) as string;
  return sanitizeInlineCaptionHtml(html);
}

const HTML_CARD_FENCE_RE =
  /<!--\s*kg-card-begin:\s*html\s*-->([\s\S]*?)<!--\s*kg-card-end:\s*html\s*-->/g;

function expandHtmlCardFences(markdown: string): string {
  return markdown.replace(HTML_CARD_FENCE_RE, (_match, body: string) => {
    const inner = body.trim();
    return inner ? `\n\n<div class="kg-card kg-html-card">\n${inner}\n</div>\n\n` : '';
  });
}

export async function renderMarkdown(
  body: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderedMarkdown> {
  const stripped = stripGhostUrlPlaceholder(body);
  const shortcodeDiagnostic = findMalformedKoenigShortcode(stripped);
  if (shortcodeDiagnostic) {
    throw new NectarError({
      message: malformedKoenigShortcodeMessage(shortcodeDiagnostic),
      line: shortcodeDiagnostic.line,
      col: shortcodeDiagnostic.col,
      hint: 'Close the shortcode or remove the malformed card block.',
      code: 'content',
    });
  }
  const validationDiagnostic = findInvalidKoenigShortcode(stripped);
  if (validationDiagnostic) {
    throw new NectarError({
      message: invalidKoenigShortcodeMessage(validationDiagnostic),
      line: validationDiagnostic.line,
      col: validationDiagnostic.col,
      hint: validationDiagnostic.hint,
      code: 'content',
    });
  }
  const htmlFencesExpanded = expandHtmlCardFences(stripped);
  const expanded = expandKoenigShortcodes(htmlFencesExpanded);
  const raw = await marked.parse(expanded);
  const calloutsRestored = restoreKoenigCalloutDirectives(raw);
  const highlighted = await highlightCodeBlocks(calloutsRestored);
  const promoted = promoteImagesToFigures(highlighted, {
    prioritizeFirstImage: options.prioritizeFirstImage === true,
  });
  const newsletterStripped = stripEmailCtaCards(promoted);
  const membersFormNormalised = normaliseSignupCardMembersFormHooks(newsletterStripped);
  const sanitized = options.unsafe
    ? membersFormNormalised
    : sanitizeRenderedHtml(membersFormNormalised);
  const html = enforceKoenigCardSpacingContract(sanitized);
  const plaintext = htmlToPlaintext(html);
  const word_count = countWords(plaintext, options.locale);
  const reading_time = computeReadingTime(
    plaintext,
    options.locale,
    word_count,
    countImages(html) + safeImageCount(options.additionalImages),
  );
  return { html, plaintext, word_count, reading_time };
}

const CODE_HIGHLIGHT_THEME = 'github-dark';
const LANGUAGE_CLASS_RE = /\blanguage-([^\s]+)/;

async function highlightCodeBlocks(html: string): Promise<string> {
  if (!html.includes('<pre')) return html;

  const doc = parseDocument(html, {
    decodeEntities: true,
    lowerCaseAttributeNames: false,
  });
  const changed = await highlightCodeBlocksInNodes(doc.children);
  if (!changed) return html;
  return renderHtml(doc.children, { decodeEntities: false });
}

async function highlightCodeBlocksInNodes(nodes: ChildNode[]): Promise<boolean> {
  let changed = false;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    if (!isElement(node)) continue;

    const code = directCodeChild(node);
    if (code) {
      const highlighted = await renderHighlightedCodeBlock(
        codeTextContent(code),
        code.attribs.class,
      );
      if (highlighted) {
        highlighted.parent = node.parent;
        nodes[i] = highlighted;
        changed = true;
      }
      continue;
    }

    changed = (await highlightCodeBlocksInNodes(node.children)) || changed;
  }
  if (changed) relinkSiblings(nodes);
  return changed;
}

function directCodeChild(node: Element): Element | null {
  if (node.name !== 'pre') return null;
  const significant = node.children.filter((child) => !isBlankTextOrComment(child));
  if (significant.length !== 1) return null;
  const child = significant[0];
  return child && isElement(child) && child.name === 'code' ? child : null;
}

async function renderHighlightedCodeBlock(
  code: string,
  languageClass: string | undefined,
): Promise<Element | null> {
  const lang = languageClass?.match(LANGUAGE_CLASS_RE)?.[1] ?? 'plaintext';
  const highlighted = await codeToHighlightedHtml(code, lang);
  const doc = parseDocument(highlighted, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  });
  const pre = doc.children.find((node): node is Element => isElement(node) && node.name === 'pre');
  if (!pre) return null;

  const highlightedCode = pre.children.find(
    (node): node is Element => isElement(node) && node.name === 'code',
  );
  if (highlightedCode && languageClass) highlightedCode.attribs.class = languageClass;
  return pre;
}

async function codeToHighlightedHtml(code: string, lang: string): Promise<string> {
  try {
    return await codeToHtml(code, { lang, theme: CODE_HIGHLIGHT_THEME });
  } catch (error) {
    if (lang === 'plaintext') throw error;
    return codeToHtml(code, { lang: 'plaintext', theme: CODE_HIGHLIGHT_THEME });
  }
}

function codeTextContent(node: ChildNode): string {
  if ('data' in node) return node.data;
  if (!isElement(node)) return '';
  return node.children.map((child) => codeTextContent(child)).join('');
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

// Ghost's editor emits newsletter/member-related card wrappers that need
// different web-build treatment:
//   - `kg-email-card`: email-only body content. Static Nectar output has no
//     authenticated newsletter renderer, so this content must never reach
//     public HTML, plaintext, excerpts, or feeds.
//   - `kg-email-cta-card`: email-only CTA. The same content is rendered into
//     the newsletter email but should never reach the web (Ghost hides it
//     server-side; in a static build we strip at render time so anonymous web
//     readers never see "Get this in your inbox" duplicated below every post).
//   - `kg-signup-card`: portal signup widget. Nectar preserves the form shell
//     and stamps the Ghost members hooks that imports can omit so the build-time
//     subscribe adapter can wire it to a configured static provider.
//   - `kg-paywall-card`: Koenig's drag-in paywall marker. The loader's paywall
//     pass (`src/content/paywall.ts`) already cuts on the `<!--kg-card-begin:
//     paywall-->` comment Ghost emits alongside this div, so we leave the div
//     alone here and let sanitize-html preserve the class hook for themes that
//     want to style the boundary.
// Strip is implemented via a balanced `<div>` walker rather than a regex so a
// nested `<div>` inside the email card (e.g. a `<div class="kg-button-card">`)
// doesn't terminate the match prematurely.
const EMAIL_CARD_OPEN_RE =
  /<div\b[^>]*\bclass\s*=\s*"([^"]*(?:\bkg-email-card\b|\bkg-email-cta-card\b)[^"]*)"[^>]*>/gi;
const MEMBERS_FORM_BLOCK_RE = /<form\b[^>]*\bdata-members-form\b[^>]*>[\s\S]*?<\/form>/gi;
const MEMBERS_FORM_OPEN_RE = /^<form\b[^>]*>/i;
const MEMBERS_FORM_INPUT_RE = /<input\b[^>]*>/gi;
const MEMBERS_FORM_BUTTON_RE = /<button\b[^>]*>/gi;

function normaliseSignupCardMembersFormHooks(html: string): string {
  if (!html.includes('kg-signup-card') || !html.includes('data-members-form')) return html;
  return html.replace(MEMBERS_FORM_BLOCK_RE, (block) => {
    const open = block.match(MEMBERS_FORM_OPEN_RE)?.[0];
    if (!open) return block;
    const body = block.slice(open.length);
    const rewrittenBody = body
      .replace(MEMBERS_FORM_INPUT_RE, (tag) => {
        if (hasHtmlAttribute(tag, 'data-members-email') || htmlAttribute(tag, 'type') === 'email') {
          return setHtmlBooleanAttribute(tag, 'data-members-email');
        }
        return tag;
      })
      .replace(MEMBERS_FORM_BUTTON_RE, (tag) => {
        const type = htmlAttribute(tag, 'type');
        if (type && type !== 'submit') return tag;
        return setHtmlBooleanAttribute(tag, 'data-members-submit');
      });
    return `${open}${rewrittenBody}`;
  });
}

export function stripEmailCtaCards(html: string): string {
  if (!html.includes('kg-email-card') && !html.includes('kg-email-cta-card')) return html;
  let out = '';
  let cursor = 0;
  EMAIL_CARD_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = EMAIL_CARD_OPEN_RE.exec(html);
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
    EMAIL_CARD_OPEN_RE.lastIndex = close;
    match = EMAIL_CARD_OPEN_RE.exec(html);
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

function setHtmlBooleanAttribute(tag: string, attr: string): string {
  if (hasHtmlAttribute(tag, attr)) return tag;
  return tag.replace(/(\s*\/?>)$/, ` ${attr}$1`);
}

function hasHtmlAttribute(tag: string, attr: string): boolean {
  const re = new RegExp(`\\s${attr}(?:\\s*=|\\s|/?>)`, 'i');
  return re.test(tag);
}

function htmlAttribute(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\s${attr}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const match = tag.match(re);
  const raw = match?.[1];
  if (!raw) return undefined;
  const value =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;
  return value.toLowerCase();
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
const LIQUID_CALLOUT_SHORTCODE_RE =
  /\{%\s+callout((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}([\s\S]*?)\{%\s*\/callout\s*%\}/g;
const CALLOUT_DIRECTIVE_COMMENT_RE =
  /<!--NECTAR-KOENIG-CALLOUT-OPEN:([^>]*)-->|<!--NECTAR-KOENIG-CALLOUT-CLOSE-->/g;

const CODE_SHORTCODE_RE =
  /\{\{<\s+code((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/code\s*>\}\}/g;

// Block-form `{{< button href="…" align="center" style="accent" >}}Label{{< /button >}}`.
// Themes target `kg-button-card` with optional `kg-align-{align}` on the card
// and `kg-btn-{style}` on the anchor itself.
const BUTTON_SHORTCODE_RE =
  /\{\{<\s+button((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}([\s\S]*?)\{\{<\s*\/button\s*>\}\}/g;
const BUTTON_STATEMENT_RE = /\{%\s+button((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}/g;
const HEADER_SHORTCODE_RE = /\{\{<\s+header((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;
const HEADER_STATEMENT_RE = /\{%\s+header((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}/g;

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
const NFT_SHORTCODE_RE = /\{\{<\s+nft((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;

type ShortcodeSchema = {
  name: string;
  requiredAttrGroups?: readonly (readonly string[])[];
};

const SHORTCODE_SCHEMAS: readonly ShortcodeSchema[] = [
  { name: 'audio', requiredAttrGroups: [['src']] },
  { name: 'bookmark', requiredAttrGroups: [['url']] },
  { name: 'button', requiredAttrGroups: [['href']] },
  { name: 'callout' },
  { name: 'code' },
  { name: 'embed', requiredAttrGroups: [['url']] },
  { name: 'figure', requiredAttrGroups: [['src']] },
  { name: 'file', requiredAttrGroups: [['href', 'src']] },
  { name: 'gallery' },
  { name: 'gallery-image', requiredAttrGroups: [['src']] },
  { name: 'gallery-row' },
  {
    name: 'header',
    requiredAttrGroups: [
      [
        'heading',
        'title',
        'subheading',
        'subtitle',
        'button_href',
        'buttonHref',
        'cta-href',
        'cta_href',
        'background',
        'background_image',
      ],
    ],
  },
  { name: 'nft', requiredAttrGroups: [['href', 'url', 'image', 'src']] },
  {
    name: 'product',
    requiredAttrGroups: [['title', 'description', 'image', 'button-href']],
  },
  { name: 'toggle' },
  { name: 'video', requiredAttrGroups: [['src']] },
  { name: 'video-track', requiredAttrGroups: [['src']] },
] as const;

const SHORTCODE_SCHEMA_BY_NAME = new Map(
  SHORTCODE_SCHEMAS.map((schema) => [schema.name, schema] as const),
);
const SHORTCODE_NAMES = SHORTCODE_SCHEMAS.map((schema) => schema.name);
const BLOCK_SHORTCODES = new Set([
  'button',
  'callout',
  'code',
  'gallery',
  'gallery-row',
  'toggle',
  'video',
]);
const LIQUID_BLOCK_SHORTCODES = new Set(['callout', 'gallery', 'gallery-row', 'toggle', 'video']);
const SHORTCODE_TOKEN_RE = /\{\{<([\s\S]*?)>\}\}|\{%([\s\S]*?)%\}/g;

interface OpenShortcode {
  name: string;
  line: number;
  col: number;
  syntax: 'hugo' | 'liquid';
}

export function findMalformedKoenigShortcode(
  markdown: string,
): KoenigShortcodeDiagnostic | undefined {
  const stack: OpenShortcode[] = [];
  const lineStarts = computeLineStarts(markdown);
  SHORTCODE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = SHORTCODE_TOKEN_RE.exec(markdown);
  while (match !== null) {
    const hugoToken = match[1];
    const liquidToken = match[2];
    const syntax: OpenShortcode['syntax'] = hugoToken !== undefined ? 'hugo' : 'liquid';
    const token = (hugoToken ?? liquidToken ?? '').trim();
    const line = lineForIndex(lineStarts, match.index);
    const col = colForIndex(lineStarts, match.index);
    const parsed = parseShortcodeToken(token, syntax);
    if (parsed) {
      if (parsed.kind === 'open') {
        stack.push({ name: parsed.name, line, col, syntax });
      } else {
        const open = stack.pop();
        if (!open || open.name !== parsed.name) {
          return {
            shortcode: parsed.name,
            expectedClose: closeTokenFor({ name: parsed.name, line, col, syntax }),
            line,
            col,
          };
        }
      }
    }
    match = SHORTCODE_TOKEN_RE.exec(markdown);
  }

  const open = stack[stack.length - 1];
  if (!open) return undefined;
  return {
    shortcode: open.name,
    expectedClose: closeTokenFor(open),
    line: open.line,
    col: open.col,
  };
}

export function malformedKoenigShortcodeMessage(diagnostic: KoenigShortcodeDiagnostic): string {
  return `Malformed Koenig shortcode "${diagnostic.shortcode}": missing closing shortcode ${JSON.stringify(diagnostic.expectedClose)}.`;
}

export function findInvalidKoenigShortcode(
  markdown: string,
): KoenigShortcodeValidationDiagnostic | undefined {
  const lineStarts = computeLineStarts(markdown);
  SHORTCODE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = SHORTCODE_TOKEN_RE.exec(markdown);
  while (match !== null) {
    const hugoToken = match[1];
    const liquidToken = match[2];
    const token = (hugoToken ?? liquidToken ?? '').trim();
    const parsed = parseValidationToken(token);
    if (!parsed || parsed.kind === 'close') {
      match = SHORTCODE_TOKEN_RE.exec(markdown);
      continue;
    }

    const schema = SHORTCODE_SCHEMA_BY_NAME.get(parsed.name);
    const line = lineForIndex(lineStarts, match.index);
    const col = colForIndex(lineStarts, match.index);
    if (!schema) {
      const closest = suggestClosest(parsed.name, SHORTCODE_NAMES);
      return {
        shortcode: parsed.name,
        line,
        col,
        message: `Unknown Koenig shortcode "${parsed.name}".`,
        hint: closest
          ? `Did you mean "${closest}"?`
          : 'Remove the shortcode or use a supported Koenig card shortcode.',
      };
    }

    const attrs = parseShortcodeAttrs(parsed.attrs);
    const missing = firstMissingRequiredAttrGroup(schema, attrs);
    if (missing) {
      const typo = closestAttrTypo(missing, Object.keys(attrs));
      return {
        shortcode: parsed.name,
        line,
        col,
        message: `Invalid Koenig shortcode "${parsed.name}": missing required ${formatRequiredAttrGroup(missing)}.`,
        hint: typo
          ? `Did you mean "${typo.expected}" instead of "${typo.actual}"?`
          : `Add ${formatRequiredAttrGroup(missing)} to the shortcode or remove the card block.`,
      };
    }

    match = SHORTCODE_TOKEN_RE.exec(markdown);
  }
  return undefined;
}

export function invalidKoenigShortcodeMessage(
  diagnostic: KoenigShortcodeValidationDiagnostic,
): string {
  return diagnostic.message;
}

function parseValidationToken(
  token: string,
): { kind: 'open' | 'close'; name: string; attrs: string } | undefined {
  if (!token) return undefined;
  if (token.startsWith('/')) {
    const name = firstShortcodeToken(token.slice(1));
    return name ? { kind: 'close', name, attrs: '' } : undefined;
  }
  const name = firstShortcodeToken(token);
  if (!name) return undefined;
  const withoutSelfClosing = token.endsWith('/') ? token.slice(0, -1).trimEnd() : token;
  return { kind: 'open', name, attrs: withoutSelfClosing.slice(name.length) };
}

function firstMissingRequiredAttrGroup(
  schema: ShortcodeSchema,
  attrs: Record<string, string>,
): readonly string[] | undefined {
  for (const group of schema.requiredAttrGroups ?? []) {
    if (!group.some((attr) => hasNonEmptyShortcodeAttr(attrs, attr))) return group;
  }
  return undefined;
}

function hasNonEmptyShortcodeAttr(attrs: Record<string, string>, attr: string): boolean {
  return (attrs[attr] ?? '').trim().length > 0;
}

function formatRequiredAttrGroup(group: readonly string[]): string {
  if (group.length === 1) return `attribute "${group[0]}"`;
  return `one of ${group.map((attr) => `"${attr}"`).join(', ')}`;
}

function closestAttrTypo(
  expectedAttrs: readonly string[],
  actualAttrs: readonly string[],
): { expected: string; actual: string } | undefined {
  for (const actual of actualAttrs) {
    const expected = suggestClosest(actual, expectedAttrs);
    if (expected) return { expected, actual };
  }
  return undefined;
}

function parseShortcodeToken(
  token: string,
  syntax: OpenShortcode['syntax'],
): { kind: 'open' | 'close'; name: string } | undefined {
  if (!token) return undefined;
  if (token.startsWith('/')) {
    const name = firstShortcodeToken(token.slice(1));
    if (!name || !isBlockShortcode(name, syntax)) return undefined;
    return { kind: 'close', name };
  }

  const name = firstShortcodeToken(token);
  if (!name || !isBlockShortcode(name, syntax)) return undefined;
  if (syntax === 'hugo' && token.endsWith('/')) return undefined;
  return { kind: 'open', name };
}

function firstShortcodeToken(token: string): string | undefined {
  return token.match(/^[a-zA-Z][\w-]*/)?.[0];
}

function isBlockShortcode(name: string, syntax: OpenShortcode['syntax']): boolean {
  return syntax === 'hugo' ? BLOCK_SHORTCODES.has(name) : LIQUID_BLOCK_SHORTCODES.has(name);
}

function closeTokenFor(open: OpenShortcode): string {
  return open.syntax === 'hugo' ? `{{< /${open.name} >}}` : `{% /${open.name} %}`;
}

function computeLineStarts(input: string): number[] {
  const starts = [0];
  for (let i = 0; i < input.length; i += 1) {
    if (input.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineForIndex(lineStarts: readonly number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid] ?? 0;
    if (start <= index) low = mid + 1;
    else high = mid - 1;
  }
  return high + 1;
}

function colForIndex(lineStarts: readonly number[], index: number): number {
  const line = lineForIndex(lineStarts, index);
  const start = lineStarts[line - 1] ?? 0;
  return index - start + 1;
}

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
      renderCalloutDirective(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(LIQUID_CALLOUT_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderCalloutDirective(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(CODE_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderCodeHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(BUTTON_STATEMENT_RE, (_match, attrsStr: string) => {
      const attrs = parseShortcodeAttrs(attrsStr);
      return renderButtonHtml(attrs, attrs.text ?? '');
    })
    .replace(BUTTON_SHORTCODE_RE, (_match, attrsStr: string, body: string) =>
      renderButtonHtml(parseShortcodeAttrs(attrsStr), body),
    )
    .replace(HEADER_STATEMENT_RE, (_match, attrsStr: string) =>
      renderHeaderHtml(parseShortcodeAttrs(attrsStr)),
    )
    .replace(HEADER_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderHeaderHtml(parseShortcodeAttrs(attrsStr)),
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
    )
    .replace(NFT_SHORTCODE_RE, (_match, attrsStr: string) =>
      renderNftHtml(parseShortcodeAttrs(attrsStr)),
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

function optionalKoenigWidthClass(attrs: Record<string, string>): string {
  const width =
    normalizeKoenigWidth(attrs.width) ??
    normalizeKoenigWidth(attrs.size) ??
    normalizeKoenigWidth(attrs.cardWidth);
  return width ? ` kg-width-${width}` : '';
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
    lazyImageAttr(attrs),
  ]
    .filter((s) => s !== '')
    .join(' ');
  const image = `<img ${imgAttrs} />`;
  const pictureSources = renderFigurePictureSourcesHtml(attrs);
  const media = pictureSources ? `<picture>${pictureSources}${image}</picture>` : image;
  const inner = attrs.href ? `<a href="${escapeHtmlAttr(attrs.href)}">${media}</a>` : media;
  const figcaption = caption
    ? `<figcaption>${renderInlineCaptionMarkdown(caption)}</figcaption>`
    : '';
  return `\n\n<figure class="kg-card kg-image-card${koenigWidthClass(attrs)}${hasCaptionClass(caption)}">${inner}${figcaption}</figure>\n\n`;
}

function renderFigurePictureSourcesHtml(attrs: Record<string, string>): string {
  const sources: string[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const prefix = `source${index}_`;
    const srcset = attrs[`${prefix}srcset`] ?? '';
    const src = attrs[`${prefix}src`] ?? '';
    const type = attrs[`${prefix}type`] ?? '';
    const media = attrs[`${prefix}media`] ?? '';
    const sizes = attrs[`${prefix}sizes`] ?? '';
    if (!srcset && !src && !type && !media && !sizes) break;
    if (!srcset && !src) continue;
    const sourceAttrs = [
      type ? `type="${escapeHtmlAttr(type)}"` : '',
      media ? `media="${escapeHtmlAttr(media)}"` : '',
      srcset ? `srcset="${escapeHtmlAttr(srcset)}"` : '',
      src ? `src="${escapeHtmlAttr(src)}"` : '',
      sizes ? `sizes="${escapeHtmlAttr(sizes)}"` : '',
    ]
      .filter((s) => s !== '')
      .join(' ');
    sources.push(`<source ${sourceAttrs}>`);
  }
  return sources.join('');
}

function lazyImageAttr(attrs: Record<string, string>): string {
  return attrs.lazy !== undefined && !truthyShortcodeAttr(attrs.lazy) ? '' : 'loading="lazy"';
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
    return renderEmbedFallbackLink(url, attrs, cardClass, figcaption);
  }

  const title = attrs.title || embed.title;
  const width = mediaWidthValue(attrs, embed.width);
  const height = attrs.height || embed.height;
  const iframe = `<iframe src="${escapeHtmlAttr(embed.src)}" title="${escapeHtmlAttr(title)}" width="${escapeHtmlAttr(width)}" height="${escapeHtmlAttr(height)}" loading="lazy" frameborder="0" allow="${escapeHtmlAttr(embed.allow)}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return `\n\n<figure class="${cardClass}">${iframe}${figcaption}</figure>\n\n`;
}

function renderCodeHtml(attrs: Record<string, string>, body: string): string {
  const parsed = parseCodeShortcodeBody(body);
  const language = normalizeCodeLanguage(attrs.language || attrs.lang || parsed.language);
  const languageClass = language ? ` class="language-${escapeHtmlAttr(language)}"` : '';
  const caption = attrs.caption ?? '';
  const lineNumberClass = classTokenList(attrs['line-number-class'] ?? '');
  const figcaption = caption ? `<figcaption>${escapeHtmlAttr(caption)}</figcaption>` : '';
  const cardClass = [
    'kg-card kg-code-card',
    optionalKoenigWidthClass(attrs).trim(),
    hasCaptionClass(caption).trim(),
    lineNumberClass,
  ]
    .filter((part) => part !== '')
    .join(' ');

  return `\n\n<figure class="${cardClass}"><pre><code${languageClass}>${escapeHtmlAttr(parsed.code)}</code></pre>${figcaption}</figure>\n\n`;
}

function parseCodeShortcodeBody(body: string): { code: string; language: string } {
  const trimmed = body.trim();
  const match = trimmed.match(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/);
  if (!match) return { code: body.trim(), language: '' };
  return {
    language: (match[2] ?? '').trim().split(/\s+/)[0] ?? '',
    code: match[3] ?? '',
  };
}

function normalizeCodeLanguage(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/^language-/, '')
    .replace(/^lang-/, '');
  return /^[a-zA-Z0-9_+.-]+$/.test(normalized) ? normalized : '';
}

function classTokenList(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((token) => /^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/.test(token))
    .join(' ');
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
  if (
    host === 'w.soundcloud.com' ||
    host === 'api.soundcloud.com' ||
    host.endsWith('.soundcloud.com')
  )
    return 'soundcloud';
  if (host === 'codepen.io' || host.endsWith('.codepen.io')) return 'codepen';
  if (host === 'gist.github.com') return 'gist';
  if (host === 'figma.com' || host.endsWith('.figma.com')) return 'figma';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'twitter.com' || host === 'x.com') return 'twitter';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'loom.com' || host.endsWith('.loom.com')) return 'loom';
  if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) return 'bandcamp';
  if (host === 'music.apple.com' || host.endsWith('.music.apple.com')) return 'apple-music';
  if (host.startsWith('pinterest.') || host.includes('.pinterest.')) return 'pinterest';
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'reddit';
  if (host === 'slideshare.net' || host.endsWith('.slideshare.net')) return 'slideshare';
  return '';
}

function renderEmbedFallbackLink(
  url: string,
  attrs: Record<string, string>,
  cardClass: string,
  figcaption: string,
): string {
  const provider = normalizeEmbedProvider(attrs.provider) || providerFromRawUrl(url);
  const href = provider === 'twitter' && truthyShortcodeAttr(attrs.dnt) ? twitterDntUrl(url) : url;
  const providerName = embedProviderLabel(provider);
  const providerAttr = scriptHydratedEmbedProvider(provider)
    ? ` data-nectar-embed-provider="${escapeHtmlAttr(provider)}"`
    : '';
  const title = attrs.title || (providerName ? `${providerName} embed` : 'Embedded link');
  const description = providerName
    ? `Open this ${providerName} embed at its source URL.`
    : 'Open this unsupported embed at its source URL.';
  return `\n\n<figure class="${cardClass}"${providerAttr}><a class="kg-bookmark-container kg-embed-card-fallback" href="${escapeHtmlAttr(href)}"><div class="kg-bookmark-content"><div class="kg-bookmark-title">${escapeHtmlAttr(title)}</div><div class="kg-bookmark-description">${escapeHtmlAttr(description)}</div><div class="kg-bookmark-metadata"><span class="kg-bookmark-publisher">${escapeHtmlAttr(providerName || 'External embed')}</span></div></div></a>${figcaption}</figure>\n\n`;
}

function twitterDntUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('dnt', '1');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function scriptHydratedEmbedProvider(
  provider: string,
): provider is 'instagram' | 'tiktok' | 'twitter' {
  return provider === 'instagram' || provider === 'tiktok' || provider === 'twitter';
}

function providerFromRawUrl(rawUrl: string): string {
  try {
    return providerFromUrl(new URL(rawUrl));
  } catch {
    return '';
  }
}

function embedProviderLabel(provider: string): string {
  switch (provider) {
    case 'apple-music':
      return 'Apple Music';
    case 'codepen':
      return 'CodePen';
    case 'figma':
      return 'Figma';
    case 'gist':
      return 'GitHub Gist';
    case 'instagram':
      return 'Instagram';
    case 'soundcloud':
      return 'SoundCloud';
    case 'slideshare':
      return 'SlideShare';
    case 'tiktok':
      return 'TikTok';
    case 'twitter':
      return 'Twitter/X';
    case 'youtube':
      return 'YouTube';
    default:
      return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : '';
  }
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
  const openAttr = attrs.state === 'open' ? ' open' : '';
  return `\n\n<details class="kg-card kg-toggle-card${koenigWidthClass(attrs)}"${openAttr}>\n${summary}\n${contentBlock}\n</details>\n\n`;
}

// Restrict callout color tokens to the kebab-case set Ghost ships so attacker-
// controlled frontmatter cannot inject arbitrary class names (e.g.
// `color="foo onclick=alert"` -> `kg-callout-card-foo onclick=alert`). Anything
// outside the alphabet is silently dropped.
const KOENIG_TOKEN_RE = /^[a-z][a-z0-9-]*$/;

const calloutEmojiHtmlSanitizeOptions: IOptions = {
  allowedTags: ['img', 'span'],
  allowedAttributes: {
    img: ['src', 'alt', 'title', 'width', 'height', 'class', 'loading', 'decoding'],
    span: ['class', 'title'],
  },
  allowedSchemes: ['http', 'https'],
  disallowedTagsMode: 'discard',
};

function calloutEmojiSlotHtml(attrs: Record<string, string>): string {
  const emojiHtml = attrs['emoji-html']?.trim();
  if (emojiHtml) {
    return sanitizeHtml(emojiHtml, calloutEmojiHtmlSanitizeOptions).trim();
  }
  const emoji = attrs.emoji ?? '';
  return emoji ? escapeHtmlAttr(emoji) : '';
}

function renderCalloutDirective(attrs: Record<string, string>, body: string): string {
  const encodedAttrs = encodeURIComponent(JSON.stringify(attrs));
  const innerMarkdown = body.trim();
  return `\n\n<!--NECTAR-KOENIG-CALLOUT-OPEN:${encodedAttrs}-->\n\n${innerMarkdown}\n\n<!--NECTAR-KOENIG-CALLOUT-CLOSE-->\n\n`;
}

function restoreKoenigCalloutDirectives(html: string): string {
  if (!html.includes('NECTAR-KOENIG-CALLOUT')) return html;
  let openCallouts = 0;
  return html.replace(CALLOUT_DIRECTIVE_COMMENT_RE, (match, encodedAttrs: string | undefined) => {
    if (encodedAttrs === undefined) {
      if (openCallouts === 0) return match;
      openCallouts -= 1;
      return '</div>\n</div>';
    }

    const attrs = decodeCalloutDirectiveAttrs(encodedAttrs);
    if (!attrs) return match;
    openCallouts += 1;
    return renderCalloutOpenHtml(attrs);
  });
}

function decodeCalloutDirectiveAttrs(encodedAttrs: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(encodedAttrs)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    );
  } catch {
    return undefined;
  }
}

function renderCalloutOpenHtml(attrs: Record<string, string>): string {
  const color = attrs.color ?? '';
  const colorClass = KOENIG_TOKEN_RE.test(color) ? ` kg-callout-card-${color}` : '';
  const emojiSlot = calloutEmojiSlotHtml(attrs);
  const noIcon = attrs['no-icon'] === 'true' || emojiSlot === '';
  const noIconClass = noIcon ? ' kg-callout-card-without-emoji' : '';
  const emojiHtml = noIcon ? '' : `<div class="kg-callout-emoji">${emojiSlot}</div>`;
  return `<div class="kg-card kg-callout-card${koenigWidthClass(attrs)}${colorClass}${noIconClass}">\n${emojiHtml}\n<div class="kg-callout-text">`;
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
      const srcsetAttr = ia.srcset ? ` srcset="${escapeHtmlAttr(ia.srcset)}"` : '';
      const sizes = ia.sizes ?? (ia.srcset ? GALLERY_IMAGE_SIZES : '');
      const sizesAttr = sizes ? ` sizes="${escapeHtmlAttr(sizes)}"` : '';
      images.push(
        `<div class="kg-gallery-image"><img src="${escapeHtmlAttr(ia.src)}" alt="${escapeHtmlAttr(ia.alt ?? '')}"${widthAttr}${heightAttr}${srcsetAttr}${sizesAttr} loading="lazy" /></div>`,
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
  const metadataHtml =
    filenameHtml || filesizeHtml
      ? `<div class="kg-file-card-metadata">${filenameHtml}${filesizeHtml}</div>`
      : '';
  const contentsHtml = `<div class="kg-file-card-contents">${titleHtml}${captionHtml}${metadataHtml}</div>`;
  const iconHtml =
    '<div class="kg-file-card-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>';
  return `\n\n<div class="kg-card kg-file-card${koenigWidthClass(attrs)}"><a class="kg-file-card-container" href="${escapeHtmlAttr(src)}" download>${contentsHtml}${iconHtml}</a></div>\n\n`;
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
    ? `<div class="kg-product-card-description"><p>${escapeHtmlAttr(description)}</p></div>`
    : '';
  const ratingHtml =
    attrs.rating && /^\d+(?:\.\d+)?$/.test(attrs.rating)
      ? `<div class="kg-product-card-rating" data-rating="${escapeHtmlAttr(attrs.rating)}"></div>`
      : '';
  const buttonHtml =
    buttonHref && buttonText
      ? `<a class="kg-product-card-button kg-product-card-btn-accent" href="${escapeHtmlAttr(buttonHref)}">${escapeHtmlAttr(buttonText)}</a>`
      : '';
  return `\n\n<div class="kg-card kg-product-card${koenigWidthClass(attrs)}"><div class="kg-product-card-container">${imageHtml}${titleHtml}${ratingHtml}${descriptionHtml}${buttonHtml}</div></div>\n\n`;
}

function renderNftHtml(attrs: Record<string, string>): string {
  const href = attrs.href ?? attrs.url ?? '';
  const image = attrs.image ?? attrs.src ?? '';
  if (!href && !image) return '';
  const imageHtml = image
    ? `<div class="kg-nft-image-container"><img class="kg-nft-image" src="${escapeHtmlAttr(image)}" alt="" /></div>`
    : '';
  const titleHtml = attrs.title
    ? `<div class="kg-nft-title">${escapeHtmlAttr(attrs.title)}</div>`
    : '';
  const creatorHtml = attrs.creator
    ? `<div class="kg-nft-creator">${escapeHtmlAttr(attrs.creator)}</div>`
    : '';
  const descriptionHtml = attrs.description
    ? `<div class="kg-nft-description">${escapeHtmlAttr(attrs.description)}</div>`
    : '';
  const metadataHtml =
    titleHtml || creatorHtml || descriptionHtml
      ? `<div class="kg-nft-metadata">${titleHtml}${creatorHtml}${descriptionHtml}</div>`
      : '';
  const body = `${imageHtml}${metadataHtml}`;
  const cardBody = href
    ? `<a class="kg-nft-card-container" href="${escapeHtmlAttr(href)}">${body}</a>`
    : `<div class="kg-nft-card-container">${body}</div>`;
  return `\n\n<figure class="kg-card kg-nft-card${koenigWidthClass(attrs)}">${cardBody}</figure>\n\n`;
}

function renderHeaderHtml(attrs: Record<string, string>): string {
  return attrs.version === 'v2' ? renderHeaderV2Html(attrs) : renderHeaderV1Html(attrs);
}

function renderHeaderV1Html(attrs: Record<string, string>): string {
  const heading = attrs.heading ?? attrs.title ?? '';
  const subheading = attrs.subheading ?? attrs.subtitle ?? '';
  const buttonHref =
    attrs.button_href ?? attrs.buttonHref ?? attrs['cta-href'] ?? attrs.cta_href ?? '';
  const buttonText =
    attrs.button_text ?? attrs.buttonText ?? attrs['cta-text'] ?? attrs.cta_text ?? '';
  const background = attrs.background ?? attrs.background_image ?? '';
  if (!heading && !subheading && !buttonText && !background) return '';

  const styleClass = tokenClass('kg-style', attrs.style);
  const sizeClass = tokenClass('kg-size', attrs.size ?? attrs['card-size'] ?? attrs.card_size);
  const widthClass = attrs.width ? tokenClass('kg-width', attrs.width) : '';
  const safeBackground = safeHeaderBackgroundUrl(background) ? background : '';
  const backgroundAttrs = safeBackground
    ? ` data-kg-background-image="${escapeHtmlAttr(safeBackground)}" style="background-image:url(${escapeHtmlAttr(safeBackground)})"`
    : '';
  const headingHtml = heading
    ? `<h2 class="kg-header-card-heading">${escapeHtmlAttr(heading)}</h2>`
    : '';
  const subheadingHtml = subheading
    ? `<h3 class="kg-header-card-subheading">${escapeHtmlAttr(subheading)}</h3>`
    : '';
  const buttonHtml =
    buttonHref && buttonText
      ? `<a class="kg-header-card-button" href="${escapeHtmlAttr(buttonHref)}">${escapeHtmlAttr(buttonText)}</a>`
      : '';
  return `\n\n<div class="kg-card kg-header-card${widthClass}${styleClass}${sizeClass}"${backgroundAttrs}>${headingHtml}${subheadingHtml}${buttonHtml}</div>\n\n`;
}

function safeHeaderBackgroundUrl(value: string): boolean {
  if (!/^(?:https?:\/\/|\/(?!\/))/.test(value)) return false;
  if (/[\s"'()<>]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://example.invalid');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderHeaderV2Html(attrs: Record<string, string>): string {
  const heading = attrs.heading ?? '';
  const subheading = attrs.subheading ?? '';
  const buttonHref = attrs.button_href ?? attrs.buttonHref ?? '';
  const buttonText = attrs.button_text ?? attrs.buttonText ?? '';
  if (!heading && !subheading && !buttonText && !attrs.background_image) return '';

  const alignClass = tokenClass('kg-align', attrs.align);
  const classes = [
    'kg-card kg-header-card kg-v2',
    tokenClass('kg-width', attrs.width),
    attrs.content_width === 'wide' ? ' kg-content-wide' : '',
    alignClass,
    tokenClass('kg-style', attrs.style),
  ].join('');
  const rootAttrs = [
    `class="${classes}"`,
    headerRootStyle(attrs),
    attrs.background_color
      ? `data-background-color="${escapeHtmlAttr(attrs.background_color)}"`
      : '',
    attrs.accent ? `data-accent-color="${escapeHtmlAttr(attrs.accent)}"` : '',
  ]
    .filter((s) => s !== '')
    .join(' ');
  const imageHtml = renderHeaderImageHtml(attrs);
  const textColor = attrs.text_color ?? '';
  const headingAttrs = headerTextAttrs(textColor);
  const headingHtml = heading
    ? `<h2 class="kg-header-card-heading"${headingAttrs}>${escapeHtmlAttr(heading)}</h2>`
    : '';
  const subheadingHtml = subheading
    ? `<p class="kg-header-card-subheading"${headingAttrs}>${escapeHtmlAttr(subheading)}</p>`
    : '';
  const buttonHtml = renderHeaderButtonHtml(attrs, buttonHref, buttonText);
  const textClass = `kg-header-card-text${alignClass}`;
  return `\n\n<div ${rootAttrs}>${imageHtml}<div class="kg-header-card-content"><div class="${textClass}">${headingHtml}${subheadingHtml}${buttonHtml}</div></div></div>\n\n`;
}

function tokenClass(prefix: string, raw: string | undefined): string {
  const token = (raw ?? '').trim().replace(new RegExp(`^${prefix}-`), '');
  return KOENIG_TOKEN_RE.test(token) ? ` ${prefix}-${token}` : '';
}

function headerRootStyle(attrs: Record<string, string>): string {
  const declarations = [
    validPosition(attrs.background_image_position)
      ? `--bg-image-position: ${attrs.background_image_position}`
      : '',
    safeHexColor(attrs.background_image_color)
      ? `--bg-image-color: ${attrs.background_image_color}`
      : '',
    safeHexColor(attrs.background_color) ? `background-color: ${attrs.background_color}` : '',
  ].filter((s) => s !== '');
  return declarations.length > 0 ? `style="${escapeHtmlAttr(`${declarations.join('; ')};`)}"` : '';
}

function renderHeaderImageHtml(attrs: Record<string, string>): string {
  const src = attrs.background_image ?? '';
  if (!src) return '';
  const imgAttrs = [
    'class="kg-header-card-image"',
    `src="${escapeHtmlAttr(src)}"`,
    attrs.background_image_width ? `width="${escapeHtmlAttr(attrs.background_image_width)}"` : '',
    attrs.background_image_height
      ? `height="${escapeHtmlAttr(attrs.background_image_height)}"`
      : '',
    'loading="lazy"',
    'alt=""',
  ]
    .filter((s) => s !== '')
    .join(' ');
  return `<picture><img ${imgAttrs}></picture>`;
}

function headerTextAttrs(textColor: string): string {
  if (!safeHexColor(textColor)) return '';
  const escaped = escapeHtmlAttr(textColor);
  return ` style="color: ${escaped};" data-text-color="${escaped}"`;
}

function renderHeaderButtonHtml(
  attrs: Record<string, string>,
  buttonHref: string,
  buttonText: string,
): string {
  if (!buttonHref || !buttonText) return '';
  const buttonStyle = tokenClass('kg-header-card-button', attrs.button_style).trim();
  const classAttr = ['kg-header-card-button', buttonStyle].filter((s) => s !== '').join(' ');
  const style = headerButtonStyle(attrs);
  const dataAttrs = [
    attrs.button_color ? `data-button-color="${escapeHtmlAttr(attrs.button_color)}"` : '',
    attrs.button_text_color
      ? `data-button-text-color="${escapeHtmlAttr(attrs.button_text_color)}"`
      : '',
  ]
    .filter((s) => s !== '')
    .join(' ');
  const extraAttrs = [style, dataAttrs].filter((s) => s !== '').join(' ');
  return `<a class="${classAttr}" href="${escapeHtmlAttr(buttonHref)}"${extraAttrs ? ` ${extraAttrs}` : ''}>${escapeHtmlAttr(buttonText)}</a>`;
}

function headerButtonStyle(attrs: Record<string, string>): string {
  const declarations = [
    safeHexColor(attrs.button_color) ? `background-color: ${attrs.button_color}` : '',
    safeHexColor(attrs.button_text_color) ? `color: ${attrs.button_text_color}` : '',
  ].filter((s) => s !== '');
  return declarations.length > 0 ? `style="${escapeHtmlAttr(`${declarations.join('; ')};`)}"` : '';
}

function safeHexColor(value: string | undefined): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value ?? '');
}

function validPosition(value: string | undefined): boolean {
  return /^\d{1,3}% \d{1,3}%$/.test(value ?? '');
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
const IMAGE_READING_SECONDS = 12;
const MIN_IMAGE_READING_SECONDS = 3;

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

function countImages(html: string): number {
  if (!html.includes('<img')) return 0;
  const doc = parseDocument(html, {
    decodeEntities: true,
    lowerCaseAttributeNames: true,
  });
  return countImageElements(doc.children);
}

function countImageElements(nodes: ChildNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.name === 'img') count += 1;
    count += countImageElements(node.children);
  }
  return count;
}

function safeImageCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function imageReadingSeconds(imageCount: number): number {
  let seconds = 0;
  for (let i = IMAGE_READING_SECONDS; i > IMAGE_READING_SECONDS - imageCount; i -= 1) {
    seconds += Math.max(i, MIN_IMAGE_READING_SECONDS);
  }
  return seconds;
}

function computeReadingTime(
  plaintext: string,
  locale: string | undefined,
  wordCount: number,
  imageCount: number,
): number {
  const imageSeconds = imageReadingSeconds(imageCount);
  if (isCjkLocale(locale)) {
    const chars = countReadingChars(plaintext, locale);
    const textSeconds = chars / (CHARS_PER_MINUTE / 60);
    return Math.max(1, Math.round((textSeconds + imageSeconds) / 60));
  }
  const textSeconds = wordCount / (WORDS_PER_MINUTE / 60);
  return Math.max(1, Math.round((textSeconds + imageSeconds) / 60));
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
