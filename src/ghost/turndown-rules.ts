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
  readonly attributes?: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly childNodes?: ArrayLike<DomNode>;
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

function directChildText(node: DomNode, nodeName: string): string {
  const wanted = nodeName.toUpperCase();
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeName === wanted) return text(child);
  }
  return '';
}

function html(el: DomNode | null): string {
  return el?.innerHTML?.trim() ?? '';
}

function firstText(node: DomNode, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const found = text(node.querySelector(selector));
    if (found) return found;
  }
  return '';
}

function styleValue(el: DomNode | null, property: string): string {
  const style = attr(el, 'style');
  if (!style) return '';
  const target = property.toLowerCase();
  for (const declaration of style.split(';')) {
    const index = declaration.indexOf(':');
    if (index === -1) continue;
    const name = declaration.slice(0, index).trim().toLowerCase();
    if (name !== target) continue;
    return declaration.slice(index + 1).trim();
  }
  return '';
}

function classTokens(node: DomNode | null): string[] {
  return (node?.getAttribute('class') ?? '').split(/\s+/).filter((cls) => cls !== '');
}

function normalizeCodeLanguage(raw: string): string {
  return raw
    .trim()
    .replace(/^language-/, '')
    .replace(/^lang-/, '');
}

function codeCardLanguage(card: DomNode, pre: DomNode | null, code: DomNode | null): string {
  for (const node of [code, pre, card]) {
    const fromAttr =
      attr(node, 'data-language') || attr(node, 'data-lang') || attr(node, 'language');
    if (fromAttr) return normalizeCodeLanguage(fromAttr);

    const fromClass = classTokens(node).find(
      (cls) => cls.startsWith('language-') || cls.startsWith('lang-'),
    );
    if (fromClass) return normalizeCodeLanguage(fromClass);
  }
  return '';
}

function codeCardLineNumberClass(card: DomNode, pre: DomNode | null, code: DomNode | null): string {
  for (const node of [card, pre, code]) {
    const found = classTokens(node).find(
      (cls) => cls === 'linenums' || cls.startsWith('linenums:') || cls.includes('line-number'),
    );
    if (found) return found;
  }
  return '';
}

