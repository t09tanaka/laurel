import { nonceAttr } from '~/util/csp.ts';

const SKIP_LINK_CLASS = 'nectar-skip-link';

const SKIP_LINK_STYLE_BODY =
  '.nectar-skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}' +
  '.nectar-skip-link:focus{position:fixed;left:0;top:0;width:auto;height:auto;clip:auto;clip-path:none;padding:8px 16px;background:#000;color:#fff;z-index:9999;text-decoration:underline;font:bold 14px/1.4 system-ui,-apple-system,sans-serif;white-space:normal}';

const SKIP_LINK_ANCHOR = `<a class="${SKIP_LINK_CLASS} skip-link" href="#main">Skip to content</a>`;

const BODY_OPEN_RE = /<body\b[^>]*>/i;

export function injectSkipLink(html: string, cspNonce?: string): string {
  if (html.includes(`class="${SKIP_LINK_CLASS}`) || html.includes(`class='${SKIP_LINK_CLASS}`)) {
    return html;
  }
  const match = BODY_OPEN_RE.exec(html);
  if (!match) return html;
  const insertAt = match.index + match[0].length;
  const style = `<style id="nectar-skip-link-style"${nonceAttr(cspNonce)}>${SKIP_LINK_STYLE_BODY}</style>`;
  return `${html.slice(0, insertAt)}\n${style}\n${SKIP_LINK_ANCHOR}${html.slice(insertAt)}`;
}
