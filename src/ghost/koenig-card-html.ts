// Shared Koenig card → HTML renderers. Both the Lexical renderer (newer Ghost)
// and the Mobiledoc renderer (older Ghost) emit cards via these helpers so the
// downstream turndown pipeline sees the same kg-* class wrappers it already
// understands. The goal is "structurally identical to what Ghost would have
// rendered in `post.html`", not byte-for-byte parity — small attribute order
// or whitespace differences are fine.

import renderHtml from 'dom-serializer';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { Marked } from 'marked';
import { cjkFriendlyEmphasis } from '~/content/markdown-cjk-emphasis.ts';

const markdownRenderer = new Marked({ gfm: true, breaks: false });
markdownRenderer.use(cjkFriendlyEmphasis());

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function strProp(obj: unknown, key: string): string {
  if (typeof obj !== 'object' || obj === null) return '';
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

function strDeep(obj: unknown, ...keys: string[]): string {
  let cur: unknown = obj;
  for (const k of keys) {
    if (typeof cur !== 'object' || cur === null) return '';
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === 'string' ? cur : '';
}

function widthClass(payload: unknown): string {
  const w = strProp(payload, 'cardWidth');
  const normalized = w.replace(/^kg-width-/, '');
  return normalized === 'regular' || normalized === 'wide' || normalized === 'full'
    ? ` kg-width-${normalized}`
    : '';
}

function alignmentClass(payload: unknown): string {
  const raw = strProp(payload, 'align') || strProp(payload, 'alignment');
  const normalized = raw.replace(/^kg-align-/, '');
  return normalized === 'left' || normalized === 'center' || normalized === 'right'
    ? ` kg-align-${normalized}`
    : '';
}

function tokenClass(prefix: string, raw: string): string {
  const token = raw.trim().replace(new RegExp(`^${prefix}-`), '');
  return /^[a-z][a-z0-9-]*$/.test(token) ? ` ${prefix}-${token}` : '';
}

function hasCaptionClass(caption: string): string {
  return caption ? ' kg-card-hascaption' : '';
}

function captionId(caption: string): string {
  return `kg-card-caption-${hashLabel(caption)}`;
}

function captionFigureAttrs(caption: string): string {
  return caption ? ` role="group" aria-labelledby="${escapeAttr(captionId(caption))}"` : '';
}

function figcaptionHtml(caption: string): string {
  return caption
    ? `<figcaption id="${escapeAttr(captionId(caption))}">${caption}</figcaption>`
    : '';
}

function hashLabel(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function renderImageCardHtml(payload: unknown): string {
  const src = strProp(payload, 'src');
  if (!src) return '';
  const alt = strProp(payload, 'alt');
  const caption = strProp(payload, 'caption');
  const href = strProp(payload, 'href');
  const widthRaw = strProp(payload, 'width');
  const heightRaw = strProp(payload, 'height');
  const imgAttrs = [
    `src="${escapeAttr(src)}"`,
    `alt="${escapeAttr(alt)}"`,
    widthRaw ? `width="${escapeAttr(widthRaw)}"` : '',
    heightRaw ? `height="${escapeAttr(heightRaw)}"` : '',
  ]
    .filter((s) => s !== '')
    .join(' ');
  const imgEl = `<img ${imgAttrs}>`;
  const wrapped = href ? `<a href="${escapeAttr(href)}">${imgEl}</a>` : imgEl;
  return `<figure class="kg-card kg-image-card${widthClass(payload)}${alignmentClass(payload)}${hasCaptionClass(caption)}"${captionFigureAttrs(caption)}>${wrapped}${figcaptionHtml(caption)}</figure>`;
}

export function renderMarkdownCardHtml(payload: unknown): string {
  const md = strProp(payload, 'markdown');
  if (!md) return '';
  const html = markdownRenderer.parse(md, { async: false }) as string;
  return `<!--kg-card-begin: markdown-->${html}<!--kg-card-end: markdown-->`;
}

export function renderHtmlCardHtml(payload: unknown): string {
  const html = strProp(payload, 'html');
  if (!html) return '';
  return `<!--kg-card-begin: html-->${html}<!--kg-card-end: html-->`;
}

export function renderCodeCardHtml(payload: unknown): string {
  const code = strProp(payload, 'code');
  if (!code) return '';
  const language = normalizeCodeLanguage(strProp(payload, 'language'));
  const caption = strProp(payload, 'caption');
  const langClass = language ? ` class="language-${escapeAttr(language)}"` : '';
  const pre = `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
  const button =
    '<button class="kg-code-card-copy" type="button" data-kg-i18n="Copy" data-label-copy="Copy" data-label-copied="Copied">Copy</button>';
  return `<figure class="kg-card kg-code-card${hasCaptionClass(caption)}"${captionFigureAttrs(caption)}>${button}${pre}${figcaptionHtml(caption)}</figure>`;
}

function normalizeCodeLanguage(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^lang-/, '')
    .replace(/\s+/g, '-');
  const aliases: Record<string, string> = {
    node: 'javascript',
    nodejs: 'javascript',
    shell: 'bash',
    sh: 'bash',
    'plain-text': 'plaintext',
    text: 'plaintext',
    csharp: 'csharp',
    'c#': 'csharp',
    cpp: 'cpp',
    'c++': 'cpp',
    'objective-c': 'objectivec',
    obj_c: 'objectivec',
  };
  const mapped = aliases[normalized] ?? normalized;
  return /^[a-zA-Z0-9_+.-]+$/.test(mapped) ? mapped : '';
}

export function renderBookmarkCardHtml(payload: unknown): string {
  const url = strProp(payload, 'url');
  if (!url) return '';
  const title = strDeep(payload, 'metadata', 'title') || strProp(payload, 'title');
  const description =
    strDeep(payload, 'metadata', 'description') || strProp(payload, 'description');
  const author = strDeep(payload, 'metadata', 'author') || strProp(payload, 'author');
  const publisher = strDeep(payload, 'metadata', 'publisher') || strProp(payload, 'publisher');
  const icon = strDeep(payload, 'metadata', 'icon') || strProp(payload, 'icon');
  const thumbnail = strDeep(payload, 'metadata', 'thumbnail') || strProp(payload, 'thumbnail');
  const caption = strProp(payload, 'caption');
  const metaInner = [
    icon ? `<img class="kg-bookmark-icon" src="${escapeAttr(icon)}" alt="">` : '',
    author ? `<span class="kg-bookmark-author">${escapeHtml(author)}</span>` : '',
    publisher ? `<span class="kg-bookmark-publisher">${escapeHtml(publisher)}</span>` : '',
  ]
    .filter((s) => s !== '')
    .join('');
  const meta = metaInner ? `<div class="kg-bookmark-metadata">${metaInner}</div>` : '';
  const content = `<div class="kg-bookmark-content">${title ? `<div class="kg-bookmark-title">${escapeHtml(title)}</div>` : ''}${description ? `<div class="kg-bookmark-description">${escapeHtml(description)}</div>` : ''}${meta}</div>`;
  const thumb = thumbnail
    ? `<div class="kg-bookmark-thumbnail"><img src="${escapeAttr(thumbnail)}" alt=""></div>`
    : '';
  return `<figure class="kg-card kg-bookmark-card${hasCaptionClass(caption)}"${captionFigureAttrs(caption)}><a class="kg-bookmark-container" href="${escapeAttr(url)}">${content}${thumb}</a>${figcaptionHtml(caption)}</figure>`;
}

export function renderCalloutCardHtml(payload: unknown): string {
  const emoji = strProp(payload, 'calloutEmoji');
  const color = strProp(payload, 'backgroundColor') || strProp(payload, 'color') || 'blue';
  const text = strProp(payload, 'calloutText');
  if (!text) return '';
  const emojiEl = emoji ? `<div class="kg-callout-emoji">${escapeHtml(emoji)}</div>` : '';
  const noIconClass = emoji ? '' : ' kg-callout-card-without-emoji';
  return `<div class="kg-card kg-callout-card kg-callout-card-${escapeAttr(color)}${noIconClass}">${emojiEl}<div class="kg-callout-text">${text}</div></div>`;
}

export function renderButtonCardHtml(payload: unknown): string {
  const url = strProp(payload, 'buttonUrl');
  const text = strProp(payload, 'buttonText');
  if (!url || !text) return '';
  const alignment = strProp(payload, 'alignment') || 'center';
  return `<div class="kg-card kg-button-card kg-align-${escapeAttr(alignment)}"><a href="${escapeAttr(url)}" class="kg-btn kg-btn-accent">${escapeHtml(text)}</a></div>`;
}

export function renderHeaderCardHtml(payload: unknown): string {
  const version = strProp(payload, 'version');
  const isV2 =
    version === 'v2' || strProp(payload, 'layout') !== '' || strProp(payload, 'alignment') !== '';
  return isV2 ? renderHeaderCardV2Html(payload) : renderHeaderCardV1Html(payload);
}

export function renderSignupCardHtml(payload: unknown): string {
  const heading = strProp(payload, 'heading') || strProp(payload, 'title');
  const subheading = strProp(payload, 'subheading') || strProp(payload, 'description');
  const buttonText =
    strProp(payload, 'buttonText') || strProp(payload, 'button_text') || 'Subscribe';
  const placeholder =
    strProp(payload, 'emailPlaceholder') ||
    strProp(payload, 'email_placeholder') ||
    'you@example.com';
  const disclaimer = strProp(payload, 'disclaimer');
  const image =
    strProp(payload, 'image') || strProp(payload, 'imageUrl') || strProp(payload, 'src');
  const layout = strProp(payload, 'layout');
  const style = strProp(payload, 'style');
  const classes = [
    'kg-card kg-signup-card',
    tokenClass('kg-width', strProp(payload, 'cardWidth') || strProp(payload, 'width')),
    tokenClass('kg-style', style),
    tokenClass('kg-align', strProp(payload, 'alignment') || strProp(payload, 'align')),
    layout ? tokenClass('kg-signup-card-image', layout) : '',
  ].join('');
  const imageHtml = image
    ? `<img class="kg-signup-card-image" src="${escapeAttr(image)}" alt="" loading="lazy">`
    : '';
  const headingHtml = heading
    ? `<h2 class="kg-signup-card-heading">${escapeHtml(heading)}</h2>`
    : '';
  const subheadingHtml = subheading
    ? `<p class="kg-signup-card-subheading">${escapeHtml(subheading)}</p>`
    : '';
  const buttonI18nAttr = buttonText === 'Subscribe' ? ' data-kg-i18n="Subscribe"' : '';
  const placeholderI18nAttr =
    placeholder === 'you@example.com' ? ' data-kg-i18n-placeholder="Your email address"' : '';
  const form = `<form class="kg-signup-card-form" data-members-form="signup"><div class="kg-signup-card-fields"><input class="kg-signup-card-input" type="email" name="email" placeholder="${escapeAttr(placeholder)}" required data-members-email${placeholderI18nAttr}></div><button class="kg-signup-card-button" type="submit"${buttonI18nAttr}>${escapeHtml(buttonText)}</button><p class="kg-signup-card-success" data-members-success hidden></p><p class="kg-signup-card-error" data-members-error hidden></p></form>`;
  const disclaimerHtml = disclaimer
    ? `<p class="kg-signup-card-disclaimer">${escapeHtml(disclaimer)}</p>`
    : '';
  return `<div class="${classes}">${imageHtml}<div class="kg-signup-card-content">${headingHtml}${subheadingHtml}${form}${disclaimerHtml}</div></div>`;
}

function renderHeaderCardV1Html(payload: unknown): string {
  const heading = strProp(payload, 'heading') || strProp(payload, 'header');
  const subheading = strProp(payload, 'subheading') || strProp(payload, 'subheader');
  const buttonHref = strProp(payload, 'buttonUrl') || strProp(payload, 'button_href');
  const buttonText = strProp(payload, 'buttonText') || strProp(payload, 'button_text');
  const buttonPortal = strProp(payload, 'buttonPortal') || strProp(payload, 'button_portal');
  if (!heading && !subheading && !buttonText) return '';
  const classes = [
    'kg-card kg-header-card',
    tokenClass('kg-width', strProp(payload, 'width') || strProp(payload, 'cardWidth')),
    tokenClass('kg-style', strProp(payload, 'style')),
    tokenClass('kg-size', strProp(payload, 'size')),
  ].join('');
  const headingHtml = heading
    ? `<h2 class="kg-header-card-heading">${escapeHtml(heading)}</h2>`
    : '';
  const subheadingHtml = subheading
    ? `<h3 class="kg-header-card-subheading">${escapeHtml(subheading)}</h3>`
    : '';
  const buttonHtml =
    buttonHref && buttonText
      ? `<a class="kg-header-card-button" href="${escapeAttr(buttonHref)}"${buttonPortal ? ` data-portal="${escapeAttr(buttonPortal)}"` : ''}>${escapeHtml(buttonText)}</a>`
      : '';
  return `<div class="${classes}">${headingHtml}${subheadingHtml}${buttonHtml}</div>`;
}

function renderHeaderCardV2Html(payload: unknown): string {
  const heading = strProp(payload, 'heading') || strProp(payload, 'header');
  const subheading = strProp(payload, 'subheading') || strProp(payload, 'subheader');
  const buttonHref = strProp(payload, 'buttonUrl') || strProp(payload, 'button_href');
  const buttonText = strProp(payload, 'buttonText') || strProp(payload, 'button_text');
  const backgroundImage =
    strProp(payload, 'backgroundImageSrc') || strProp(payload, 'background_image');
  if (!heading && !subheading && !buttonText && !backgroundImage) return '';
  const layout = strProp(payload, 'layout');
  const width = strProp(payload, 'width') || (layout && layout !== 'split' ? layout : '');
  const align = strProp(payload, 'alignment') || strProp(payload, 'align');
  const backgroundColor =
    strProp(payload, 'backgroundColor') || strProp(payload, 'background_color');
  const accent = strProp(payload, 'accentColor') || strProp(payload, 'accent');
  const textColor = strProp(payload, 'textColor') || strProp(payload, 'text_color');
  const buttonColor = strProp(payload, 'buttonColor') || strProp(payload, 'button_color');
  const buttonTextColor =
    strProp(payload, 'buttonTextColor') || strProp(payload, 'button_text_color');
  const style = strProp(payload, 'style') || (backgroundColor === 'accent' ? 'accent' : '');
  const classes = [
    'kg-card kg-header-card kg-v2',
    tokenClass('kg-width', width),
    layout === 'full' || strProp(payload, 'content_width') === 'wide' ? ' kg-content-wide' : '',
    tokenClass('kg-align', align),
    tokenClass('kg-style', style),
  ].join('');
  const rootStyle =
    safeHeaderHexColor(backgroundColor) && backgroundColor !== 'accent'
      ? ` style="background-color: ${escapeAttr(backgroundColor)};"`
      : '';
  const dataBackground = backgroundColor
    ? ` data-background-color="${escapeAttr(backgroundColor)}"`
    : '';
  const dataAccent = accent ? ` data-accent-color="${escapeAttr(accent)}"` : '';
  const imageHtml = backgroundImage
    ? `<picture><img class="kg-header-card-image" src="${escapeAttr(backgroundImage)}"${headerImageDimensionAttrs(payload)} loading="lazy" alt=""></picture>`
    : '';
  const textAttrs = safeHeaderHexColor(textColor)
    ? ` style="color: ${escapeAttr(textColor)};" data-text-color="${escapeAttr(textColor)}"`
    : '';
  const headingHtml = heading
    ? `<h2 class="kg-header-card-heading"${textAttrs}>${escapeHtml(heading)}</h2>`
    : '';
  const subheadingHtml = subheading
    ? `<p class="kg-header-card-subheading"${textAttrs}>${escapeHtml(subheading)}</p>`
    : '';
  const buttonStyle = [
    safeHeaderHexColor(buttonColor) && buttonColor !== 'accent'
      ? `background-color: ${buttonColor}`
      : '',
    safeHeaderHexColor(buttonTextColor) ? `color: ${buttonTextColor}` : '',
  ]
    .filter((s) => s !== '')
    .join('; ');
  const buttonStyleAttr = buttonStyle ? ` style="${escapeAttr(`${buttonStyle};`)}"` : '';
  const buttonDataColor = buttonColor ? ` data-button-color="${escapeAttr(buttonColor)}"` : '';
  const buttonDataTextColor = buttonTextColor
    ? ` data-button-text-color="${escapeAttr(buttonTextColor)}"`
    : '';
  const buttonClass =
    buttonColor === 'accent'
      ? 'kg-header-card-button kg-header-card-button-accent'
      : 'kg-header-card-button';
  const buttonPortal = strProp(payload, 'buttonPortal') || strProp(payload, 'button_portal');
  const buttonPortalAttr = buttonPortal ? ` data-portal="${escapeAttr(buttonPortal)}"` : '';
  const buttonHtml =
    buttonHref && buttonText
      ? `<a class="${buttonClass}" href="${escapeAttr(buttonHref)}"${buttonStyleAttr}${buttonDataColor}${buttonDataTextColor}${buttonPortalAttr}>${escapeHtml(buttonText)}</a>`
      : '';
  const textClass = `kg-header-card-text${tokenClass('kg-align', align)}`;
  return `<div class="${classes}"${rootStyle}${dataBackground}${dataAccent}>${imageHtml}<div class="kg-header-card-content"><div class="${textClass}">${headingHtml}${subheadingHtml}${buttonHtml}</div></div></div>`;
}

function headerImageDimensionAttrs(payload: unknown): string {
  const width =
    strProp(payload, 'backgroundImageWidth') || strProp(payload, 'background_image_width');
  const height =
    strProp(payload, 'backgroundImageHeight') || strProp(payload, 'background_image_height');
  return [
    width ? ` width="${escapeAttr(width)}"` : '',
    height ? ` height="${escapeAttr(height)}"` : '',
  ].join('');
}

function safeHeaderHexColor(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value);
}

export function renderEmbedCardHtml(payload: unknown): string {
  const html = strProp(payload, 'html');
  const url = strProp(payload, 'url');
  const caption = strProp(payload, 'caption');
  if (!html && !url) return '';
  const inner = html
    ? lazyLoadEmbedIframes(html)
    : `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
  return `<figure class="kg-card kg-embed-card${widthClass(payload)}${hasCaptionClass(caption)}"${captionFigureAttrs(caption)}>${inner}${figcaptionHtml(caption)}</figure>`;
}

function lazyLoadEmbedIframes(html: string): string {
  if (!/<iframe\b/i.test(html)) return html;
  const doc = parseDocument(html, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  });
  const changed = lazyLoadIframesInNodes(doc.children);
  return changed ? renderHtml(doc.children, { decodeEntities: false }) : html;
}

function lazyLoadIframesInNodes(nodes: ChildNode[]): boolean {
  let changed = false;
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.name.toLowerCase() === 'iframe' && node.attribs.loading !== 'lazy') {
      node.attribs.loading = 'lazy';
      changed = true;
    }
    changed = lazyLoadIframesInNodes(node.children) || changed;
  }
  return changed;
}

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

