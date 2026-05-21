import { joinPath } from '~/theme/assets.ts';
import type { PortalTrigger, ResolvedPortalUrls } from './portal-urls.ts';

// Source theme's sidebar "See all" recommendations button is rendered as
// `<button data-portal="recommendations">` — in Ghost this attribute binds the
// Portal modal that lists every recommendation. Without a Portal runtime the
// button is dead in Nectar. This transform finds the button in already-rendered
// HTML and rewrites it to an `<a>` deep-linking to the
// `<section id="all-recommendations">` block on the auto-emitted
// `/recommendations/` page. Other `data-portal` values (signin, signup,
// upgrade) are handled by `rewritePortalLinks` below.
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

const PORTAL_TRIGGERS: readonly PortalTrigger[] = ['signup', 'signin', 'account', 'upgrade'];

// Ghost themes ship `<a href="#/portal/signup" data-portal="signup">…</a>` and
// `<button data-portal="signup">…</button>` markers that the Ghost Portal
// script intercepts at runtime. Nectar is static-only, so when the operator
// has named an external provider in `[components.portal]`, we rewrite those
// buttons to point at the provider's hosted page (signup form, sign-in page,
// account page, upgrade checkout). Anchors get their `href` patched in place;
// `<button>` elements are upgraded to `<a>` so the link works without JS and
// is reachable by crawlers and keyboard users.
//
// Recommendations buttons are owned by `rewriteRecommendationsButton` and are
// skipped here.
export function rewritePortalLinks(opts: {
  html: string;
  urls: ResolvedPortalUrls;
  inviteOnly?: boolean | undefined;
}): string {
  const { urls } = opts;
  const html = opts.inviteOnly ? removeInviteOnlySignupTriggers(opts.html) : opts.html;
  const wired = PORTAL_TRIGGERS.filter((t) => Boolean(urls[t]));
  if (wired.length === 0) return html;
  let out = html;
  for (const trigger of wired) {
    const href = urls[trigger];
    if (!href) continue;
    out = rewriteAnchors(out, trigger, href);
    out = rewriteButtons(out, trigger, href);
  }
  return out;
}

const INVITE_ONLY_SIGNUP_TRIGGERS = ['signup', 'subscribe'] as const;
const INVITE_ONLY_SIGNUP_TAGS = ['a', 'button'] as const;

function removeInviteOnlySignupTriggers(html: string): string {
  let out = html;
  for (const trigger of INVITE_ONLY_SIGNUP_TRIGGERS) {
    for (const tag of INVITE_ONLY_SIGNUP_TAGS) out = removePortalTriggerElement(out, tag, trigger);
  }
  out = removeElementWithAttribute(out, 'form', 'data-members-form');
  return out;
}

function removePortalTriggerElement(html: string, tag: 'a' | 'button', trigger: string): string {
  const openRe = new RegExp(`<${tag}\\b[^>]*?\\bdata-portal="${trigger}"[^>]*>`, 'gi');
  return removeMatchedElements(html, openRe, `</${tag}>`);
}

function removeElementWithAttribute(html: string, tag: string, attribute: string): string {
  const openRe = new RegExp(`<${tag}\\b[^>]*?\\b${attribute}\\b[^>]*>`, 'gi');
  return removeMatchedElements(html, openRe, `</${tag}>`);
}

function removeMatchedElements(html: string, openRe: RegExp, closeTag: string): string {
  let out = '';
  let cursor = 0;
  openRe.lastIndex = 0;
  while (true) {
    const match = openRe.exec(html);
    if (match === null) break;
    const start = match.index;
    const openEnd = start + match[0].length;
    const closeIdx = html.indexOf(closeTag, openEnd);
    if (closeIdx === -1) {
      out += html.slice(cursor);
      cursor = html.length;
      break;
    }
    out += html.slice(cursor, start);
    cursor = closeIdx + closeTag.length;
    openRe.lastIndex = cursor;
  }
  out += html.slice(cursor);
  return out;
}

function rewriteAnchors(html: string, trigger: PortalTrigger, href: string): string {
  const re = new RegExp(`<a\\b([^>]*?)\\bdata-portal="${trigger}"([^>]*)>`, 'gi');
  return html.replace(re, (_match, before: string, after: string) => {
    const combined = `${before ?? ''}${after ?? ''}`;
    const stripped = combined.replace(/\s+href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
    const prefix = stripped.startsWith(' ') || stripped.length === 0 ? stripped : ` ${stripped}`;
    return `<a href="${escapeAttr(href)}"${prefix} data-portal="${trigger}">`;
  });
}

function rewriteButtons(html: string, trigger: PortalTrigger, href: string): string {
  const openRe = new RegExp(`<button\\b([^>]*?)\\bdata-portal="${trigger}"([^>]*)>`, 'gi');
  let out = '';
  let cursor = 0;
  openRe.lastIndex = 0;
  while (true) {
    const match = openRe.exec(html);
    if (match === null) break;
    const start = match.index;
    const openEnd = start + match[0].length;
    const before = match[1] ?? '';
    const after = match[2] ?? '';
    const closeIdx = html.indexOf(CLOSE_BUTTON, openEnd);
    if (closeIdx === -1) {
      out += html.slice(cursor);
      cursor = html.length;
      break;
    }
    out += html.slice(cursor, start);
    out += `<a${before}${after} href="${escapeAttr(href)}" role="button">`;
    out += html.slice(openEnd, closeIdx);
    out += '</a>';
    cursor = closeIdx + CLOSE_BUTTON.length;
    openRe.lastIndex = cursor;
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
