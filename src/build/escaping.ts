const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const HTML_ATTRIBUTE_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeXmlText(value: string): string {
  return escapeWithMap(value, XML_ESCAPE_MAP, { stripXmlForbiddenControls: true });
}

export function escapeHtmlAttribute(value: string): string {
  return escapeWithMap(value, HTML_ATTRIBUTE_ESCAPE_MAP);
}

function escapeWithMap(
  value: string,
  map: Record<string, string>,
  options?: { stripXmlForbiddenControls?: boolean },
): string {
  let out = '';
  for (const ch of value) {
    const escaped = map[ch];
    if (escaped !== undefined) {
      out += escaped;
      continue;
    }
    if (options?.stripXmlForbiddenControls && isXmlForbiddenControlChar(ch)) continue;
    out += ch;
  }
  return out;
}

function isXmlForbiddenControlChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}
