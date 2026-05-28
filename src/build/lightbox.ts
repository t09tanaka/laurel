// The Source theme always emits the ~2KB PhotoSwipe overlay markup
// (`<div class="pswp">…</div>`) on every post/page, but the theme's runtime
// only binds the lightbox to `.kg-image-card > .kg-image[width][height]` and
// `.kg-gallery-image > img`. When the rendered content has neither, the
// markup is dead weight. Strip it post-render so post/page pages without
// lightboxable images don't ship the unused payload.

// Exact open-tag the Source theme emits. Located via `indexOf` (native, fast)
// rather than an unanchored regex: the previous `/\n?[ \t]*<div …>/` scan tried
// its leading-whitespace quantifier at every position in the document and was
// the single hottest function in a full build (~12% of CPU). `indexOf` finds
// the same literal in one optimized pass; the leading newline/indentation that
// the old `\n?[ \t]*` prefix consumed is reproduced by walking back from the
// match (see below) so the stripped output is byte-identical.
const LIGHTBOX_OPEN = '<div class="pswp" tabindex="-1" role="dialog" aria-hidden="true">';
const LIGHTBOXABLE_RE = /class="[^"]*\b(?:kg-image-card|kg-gallery-image)\b/;

export function stripUnusedLightbox(html: string): string {
  const open = html.indexOf(LIGHTBOX_OPEN);
  if (open === -1) return html;
  if (LIGHTBOXABLE_RE.test(html)) return html;

  // Reproduce the old regex's `\n?[ \t]*` prefix: consume the run of spaces/tabs
  // immediately before the tag, then at most one preceding newline.
  let blockStart = open;
  while (blockStart > 0) {
    const c = html.charCodeAt(blockStart - 1);
    if (c === 0x20 /* space */ || c === 0x09 /* tab */) blockStart -= 1;
    else break;
  }
  if (blockStart > 0 && html.charCodeAt(blockStart - 1) === 0x0a /* \n */) blockStart -= 1;

  const afterOpen = open + LIGHTBOX_OPEN.length;
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
