import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ThemeCardAssets } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';

export const CARD_ASSETS_CSS_PATH = 'assets/ghost-card-assets.css';
export const CARD_ASSETS_JS_PATH = 'assets/ghost-card-assets.js';
export const CARD_ASSETS_VERSION = '7';

const CARD_NAMES = [
  'audio',
  'blockquote',
  'bookmark',
  'button',
  'callout',
  'code',
  'embed',
  'file',
  'gallery',
  'header',
  'lightbox',
  'nft',
  'product',
  'signup',
  'toggle',
  'video',
] as const;

const CARD_CSS: Record<(typeof CARD_NAMES)[number], string> = {
  audio:
    '.kg-audio-card{display:flex;align-items:center;gap:1rem;width:100%;min-height:96px;padding:1rem;border:1px solid rgba(0,0,0,.08);border-radius:5px;background:#fff}.kg-audio-thumbnail{width:72px;height:72px;object-fit:cover;border-radius:4px}.kg-audio-player-container{flex:1;min-width:0}.kg-audio-title{font-weight:700}.kg-audio-player{width:100%;margin-top:.75rem}',
  blockquote:
    '.kg-blockquote-alt{font-size:1.35em;font-style:italic;line-height:1.35}.kg-card.kg-blockquote-card blockquote{margin:0}',
  bookmark:
    // .kg-bookmark-thumbnail uses position:relative + img position:absolute so
    // the thumbnail img's intrinsic width does not bloat the flex basis of
    // the right-hand column (which would crush .kg-bookmark-content down to
    // a few characters wide). This mirrors modern Ghost card-assets.
    '.kg-bookmark-card{width:100%}.kg-bookmark-container{display:flex;min-height:148px;color:inherit;text-decoration:none;border:1px solid rgba(0,0,0,.12);border-radius:5px;overflow:hidden}.kg-bookmark-content{display:flex;flex:1;flex-direction:column;justify-content:flex-start;padding:20px;min-width:0}.kg-bookmark-title{font-weight:700}.kg-bookmark-description{margin-top:.5rem;color:rgba(0,0,0,.68);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.kg-bookmark-metadata{display:flex;align-items:center;gap:.5rem;margin-top:auto;font-size:.85em;color:rgba(0,0,0,.6)}.kg-bookmark-icon{width:20px;height:20px}.kg-bookmark-thumbnail{position:relative;flex:0 0 33%;max-height:100%}.kg-bookmark-thumbnail img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
  button:
    '.kg-button-card,.kg-button-card *{box-sizing:border-box}.kg-button-card{display:flex;text-align:center}.kg-button-card.kg-align-left{justify-content:flex-start}.kg-button-card.kg-align-center{justify-content:center}.kg-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.4em;padding:.65em 1.2em;border-radius:4px;background:var(--ghost-accent-color,#15171a);color:#fff!important;font-weight:700;text-decoration:none}',
  callout:
    '.kg-callout-card{display:flex;gap:1rem;padding:1.2rem 1.5rem;border-radius:5px;background:#f5f5f5}.kg-callout-card-grey{background:rgba(124,139,154,.13)}.kg-callout-card-white{background:transparent;box-shadow:inset 0 0 0 1px rgba(124,139,154,.2)}.kg-callout-card-blue{background:rgba(33,172,232,.12)}.kg-callout-card-green{background:rgba(52,183,67,.12)}.kg-callout-card-yellow{background:rgba(240,165,15,.13)}.kg-callout-card-red{background:rgba(209,46,46,.11)}.kg-callout-card-pink{background:rgba(225,71,174,.11)}.kg-callout-card-purple{background:rgba(135,85,236,.12)}.kg-callout-card-accent{background:var(--ghost-accent-color,#15171a);color:#fff}.kg-callout-card-accent a{color:#fff;text-decoration:underline}.kg-callout-emoji{line-height:1.4}.kg-callout-text{flex:1}',
  code: '.kg-code-card{position:relative;width:100%}.kg-code-card pre{margin:0;padding:1rem 1.25rem;overflow-x:auto;border-radius:5px;background:#15171a;color:#fff;line-height:1.5}.kg-code-card pre code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;white-space:pre}.kg-code-card figcaption{margin-top:.75rem;text-align:center;color:rgba(0,0,0,.6);font-size:.9em}.kg-code-card-copy{position:absolute;top:.6rem;right:.6rem;padding:.35rem .55rem;border:0;border-radius:4px;background:rgba(255,255,255,.14);color:#fff;font:inherit;font-size:.75rem;cursor:pointer}.kg-code-card-copy[data-copied="true"]{background:rgba(255,255,255,.28)}.kg-code-card-with-line-numbers pre{padding-left:3rem}',
  embed:
    '.kg-embed-card{width:100%}.kg-embed-card iframe{display:block;width:100%;max-width:100%;aspect-ratio:16/9;border:0}.kg-embed-card blockquote{margin:0}',
  file: '.kg-file-card{display:flex}.kg-file-card-container{display:flex;align-items:center;gap:1rem;width:100%;padding:1rem;border:1px solid rgba(0,0,0,.12);border-radius:5px;color:inherit;text-decoration:none}.kg-file-card-contents{flex:1;min-width:0}.kg-file-card-title{font-weight:700}.kg-file-card-caption,.kg-file-card-metadata{color:rgba(0,0,0,.6);font-size:.9em}.kg-file-card-icon{width:32px;height:32px;flex:0 0 auto}',
  gallery:
    '.kg-gallery-card+.kg-gallery-card,.kg-gallery-card+.kg-image-card{margin-top:.75em}.kg-gallery-container{display:flex;flex-direction:column;gap:.75em;width:100%}.kg-gallery-row{display:flex;flex-direction:row;justify-content:center;gap:.75em}.kg-gallery-image{flex:1;min-width:0}.kg-gallery-image img{display:block;width:100%;height:100%;object-fit:cover}',
  header:
    '.kg-header-card{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:24rem;padding:6vmin 4vmin;text-align:center;background:#f5f5f5;color:#15171a}.kg-header-card.kg-style-dark{background:#15171a;color:#fff}.kg-header-card h2,.kg-header-card h3{margin:.2em 0}.kg-header-card .kg-header-card-button{display:inline-flex;margin-top:1.5rem;padding:.75em 1.25em;border-radius:4px;background:var(--ghost-accent-color,#15171a);color:#fff;text-decoration:none;font-weight:700}',
  lightbox:
    '.kg-lightbox-backdrop{position:fixed;inset:0;z-index:3999998;display:none;align-items:center;justify-content:center;padding:4vmin;background:rgba(0,0,0,.86)}.kg-lightbox-backdrop[data-kg-lightbox-open="true"]{display:flex}.kg-lightbox-backdrop img{max-width:100%;max-height:100%;object-fit:contain}.kg-lightbox-close{position:absolute;top:1rem;right:1rem;width:44px;height:44px;border:0;border-radius:999px;background:rgba(255,255,255,.15);color:#fff;font-size:28px;line-height:1;cursor:pointer}.kg-image-card img,.kg-gallery-image img{cursor:zoom-in}',
  nft: '.kg-nft-card{display:block}.kg-nft-card-container{display:flex;flex-direction:column;max-width:520px;margin:0 auto;color:inherit;text-decoration:none;border:1px solid rgba(0,0,0,.12);border-radius:8px;overflow:hidden}.kg-nft-image{display:block;width:100%}.kg-nft-metadata{padding:1rem}.kg-nft-title{font-weight:700}.kg-nft-description{color:rgba(0,0,0,.65)}',
  product:
    '.kg-product-card{display:flex;flex-direction:column;gap:1rem;padding:1.5rem;border:1px solid rgba(0,0,0,.12);border-radius:5px}.kg-product-card-image{width:100%;height:auto}.kg-product-card-title{font-size:1.2em;font-weight:700}.kg-product-card-description{color:rgba(0,0,0,.7)}.kg-product-card-button{display:inline-flex;align-self:flex-start;padding:.65em 1em;border-radius:4px;background:var(--ghost-accent-color,#15171a);color:#fff;text-decoration:none;font-weight:700}',
  signup:
    '.kg-signup-card,.kg-signup-card *{box-sizing:border-box}.kg-signup-card{display:flex;flex-direction:column;align-items:center;gap:1rem;width:100%;padding:3rem 2rem;border-radius:8px;overflow:hidden;background:#f5f5f5;color:#15171a;text-align:center}.kg-signup-card.kg-style-dark{background:#15171a;color:#fff}.kg-signup-card.kg-style-accent{background:var(--ghost-accent-color,#15171a);color:#fff}.kg-signup-card-content{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:1rem;width:100%;text-align:center}.kg-signup-card-image-top,.kg-signup-card-image-bottom,.kg-signup-card-image-left{padding:0;gap:0}.kg-signup-card-image-top .kg-signup-card-content,.kg-signup-card-image-bottom .kg-signup-card-content,.kg-signup-card-image-left .kg-signup-card-content{padding:3rem 2rem}.kg-signup-card-image{display:block;width:100%;height:auto;object-fit:cover}.kg-signup-card-image-top .kg-signup-card-image{order:0}.kg-signup-card-image-top .kg-signup-card-content{order:1}.kg-signup-card-image-bottom .kg-signup-card-content{order:0}.kg-signup-card-image-bottom .kg-signup-card-image{order:1}.kg-signup-card-image-left{flex-direction:row;align-items:stretch;text-align:left}.kg-signup-card-image-left .kg-signup-card-image{width:50%;max-width:50%;height:auto}.kg-signup-card-image-left .kg-signup-card-content{align-items:flex-start;text-align:left}.kg-signup-card-heading{margin:0;font-size:2rem;line-height:1.15}.kg-signup-card-subheading{margin:0;max-width:42rem;color:currentColor;opacity:.78}.kg-signup-card-form{display:flex;align-items:stretch;gap:.75rem;max-width:36rem;width:100%}.kg-signup-card-fields{display:flex;flex:1;gap:.75rem;min-width:0}.kg-signup-card-input{flex:1;min-width:0;width:100%;padding:.85em 1em;border:1px solid rgba(0,0,0,.18);border-radius:4px;background:#fff;color:#15171a;font:inherit;line-height:1.2}.kg-signup-card.kg-style-dark .kg-signup-card-input,.kg-signup-card.kg-style-accent .kg-signup-card-input{border-color:rgba(255,255,255,.3)}.kg-signup-card-input::placeholder{color:rgba(0,0,0,.5)}.kg-signup-card-button{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.85em 1.2em;border:0;border-radius:4px;background:var(--ghost-accent-color,#15171a);color:#fff;font:inherit;font-weight:700;line-height:1.2;text-decoration:none;cursor:pointer}.kg-signup-card.kg-style-dark .kg-signup-card-button,.kg-signup-card.kg-style-accent .kg-signup-card-button{background:#fff;color:#15171a}.kg-signup-card-disclaimer{margin:0;max-width:36rem;font-size:.85em;line-height:1.45;color:currentColor;opacity:.62}.kg-signup-card [data-members-success],.kg-signup-card [data-members-error]{margin:0;font-size:.9em}.kg-signup-card [data-members-error]{color:#c41e3a}@media (max-width:640px){.kg-signup-card-image-left{flex-direction:column;text-align:center}.kg-signup-card-image-left .kg-signup-card-image{width:100%;max-width:none}.kg-signup-card-image-left .kg-signup-card-content{align-items:center;text-align:center}.kg-signup-card-form,.kg-signup-card-fields{flex-direction:column}.kg-signup-card-button{width:100%}}',
  toggle:
    '.kg-toggle-card{padding:1.2rem 1.5rem;border:1px solid rgba(0,0,0,.12);border-radius:5px}.kg-toggle-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;cursor:pointer}.kg-toggle-heading-text{margin:0}.kg-toggle-content{margin-top:1rem}.kg-toggle-card[data-kg-toggle-state="close"] .kg-toggle-content{display:none}',
  video:
    '.kg-video-card{position:relative}.kg-video-container{position:relative;width:100%;overflow:hidden;background:#000}.kg-video-container video{display:block;width:100%;height:auto}.kg-video-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff}.kg-video-play-icon{width:72px;height:72px}',
};

