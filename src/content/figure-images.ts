// Bare markdown `![alt](src)` produces `<p><img src="..." alt="..."></p>`. The
// Source theme (and most Ghost themes) target `.kg-image` on the <img> and a
// `<figure class="kg-card kg-image-card">` wrapper for layout, aspect-ratio
// reservation (`.kg-image[width][height]`), and figcaption styling. Without
// this pass, none of that CSS matches and image-heavy posts render unstyled.
//
// Promote any top-level paragraph whose only block-level child is an image
// (optionally wrapped in an anchor — Ghost's "link target" image card) into
// the Koenig image-card structure. When the next block is a blockquote with
// a single paragraph, or a paragraph that contains nothing but italicised
// text, consume it as the <figcaption>. This mirrors the convention Hugo,
// Eleventy, and most static generators use for markdown image captions.

const SINGLE_IMG_PARAGRAPH_RE = /<p>\s*(<a\b[^>]*>)?\s*(<img\b[^>]*?\/?>)\s*(<\/a>)?\s*<\/p>/gi;

const FOLLOWING_BLOCKQUOTE_CAPTION_RE = /^\s*<blockquote>\s*<p>([\s\S]*?)<\/p>\s*<\/blockquote>/i;

const FOLLOWING_EM_CAPTION_RE = /^\s*<p>\s*<em>([\s\S]*?)<\/em>\s*<\/p>/i;

export function promoteImagesToFigures(html: string): string {
  if (!html.includes('<img')) return html;

  let result = '';
  let cursor = 0;
  SINGLE_IMG_PARAGRAPH_RE.lastIndex = 0;
  while (true) {
    const match = SINGLE_IMG_PARAGRAPH_RE.exec(html);
    if (match === null) break;

    const [full, aOpen, imgTag, aClose] = match;

    result += html.slice(cursor, match.index);

    if ((aOpen && !aClose) || (!aOpen && aClose)) {
      // Unbalanced anchor: leave the paragraph untouched rather than emit
      // malformed figure markup.
      result += full;
      cursor = match.index + full.length;
      continue;
    }

    const imgWithClass = addKgImageClass(imgTag);
    const inner = aOpen ? `${aOpen}${imgWithClass}${aClose}` : imgWithClass;

    const tail = html.slice(match.index + full.length);
    const caption = extractFollowingCaption(tail);

    const hasCaptionClass = caption ? ' kg-card-hascaption' : '';
    const figcaption = caption ? `<figcaption>${caption.text}</figcaption>` : '';
    result += `<figure class="kg-card kg-image-card kg-width-regular${hasCaptionClass}">${inner}${figcaption}</figure>`;

    cursor = match.index + full.length + (caption?.consumed ?? 0);
    SINGLE_IMG_PARAGRAPH_RE.lastIndex = cursor;
  }
  result += html.slice(cursor);
  return result;
}

function extractFollowingCaption(tail: string): { text: string; consumed: number } | null {
  const bq = tail.match(FOLLOWING_BLOCKQUOTE_CAPTION_RE);
  if (bq) return { text: bq[1].trim(), consumed: bq[0].length };
  const em = tail.match(FOLLOWING_EM_CAPTION_RE);
  if (em) return { text: em[1].trim(), consumed: em[0].length };
  return null;
}

function addKgImageClass(imgTag: string): string {
  const classMatch = imgTag.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (classMatch) {
    const existing = classMatch[2] ?? classMatch[3] ?? '';
    if (existing.split(/\s+/).includes('kg-image')) return imgTag;
    const merged = existing ? `${existing} kg-image` : 'kg-image';
    return imgTag.replace(/(\sclass\s*=\s*)("[^"]*"|'[^']*')/i, `$1"${merged}"`);
  }
  return imgTag.replace(/^<img\b/i, '<img class="kg-image"');
}
