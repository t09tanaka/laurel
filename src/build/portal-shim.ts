import { joinPath } from '~/theme/assets.ts';

// Source theme's sidebar "See all" recommendations button is rendered as
// `<button data-portal="recommendations">` — in Ghost this attribute binds the
// Portal modal that lists every recommendation. Without a Portal runtime the
// button is dead in Nectar. This transform finds the button in already-rendered
// HTML and rewrites it to an `<a>` deep-linking to the
// `<section id="all-recommendations">` block on the auto-emitted
// `/recommendations/` page. Other `data-portal` values (signin, signup,
// upgrade) stay untouched; their behaviour is owned by future members work.
//
// We rewrite to a link rather than wiring a JS click handler so the deep-link
// works without JavaScript: crawlers and keyboard users follow the anchor,
// while in-browser clicks scroll to the section via the URL hash.
const RECOMMENDATIONS_BUTTON_RE = /<button\b([^>]*?)\bdata-portal="recommendations"([^>]*)>/gi;
const CLOSE_BUTTON = '</button>';

export function rewriteRecommendationsButton(opts: {
  html: string;
  basePath: string;
  enabled: boolean;
}): string {
  const { html, basePath, enabled } = opts;
  if (!enabled) return html;
  if (!html.includes('data-portal="recommendations"')) return html;
  const href = `${joinPath(basePath, 'recommendations/')}#all-recommendations`;
  let out = '';
  let cursor = 0;
  RECOMMENDATIONS_BUTTON_RE.lastIndex = 0;
  while (true) {
    const match = RECOMMENDATIONS_BUTTON_RE.exec(html);
    if (match === null) break;
    const start = match.index;
    const openEnd = start + match[0].length;
    const before = match[1] ?? '';
    const after = match[2] ?? '';
    const closeIdx = html.indexOf(CLOSE_BUTTON, openEnd);
    if (closeIdx === -1) {
      // Malformed markup; bail without rewriting the rest so we never produce
      // unbalanced tags. Themes ship valid HTML in practice, so this is a
      // defensive guard rather than a hot path.
      out += html.slice(cursor);
      cursor = html.length;
      break;
    }
    out += html.slice(cursor, start);
    out += `<a${before}${after} href="${escapeAttr(href)}" role="button" data-nectar-recommendations-link>`;
    out += html.slice(openEnd, closeIdx);
    out += '</a>';
    cursor = closeIdx + CLOSE_BUTTON.length;
    RECOMMENDATIONS_BUTTON_RE.lastIndex = cursor;
  }
  out += html.slice(cursor);
  return out;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
