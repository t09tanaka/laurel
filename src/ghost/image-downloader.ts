import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Default per-image size cap. A 10 MiB ceiling covers typical Ghost feature
// images, hero shots, and even very large screenshots while still refusing
// runaway downloads (multi-hundred-MB videos mislabeled as images, malicious
// streams that never end, etc.). Operators can raise or disable via
// `maxImageSizeBytes` / `--max-image-size`.
export const DEFAULT_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export interface GhostImageDownloaderOptions {
  // Project root. Downloaded files are written under <cwd>/content/images/.
  cwd: string;
  // Optional content-output root. Defaults to <cwd>/content. When import-ghost
  // uses --output, downloaded files are written under that review directory
  // while markdown URLs remain Ghost-compatible /content/... paths.
  outputRoot?: string;
  // Optional fetch override (test seam). Defaults to globalThis.fetch.
  fetcher?: typeof fetch;
  // Maximum per-image size in bytes. Defaults to DEFAULT_MAX_IMAGE_SIZE_BYTES
  // (10 MiB). 0 disables the cap. Enforced both via the Content-Length header
  // (when present) and via the actual response body length (in case the
  // server lies or omits the header), so a single oversize asset cannot
  // exhaust memory or disk.
  maxImageSizeBytes?: number;
}

interface CacheEntry {
  // Site-relative URL to use in markdown / frontmatter after download.
  rewrittenUrl: string;
}

