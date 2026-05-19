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

  // Gallery card: <figure class="kg-card kg-gallery-card"><div.kg-gallery-container>...<img>...
  turndown.addRule('kg-gallery-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-gallery-card'),
    replacement: (_content, node) => {
      const seen = new Set<string>();
      const imgs: string[] = [];
      const all = Array.from(node.querySelectorAll('img') as ArrayLike<DomNode>);
      for (const img of all) {
        const src = attr(img, 'src');
        if (!src || seen.has(src)) continue;
        seen.add(src);
        imgs.push(`![${attr(img, 'alt')}](${src})`);
      }
      return wrap(
        shortcodeBlock(
          'gallery',
          { caption: text(node.querySelector('figcaption')) },
          imgs.join('\n'),
        ),
      );
    },
  });

  // Embed card: <figure class="kg-card kg-embed-card"><iframe>
  turndown.addRule('kg-embed-card', {
    filter: (node) => node.nodeName === 'FIGURE' && hasClass(node, 'kg-embed-card'),
    replacement: (_content, node) => {
      const iframe = node.querySelector('iframe');
      return wrap(
        shortcode('embed', {
          url: attr(iframe, 'src'),
          title: attr(iframe, 'title'),
          width: attr(iframe, 'width'),
          height: attr(iframe, 'height'),
          caption: text(node.querySelector('figcaption')),
        }),
      );
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
  // Preserve the inner HTML verbatim — markdown allows inline HTML, and any
  // attempt to convert handcrafted HTML to markdown is going to lose intent.
  turndown.addRule('kg-html-card', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'kg-html-card'),
    replacement: (_content, node) => {
      const inner = node.innerHTML.trim();
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
  // HTML. Preserve it verbatim; markdown conversion would destroy attributes,
  // inline styles, and any structure the user intended.
  turndown.addRule('kg-card-fence-html', {
    filter: (node) => isDataKgCard(node, 'html'),
    replacement: (_content, node) => {
      const inner = node.innerHTML.trim();
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