export interface EmitCardAssetsOptions {
  outputDir: string;
  cardAssets: ThemeCardAssets;
}

export async function emitCardAssets(opts: EmitCardAssetsOptions): Promise<boolean> {
  if (!isCardAssetsEnabled(opts.cardAssets)) return false;

  const cssPath = join(opts.outputDir, CARD_ASSETS_CSS_PATH);
  const jsPath = join(opts.outputDir, CARD_ASSETS_JS_PATH);
  await ensureDir(dirname(cssPath));
  await writeFile(cssPath, renderCardAssetsCss(opts.cardAssets), 'utf8');
  await writeFile(jsPath, renderCardAssetsJs(opts.cardAssets), 'utf8');
  return true;
}

export function isCardAssetsEnabled(cardAssets: ThemeCardAssets): boolean {
  return cardAssets !== false;
}

export function cardAssetsExcludeSet(cardAssets: ThemeCardAssets): Set<string> {
  if (cardAssets === true || cardAssets === false) return new Set();
  return new Set(cardAssets.exclude);
}

export function cardAssetsVersion(cardAssets: ThemeCardAssets): string {
  if (cardAssets === true || cardAssets === false || cardAssets.exclude.length === 0) {
    return CARD_ASSETS_VERSION;
  }
  return `${CARD_ASSETS_VERSION}-${hashLabel(cardAssets.exclude.slice().sort().join(','))}`;
}