export function renderFileCardHtml(payload: unknown): string {
  const src = strProp(payload, 'href') || strProp(payload, 'src') || strProp(payload, 'fileSrc');
  if (!src) return '';
  const title = strProp(payload, 'fileTitle') || strProp(payload, 'title');
  const caption =
    strProp(payload, 'description') ||
    strProp(payload, 'fileCaption') ||
    strProp(payload, 'caption');
  const name = strProp(payload, 'name') || strProp(payload, 'fileName');
  const size = strProp(payload, 'size') || strProp(payload, 'fileSize');
  return `<div class="kg-card kg-file-card"><a class="kg-file-card-container" href="${escapeAttr(src)}">${title ? `<div class="kg-file-card-title">${escapeHtml(title)}</div>` : ''}${caption ? `<div class="kg-file-card-caption">${escapeHtml(caption)}</div>` : ''}${name ? `<div class="kg-file-card-filename">${escapeHtml(name)}</div>` : ''}${size ? `<div class="kg-file-card-filesize">${escapeHtml(size)}</div>` : ''}</a></div>`;
}

export function renderGalleryCardHtml(payload: unknown): string {
  const images = (payload as { images?: unknown }).images;
  if (!Array.isArray(images) || images.length === 0) return '';
  const caption = strProp(payload, 'caption');
  // Ghost renders galleries in rows of (typically) three. Preserve that
  // structure so the existing kg-gallery-card turndown rule can read it back.
  const rowsHtml: string[] = [];
  for (let i = 0; i < images.length; i += 3) {
    const row = images.slice(i, i + 3);
    const imgsHtml = row
      .map((img) => {
        const src = strProp(img, 'src');
        if (!src) return '';
        const alt = strProp(img, 'alt');
        const w = strProp(img, 'width');
        const h = strProp(img, 'height');
        const srcset = strProp(img, 'srcset');
        const sizes = strProp(img, 'sizes');
        const attrs = [
          `src="${escapeAttr(src)}"`,
          `alt="${escapeAttr(alt)}"`,
          w ? `width="${escapeAttr(w)}"` : '',
          h ? `height="${escapeAttr(h)}"` : '',
          srcset ? `srcset="${escapeAttr(srcset)}"` : '',
          sizes ? `sizes="${escapeAttr(sizes)}"` : '',
        ]
          .filter((s) => s !== '')
          .join(' ');
        return `<div class="kg-gallery-image"><img ${attrs}></div>`;
      })
      .filter((s) => s !== '')
      .join('');
    if (imgsHtml) rowsHtml.push(`<div class="kg-gallery-row">${imgsHtml}</div>`);
  }
  if (rowsHtml.length === 0) return '';
  return `<figure class="kg-card kg-gallery-card${widthClass(payload)}${hasCaptionClass(caption)}"${captionFigureAttrs(caption)}><div class="kg-gallery-container">${rowsHtml.join('')}</div>${figcaptionHtml(caption)}</figure>`;
}

