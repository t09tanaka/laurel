import { logger } from './logger.ts';

// Theme- and config-supplied href values flow into <a href="..."> after
// HTML-escape, which blocks attribute-injection but NOT scheme-based XSS like
// `javascript:alert(1)` or `data:text/html,<script>...</script>`. Themes and
// recommendation lists are frequently downloaded from third parties or
// composed of partials whose origin the operator did not audit, so we treat
// the href as untrusted at the render boundary. Allow only http(s), mailto,
// tel, and relative URLs; anything else collapses to `#` so the rendered <a>
// is harmless. Control characters are stripped first because browsers ignore
// them when resolving URLs, so `\tjavascript:alert(1)` would otherwise sneak
// past a naive prefix check.
const URL_SCHEME_RE = /^([a-z][a-z0-9+.\-]*):/i;
const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

export function sanitizeHref(value: string, context: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional sentinel for attacker-controlled bytes
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (normalized.length === 0) return '#';
  const match = normalized.match(URL_SCHEME_RE);
  if (!match) return value;
  const scheme = match[1].toLowerCase();
  if (SAFE_LINK_SCHEMES.has(scheme)) return value;
  logger.warn(`Refusing unsafe href in ${context}: ${JSON.stringify(value)} (scheme: ${scheme}:)`);
  return '#';
}
