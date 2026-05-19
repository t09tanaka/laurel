// Render the ` nonce="..."` attribute fragment (leading space included) for an
// inline `<script>` or `<style>` tag emitted by Nectar, or an empty string
// when no nonce is configured.
//
// The `[build].csp_nonce` schema validates against `[A-Za-z0-9+/\-_]+={0,2}`,
// so a non-empty value is always safe to inject without HTML-escaping; any
// character that would need escaping would have failed config parsing. The
// `string | undefined` shape mirrors the optional schema field — callers pass
// `config.build.csp_nonce` directly without an extra ternary.
export function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${nonce}"` : '';
}
