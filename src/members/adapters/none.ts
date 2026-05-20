import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// `provider = "none"` keeps the original markup in place but neutralises
// every interactive surface so the static site does not pretend to accept
// signups. The form action is collapsed to `#`, submit is preventDefault'd,
// the email field keeps its default name, and any operator-configured
// wrapper selectors (e.g. `.gh-footer-signup`, `.gh-cta`) are stripped
// outright so the page does not advertise a CTA that goes nowhere.
//
// We stop short of ripping the form / input elements themselves: Source-style
// themes use them as layout anchors, and tearing them out can leave a
// trailing `<div class="gh-form-wrapper">` that distorts the page. Operators
// who want the elements gone configure `strip_selectors` against the wrapper
// they actually care about.
export const noneAdapter: PortalAdapter = {
  provider: 'none',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    return {
      action: '#',
      emailFieldName: cfg.field_map?.email ?? cfg.email_field_name ?? 'email',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'name',
      method: cfg.method ?? 'post',
      disabled: true,
    };
  },
  transform(html: string, cfg: SubscribeAdapterConfig): string {
    const selectors = cfg.strip_selectors ?? [];
    if (selectors.length === 0) return html;
    let out = html;
    for (const selector of selectors) {
      out = stripBySelector(out, selector);
    }
    return out;
  },
};

// Minimal CSS-selector subset: `.class`, `#id`, or `tag`. Themes ship the
// wrapper classes documented in the schema (`gh-footer-signup`, `gh-cta`).
// Combinators / pseudo-classes are deliberately out of scope; an operator
// who needs them owns a richer post-processor anyway.
export function stripBySelector(html: string, selector: string): string {
  const trimmed = selector.trim();
  if (trimmed.length === 0) return html;
  let attr: 'class' | 'id' | null = null;
  let needle: string;
  let tag = '[a-zA-Z][\\w-]*';
  if (trimmed.startsWith('.')) {
    attr = 'class';
    needle = trimmed.slice(1);
  } else if (trimmed.startsWith('#')) {
    attr = 'id';
    needle = trimmed.slice(1);
  } else {
    needle = trimmed;
    tag = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (needle.length === 0) return html;
  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrMatch =
    attr === null
      ? ''
      : `[^>]*?\\b${attr}\\s*=\\s*("[^"]*\\b${escapedNeedle}\\b[^"]*"|'[^']*\\b${escapedNeedle}\\b[^']*')`;
  const openRe = new RegExp(`<(${tag})\\b${attrMatch}[^>]*>`, 'gi');
  return spliceMatchingBlocks(html, openRe);
}

function spliceMatchingBlocks(html: string, openRe: RegExp): string {
  let out = '';
  let cursor = 0;
  openRe.lastIndex = 0;
  while (true) {
    const match = openRe.exec(html);
    if (match === null) break;
    const start = match.index;
    if (start < cursor) {
      openRe.lastIndex = cursor;
      continue;
    }
    const tagName = (match[1] ?? '').toLowerCase();
    const openEnd = start + match[0].length;
    out += html.slice(cursor, start);
    const closeIdx = findMatchingClose(html, openEnd, tagName);
    if (closeIdx === -1) {
      // Self-closing or void element — drop just the opening tag.
      cursor = openEnd;
    } else {
      cursor = closeIdx;
    }
    openRe.lastIndex = cursor;
  }
  out += html.slice(cursor);
  return out;
}

// Find the index immediately after the matching closing tag, handling nested
// occurrences of the same tag (e.g. `<div class="gh-cta"><div>...</div></div>`).
function findMatchingClose(html: string, from: number, tagName: string): number {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let i = from;
  while (depth > 0 && i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (nextClose === null) return -1;
    if (nextOpen !== null && nextOpen.index < nextClose.index) {
      depth += 1;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return depth === 0 ? i : -1;
}
