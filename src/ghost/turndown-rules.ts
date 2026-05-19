import sanitizeHtml, { type IOptions } from 'sanitize-html';
import TurndownService from 'turndown';

// Ghost emits Koenig "cards" as HTML wrappers (figure/div) with `kg-*` class
// names. Turndown's defaults treat any unknown element as transparent: it
// walks the children and drops the wrapper, so bookmark URLs, callout colors,
// gallery groupings, etc. are silently destroyed on import. The rules below
// inspect each known card and emit a self-describing shortcode so the
// metadata survives the round-trip into Markdown — even though no renderer
// currently consumes the shortcodes, preserving them avoids permanent data
// loss at import time.

type FilterNode = Parameters<TurndownService.FilterFunction>[0];

function hasClass(node: FilterNode, className: string): boolean {
  const c = node.getAttribute?.('class');
  if (!c) return false;
  return c.split(/\s+/).includes(className);
}

// Minimal DOM-like shape — Bun's TS lib doesn't include the DOM lib, so we
// cannot reference the global `Element` type. Turndown's filter callback
// hands us nodes that structurally satisfy this interface at runtime (via
// the `@mixmark-io/domino` parser turndown uses under the hood).
interface DomNode {
  readonly nodeName: string;
  readonly innerHTML: string;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomNode | null;
  querySelectorAll(selector: string): ArrayLike<DomNode>;
}

function classByPrefix(node: DomNode | null, prefix: string): string {
  const c = node?.getAttribute('class');
  if (!c) return '';
  const found = c
    .split(/\s+/)
    .find((cls: string) => cls.startsWith(prefix) && cls.length > prefix.length);
  return found ? found.slice(prefix.length) : '';
}

function attr(el: DomNode | null, name: string): string {
  if (!el) return '';
  const v = el.getAttribute(name);
  return v ? v.trim() : '';
}

function text(el: DomNode | null): string {
  return el?.textContent?.trim() ?? '';
}

