type CardReplacement = (card: CardElement) => string;

interface CardElement {
  innerHtml: string;
}

const CARD_REPLACERS: Array<[string, CardReplacement]> = [
  ['kg-bookmark-card', renderBookmarkCard],
  ['kg-embed-card', renderEmbedCard],
  ['kg-gallery-card', renderGalleryCard],
  ['kg-audio-card', renderAudioCard],
  ['kg-video-card', renderVideoCard],
];

export function renderFeedSafeHtml(html: string): string {
  if (!html) return html;
  let rewritten = html;
  for (const [className, replacer] of CARD_REPLACERS) {
    rewritten = replaceCardsByClass(rewritten, className, replacer);
  }
  return stripFeedUnsafeTags(rewritten).trim();
}

function renderBookmarkCard(card: CardElement): string {
  const href = firstAttr(card.innerHtml, 'a', 'href', 'kg-bookmark-container');
  if (!href) return '';
  const title = textFromClass(card.innerHtml, 'kg-bookmark-title') || href;
  const description = textFromClass(card.innerHtml, 'kg-bookmark-description');
  const caption = textFromTag(card.innerHtml, 'figcaption');
  return joinBlocks([
    `<p><a href="${escapeAttr(href)}">${escapeHtml(title)}</a></p>`,
    description ? `<p>${escapeHtml(description)}</p>` : '',
    caption ? `<p>${escapeHtml(caption)}</p>` : '',
  ]);
}

function renderEmbedCard(card: CardElement): string {
  const href =
    lastAttr(card.innerHtml, 'a', 'href') ||
    firstAttr(card.innerHtml, 'iframe', 'src') ||
    firstAttr(card.innerHtml, 'blockquote', 'cite');
  if (!href) return '';
  const label =
    lastTextFromTag(card.innerHtml, 'a') ||
    firstAttr(card.innerHtml, 'iframe', 'title') ||
    textFromTag(card.innerHtml, 'figcaption') ||
    href;
  const caption = textFromTag(card.innerHtml, 'figcaption');
  return joinBlocks([
    `<p><a href="${escapeAttr(href)}">${escapeHtml(label)}</a></p>`,
    caption && caption !== label ? `<p>${escapeHtml(caption)}</p>` : '',
  ]);
}

function renderGalleryCard(card: CardElement): string {
  const images = imageTags(card.innerHtml);
  if (images.length === 0) return '';
  const caption = textFromTag(card.innerHtml, 'figcaption');
  return joinBlocks([
    `<ul>${images.map((img) => `<li>${img}</li>`).join('')}</ul>`,
    caption ? `<p>${escapeHtml(caption)}</p>` : '',
  ]);
}

function renderAudioCard(card: CardElement): string {
  const src =
    firstAttr(card.innerHtml, 'audio', 'src') || firstAttr(card.innerHtml, 'source', 'src');
  if (!src) return '';
  const title = textFromClass(card.innerHtml, 'kg-audio-title');
  const label = title ? `Download audio: ${title}` : 'Download audio';
  return `<p><a href="${escapeAttr(src)}">${escapeHtml(label)}</a></p>`;
}

function renderVideoCard(card: CardElement): string {
  const src =
    firstAttr(card.innerHtml, 'video', 'src') || firstAttr(card.innerHtml, 'source', 'src');
  if (!src) return '';
  const caption = textFromTag(card.innerHtml, 'figcaption');
  const label = caption ? `Download video: ${caption}` : 'Download video';
  return `<p><a href="${escapeAttr(src)}">${escapeHtml(label)}</a></p>`;
}

