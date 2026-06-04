import { nonceAttr } from '~/util/csp.ts';

const SKIP_LINK_CLASS = 'laurel-skip-link';

const SKIP_LINK_STYLE_BODY =
  '.laurel-skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}' +
  '.laurel-skip-link:focus{position:fixed;left:0;top:0;width:auto;height:auto;clip:auto;clip-path:none;padding:8px 16px;background:#000;color:#fff;z-index:9999;text-decoration:underline;font:bold 14px/1.4 system-ui,-apple-system,sans-serif;white-space:normal}';

const BODY_OPEN_RE = /<body\b[^>]*>/i;
const MAIN_OPEN_RE = /<main\b[^>]*>/i;
const ID_ATTR_RE = /\bid\s*=\s*(["'])(.*?)\1/i;

export function injectSkipLink(html: string, cspNonce?: string): string {
  if (html.includes(`class="${SKIP_LINK_CLASS}`) || html.includes(`class='${SKIP_LINK_CLASS}`)) {
    return html;
  }
  const match = BODY_OPEN_RE.exec(html);
  if (!match) return html;
  const insertAt = match.index + match[0].length;
  const style = `<style id="laurel-skip-link-style"${nonceAttr(cspNonce)}>${SKIP_LINK_STYLE_BODY}</style>`;
  return `${html.slice(0, insertAt)}\n${style}\n${skipLinkAnchor(mainTargetId(html))}${html.slice(insertAt)}`;
}

function skipLinkAnchor(targetId: string): string {
  return `<a class="${SKIP_LINK_CLASS} skip-link" href="#${escapeAttrValue(targetId)}">Skip to content</a>`;
}

function mainTargetId(html: string): string {
  const main = MAIN_OPEN_RE.exec(html);
  if (!main) return 'main';
  const id = ID_ATTR_RE.exec(main[0])?.[2];
  return id?.trim() || 'main';
}

function escapeAttrValue(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