export function renderCardAssetsCss(cardAssets: ThemeCardAssets): string {
  const exclude = cardAssetsExcludeSet(cardAssets);
  const sections = CARD_NAMES.filter((name) => !exclude.has(name)).map((name) => CARD_CSS[name]);
  return `/* Nectar Ghost-compatible shared card assets. */\n${sections.join('\n')}\n`;
}

function hashLabel(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function renderCardAssetsJs(cardAssets: ThemeCardAssets): string {
  const exclude = cardAssetsExcludeSet(cardAssets);
  const sections: string[] = [];
  if (!exclude.has('toggle')) {
    sections.push(`document.addEventListener('click', function (event) {
    var heading = closest(event.target, '.kg-toggle-card .kg-toggle-heading');
    if (!heading) return;
    var card = closest(heading, '.kg-toggle-card');
    if (!card || card.tagName === 'DETAILS') return;
    var content = card.querySelector('.kg-toggle-content');
    var isOpen = card.getAttribute('data-kg-toggle-state') === 'open';
    card.setAttribute('data-kg-toggle-state', isOpen ? 'close' : 'open');
    heading.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    if (content) content.hidden = isOpen;
  });`);
  }
  if (!exclude.has('code')) {
    sections.push(`document.addEventListener('click', function (event) {
    var button = closest(event.target, '.kg-code-card-copy');
    if (!button) return;
    var card = closest(button, '.kg-code-card');
    var code = card && card.querySelector('pre code');
    if (!code) return;
    var text = code.innerText || code.textContent || '';
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      var copyLabel = button.getAttribute('data-label-copy') || button.textContent || 'Copy';
      var copiedLabel = button.getAttribute('data-label-copied') || 'Copied';
      button.setAttribute('data-copied', 'true');
      button.textContent = copiedLabel;
      setTimeout(function () {
        button.removeAttribute('data-copied');
        button.textContent = copyLabel;
      }, 1500);
    }).catch(function () {});
  });`);
  }
  if (!exclude.has('audio')) {
    sections.push(`ready(function () {
    each(document.querySelectorAll('.kg-audio-card audio'), function (audio) {
      if (!audio.hasAttribute('controls')) audio.setAttribute('controls', 'controls');
      if (!audio.hasAttribute('preload')) audio.setAttribute('preload', 'metadata');
    });
  });`);
  }
  if (!exclude.has('video')) {
    sections.push(`ready(function () {
    each(document.querySelectorAll('.kg-video-card video'), function (video) {
      if (!video.hasAttribute('controls')) video.setAttribute('controls', 'controls');
      if (!video.hasAttribute('preload')) video.setAttribute('preload', 'metadata');
    });
    each(document.querySelectorAll('.kg-video-card video[data-kg-gif-video]'), function (video) {
      video.removeAttribute('controls');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      if (!('IntersectionObserver' in window)) {
        video.play && video.play().catch(function () {});
        return;
      }
      gifObserver().observe(video);
    });
  });

  document.addEventListener('click', function (event) {
    var trigger = closest(event.target, '.kg-video-card .kg-video-overlay, .kg-video-card .kg-video-play-icon');
    if (!trigger) return;
    var card = closest(trigger, '.kg-video-card');
    var video = card && card.querySelector('video');
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  });`);
  }
  if (!exclude.has('lightbox')) {
    sections.push(`ready(function () {
    var backdrop;
    function ensureBackdrop() {
      if (backdrop) return backdrop;
      backdrop = document.createElement('div');
      backdrop.className = 'kg-lightbox-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.innerHTML = '<button class="kg-lightbox-close" type="button" aria-label="Close">&times;</button><img alt="">';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop || closest(event.target, '.kg-lightbox-close')) close();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') close();
      });
      return backdrop;
    }
    function close() {
      if (!backdrop) return;
      backdrop.removeAttribute('data-kg-lightbox-open');
    }
    document.addEventListener('click', function (event) {
      var image = closest(event.target, '.kg-image-card img, .kg-gallery-image img');
      if (!image || closest(image, 'a')) return;
      var overlay = ensureBackdrop();
      var target = overlay.querySelector('img');
      target.src = image.currentSrc || image.src;
      target.alt = image.alt || '';
      overlay.setAttribute('data-kg-lightbox-open', 'true');
    });
  });`);
  }
  if (!exclude.has('embed')) {
    sections.push(`ready(function () {
    each(document.querySelectorAll('.kg-embed-card iframe'), function (iframe) {
      if (!iframe.hasAttribute('loading')) iframe.setAttribute('loading', 'lazy');
    });
  });`);
  }
  if (!exclude.has('signup')) {
    sections.push(`ready(function () {
    each(document.querySelectorAll('.kg-signup-card form'), function (form) {
      if (!form.hasAttribute('data-nectar-koenig-signup')) {
        form.setAttribute('data-nectar-koenig-signup', 'static');
      }
    });
  });`);
  }

  if (sections.length === 0) {
    return '/* Nectar Ghost-compatible shared card assets: no runtime sections enabled. */\n';
  }
  return `/* Nectar Ghost-compatible shared card assets. */
(function () {
  function closest(el, selector) {
    return el && el.closest ? el.closest(selector) : null;
  }

  function each(nodes, fn) {
    Array.prototype.forEach.call(nodes, fn);
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  var sharedGifObserver;
  function gifObserver() {
    if (sharedGifObserver) return sharedGifObserver;
    sharedGifObserver = new IntersectionObserver(function (entries) {
      each(entries, function (entry) {
        var video = entry.target;
        if (entry.isIntersecting) video.play && video.play().catch(function () {});
        else video.pause && video.pause();
      });
    }, { threshold: 0.2 });
    return sharedGifObserver;
  }

  ${sections.join('\n\n  ')}
})();
`;
}