// Map an embed URL's host to an oEmbed provider key the renderer can use to
// look up cached metadata. Ghost's export strips the original oEmbed `provider`
// field, so we recover it from the iframe src / blockquote anchor at import
// time — otherwise downstream re-rendering can't tell YouTube from Spotify
// without parsing the URL again.
function providerFromUrl(url: string): string {
  if (!url) return '';
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
  if (/(?:^|\.)(?:youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if (/(?:^|\.)vimeo\.com$/.test(host)) return 'vimeo';
  if (/(?:^|\.)spotify\.com$/.test(host)) return 'spotify';
  if (/(?:^|\.)soundcloud\.com$/.test(host)) return 'soundcloud';
  if (/(?:^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(?:^|\.)(?:twitter\.com|x\.com)$/.test(host)) return 'twitter';
  if (/(?:^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(?:^|\.)codepen\.io$/.test(host)) return 'codepen';
  return '';
}

function lastAnchorHref(node: DomNode): string {
  const anchors = Array.from(node.querySelectorAll('a') as ArrayLike<DomNode>);
  for (let i = anchors.length - 1; i >= 0; i--) {
    const href = attr(anchors[i], 'href');
    if (href) return href;
  }
  return '';
}

function escapeAttr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatAttrs(attrs: Record<string, string>): string {
  const pairs = Object.entries(attrs)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  return pairs.length ? ` ${pairs.join(' ')}` : '';
}

function shortcode(name: string, attrs: Record<string, string>): string {
  return `{{< ${name}${formatAttrs(attrs)} />}}`;
}

function shortcodeBlock(name: string, attrs: Record<string, string>, inner: string): string {
  return `{{< ${name}${formatAttrs(attrs)} >}}\n${inner}\n{{< /${name} >}}`;
}

function wrap(s: string): string {
  return `\n\n${s}\n\n`;
}

function isDataKgCard(node: FilterNode, ...types: readonly string[]): boolean {
  if (node.nodeName !== 'DIV') return false;
  const t = node.getAttribute?.('data-kg-card');
  return typeof t === 'string' && types.includes(t);
}

// Ghost emits four Koenig card types as HTML comment fences instead of class
// wrappers: `markdown`, `html`, `email`, `email-cta`. Turndown drops comments
// by default, which makes it impossible to detect where each card starts and
// ends — fatal for `email`/`email-cta` (members-only content that must NOT
// leak into a public static site) and lossy for `markdown`/`html` (where the
// raw user payload should survive the round-trip).
//
// This regex converts each fence pair into a `<div data-kg-card="X">…</div>`
// wrapper that dedicated Turndown rules can act on. The back-reference (`\1`)
// requires the closing fence to match the opening one, so an orphan or
// crossed-up fence is left alone (graceful degradation rather than silent
// truncation across an unrelated region).
const KG_CARD_FENCE_RE =
  /<!--\s*kg-card-begin:\s*([a-z-]+)\s*-->([\s\S]*?)<!--\s*kg-card-end:\s*\1\s*-->/g;

export function preprocessKoenigCardFences(html: string): string {
  return html.replace(
    KG_CARD_FENCE_RE,
    (_match, type: string, body: string) => `<div data-kg-card="${type}">${body}</div>`,
  );
}

// Sanitisation policy for Ghost HTML cards. Both the comment-fenced form
// (`<!--kg-card-begin: html-->…<!--kg-card-end: html-->`) and the class-wrapped
// form (`<div class="kg-html-card">…</div>`) carry arbitrary author-supplied
// HTML straight from Ghost's editor. Ghost itself does no scrubbing on export,
// so an HTML card lifted from a compromised or careless source can contain
// `<script>`, inline event handlers (`onclick`, `onerror`, …), or
// `javascript:` URLs that turn into stored XSS once the imported markdown is
// rendered.
//
// We strip the dangerous surface and keep the structural HTML authors actually
// reach for (custom layouts, inline `style="…"` attributes, tables, embeds).
// `<iframe>` is allowed but restricted to `https` so the common
// YouTube/CodePen/Spotify custom-embed use case survives; `<script>` and
// `<style>` block elements are dropped unconditionally — if an author needs a
// vendor widget loader or stylesheet they should inject it via the theme's
// `{{ghost_head}}` hook, not per-post HTML. See `docs/GHOST_COMPATIBILITY.md`
// for the rationale.
const HTML_CARD_SANITIZE_OPTIONS: IOptions = {
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
    'mark',
    'sub',
    'sup',
    'kbd',
    'abbr',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['id', 'class', 'lang', 'dir', 'title', 'style'],
    a: ['href', 'name', 'target', 'rel', 'hreflang'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
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
      'sandbox',
    ],
    source: ['src', 'srcset', 'type', 'media', 'sizes'],
    video: ['src', 'poster', 'controls', 'preload', 'width', 'height', 'muted', 'loop'],
    audio: ['src', 'controls', 'preload', 'loop'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    abbr: ['title'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
    source: ['http', 'https'],
    video: ['http', 'https'],
    audio: ['http', 'https'],
    iframe: ['https'],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

export function sanitizeImportedHtmlCard(html: string): string {
  return sanitizeHtml(html, HTML_CARD_SANITIZE_OPTIONS).trim();
}

// kg-card classes that get their own rule. The plain-figure fallback uses this
// list to avoid claiming a figure that belongs to a more specific card.
const FIGURE_CARD_SUBTYPES = [
  'kg-image-card',
  'kg-bookmark-card',
  'kg-gallery-card',
  'kg-embed-card',
  'kg-video-card',
  'kg-audio-card',
  'kg-file-card',
] as const;

export function registerGhostCardRules(turndown: TurndownService): void {
  // Bookmark card: <figure class="kg-card kg-bookmark-card"><a href><...>
  turndown.addRule('kg-bookmark-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-bookmark-card'),
    replacement: (_content, node) => {
      const anchor = node.querySelector('a.kg-bookmark-container') ?? node.querySelector('a');
      return wrap(
        shortcode('bookmark', {
          url: attr(anchor, 'href'),
          title: text(node.querySelector('.kg-bookmark-title')),
          description: text(node.querySelector('.kg-bookmark-description')),
          author: text(node.querySelector('.kg-bookmark-author')),
          publisher: text(node.querySelector('.kg-bookmark-publisher')),
          icon: attr(node.querySelector('.kg-bookmark-icon'), 'src'),
          thumbnail: attr(node.querySelector('.kg-bookmark-thumbnail img'), 'src'),
          caption: text(node.querySelector('figcaption')),
        }),
      );
    },
  });

  // Gallery card: <figure class="kg-card kg-gallery-card"><div.kg-gallery-container>
  //   <div class="kg-gallery-row">
  //     <div class="kg-gallery-image"><img src width height /></div> × N (typically up to 3)
  //   </div> × M (typically up to 3, giving 9 images max)
  //   <figcaption>…</figcaption>
  //
  // Ghost groups images into rows of (usually) three and relies on each image's
  // intrinsic width/height to compute `flex-grow` per row — that's what gives
  // the masonry look. Flattening to `![alt](src)` lines (the default turndown
  // behaviour) drops both the row boundaries and the dimensions, leaving the
  // gallery shape unrecoverable on the way back. Emit a nested shortcode that
  // keeps each row explicit and carries the dimensions on every image;
  // renderers without row support can flatten by ignoring the wrapper.
  turndown.addRule('kg-gallery-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-gallery-card'),
    replacement: (_content, node) => {
      const seen = new Set<string>();
      const renderImage = (img: DomNode): string => {
        const src = attr(img, 'src');
        if (!src || seen.has(src)) return '';
        seen.add(src);
        return shortcode('gallery-image', {
          src,
          alt: attr(img, 'alt'),
          width: attr(img, 'width'),
          height: attr(img, 'height'),
        });
      };
      const renderRow = (rowImgs: DomNode[]): string => {
        const lines = rowImgs.map(renderImage).filter((s) => s !== '');
        return lines.length === 0 ? '' : shortcodeBlock('gallery-row', {}, lines.join('\n'));
      };

      const rows: string[] = [];
      const rowNodes = Array.from(node.querySelectorAll('.kg-gallery-row') as ArrayLike<DomNode>);
      for (const row of rowNodes) {
        const rowImgs = Array.from(row.querySelectorAll('img') as ArrayLike<DomNode>);
        const block = renderRow(rowImgs);
        if (block) rows.push(block);
      }

      // Fallback for galleries without explicit row wrappers (older themes /
      // hand-written HTML). Group every image into a single synthesized row so
      // the shortcode shape stays consistent regardless of source structure.
      if (rows.length === 0) {
        const block = renderRow(Array.from(node.querySelectorAll('img') as ArrayLike<DomNode>));
        if (block) rows.push(block);
      }

      return wrap(
        shortcodeBlock(
          'gallery',
          { caption: text(node.querySelector('figcaption')) },
          rows.join('\n'),
        ),
      );
    },
  });

  // Embed card: <figure class="kg-card kg-embed-card">
  //   - <iframe>                 (YouTube / Vimeo / Spotify / SoundCloud / TikTok / CodePen / …)
  //   - <blockquote.twitter-tweet>   (Twitter/X — hydrated client-side via widgets.js)
  //   - <blockquote.instagram-media> (Instagram — hydrated client-side via embed.js)
  //   - <a> only                 (generic "rich"/"link" oEmbed fallback)
  //
  // Default turndown drops the iframe entirely and reduces social blockquotes
  // to a plain quoted line without their hydration script, so the embed
  // becomes invisible (video) or context-less plain text (social). The
  // shortcode below carries the source URL plus an inferred provider so the
  // renderer can re-resolve oEmbed at build time against a cache.
  turndown.addRule('kg-embed-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-embed-card'),
    replacement: (_content, node) => {
      const caption = text(node.querySelector('figcaption'));

      const iframe = node.querySelector('iframe');
      if (iframe) {
        const url = attr(iframe, 'src');
        return wrap(
          shortcode('embed', {
            url,
            provider: providerFromUrl(url),
            title: attr(iframe, 'title'),
            width: attr(iframe, 'width'),
            height: attr(iframe, 'height'),
            caption,
          }),
        );
      }

      const twitter = node.querySelector('blockquote.twitter-tweet');
      if (twitter) {
        return wrap(
          shortcode('embed', {
            url: lastAnchorHref(twitter),
            provider: 'twitter',
            caption,
          }),
        );
      }

      const instagram = node.querySelector('blockquote.instagram-media');
      if (instagram) {
        const permalink = attr(instagram, 'data-instgrm-permalink');
        return wrap(
          shortcode('embed', {
            url: permalink || lastAnchorHref(instagram),
            provider: 'instagram',
            caption,
          }),
        );
      }

      const fallbackAnchor = node.querySelector('a');
      if (fallbackAnchor) {
        const url = attr(fallbackAnchor, 'href');
        return wrap(
          shortcode('embed', {
            url,
            provider: providerFromUrl(url),
            caption,
          }),
        );
      }

      return '';
    },
  });

  // Video card: <figure class="kg-card kg-video-card">...<video>
  turndown.addRule('kg-video-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-video-card'),
    replacement: (_content, node) => {
      const video = node.querySelector('video');
      const src = attr(video, 'src') || attr(video?.querySelector('source') ?? null, 'src');
      return wrap(
        shortcode('video', {
          src,
          poster: attr(video, 'poster'),
          width: attr(video, 'width'),
          height: attr(video, 'height'),
          caption: text(node.querySelector('figcaption')),
        }),
      );
    },
  });

  // Audio card: <div class="kg-card kg-audio-card">...<audio>
  turndown.addRule('kg-audio-card', {
    filter: (node) =>
      (node.nodeName === 'DIV' || node.nodeName === 'FIGURE') && hasClass(node, 'kg-audio-card'),
    replacement: (_content, node) => {
      const audio = node.querySelector('audio');
      const src = attr(audio, 'src') || attr(audio?.querySelector('source') ?? null, 'src');
      return wrap(
        shortcode('audio', {
          src,
          title: text(node.querySelector('.kg-audio-title')),
          duration: text(node.querySelector('.kg-audio-duration')),
          thumbnail: attr(node.querySelector('img.kg-audio-thumbnail'), 'src'),
        }),
      );
    },
  });

  // File card: <div class="kg-card kg-file-card"><a><...>
  turndown.addRule('kg-file-card', {
    filter: (node) =>
      (node.nodeName === 'DIV' || node.nodeName === 'FIGURE') && hasClass(node, 'kg-file-card'),
    replacement: (_content, node) => {
      const anchor = node.querySelector('a.kg-file-card-container') ?? node.querySelector('a');
      return wrap(
        shortcode('file', {
          src: attr(anchor, 'href'),
          title: text(node.querySelector('.kg-file-card-title')),
          caption: text(node.querySelector('.kg-file-card-caption')),
          name: text(node.querySelector('.kg-file-card-filename')),
          size: text(node.querySelector('.kg-file-card-filesize')),
        }),
      );
    },
  });

  // Image card: <figure class="kg-card kg-image-card"><img><figcaption>
  turndown.addRule('kg-image-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-image-card'),
    replacement: (_content, node) => {
      const img = node.querySelector('img');
      if (!img) return '';
      return wrap(
        shortcode('figure', {
          src: attr(img, 'src'),
          alt: attr(img, 'alt'),
          width: attr(img, 'width'),
          height: attr(img, 'height'),
          size: classByPrefix(node, 'kg-width-'),
          caption: text(node.querySelector('figcaption')),
        }),
      );
    },
  });

  // Callout card: <div class="kg-card kg-callout-card kg-callout-card-{color}">
  //   <div class="kg-callout-emoji">💡</div>
  //   <div class="kg-callout-text">body</div>
  // Re-run turndown on the inner text element so nested markdown is preserved.
  turndown.addRule('kg-callout-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-callout-card'),
    replacement: (_content, node) => {
      const emoji = text(node.querySelector('.kg-callout-emoji'));
      const color = classByPrefix(node, 'kg-callout-card-');
      const textEl = node.querySelector('.kg-callout-text');
      const inner = textEl ? turndown.turndown(textEl.innerHTML).trim() : '';
      return wrap(shortcodeBlock('callout', { emoji, color }, inner));
    },
  });

  // Toggle card: <div class="kg-card kg-toggle-card">
  //   <div class="kg-toggle-heading"><h4 class="kg-toggle-heading-text">Heading</h4></div>
  //   <div class="kg-toggle-content">body</div>
  turndown.addRule('kg-toggle-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-toggle-card'),
    replacement: (_content, node) => {
      const heading = text(node.querySelector('.kg-toggle-heading-text'));
      const contentEl = node.querySelector('.kg-toggle-content');
      const inner = contentEl ? turndown.turndown(contentEl.innerHTML).trim() : '';
      return wrap(shortcodeBlock('toggle', { heading }, inner));
    },
  });

  // Button card: <div class="kg-card kg-button-card kg-align-{align}"><a.kg-btn>label</a>
  turndown.addRule('kg-button-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-button-card'),
    replacement: (_content, node) => {
      const anchor = node.querySelector('a.kg-btn') ?? node.querySelector('a');
      if (!anchor) return '';
      return wrap(
        shortcodeBlock(
          'button',
          {
            href: attr(anchor, 'href'),
            align: classByPrefix(node, 'kg-align-'),
            style: classByPrefix(anchor, 'kg-btn-'),
          },
          text(anchor),
        ),
      );
    },
  });

  // HTML card: <div class="kg-card kg-html-card">...raw HTML...</div>
  // Preserve the inner HTML so handcrafted layouts survive, but pass it
  // through `sanitizeImportedHtmlCard` first to strip the stored-XSS surface
  // (`<script>`, event-handler attributes, `javascript:` URLs). See the
  // policy comment on `HTML_CARD_SANITIZE_OPTIONS` for what stays vs goes.
  turndown.addRule('kg-html-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-html-card'),
    replacement: (_content, node) => {
      const inner = sanitizeImportedHtmlCard(node.innerHTML);
      return inner ? wrap(inner) : '';
    },
  });

  // Product / NFT / Header cards are less common but worth preserving rather
  // than dropping. Emit a generic kg-card shortcode that captures the inner
  // HTML so a later renderer can re-style without re-importing.
  turndown.addRule('kg-product-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-product-card'),
    replacement: (_content, node) => {
      return wrap(
        shortcode('product', {
          title: text(node.querySelector('.kg-product-card-title')),
          description: text(node.querySelector('.kg-product-card-description')),
          image: attr(node.querySelector('.kg-product-card-image'), 'src'),
          rating: attr(node.querySelector('.kg-product-card-rating'), 'data-rating'),
          'button-href': attr(node.querySelector('a.kg-product-card-button'), 'href'),
          'button-text': text(node.querySelector('.kg-product-card-button')),
        }),
      );
    },
  });

  // Standalone <figure><img>[+figcaption]</figure> that is NOT one of the
  // kg-card subtypes already handled. Preserves the caption that Turndown's
  // default would otherwise turn into trailing text adjacent to the image.
  turndown.addRule('plain-figure-with-img', {
    filter: (node) => {
      if (node.nodeName !== 'FIGURE') return false;
      if (!node.querySelector('img')) return false;
      return !FIGURE_CARD_SUBTYPES.some((c) => hasClass(node, c));
    },
    replacement: (_content, node) => {
      const img = node.querySelector('img');
      if (!img) return '';
      const caption = text(node.querySelector('figcaption'));
      const src = attr(img, 'src');
      const alt = attr(img, 'alt');
      if (!caption) return wrap(`![${alt}](${src})`);
      return wrap(
        shortcode('figure', {
          src,
          alt,
          width: attr(img, 'width'),
          height: attr(img, 'height'),
          caption,
        }),
      );
    },
  });

  // <picture> wraps an <img> with <source> fallbacks. Default behaviour drops
  // the wrapper and the alternate sources; instead, fall back to the inner
  // <img>'s src/alt which is the lowest-common-denominator markdown image.
  turndown.addRule('picture-element', {
    filter: (node) => node.nodeName === 'PICTURE',
    replacement: (_content, node) => {
      const img = node.querySelector('img');
      if (!img) return '';
      const src = attr(img, 'src');
      if (!src) return '';
      return `![${attr(img, 'alt')}](${src})`;
    },
  });

  // Comment-fence cards (preprocessed by `preprocessKoenigCardFences` into
  // `<div data-kg-card="X">` wrappers).
  //
  // `email` / `email-cta`: members-only content (paid-newsletter intros and
  // CTAs). Stripping them outright is non-negotiable — a public static site
  // must never expose this content.
  turndown.addRule('kg-card-fence-email', {
    filter: (node) => isDataKgCard(node, 'email', 'email-cta'),
    replacement: () => '',
  });

  // `html`: Ghost emits the card without the `kg-html-card` div in `post.html`,
  // so the comment fence is the only signal that this region is hand-crafted
  // HTML. Preserve the structure (attributes, inline styles, layout) but
  // route it through `sanitizeImportedHtmlCard` first — without it, any
  // `<script>` an author embedded in the editor reaches the rendered page
  // as stored XSS.
  turndown.addRule('kg-card-fence-html', {
    filter: (node) => isDataKgCard(node, 'html'),
    replacement: (_content, node) => {
      const inner = sanitizeImportedHtmlCard(node.innerHTML);
      return inner ? wrap(inner) : '';
    },
  });

  // `markdown` cards intentionally have no rule: Ghost has already rendered
  // the user's markdown to HTML before export, so the default `<div>`
  // walk-through behaviour converts the children back to markdown — and any
  // nested kg-* card rules inside still fire.

  // Inline semantic tags markdown has no syntax for. Keeping them as HTML is
  // strictly better than silently flattening to plain text.
  turndown.keep(['mark', 'sub', 'sup', 'details', 'summary', 'kbd', 'abbr']);
}

export function createGhostTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  registerGhostCardRules(turndown);
  return turndown;
}