export function renderAudioCardHtml(payload: unknown): string {
  const src = strProp(payload, 'src');
  if (!src) return '';
  const title = strProp(payload, 'title');
  const duration = strProp(payload, 'duration');
  const thumb = strProp(payload, 'thumbnailSrc');
  return `<div class="kg-card kg-audio-card">${thumb ? `<img src="${escapeAttr(thumb)}" alt="" class="kg-audio-thumbnail">` : ''}<audio src="${escapeAttr(src)}" preload="metadata" controls></audio>${title ? `<div class="kg-audio-title">${escapeHtml(title)}</div>` : ''}${duration ? `<div class="kg-audio-duration">${escapeHtml(duration)}</div>` : ''}</div>`;
}

export function renderVideoCardHtml(payload: unknown): string {
  const src = strProp(payload, 'src');
  if (!src) return '';
  const poster = strProp(payload, 'thumbnailSrc');
  const posterSrcset = strProp(payload, 'thumbnailSrcset') || strProp(payload, 'posterSrcset');
  const posterSizes = strProp(payload, 'thumbnailSizes') || strProp(payload, 'posterSizes');
  const caption = strProp(payload, 'caption');
  // Lexical payloads store width/height as numbers; Mobiledoc and ad-hoc
  // callers may pass strings. Accept either rather than silently dropping
  // the values when the JSON type isn't string.
  const w = dimensionProp(payload, 'width');
  const h = dimensionProp(payload, 'height');
  const videoAttrs = [
    `src="${escapeAttr(src)}"`,
    poster ? `poster="${escapeAttr(poster)}"` : '',
    w ? `width="${escapeAttr(w)}"` : '',
    h ? `height="${escapeAttr(h)}"` : '',
    'controls',
    `preload="metadata"`,
  ]
    .filter((s) => s !== '')
    .join(' ');
  // Surface the intrinsic aspect ratio as a CSS custom property so the
  // theme's `.kg-video-container { aspect-ratio: var(--aspect-ratio) }`
  // rule has a value to consume — without this the container collapses
  // to zero height before the video's metadata loads.
  const wNum = Number(w);
  const hNum = Number(h);
  const containerStyle =
    Number.isFinite(wNum) && Number.isFinite(hNum) && wNum > 0 && hNum > 0
      ? ` style="--aspect-ratio: ${wNum / hNum}"`
      : '';
  const posterImageAttrs = [
    poster ? `src="${escapeAttr(poster)}"` : '',
    posterSrcset ? `srcset="${escapeAttr(posterSrcset)}"` : '',
    posterSizes ? `sizes="${escapeAttr(posterSizes)}"` : '',
    'alt=""',
    'class="kg-video-thumbnail-image-card"',
    'loading="lazy"',
  ]
    .filter((s) => s !== '')
    .join(' ');
  const posterImage = posterSrcset || posterSizes ? `<img ${posterImageAttrs}>` : '';
  return `<figure class="kg-card kg-video-card${widthClass(payload)}${hasCaptionClass(caption)}"${captionFigureAttrs(caption)}><div class="kg-video-container"${containerStyle}>${posterImage}<video ${videoAttrs}></video></div>${figcaptionHtml(caption)}</figure>`;
}

