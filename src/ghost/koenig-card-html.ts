// Shared Koenig card → HTML renderers. Both the Lexical renderer (newer Ghost)
// and the Mobiledoc renderer (older Ghost) emit cards via these helpers so the
// downstream turndown pipeline sees the same kg-* class wrappers it already
// understands. The goal is "structurally identical to what Ghost would have
// rendered in `post.html`", not byte-for-byte parity — small attribute order
// or whitespace differences are fine.

import { Marked } from 'marked';

const markdownRenderer = new Marked({ gfm: true, breaks: false });

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
  return w && w !== 'regular' ? ` kg-width-${w}` : '';
}

function hasCaptionClass(caption: string): string {
  return caption ? ' kg-card-hascaption' : '';
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
  const figcap = caption ? `<figcaption>${caption}</figcaption>` : '';
  return `<figure class="kg-card kg-image-card${widthClass(payload)}${hasCaptionClass(caption)}">${wrapped}${figcap}</figure>`;
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
  const language = strProp(payload, 'language');
  const caption = strProp(payload, 'caption');
  const langClass = language ? ` class="language-${escapeAttr(language)}"` : '';
  const pre = `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
  if (!caption) return pre;
  return `<figure class="kg-card kg-code-card kg-card-hascaption">${pre}<figcaption>${caption}</figcaption></figure>`;
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
  const figcap = caption ? `<figcaption>${caption}</figcaption>` : '';
  return `<figure class="kg-card kg-bookmark-card${hasCaptionClass(caption)}"><a class="kg-bookmark-container" href="${escapeAttr(url)}">${content}${thumb}</a>${figcap}</figure>`;
}

export function renderCalloutCardHtml(payload: unknown): string {
  const emoji = strProp(payload, 'calloutEmoji');
  const color = strProp(payload, 'backgroundColor') || strProp(payload, 'color') || 'blue';
  const text = strProp(payload, 'calloutText');
  if (!text) return '';
  const emojiEl = emoji ? `<div class="kg-callout-emoji">${escapeHtml(emoji)}</div>` : '';
  return `<div class="kg-card kg-callout-card kg-callout-card-${escapeAttr(color)}">${emojiEl}<div class="kg-callout-text">${text}</div></div>`;
}

export function renderButtonCardHtml(payload: unknown): string {
  const url = strProp(payload, 'buttonUrl');
  const text = strProp(payload, 'buttonText');
  if (!url || !text) return '';
  const alignment = strProp(payload, 'alignment') || 'center';
  return `<div class="kg-card kg-button-card kg-align-${escapeAttr(alignment)}"><a href="${escapeAttr(url)}" class="kg-btn kg-btn-accent">${escapeHtml(text)}</a></div>`;
}

export function renderEmbedCardHtml(payload: unknown): string {
  const html = strProp(payload, 'html');
  const url = strProp(payload, 'url');
  const caption = strProp(payload, 'caption');
  if (!html && !url) return '';
  const inner = html || `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
  const figcap = caption ? `<figcaption>${caption}</figcaption>` : '';
  return `<figure class="kg-card kg-embed-card${hasCaptionClass(caption)}">${inner}${figcap}</figure>`;
}

export function renderFileCardHtml(payload: unknown): string {
  const src = strProp(payload, 'src') || strProp(payload, 'fileSrc');
  if (!src) return '';
  const title = strProp(payload, 'fileTitle') || strProp(payload, 'title');
  const caption = strProp(payload, 'fileCaption') || strProp(payload, 'caption');
  const name = strProp(payload, 'fileName');
  const size = strProp(payload, 'fileSize');
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
        const attrs = [
          `src="${escapeAttr(src)}"`,
          `alt="${escapeAttr(alt)}"`,
          w ? `width="${escapeAttr(w)}"` : '',
          h ? `height="${escapeAttr(h)}"` : '',
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
  const figcap = caption ? `<figcaption>${caption}</figcaption>` : '';
  return `<figure class="kg-card kg-gallery-card${hasCaptionClass(caption)}"><div class="kg-gallery-container">${rowsHtml.join('')}</div>${figcap}</figure>`;
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
  const figcap = caption ? `<figcaption>${caption}</figcaption>` : '';
  return `<figure class="kg-card kg-video-card${hasCaptionClass(caption)}"><div class="kg-video-container"${containerStyle}><video ${videoAttrs}></video></div>${figcap}</figure>`;
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
  const title = strProp(payload, 'productTitle');
  const description = strProp(payload, 'productDescription');
  if (!title && !description) return '';
  return `<div class="kg-card kg-product-card">${title ? `<div class="kg-product-card-title">${escapeHtml(title)}</div>` : ''}${description ? `<div class="kg-product-card-description">${description}</div>` : ''}</div>`;
}
