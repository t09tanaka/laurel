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

// Code-indexed escape tables built once from the maps above. All metacharacters
// are ASCII (< 128), so a single integer compare on each char's code point skips
// the table lookup for everything else (CJK, emoji surrogates, accented Latin),
// avoiding the per-character string allocation a `map[value[i]]` lookup incurs.
const XML_ESCAPE_TABLE = buildEscapeTable(XML_ESCAPE_MAP);
const HTML_ATTRIBUTE_ESCAPE_TABLE = buildEscapeTable(HTML_ATTRIBUTE_ESCAPE_MAP);

function buildEscapeTable(map: Record<string, string>): (string | undefined)[] {
  const table: (string | undefined)[] = new Array(128);
  for (const ch of Object.keys(map)) {
    const code = ch.charCodeAt(0);
    if (code < 128) table[code] = map[ch];
  }
  return table;
}

export function escapeXmlText(value: string): string {
  return escapeWithTable(value, XML_ESCAPE_TABLE, true);
}

export function escapeHtmlAttribute(value: string): string {
  return escapeWithTable(value, HTML_ATTRIBUTE_ESCAPE_TABLE, false);
}

// Escapes the handful of XML/HTML metacharacters, optionally stripping
// XML-forbidden control characters. Hot path: this runs on every escaped
// `{{ }}` attribute value (~48 per route via `ghost_head`) and on every feed /
// sitemap field. Most values contain nothing to escape, so we scan by code
// point and return the input unchanged with no allocation; when an escape /
// strip is needed we copy the untouched runs in slices rather than rebuilding
// char-by-char.
function escapeWithTable(
  value: string,
  table: readonly (string | undefined)[],
  strip: boolean,
): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const escaped = code < 128 ? table[code] : undefined;
    if (escaped !== undefined) {
      out += value.slice(last, i) + escaped;
      last = i + 1;
    } else if (strip && isXmlForbiddenControlCharCode(code)) {
      out += value.slice(last, i);
      last = i + 1;
    }
  }
  if (last === 0) return value;
  return out + value.slice(last);
}

function isXmlForbiddenControlCharCode(code: number): boolean {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}
