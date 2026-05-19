// The Source theme always emits the ~2KB PhotoSwipe overlay markup
// (`<div class="pswp">…</div>`) on every post/page, but the theme's runtime
// only binds the lightbox to `.kg-image-card > .kg-image[width][height]` and
// `.kg-gallery-image > img`. When the rendered content has neither, the
// markup is dead weight. Strip it post-render so post/page pages without
// lightboxable images don't ship the unused payload.

const LIGHTBOX_OPEN_RE =
  /\n?[ \t]*<div class="pswp" tabindex="-1" role="dialog" aria-hidden="true">/;
const LIGHTBOXABLE_RE = /class="[^"]*\b(?:kg-image-card|kg-gallery-image)\b/;

export function stripUnusedLightbox(html: string): string {
  const match = LIGHTBOX_OPEN_RE.exec(html);
  if (!match) return html;
  if (LIGHTBOXABLE_RE.test(html)) return html;

  const blockStart = match.index;
  const afterOpen = match.index + match[0].length;
  const blockEnd = findMatchingDivClose(html, afterOpen);
  if (blockEnd === -1) return html;

  return html.slice(0, blockStart) + html.slice(blockEnd);
}

function findMatchingDivClose(html: string, from: number): number {
  let depth = 1;
  let pos = from;
  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 4;
    } else {
      depth -= 1;
      pos = nextClose + 6;
    }
  }
  return depth === 0 ? pos : -1;
}