// Match `![alt](url)` and `![alt](url "title")`. The URL group stops at the
// first whitespace, paren, or quote so we don't accidentally swallow a title.
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s"']+)(\s+"[^"]*")?\)/g;
// Match `<img ... src="url" ...>` and the single-quote variant. We rely on
// `src` only appearing once per tag (Turndown's output and Koenig HTML cards
// honor this).
const HTML_IMG_RE = /<img\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>/gi;
const CSS_URL_RE = /url\(\s*(?:(["'])(.*?)\1|(&quot;|&#34;|&#x22;)(.*?)\3|([^'")\s][^)]*?))\s*\)/gi;
const HEADER_IMAGE_DATA_ATTR_RE =
  /\b(data-[a-zA-Z0-9:_-]*(?:background|image)[a-zA-Z0-9:_-]*)\s*=\s*(["'])([^"']+)\2/gi;
const BOOKMARK_SHORTCODE_RE =
  /\{\{<\s+bookmark((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;
const HEADER_SHORTCODE_RE = /\{%\s+header((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}/g;
const HEADER_HUGO_SHORTCODE_RE =
  /\{\{<\s+header((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;
const SHORTCODE_ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;
const BOOKMARK_IMAGE_ATTRS = new Set(['icon', 'thumbnail']);
const HEADER_IMAGE_ATTRS = new Set(['background', 'background_image']);

const KNOWN_IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.ico',
  '.bmp',
  '.tiff',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
};

export class GhostImageDownloader {
  private readonly fetcher: typeof fetch;
  private readonly contentRoot: string;
  private readonly maxBytes: number;
  // Per-URL cache. `null` means a prior attempt failed; future calls reuse
  // that verdict instead of re-fetching.
  private readonly cache = new Map<string, CacheEntry | null>();
  private _downloaded = 0;
  private _failed = 0;

  constructor(opts: GhostImageDownloaderOptions) {
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
    this.contentRoot = resolve(opts.outputRoot ?? join(opts.cwd, 'content'));
    // A negative cap is meaningless; treat it the same as 0 (disabled) rather
    // than silently rejecting every fetch.
    const raw = opts.maxImageSizeBytes ?? DEFAULT_MAX_IMAGE_SIZE_BYTES;
    this.maxBytes = raw > 0 ? raw : 0;
  }

  get downloaded(): number {
    return this._downloaded;
  }

  get failed(): number {
    return this._failed;
  }

  // Download a single image URL and return the rewritten site-relative URL,
  // or `null` if the input should be left alone (non-http(s), already
  // relative, or download failed).
  async downloadOne(
    url: string,
    opts?: { externalDir?: 'external' | 'bookmarks' },
  ): Promise<string | null> {
    if (!isHttpUrl(url)) return null;
    const cacheKey = opts?.externalDir ? `${opts.externalDir}\0${url}` : url;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached?.rewrittenUrl ?? null;
    }

    try {
      const response = await this.fetcher(url);
      if (!response.ok) {
        logger.warn(`Failed to download image ${url}: HTTP ${response.status}`);
        this.cache.set(cacheKey, null);
        this._failed += 1;
        return null;
      }
      // Trust-but-verify Content-Length: refuse upfront when the server
      // advertises an oversize payload so we never allocate the buffer. After
      // download we re-check actual byte length because a hostile / broken
      // server can lie or omit the header entirely.
      if (this.maxBytes > 0) {
        const cl = response.headers.get('content-length');
        if (cl !== null) {
          const advertised = Number.parseInt(cl, 10);
          if (Number.isFinite(advertised) && advertised > this.maxBytes) {
            logger.warn(
              `Failed to download image ${url}: advertised size ${advertised} exceeds max ${this.maxBytes} bytes`,
            );
            this.cache.set(cacheKey, null);
            this._failed += 1;
            return null;
          }
        }
      }
      const contentType = response.headers.get('content-type') ?? '';
      const buf = new Uint8Array(await response.arrayBuffer());
      if (this.maxBytes > 0 && buf.byteLength > this.maxBytes) {
        logger.warn(
          `Failed to download image ${url}: payload ${buf.byteLength} exceeds max ${this.maxBytes} bytes`,
        );
        this.cache.set(cacheKey, null);
        this._failed += 1;
        return null;
      }
      const { localPath, rewrittenUrl } = derivePaths(url, contentType, opts);
      const absPath = join(this.contentRoot, stripContentPrefix(localPath));
      // Defense in depth: pathname normalization in `URL` already strips
      // `..`, but assert we stay under the configured content output root.
      assertWithinContent(this.contentRoot, absPath);
      await ensureDir(dirname(absPath));
      await writeFile(absPath, buf);
      const entry: CacheEntry = { rewrittenUrl };
      this.cache.set(cacheKey, entry);
      this._downloaded += 1;
      return rewrittenUrl;
    } catch (err) {
      logger.warn(
        `Failed to download image ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.cache.set(cacheKey, null);
      this._failed += 1;
      return null;
    }
  }

  // Walk markdown / HTML text and rewrite every image URL we can download.
  async rewriteText(text: string): Promise<string> {
    if (!text) return text;

    const urls = new Set<string>();
    for (const m of text.matchAll(MARKDOWN_IMAGE_RE)) urls.add(m[2]);
    for (const m of text.matchAll(HTML_IMG_RE)) urls.add(m[3]);
    for (const m of text.matchAll(CSS_URL_RE)) {
      const url = cssUrlMatchValue(m);
      if (url) urls.add(url);
    }
    for (const m of text.matchAll(HEADER_IMAGE_DATA_ATTR_RE)) urls.add(m[3]);
    for (const url of collectShortcodeImageUrls(text, HEADER_SHORTCODE_RE, HEADER_IMAGE_ATTRS)) {
      urls.add(url);
    }
    for (const url of collectShortcodeImageUrls(
      text,
      HEADER_HUGO_SHORTCODE_RE,
      HEADER_IMAGE_ATTRS,
    )) {
      urls.add(url);
    }
    const bookmarkUrls = collectBookmarkImageUrls(text);
    if (urls.size === 0 && bookmarkUrls.size === 0) return text;

    const replacements = new Map<string, string>();
    for (const url of urls) {
      const rep = await this.downloadOne(url);
      if (rep) replacements.set(url, rep);
    }
    const bookmarkReplacements = new Map<string, string>();
    for (const url of bookmarkUrls) {
      const rep = await this.downloadOne(url, { externalDir: 'bookmarks' });
      if (rep) bookmarkReplacements.set(url, rep);
    }
    if (replacements.size === 0 && bookmarkReplacements.size === 0) return text;

    return text
      .replace(MARKDOWN_IMAGE_RE, (full, alt: string, url: string, title?: string) => {
        const rep = replacements.get(url);
        return rep ? `![${alt}](${rep}${title ?? ''})` : full;
      })
      .replace(HTML_IMG_RE, (full, before: string, quote: string, url: string, after: string) => {
        const rep = replacements.get(url);
        return rep ? `<img${before}src=${quote}${rep}${quote}${after}>` : full;
      })
      .replace(
        CSS_URL_RE,
        (
          full,
          quote: string,
          quoted: string,
          entityQuote: string,
          entityQuoted: string,
          bare: string,
        ) => {
          const url = quoted ?? entityQuoted ?? bare?.trim();
          const rep = replacements.get(url);
          return rep ? full.replace(url, rep) : full;
        },
      )
      .replace(HEADER_IMAGE_DATA_ATTR_RE, (full, name: string, quote: string, value: string) => {
        const rep = replacements.get(value);
        return rep ? `${name}=${quote}${rep}${quote}` : full;
      })
      .replace(HEADER_SHORTCODE_RE, (full, attrs: string) =>
        rewriteShortcodeImageAttrs(full, attrs, replacements, HEADER_IMAGE_ATTRS),
      )
      .replace(HEADER_HUGO_SHORTCODE_RE, (full, attrs: string) =>
        rewriteShortcodeImageAttrs(full, attrs, replacements, HEADER_IMAGE_ATTRS),
      )
      .replace(BOOKMARK_SHORTCODE_RE, (full, attrs: string) =>
        rewriteShortcodeImageAttrs(full, attrs, bookmarkReplacements, BOOKMARK_IMAGE_ATTRS),
      );
  }

  // Rewrite a single frontmatter URL field (e.g. feature_image). Returns the
  // input unchanged when it's nullish, not a string, not an http(s) URL, or
  // the download fails.
  async rewriteField<T extends string | null | undefined>(value: T): Promise<T | string> {
    if (typeof value !== 'string' || value.length === 0) return value;
    const rep = await this.downloadOne(value);
    return rep ?? value;
  }
}

function isHttpUrl(s: string): boolean {
  if (typeof s !== 'string' || s.length === 0) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function derivePaths(
  url: string,
  contentType: string,
  opts?: { externalDir?: 'external' | 'bookmarks' },
): { localPath: string; rewrittenUrl: string } {
  const u = new URL(url);
  const pathname = u.pathname;

  // Ghost CDN style: keep the /content/(images|media)/<rest> layout so the
  // imported markdown already lines up with how the build pipeline resolves
  // `/content/images/...` URLs.
  const ghostMatch = pathname.match(/^\/content\/(images|media)\/(.+)$/);
  if (ghostMatch && !ghostMatch[2].includes('..')) {
    const subdir = ghostMatch[1];
    const rest = ghostMatch[2];
    return {
      localPath: join('content', subdir, ...rest.split('/')),
      rewrittenUrl: `/content/${subdir}/${rest}`,
    };
  }

  // External URL: use a deterministic hashed filename under
  // content/images/external/ so the same URL always maps to the same file
  // (dedup-friendly across re-imports) and so collisions across hosts are
  // impossible.
  const ext = inferExtension(url, contentType);
  const hash = sha256Hex(url).slice(0, 16);
  const file = `${hash}${ext}`;
  const externalDir = opts?.externalDir ?? 'external';
  return {
    localPath: join('content', 'images', externalDir, file),
    rewrittenUrl: `/content/images/${externalDir}/${file}`,
  };
}

function cssUrlMatchValue(match: RegExpMatchArray): string {
  return match[2] ?? match[4] ?? match[5]?.trim() ?? '';
}

function collectBookmarkImageUrls(text: string): Set<string> {
  return collectShortcodeImageUrls(text, BOOKMARK_SHORTCODE_RE, BOOKMARK_IMAGE_ATTRS);
}

function collectShortcodeImageUrls(
  text: string,
  shortcodeRe: RegExp,
  imageAttrs: Set<string>,
): Set<string> {
  const urls = new Set<string>();
  for (const shortcode of text.matchAll(shortcodeRe)) {
    const attrs = shortcode[1];
    SHORTCODE_ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null = SHORTCODE_ATTR_RE.exec(attrs);
    while (attr !== null) {
      const name = attr[1];
      const value = attr[2];
      if (imageAttrs.has(name) && isHttpUrl(value)) urls.add(value);
      attr = SHORTCODE_ATTR_RE.exec(attrs);
    }
  }
  return urls;
}

function rewriteShortcodeImageAttrs(
  full: string,
  attrs: string,
  replacements: Map<string, string>,
  imageAttrs: Set<string>,
): string {
  if (replacements.size === 0) return full;
  const rewrittenAttrs = attrs.replace(SHORTCODE_ATTR_RE, (match, name: string, value: string) => {
    if (!imageAttrs.has(name)) return match;
    const rep = replacements.get(value);
    return rep ? `${name}="${rep}"` : match;
  });
  return full.replace(attrs, rewrittenAttrs);
}

function inferExtension(url: string, contentType: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').pop() ?? '';
    const ext = extname(base).toLowerCase();
    if (KNOWN_IMAGE_EXTS.has(ext)) return ext;
  } catch {
    // fall through
  }
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_EXT[mime] ?? '.bin';
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function stripContentPrefix(localPath: string): string {
  const prefix = `content${sep}`;
  return localPath.startsWith(prefix) ? localPath.slice(prefix.length) : localPath;
}

function assertWithinContent(contentRoot: string, candidate: string): void {
  const resolvedBase = resolve(contentRoot);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(resolvedBase + sep)) {
    throw new Error(
      `Refusing to write downloaded image outside content output: candidate=${resolvedCandidate} base=${resolvedBase}`,
    );
  }
}