function dimensionProp(obj: unknown, key: string): string {
  if (typeof obj !== 'object' || obj === null) return '';
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

export function renderToggleCardHtml(payload: unknown): string {
  const heading = strProp(payload, 'heading');
  const content = strProp(payload, 'content');
  if (!heading && !content) return '';
  const contentHtml = content ? (markdownRenderer.parse(content, { async: false }) as string) : '';
  return `<div class="kg-card kg-toggle-card"><div class="kg-toggle-heading"><h4 class="kg-toggle-heading-text">${escapeHtml(heading)}</h4></div><div class="kg-toggle-content">${contentHtml}</div></div>`;
}

export function renderProductCardHtml(payload: unknown): string {
  const title = strProp(payload, 'productTitle') || strProp(payload, 'title');
  const description = strProp(payload, 'productDescription') || strProp(payload, 'description');
  const image =
    strProp(payload, 'productImageSrc') ||
    strProp(payload, 'productImage') ||
    strProp(payload, 'image');
  const imageSrcset = strProp(payload, 'productImageSrcset') || strProp(payload, 'imageSrcset');
  const imageSizes = strProp(payload, 'productImageSizes') || strProp(payload, 'imageSizes');
  const buttonHref =
    strProp(payload, 'productUrl') ||
    strProp(payload, 'productButtonUrl') ||
    strProp(payload, 'buttonUrl') ||
    strProp(payload, 'url');
  const buttonText =
    strProp(payload, 'productButton') ||
    strProp(payload, 'productButtonText') ||
    strProp(payload, 'buttonText');
  const rating = dimensionProp(payload, 'productRating') || dimensionProp(payload, 'rating');
  if (!title && !description && !image && !buttonHref) return '';
  const imageHtml = image
    ? `<img class="kg-product-card-image" src="${escapeAttr(image)}"${imageSrcset ? ` srcset="${escapeAttr(imageSrcset)}"` : ''}${imageSizes ? ` sizes="${escapeAttr(imageSizes)}"` : ''} alt="">`
    : '';
  const titleHtml = title ? `<div class="kg-product-card-title">${escapeHtml(title)}</div>` : '';
  const ratingHtml =
    rating && /^\d+(?:\.\d+)?$/.test(rating)
      ? `<div class="kg-product-card-rating" data-rating="${escapeAttr(rating)}"></div>`
      : '';
  const descriptionHtml = renderProductDescriptionHtml(description);
  const buttonHtml =
    buttonHref && buttonText
      ? `<a class="kg-product-card-button kg-product-card-btn-accent" href="${escapeAttr(buttonHref)}">${escapeHtml(buttonText)}</a>`
      : '';
  return `<div class="kg-card kg-product-card${widthClass(payload)}"><div class="kg-product-card-container">${imageHtml}${titleHtml}${ratingHtml}${descriptionHtml}${buttonHtml}</div></div>`;
}

function renderProductDescriptionHtml(description: string): string {
  if (!description) return '';
  const trimmed = description.trim();
  const body = /^\s*<(?:p|ul|ol)\b/i.test(trimmed) ? description : `<p>${description}</p>`;
  return `<div class="kg-product-card-description">${body}</div>`;
}
