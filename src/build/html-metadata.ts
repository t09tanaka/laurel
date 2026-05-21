import { createHash } from 'node:crypto';

export function htmlBuildId(html: string): string {
  return createHash('sha256').update(html).digest('hex').slice(0, 16);
}

export function injectHtmlBuildAttribute(html: string, buildId: string): string {
  if (!buildId) return html;
  const match = html.match(/<html(?:\s[^>]*)?>/i);
  if (!match || match.index === undefined) return html;
  const openTag = match[0];
  if (/\sdata-build(?:\s|=|>)/i.test(openTag)) return html;

  const insertAt = match.index + openTag.length - 1;
  return `${html.slice(0, insertAt)} data-build="${escapeAttr(buildId)}"${html.slice(insertAt)}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