function replaceCardsByClass(html: string, className: string, replacer: CardReplacement): string {
  let result = '';
  let cursor = 0;
  const startTagRe = /<(figure|div)\b[^>]*>/gi;
  startTagRe.lastIndex = 0;

  while (true) {
    const match = startTagRe.exec(html);
    if (!match?.[0] || !match[1]) break;
    const openTag = match[0];
    if (!tagHasClass(openTag, className)) continue;

    const tagName = match[1].toLowerCase();
    const closeEnd = findElementCloseEnd(html, startTagRe.lastIndex, tagName);
    if (closeEnd < 0) continue;

    const innerHtml = html.slice(startTagRe.lastIndex, closeEnd - `</${tagName}>`.length);
    result += html.slice(cursor, match.index);
    result += replacer({ innerHtml });
    cursor = closeEnd;
    startTagRe.lastIndex = closeEnd;
  }

  return cursor === 0 ? html : result + html.slice(cursor);
}

function findElementCloseEnd(html: string, start: number, tagName: string): number {
  const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = start;
  let depth = 1;
  while (true) {
    const match = tagRe.exec(html);
    if (!match?.[0]) return -1;
    const tag = match[0];
    if (tag.startsWith('</')) {
      depth -= 1;
      if (depth === 0) return tagRe.lastIndex;
    } else if (!tag.endsWith('/>')) {
      depth += 1;
    }
  }
}

function tagHasClass(tag: string, className: string): boolean {
  const classValue = getAttrFromTag(tag, 'class');
  if (!classValue) return false;
  return classValue.split(/\s+/).includes(className);
}

function firstAttr(html: string, tagName: string, attrName: string, className?: string): string {
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  while (true) {
    const match = tagRe.exec(html);
    if (!match?.[0]) return '';
    if (className && !tagHasClass(match[0], className)) continue;
    const value = getAttrFromTag(match[0], attrName);
    if (value) return value;
  }
}

function lastAttr(html: string, tagName: string, attrName: string): string {
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let found = '';
  while (true) {
    const match = tagRe.exec(html);
    if (!match?.[0]) return found;
    const value = getAttrFromTag(match[0], attrName);
    if (value) found = value;
  }
}

function getAttrFromTag(tag: string, attrName: string): string {
  const attrRe = new RegExp(`\\b${attrName}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  return decodeEntities(attrRe.exec(tag)?.[2] ?? '');
}

function textFromClass(html: string, className: string): string {
  const startTagRe = /<([a-z0-9-]+)\b[^>]*>/gi;
  while (true) {
    const match = startTagRe.exec(html);
    if (!match?.[0] || !match[1]) return '';
    if (!tagHasClass(match[0], className)) continue;
    const tagName = match[1].toLowerCase();
    const closeEnd = findElementCloseEnd(html, startTagRe.lastIndex, tagName);
    if (closeEnd < 0) return '';
    const inner = html.slice(startTagRe.lastIndex, closeEnd - `</${tagName}>`.length);
    return textContent(inner);
  }
}

function textFromTag(html: string, tagName: string): string {
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  return textContent(tagRe.exec(html)?.[1] ?? '');
}

function lastTextFromTag(html: string, tagName: string): string {
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let found = '';
  while (true) {
    const match = tagRe.exec(html);
    if (!match?.[1]) return found;
    const text = textContent(match[1]);
    if (text) found = text;
  }
}

function imageTags(html: string): string[] {
  const imgRe = /<img\b[^>]*>/gi;
  const out: string[] = [];
  while (true) {
    const match = imgRe.exec(html);
    if (!match?.[0]) return out;
    const src = getAttrFromTag(match[0], 'src');
    if (!src) continue;
    const attrs = [
      ['src', src],
      ['alt', getAttrFromTag(match[0], 'alt')],
      ['width', getAttrFromTag(match[0], 'width')],
      ['height', getAttrFromTag(match[0], 'height')],
    ]
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
      .join(' ');
    out.push(`<img ${attrs}>`);
  }
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter(Boolean).join('');
}

function stripFeedUnsafeTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<audio\b[\s\S]*?<\/audio>/gi, '')
    .replace(/<video\b[\s\S]*?<\/video>/gi, '')
    .replace(/<button\b[\s\S]*?<\/button>/gi, '')
    .replace(/<(?:source|track|object|embed|canvas)\b[^>]*\/?>/gi, '');
}

function textContent(html: string): string {
  return decodeEntities(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}
