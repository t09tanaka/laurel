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

const SINGLE_IMG_PARAGRAPH_RE =
  /<p>\s*(<a\b[^>]*>)?\s*(<img\b[^>]*?\/?>)\s*(<\/a>)?\s*(\{\s*lazy\s*=\s*(?:"(?:false|true)"|'(?:false|true)'|false|true)\s*\})?\s*<\/p>/gi;

const FOLLOWING_BLOCKQUOTE_CAPTION_RE = /^\s*<blockquote>\s*<p>([\s\S]*?)<\/p>\s*<\/blockquote>/i;

const FOLLOWING_EM_CAPTION_RE = /^\s*<p>\s*<em>([\s\S]*?)<\/em>\s*<\/p>/i;

const KOENIG_IMAGE_WIDTHS = new Set(['regular', 'wide', 'full']);

export interface PromoteImagesToFiguresOptions {
  prioritizeFirstImage?: boolean;
}

export function promoteImagesToFigures(
  html: string,
  options: PromoteImagesToFiguresOptions = {},
): string {
  if (!html.includes('<img')) return html;

  let result = '';
  let cursor = 0;
  let promotedImageCount = 0;
  SINGLE_IMG_PARAGRAPH_RE.lastIndex = 0;
  while (true) {
    const match = SINGLE_IMG_PARAGRAPH_RE.exec(html);
    if (match === null) break;

    const [full, aOpen, imgTag, aClose, lazyOverride] = match;

    result += html.slice(cursor, match.index);

    if ((aOpen && !aClose) || (!aOpen && aClose)) {
      // Unbalanced anchor: leave the paragraph untouched rather than emit
      // malformed figure markup.
      result += full;
      cursor = match.index + full.length;
      continue;
    }

    const { imgTag: imageTag, width } = consumeImageWidthHint(imgTag ?? '');
    const isPriorityImage = options.prioritizeFirstImage === true && promotedImageCount === 0;
    const imgWithClass = addDefaultImageLoading(
      addKgImageClass(imageTag),
      lazyOverride !== undefined && /\bfalse\b/i.test(lazyOverride),
      isPriorityImage,
    );
    const inner = aOpen ? `${aOpen}${imgWithClass}${aClose}` : imgWithClass;

    const tail = html.slice(match.index + full.length);
    const caption = extractFollowingCaption(tail);

    const hasCaptionClass = caption ? ' kg-card-hascaption' : '';
    const figureAttrs = caption ? captionFigureAttrs(caption.text) : '';
    const figcaption = caption
      ? `<figcaption id="${escapeHtmlAttr(captionId(caption.text))}">${caption.text}</figcaption>`
      : '';
    result += `<figure class="kg-card kg-image-card kg-width-${width}${hasCaptionClass}"${figureAttrs}>${inner}${figcaption}</figure>`;
    promotedImageCount += 1;

    cursor = match.index + full.length + (caption?.consumed ?? 0);
    SINGLE_IMG_PARAGRAPH_RE.lastIndex = cursor;
  }
  result += html.slice(cursor);
  return result;
}

function extractFollowingCaption(tail: string): { text: string; consumed: number } | null {
  const bq = tail.match(FOLLOWING_BLOCKQUOTE_CAPTION_RE);
  if (bq?.[1]) return { text: bq[1].trim(), consumed: bq[0].length };
  const em = tail.match(FOLLOWING_EM_CAPTION_RE);
  if (em?.[1]) return { text: em[1].trim(), consumed: em[0].length };
  return null;
}

function consumeImageWidthHint(imgTag: string): { imgTag: string; width: string } {
  const titleMatch = imgTag.match(/\stitle\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (titleMatch) {
    const parsed = parseImageTitleWidth(titleMatch[2] ?? titleMatch[3] ?? '');
    if (parsed) return { imgTag: imgTag.replace(titleMatch[0], ''), width: parsed.width };
  }

  const altMatch = imgTag.match(/\salt\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!altMatch) return { imgTag, width: 'regular' };

  const attr = altMatch[0];
  const quoted = altMatch[1] ?? '';
  const value = altMatch[2] ?? altMatch[3] ?? '';
  const parsed = parseImageAltWidth(value);
  if (!parsed) return { imgTag, width: 'regular' };

  const quote = quoted.startsWith("'") ? "'" : '"';
  const replacement = ` alt=${quote}${parsed.alt}${quote}`;
  return { imgTag: imgTag.replace(attr, replacement), width: parsed.width };
}

function parseImageAltWidth(value: string): { alt: string; width: string } | null {
  const divider = value.lastIndexOf('|');
  if (divider === -1) return null;

  const candidate = value
    .slice(divider + 1)
    .trim()
    .replace(/^kg-width-/, '');
  if (!KOENIG_IMAGE_WIDTHS.has(candidate)) return null;

  return {
    alt: value.slice(0, divider).trimEnd(),
    width: candidate,
  };
}

function parseImageTitleWidth(value: string): { width: string } | null {
  const width = value.trim().replace(/^kg-width-/, '');
  return KOENIG_IMAGE_WIDTHS.has(width) ? { width } : null;
}

function captionId(caption: string): string {
  return `kg-card-caption-${hashLabel(caption)}`;
}

function captionFigureAttrs(caption: string): string {
  return ` role="group" aria-labelledby="${escapeHtmlAttr(captionId(caption))}"`;
}

function hashLabel(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function addDefaultImageLoading(imgTag: string, disabled: boolean, priority: boolean): string {
  if (disabled) return imgTag;
  if (priority) {
    return addOrReplaceAttr(addOrReplaceAttr(imgTag, 'loading', 'eager'), 'fetchpriority', 'high');
  }
  if (/\sloading\s*=/i.test(imgTag)) return imgTag;
  return addOrReplaceAttr(imgTag, 'loading', 'lazy');
}

function addOrReplaceAttr(imgTag: string, name: string, value: string): string {
  const attrRe = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, 'i');
  if (attrRe.test(imgTag)) {
    return imgTag.replace(attrRe, `$1"${value}"`);
  }
  if (/\/\s*>$/.test(imgTag)) {
    return imgTag.replace(/\s*\/\s*>$/, ` ${name}="${value}" />`);
  }
  return imgTag.replace(/\s*>$/, ` ${name}="${value}">`);
}