function fencedCodeBlock(code: string, language: string): string {
  const longestFence = Math.max(
    2,
    ...Array.from(code.matchAll(/`+/g), (match) => match[0]?.length ?? 0),
  );
  const fence = '`'.repeat(Math.max(3, longestFence + 1));
  const info = language.replace(/`/g, '').trim();
  return `${fence}${info}\n${code.replace(/\n$/, '')}\n${fence}`;
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
  if (/(?:^|\.)(?:soundcloud\.com|w\.soundcloud\.com|api\.soundcloud\.com)$/.test(host))
    return 'soundcloud';
  if (/(?:^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(?:^|\.)(?:twitter\.com|x\.com)$/.test(host)) return 'twitter';
  if (/(?:^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(?:^|\.)codepen\.io$/.test(host)) return 'codepen';
  if (host === 'gist.github.com') return 'gist';
  if (/(?:^|\.)figma\.com$/.test(host)) return 'figma';
  if (/(?:^|\.)loom\.com$/.test(host)) return 'loom';
  if (/(?:^|\.)bandcamp\.com$/.test(host)) return 'bandcamp';
  if (/(?:^|\.)music\.apple\.com$/.test(host)) return 'apple-music';
  if (/(?:^|\.)pinterest\.(?:com|[a-z.]+)$/.test(host)) return 'pinterest';
  if (/(?:^|\.)reddit\.com$/.test(host)) return 'reddit';
  if (/(?:^|\.)slideshare\.net$/.test(host)) return 'slideshare';
  return '';
}

function sourceUrlFromEmbedUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (url.hostname.toLowerCase() === 'www.figma.com' && url.pathname === '/embed') {
    const source = url.searchParams.get('url');
    if (source && /^https?:\/\//i.test(source)) return source;
  }

  if (url.hostname.toLowerCase() === 'gist.github.com' && url.pathname.endsWith('.js')) {
    url.pathname = url.pathname.replace(/\.js$/, '');
    url.search = '';
    return url.toString();
  }

  if (url.hostname.toLowerCase().endsWith('codepen.io')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const embedIndex = parts.indexOf('embed');
    if (embedIndex > 0 && parts[embedIndex + 1]) {
      return `https://codepen.io/${parts[embedIndex - 1]}/pen/${parts[embedIndex + 1]}`;
    }
  }

  if (url.hostname.toLowerCase() === 'w.soundcloud.com' && url.pathname.startsWith('/player')) {
    const source = url.searchParams.get('url');
    if (source && /^https?:\/\//i.test(source)) return source;
  }

  return rawUrl;
}

// Return the href of the first <a> inside a figure that wraps an <img>. Skips
// anchors inside figcaption (which carry markdown caption links, not the
// image's click target).
function imageWrapAnchorHref(figure: DomNode): string {
  const anchors = Array.from(figure.querySelectorAll('a') as ArrayLike<DomNode>);
  for (const a of anchors) {
    if (a.querySelector('img')) {
      return attr(a, 'href');
    }
  }
  return '';
}

function pictureSourceAttrs(node: DomNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  const sources = Array.from(node.querySelectorAll('source') as ArrayLike<DomNode>);
  sources.forEach((source, index) => {
    const prefix = `source${index + 1}_`;
    attrs[`${prefix}srcset`] = attr(source, 'srcset');
    attrs[`${prefix}src`] = attr(source, 'src');
    attrs[`${prefix}type`] = attr(source, 'type');
    attrs[`${prefix}media`] = attr(source, 'media');
    attrs[`${prefix}sizes`] = attr(source, 'sizes');
  });
  return attrs;
}

function lastAnchorHref(node: DomNode): string {
  const anchors = Array.from(node.querySelectorAll('a') as ArrayLike<DomNode>);
  for (let i = anchors.length - 1; i >= 0; i--) {
    const href = attr(anchors[i], 'href');
    if (href) return href;
  }
  return '';
}

function twitterDnt(node: DomNode, rawUrl: string): string {
  const dataDnt = attr(node, 'data-dnt').toLowerCase();
  if (dataDnt === 'true' || dataDnt === '1') return 'true';
  try {
    return new URL(rawUrl).searchParams.get('dnt') === '1' ? 'true' : '';
  } catch {
    return '';
  }
}

function backgroundImageUrlFromStyle(style: string): string {
  const match = style.match(
    /(?:^|;)\s*background-image\s*:\s*url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/i,
  );
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function escapeAttr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeHtmlAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function liquidShortcode(name: string, attrs: Record<string, string>): string {
  return `{% ${name}${formatAttrs(attrs)} %}`;
}

function shortcodeBlock(name: string, attrs: Record<string, string>, inner: string): string {
  return `{{< ${name}${formatAttrs(attrs)} >}}\n${inner}\n{{< /${name} >}}`;
}

function wrap(s: string): string {
  return `\n\n${s}\n\n`;
}

function formatHtmlAttrs(attrs: Array<[string, string]>): string {
  const pairs = attrs
    .filter(([name, value]) => /^[a-zA-Z_:][\w:.-]*$/.test(name) && value !== '')
    .map(([name, value]) => `${name}="${escapeHtmlAttr(value)}"`);
  return pairs.length ? ` ${pairs.join(' ')}` : '';
}

function dataAttrs(node: DomNode): Array<[string, string]> {
  const attrs = Array.from(node.attributes ?? []);
  return attrs
    .filter(({ name }) => name.toLowerCase().startsWith('data-'))
    .map(({ name, value }) => [name, value] as [string, string]);
}

function hasAttr(el: DomNode | null, name: string): boolean {
  return el ? el.getAttribute(name) !== null : false;
}

function isDataKgCard(node: FilterNode, ...types: readonly string[]): boolean {
  if (node.nodeName !== 'DIV') return false;
  const t = node.getAttribute?.('data-kg-card');
  return typeof t === 'string' && types.includes(t);
}

// Ghost emits several Koenig card types as HTML comment fences instead of class
// wrappers. Turndown drops comments by default, which makes it impossible to
// detect where each card starts and ends — fatal for `email`/`email-cta`
// (members-only content that must NOT leak into a public static site), lossy
// for `markdown`/`html` (where the raw user payload should survive the
// round-trip), and boundary-breaking for paywall comments.
//
// This regex converts each fence pair into a `<div data-kg-card="X">…</div>`
// wrapper that dedicated Turndown rules can act on. The back-reference (`\1`)
// requires the closing fence to match the opening one, so an orphan or
// crossed-up fence is left alone (graceful degradation rather than silent
// truncation across an unrelated region).
const KG_CARD_FENCE_RE =
  /<!--\s*kg-card-begin:\s*([a-z-]+)\s*-->([\s\S]*?)<!--\s*kg-card-end:\s*\1\s*-->/g;
const MEMBERS_ONLY_PAYWALL_RE = /<!--\s*members-only\s*-->/gi;

export function preprocessKoenigCardFences(html: string): string {
  return html
    .replace(MEMBERS_ONLY_PAYWALL_RE, '<div data-kg-card="paywall">members-only</div>')
    .replace(
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
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
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
  'kg-code-card',
  'kg-video-card',
  'kg-audio-card',
  'kg-file-card',
  'kg-nft-card',
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
          srcset: attr(img, 'srcset'),
          sizes: attr(img, 'sizes'),
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
          {
            caption: directChildText(node, 'figcaption'),
            size: classByPrefix(node, 'kg-width-'),
          },
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
        const rawUrl = attr(iframe, 'src');
        const url = sourceUrlFromEmbedUrl(rawUrl);
        return wrap(
          shortcode('embed', {
            url,
            provider: providerFromUrl(url) || providerFromUrl(rawUrl),
            title: attr(iframe, 'title'),
            width: attr(iframe, 'width'),
            height: attr(iframe, 'height'),
            caption,
            size: classByPrefix(node, 'kg-width-'),
          }),
        );
      }

      const twitter = node.querySelector('blockquote.twitter-tweet');
      if (twitter) {
        const url = lastAnchorHref(twitter);
        return wrap(
          shortcode('embed', {
            url,
            provider: 'twitter',
            'blockquote-class': attr(twitter, 'class'),
            dnt: twitterDnt(twitter, url),
            caption,
            size: classByPrefix(node, 'kg-width-'),
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
            size: classByPrefix(node, 'kg-width-'),
          }),
        );
      }

      const script = node.querySelector('script');
      if (script) {
        const rawUrl = attr(script, 'src');
        const url = sourceUrlFromEmbedUrl(rawUrl);
        if (url) {
          return wrap(
            shortcode('embed', {
              url,
              provider: providerFromUrl(url) || providerFromUrl(rawUrl),
              caption,
              size: classByPrefix(node, 'kg-width-'),
            }),
          );
        }
      }

      const fallbackAnchor = node.querySelector('a');
      if (fallbackAnchor) {
        const rawUrl = attr(fallbackAnchor, 'href');
        const url = sourceUrlFromEmbedUrl(rawUrl);
        return wrap(
          shortcode('embed', {
            url,
            provider: providerFromUrl(url) || providerFromUrl(rawUrl),
            caption,
            size: classByPrefix(node, 'kg-width-'),
          }),
        );
      }

      return '';
    },
  });

  // Code card: <figure class="kg-card kg-code-card"><pre><code>...</code></pre>
  //
  // Ghost has emitted the selected language in a few places over time:
  // `data-language` on the figure/pre/code wrapper, `language-*` on `<pre>`,
  // or `language-*` on `<code>`. Turndown only reads the `<code>` class, so a
  // card-level rule is needed to keep pre/data-language variants, figcaption,
  // and line-number classes from disappearing during import.
  turndown.addRule('kg-code-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-code-card'),
    replacement: (_content, node) => {
      const pre = node.querySelector('pre');
      const code = node.querySelector('code');
      const body = code?.textContent ?? pre?.textContent ?? '';
      const language = codeCardLanguage(node, pre, code);
      const caption = text(node.querySelector('figcaption'));
      const lineNumberClass = codeCardLineNumberClass(node, pre, code);
      const fenced = fencedCodeBlock(body, language);

      if (!caption && !lineNumberClass) return wrap(fenced);
      return wrap(
        shortcodeBlock(
          'code',
          {
            language,
            caption,
            'line-number-class': lineNumberClass,
          },
          fenced,
        ),
      );
    },
  });

  // Raw HTML fallback for older/partial exports that contain only
  // `<pre><code>` without the `kg-code-card` wrapper. Turndown's built-in
  // fenced-code rule reads `language-*` from `<code>` only, so preserve Ghost's
  // historical `data-language` and `<pre class="language-*">` variants too.
  turndown.addRule('plain-pre-code-language', {
    filter: (node) => node.nodeName === 'PRE' && node.querySelector('code') !== null,
    replacement: (_content, node) => {
      const code = node.querySelector('code');
      const body = code?.textContent ?? node.textContent ?? '';
      const language = codeCardLanguage(node, node, code);
      return wrap(fencedCodeBlock(body, language));
    },
  });

  // Video card: <figure class="kg-card kg-video-card">...<video>...<track>...
  //
  // Koenig stores three distinct asset types on a video card and Ghost's export
  // scatters them into three different content subdirs (issue #99):
  //   - poster image → /content/images/    (`poster=` attr on <video>)
  //   - video file   → /content/media/     (<video src> or <source src>)
  //   - caption VTT  → /content/files/     (<track src kind="captions|subtitles">)
  // Without explicit track capture, turndown's default walk drops the <track>
  // children, leaving the .vtt file orphaned on disk after import.
  //
  // Issue #100 extends this with the layout/playback metadata Ghost stores on
  // the surrounding wrapper:
  //   - aspect ratio   → `<div class="kg-video-container" style="--aspect-ratio: 1.777">`
  //                      (a CSS custom prop that drives the player's intrinsic
  //                      box; without it the renderer either reflows on load or
  //                      collapses to zero height)
  //   - loop / preload / playsinline / muted / controls → boolean / valued
  //                      attrs on <video>. Default turndown drops the element
  //                      entirely, so even the truthy boolean form is lost.
  // Emit a nested `{{< video-track />}}` shortcode per track and surface the
  // wrapper/playback attrs on the parent `{{< video … >}}` shortcode so all of
  // poster + media + captions + layout round-trip through the markdown.
  turndown.addRule('kg-video-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-video-card'),
    replacement: (_content, node) => {
      const video = node.querySelector('video');
      const src = attr(video, 'src') || attr(video?.querySelector('source') ?? null, 'src');
      const container = node.querySelector('.kg-video-container');
      const containerStyle = attr(container, 'style');
      const aspectMatch = containerStyle.match(/--aspect-ratio\s*:\s*([0-9.]+)/);
      const aspect = aspectMatch ? aspectMatch[1] : '';
      const booleanAttr = (el: DomNode | null, name: string): string => {
        if (!el) return '';
        const v = el.getAttribute(name);
        return v === null ? '' : 'true';
      };
      const attrs = {
        src,
        poster: attr(video, 'poster'),
        width: attr(video, 'width'),
        height: attr(video, 'height'),
        aspect,
        loop: booleanAttr(video, 'loop'),
        muted: booleanAttr(video, 'muted'),
        controls: booleanAttr(video, 'controls'),
        playsinline: booleanAttr(video, 'playsinline'),
        preload: attr(video, 'preload'),
        caption: text(node.querySelector('figcaption')),
        size: classByPrefix(node, 'kg-width-'),
      };
      const trackEls = video
        ? Array.from(video.querySelectorAll('track') as ArrayLike<DomNode>)
        : [];
      if (trackEls.length === 0) {
        return wrap(shortcode('video', attrs));
      }
      const inner = trackEls
        .map((t) =>
          shortcode('video-track', {
            src: attr(t, 'src'),
            kind: attr(t, 'kind'),
            srclang: attr(t, 'srclang'),
            label: attr(t, 'label'),
            default: t.getAttribute('default') !== null ? 'true' : '',
          }),
        )
        .filter((line) => line.includes('src='))
        .join('\n');
      if (!inner) {
        return wrap(shortcode('video', attrs));
      }
      return wrap(shortcodeBlock('video', attrs, inner));
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
          href: attr(anchor, 'href'),
          title: text(node.querySelector('.kg-file-card-title')),
          description: text(node.querySelector('.kg-file-card-caption')),
          name: text(node.querySelector('.kg-file-card-filename')),
          size: text(node.querySelector('.kg-file-card-filesize')),
        }),
      );
    },
  });

  // Image card: <figure class="kg-card kg-image-card"><a href><img><figcaption>
  //
  // Ghost wraps the <img> in an <a> when the editor sets a "click target" link
  // on the image. Default turndown loses that anchor because the figure rule
  // takes over and only renders the inner img. We capture the wrapper href so
  // the click target survives. Likewise, `srcset`/`sizes` carry the responsive
  // variants Ghost computes at upload time — without them the renderer falls
  // back to a single resolution and loses the layout shift protection.
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
          srcset: attr(img, 'srcset'),
          sizes: attr(img, 'sizes'),
          ...pictureSourceAttrs(node),
          href: imageWrapAnchorHref(node),
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
      const emojiEl = node.querySelector('.kg-callout-emoji');
      const emoji = text(emojiEl);
      const emojiHtml = emoji ? '' : html(emojiEl);
      const noIcon = hasClass(node, 'kg-callout-card-without-emoji') || (!emoji && !emojiHtml);
      const color = classByPrefix(node, 'kg-callout-card-');
      const textEl = node.querySelector('.kg-callout-text');
      const inner = textEl ? turndown.turndown(textEl.innerHTML).trim() : '';
      return wrap(
        shortcodeBlock(
          'callout',
          { emoji, 'emoji-html': emojiHtml, 'no-icon': noIcon ? 'true' : '', color },
          inner,
        ),
      );
    },
  });

  // Toggle card: <div class="kg-card kg-toggle-card">
  //   <div class="kg-toggle-heading"><h4 class="kg-toggle-heading-text">Heading</h4></div>
  //   <div class="kg-toggle-content">body</div>
  turndown.addRule('kg-toggle-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-toggle-card'),
    replacement: (_content, node) => {
      const heading = text(node.querySelector('.kg-toggle-heading-text'));
      const width = classByPrefix(node, 'kg-width-');
      const rawState = attr(node, 'data-kg-toggle-state');
      const state = rawState === 'open' || rawState === 'close' ? rawState : '';
      const contentEl = node.querySelector('.kg-toggle-content');
      const inner = contentEl ? turndown.turndown(contentEl.innerHTML).trim() : '';
      return wrap(shortcodeBlock('toggle', { heading, width, state }, inner));
    },
  });

  // Button card: <div class="kg-card kg-button-card kg-align-{align}"><a.kg-btn>label</a>
  turndown.addRule('kg-button-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-button-card'),
    replacement: (_content, node) => {
      const anchor = node.querySelector('a.kg-btn') ?? node.querySelector('a');
      if (!anchor) return '';
      return wrap(
        liquidShortcode('button', {
          href: attr(anchor, 'href'),
          text: text(anchor),
          align: classByPrefix(node, 'kg-align-'),
          style: classByPrefix(anchor, 'kg-btn-'),
        }),
      );
    },
  });

  // Signup card: <div class="kg-card kg-signup-card">...<form data-members-form>
  //
  // The default Turndown walk flattens this into heading/paragraph/button text,
  // permanently losing the Ghost Members contract (`data-members-form`,
  // `data-members-email`, labels, success/error copy) and the provider-facing
  // form fields. Emit a metadata carrier only; rendering/provider wiring lives
  // in the build layer.
  turndown.addRule('kg-signup-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-signup-card'),
    replacement: (_content, node) => {
      const form = node.querySelector('form');
      const button =
        node.querySelector('.kg-signup-card-button') ??
        form?.querySelector('button') ??
        node.querySelector('button');
      const nameInput =
        form?.querySelector('input[data-members-name]') ??
        form?.querySelector('input[name="name"]') ??
        form?.querySelector('input[type="text"]') ??
        null;
      const emailInput =
        form?.querySelector('input[data-members-email]') ??
        form?.querySelector('input[type="email"]') ??
        null;
      const labels = form
        ? Array.from(form.querySelectorAll('[data-members-label]') as ArrayLike<DomNode>)
            .map((label) => attr(label, 'value') || text(label))
            .filter((label) => label !== '')
            .join(',')
        : '';
      const image = node.querySelector('.kg-signup-card-image') ?? node.querySelector('img');

      return wrap(
        liquidShortcode('signup', {
          heading: text(node.querySelector('.kg-signup-card-heading')),
          subheading: text(node.querySelector('.kg-signup-card-subheading')),
          button: text(button),
          disclaimer: text(node.querySelector('.kg-signup-card-disclaimer')),
          background:
            attr(image, 'src') ||
            attr(node, 'data-kg-background-image') ||
            attr(node, 'data-background-image') ||
            backgroundImageUrlFromStyle(attr(node, 'style')),
          labels,
          width: classByPrefix(node, 'kg-width-'),
          style: classByPrefix(node, 'kg-style-'),
          form_action: attr(form, 'action'),
          form_method: attr(form, 'method'),
          'data-members-form': attr(form, 'data-members-form'),
          name_field: attr(nameInput, 'name'),
          name_placeholder: attr(nameInput, 'placeholder'),
          name_required: hasAttr(nameInput, 'required') ? 'true' : '',
          'data-members-name': hasAttr(nameInput, 'data-members-name') ? 'true' : '',
          email_field: attr(emailInput, 'name'),
          email_placeholder: attr(emailInput, 'placeholder'),
          email_required: hasAttr(emailInput, 'required') ? 'true' : '',
          'data-members-email': hasAttr(emailInput, 'data-members-email') ? 'true' : '',
          success: text(node.querySelector('[data-members-success]')),
          error: text(node.querySelector('[data-members-error]')),
        }),
      );
    },
  });

  // Header card v1/v2. The default Turndown walk drops the wrapper classes,
  // image/color metadata, and button styling. v1 keeps the statement shortcode
  // introduced for legacy header migration; v2 uses the self-closing shortcode
  // because it carries the larger Ghost 5 metadata surface.
  turndown.addRule('kg-header-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-header-card'),
    replacement: (_content, node) => {
      const isV2 = hasClass(node, 'kg-v2');
      const heading =
        node.querySelector('.kg-header-card-heading') ??
        node.querySelector('.kg-header-card-header');
      const subheading =
        node.querySelector('.kg-header-card-subheading') ??
        node.querySelector('.kg-header-card-subheader');
      const button = node.querySelector('a.kg-header-card-button') ?? node.querySelector('a');
      const image = node.querySelector('.kg-header-card-image') ?? node.querySelector('img');
      const textWrap = node.querySelector('.kg-header-card-text');
      const buttonStyle =
        classByPrefix(button, 'kg-header-card-button-') || classByPrefix(button, 'kg-style-');

      const style = classByPrefix(node, 'kg-style-');

      if (isV2) {
        const attrs: Record<string, string> = {
          version: 'v2',
          heading: text(heading),
          subheading: text(subheading),
          style,
          button_href: attr(button, 'href'),
          button_text: text(button),
        };
        attrs.align = classByPrefix(node, 'kg-align-') || classByPrefix(textWrap, 'kg-align-');
        attrs.width = classByPrefix(node, 'kg-width-');
        attrs.content_width = hasClass(node, 'kg-content-wide') ? 'wide' : '';
        attrs.layout = hasClass(node, 'kg-layout-split') ? 'split' : '';
        attrs.background_image =
          attr(image, 'src') ||
          attr(node, 'data-kg-background-image') ||
          attr(node, 'data-background-image');
        attrs.background_image_width = attr(image, 'width');
        attrs.background_image_height = attr(image, 'height');
        attrs.background_image_position = styleValue(node, '--bg-image-position');
        attrs.background_image_color = styleValue(node, '--bg-image-color');
        attrs.background_color =
          attr(node, 'data-background-color') || styleValue(node, 'background-color');
        attrs.text_color =
          attr(heading, 'data-text-color') ||
          styleValue(heading, 'color') ||
          styleValue(node, 'color');
        attrs.button_color =
          attr(button, 'data-button-color') || styleValue(button, 'background-color');
        attrs.button_text_color =
          attr(button, 'data-button-text-color') || styleValue(button, 'color');
        attrs.button_style = buttonStyle;
        attrs.accent = attr(node, 'data-accent-color') || styleValue(node, '--accent-color');
        return wrap(shortcode('header', attrs));
      }

      return wrap(
        liquidShortcode('header', {
          style,
          background:
            attr(image, 'src') ||
            attr(node, 'data-kg-background-image') ||
            attr(node, 'data-background-image') ||
            backgroundImageUrlFromStyle(attr(node, 'style')),
          title: text(heading),
          subtitle: text(subheading),
          'cta-text': text(button),
          'cta-href': attr(button, 'href'),
          'card-size': classByPrefix(node, 'kg-size-'),
        }),
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

  // Product cards are less common but worth preserving rather than dropping.
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

  // NFT card: <figure class="kg-card kg-nft-card"><a><img><metadata>...
  //
  // Default turndown sees the figure as a generic image wrapper and collapses
  // it to `![](image)`, losing the OpenSea link and all kg-nft-* hooks. Keep a
  // compact shortcode carrier so renderMarkdown can rebuild the static scaffold
  // that themes and the built-in card CSS target.
  turndown.addRule('kg-nft-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-nft-card'),
    replacement: (_content, node) => {
      const anchor = node.querySelector('a.kg-nft-card-container') ?? node.querySelector('a');
      return wrap(
        shortcode('nft', {
          href: attr(anchor, 'href'),
          image:
            attr(node.querySelector('.kg-nft-image'), 'src') ||
            attr(node.querySelector('img'), 'src'),
          title: text(node.querySelector('.kg-nft-title')),
          creator: text(node.querySelector('.kg-nft-creator')),
          description: text(node.querySelector('.kg-nft-description')),
          size: classByPrefix(node, 'kg-width-'),
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
      const srcset = attr(img, 'srcset');
      const sizes = attr(img, 'sizes');
      if (!caption && !srcset && !sizes) return wrap(`![${alt}](${src})`);
      return wrap(
        shortcode('figure', {
          src,
          alt,
          width: attr(img, 'width'),
          height: attr(img, 'height'),
          srcset,
          sizes,
          ...pictureSourceAttrs(node),
          size: classByPrefix(node, 'kg-width-'),
          caption,
        }),
      );
    },
  });

  // Plain raw <img> tags with responsive metadata need a shortcode carrier.
  // Turndown's default image rule emits `![alt](src)`, which permanently drops
  // `srcset` and `sizes` before renderMarkdown can rebuild the HTML.
  turndown.addRule('plain-responsive-img', {
    filter: (node) =>
      node.nodeName === 'IMG' && (!!node.getAttribute('srcset') || !!node.getAttribute('sizes')),
    replacement: (_content, node) =>
      wrap(
        shortcode('figure', {
          src: attr(node, 'src'),
          alt: attr(node, 'alt'),
          width: attr(node, 'width'),
          height: attr(node, 'height'),
          srcset: attr(node, 'srcset'),
          sizes: attr(node, 'sizes'),
        }),
      ),
  });

  // <picture> wraps an <img> with <source> fallbacks. Default behaviour drops
  // the wrapper and the alternate sources; preserve each source on the figure
  // shortcode so MP4/GIF/WebP/AVIF fallbacks survive import and render.
  turndown.addRule('picture-element', {
    filter: (node) => node.nodeName === 'PICTURE',
    replacement: (_content, node) => {
      const img = node.querySelector('img');
      if (!img) return '';
      const src = attr(img, 'src');
      if (!src) return '';
      const sourceAttrs = pictureSourceAttrs(node);
      if (Object.values(sourceAttrs).every((value) => value === '')) {
        return `![${attr(img, 'alt')}](${src})`;
      }
      return wrap(
        shortcode('figure', {
          src,
          alt: attr(img, 'alt'),
          width: attr(img, 'width'),
          height: attr(img, 'height'),
          srcset: attr(img, 'srcset'),
          sizes: attr(img, 'sizes'),
          ...sourceAttrs,
        }),
      );
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

  // `paywall`: Ghost serialises the split point as `<!--members-only-->`.
  // Keep it as a Markdown-safe HTML comment so the content loader can split
  // public preview content from the locked body before rendering.
  turndown.addRule('kg-card-fence-paywall', {
    filter: (node) => isDataKgCard(node, 'paywall'),
    replacement: () => wrap('<!-- members-only -->'),
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
