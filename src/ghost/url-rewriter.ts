// Rewrites absolute URLs that point at the migrated Ghost site to site-relative
// paths. Driven by the importer's `--source-url=<url>` flag.
//
// Ghost stores `<a href="https://oldblog.com/some-post">` and similar absolute
// URLs inside post HTML even after `__GHOST_URL__` placeholder substitution,
// because the editor lets authors paste fully-qualified links freely. After
// import, those links would 404 if the old blog is taken down, or point at the
// old site instead of the new one. This module walks the post body and turns
// `https://oldblog.com/<rest>` into `/<rest>` so links resolve against the new
// site root.

// Match `[text](url)` and `[text](url "title")`. The negative lookbehind
// `(?<!!)` keeps us from matching `![alt](url)` image syntax — those are owned
// by the image downloader.
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s"']+)(\s+"[^"]*")?\)/g;

// Match `<a ... href="url" ...>` and the single-quote variant. Mirrors the
// shape used in image-downloader for `<img src>` so the two passes compose
// cleanly when both run.
const HTML_ANCHOR_RE = /<a\b([^>]*?)\bhref\s*=\s*(["'])([^"']+)\2([^>]*)>/gi;

export class GhostUrlRewriter {
  private readonly hostname: string;

  constructor(sourceUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new Error(
        `Invalid --source-url: ${sourceUrl}. Expected an absolute URL like https://oldblog.com.`,
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid --source-url: ${sourceUrl}. Only http(s) URLs are supported.`);
    }
    this.hostname = parsed.hostname.toLowerCase();
  }

  // Rewrite a single URL string. Returns the input unchanged if it's not an
  // http(s) URL whose hostname matches the configured source.
  rewriteUrl(url: string): string {
    if (typeof url !== 'string' || url.length === 0) return url;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    if (parsed.hostname.toLowerCase() !== this.hostname) return url;
    // Preserve pathname + query + fragment. URL guarantees pathname starts
    // with '/', so the result is always site-relative.
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  // Walk markdown / HTML body text and rewrite every link URL we recognize.
  rewriteText(text: string): string {
    if (!text) return text;
    return text
      .replace(MARKDOWN_LINK_RE, (full, label: string, url: string, title?: string) => {
        const rep = this.rewriteUrl(url);
        return rep !== url ? `[${label}](${rep}${title ?? ''})` : full;
      })
      .replace(
        HTML_ANCHOR_RE,
        (full, before: string, quote: string, url: string, after: string) => {
          const rep = this.rewriteUrl(url);
          return rep !== url ? `<a${before}href=${quote}${rep}${quote}${after}>` : full;
        },
      );
  }
}
