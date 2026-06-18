import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { sanitizeImageAssetBytes } from '~/util/image-sanitization.ts';
import { logger } from '~/util/logger.ts';

// Default per-image size cap. A 10 MiB ceiling covers typical Ghost feature
// images, hero shots, and even very large screenshots while still refusing
// runaway downloads (multi-hundred-MB videos mislabeled as images, malicious
// streams that never end, etc.). Operators can raise or disable via
// `maxImageSizeBytes` / `--max-image-size`.
export const DEFAULT_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

// Rate-limit knobs for the sequential download loop.
//
// `PER_FETCH_SLEEP_MS` paces successive requests so we don't pound the
// source Ghost CDN with hundreds of back-to-back fetches. At 100ms / image
// a 200-image import only pays an extra 20s of wall-clock — invisible next
// to the actual transfer time — and it stays a polite citizen.
//
// `YIELD_EVERY_N_FETCHES` periodically hands control back to the event
// loop and nudges Bun's GC. Bun 1.3.14 has known stability issues when a
// single async loop holds the runtime for minutes (the dashboard segfaults
// after ~80–200s of continuous fetch+writeFile), and forcing a breather
// every 25 images both flushes pending I/O callbacks and gives the
// collector a chance to reclaim Response/ArrayBuffer churn.
const PER_FETCH_SLEEP_MS = 100;
const YIELD_EVERY_N_FETCHES = 25;

declare const Bun: { gc?: (sync: boolean) => void } | undefined;

function tryCancelUnreadBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  if (!body) return;
  // Error paths (HTTP !ok, size cap hit before body consumption) need this
  // to free the underlying native handle promptly. Once the stream reader has
  // drained the body, avoid a second lifecycle operation on Bun's native body
  // handle.
  body.cancel().catch(() => {});
}

interface BodyReadResult {
  bytes: Uint8Array;
  drained: boolean;
  tooLarge: number | null;
}

async function readResponseBodyBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<BodyReadResult> {
  if (!response.body) {
    return { bytes: new Uint8Array(), drained: true, tooLarge: null };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (maxBytes > 0 && total > maxBytes) {
        await reader.cancel(`Image ${label} exceeded max size ${maxBytes} bytes`).catch(() => {});
        return { bytes: new Uint8Array(), drained: false, tooLarge: total };
      }
      chunks.push(value);
    }
    return { bytes: concatChunks(chunks, total), drained: true, tooLarge: null };
  } finally {
    reader.releaseLock();
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0] ?? new Uint8Array();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// One event per image the downloader processed. `status` distinguishes the
// outcome so a UI can render counts of done / skipped / failed alongside the
// current URL. Counters are cumulative across the lifetime of the downloader
// instance, so a consumer can render them directly without bookkeeping.
interface GhostImageDownloadEvent {
  url: string;
  status: 'fetching' | 'done' | 'skipped' | 'failed';
  downloaded: number;
  skipped: number;
  failed: number;
}

interface GhostImageDownloaderOptions {
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
  // Origin of the source Ghost site (e.g. `https://oldblog.ghost.io`). When
  // provided, the downloader expands site-relative paths like
  // `/content/images/2025/06/foo.jpg` — which is what Ghost exports leave
  // behind after `__GHOST_URL__` placeholder substitution — into absolute URLs
  // it can actually fetch. Without it, only fully-qualified `http(s)://` URLs
  // are downloaded; relative paths are silently skipped.
  sourceUrl?: string;
  // Per-image progress hook. Fires once with `status: 'fetching'` before each
  // network call and again with the outcome (`done` / `skipped` / `failed`).
  // Cache hits within the same import run are silent — the consumer already
  // saw the original event for that URL on the first encounter.
  onEvent?: (event: GhostImageDownloadEvent) => void;
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
// Image-bearing Koenig card shortcodes the turndown layer emits for
// `<figure class="kg-image-card">` and `<div class="kg-gallery-card">`.
// Without crawling these the body's referenced images never reach the
// downloader, so the post ends up pointing at `/content/images/2026/...`
// paths that have no corresponding file on disk.
const IMAGE_SHORTCODE_RE =
  /\{\{<\s+(?:figure|gallery-image)((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}/g;
const SHORTCODE_ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;
const BOOKMARK_IMAGE_ATTRS = new Set(['icon', 'thumbnail']);
const HEADER_IMAGE_ATTRS = new Set(['background', 'background_image']);

// `src` and `src*_src` attributes carry a single URL. `srcset` and
// `src*_srcset` carry a comma-separated list of `<url> <descriptor>` pairs
// (e.g. `foo.jpg 600w, bar.jpg 1000w`). Figure / gallery-image shortcodes
// generate both kinds — `src` for the canonical image plus per-source
// `source1_src` / `source1_srcset` / … for `<picture>` variants.
function isImageShortcodeSrcAttr(name: string): boolean {
  return name === 'src' || name.endsWith('_src');
}
function isImageShortcodeSrcsetAttr(name: string): boolean {
  return name === 'srcset' || name.endsWith('_srcset');
}
function parseSrcsetUrls(srcset: string): string[] {
  const urls: string[] = [];
  for (const piece of srcset.split(',')) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) continue;
    const url = trimmed.split(/\s+/, 1)[0];
    if (url) urls.push(url);
  }
  return urls;
}
function rewriteSrcset(srcset: string, replacements: Map<string, string>): string {
  let changed = false;
  const rewritten = srcset
    .split(',')
    .map((piece) => {
      const leading = piece.match(/^\s*/)?.[0] ?? '';
      const trimmed = piece.slice(leading.length);
      const m = trimmed.match(/^(\S+)(\s.*)?$/);
      if (!m) return piece;
      const url = m[1];
      const rest = m[2] ?? '';
      if (!url) return piece;
      const rep = replacements.get(url);
      if (!rep) return piece;
      changed = true;
      return `${leading}${rep}${rest}`;
    })
    .join(',');
  return changed ? rewritten : srcset;
}

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
  // Base (`https://host[:port][/sub/path]`) of the source Ghost site, used
  // to expand site-relative `/content/images/...` URLs into absolute URLs
  // the fetcher can hit. The pathname is preserved so a Ghost instance
  // mounted under a subpath (e.g. `https://example.com/ja/blog`) resolves
  // images correctly. Undefined when no source URL was supplied; in that
  // case site-relative paths are left untouched.
  private readonly sourceBase: string | undefined;
  private readonly onEvent: ((event: GhostImageDownloadEvent) => void) | undefined;
  // Per-URL cache. `null` means a prior attempt failed; future calls reuse
  // that verdict instead of re-fetching.
  private readonly cache = new Map<string, CacheEntry | null>();
  private _downloaded = 0;
  private _failed = 0;
  private _skipped = 0;
  private _fetchCount = 0;
  private downloadQueue: Promise<void> = Promise.resolve();

  constructor(opts: GhostImageDownloaderOptions) {
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
    this.contentRoot = resolve(opts.outputRoot ?? join(opts.cwd, 'content'));
    // A negative cap is meaningless; treat it the same as 0 (disabled) rather
    // than silently rejecting every fetch.
    const raw = opts.maxImageSizeBytes ?? DEFAULT_MAX_IMAGE_SIZE_BYTES;
    this.maxBytes = raw > 0 ? raw : 0;
    this.sourceBase = normalizeSourceBase(opts.sourceUrl);
    this.onEvent = opts.onEvent;
  }

  private emit(url: string, status: GhostImageDownloadEvent['status']): void {
    this.onEvent?.({
      url,
      status,
      downloaded: this._downloaded,
      skipped: this._skipped,
      failed: this._failed,
    });
  }

  // Called right before every real network fetch. Sleeps `PER_FETCH_SLEEP_MS`
  // unconditionally (rate-limit) and, every `YIELD_EVERY_N_FETCHES` calls,
  // additionally hands control back to the event loop and nudges GC. Both
  // are workarounds for the Bun 1.3.14 SIGSEGV that fires after long
  // continuous fetch+writeFile loops.
  private async preFetchBreather(): Promise<void> {
    this._fetchCount += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, PER_FETCH_SLEEP_MS));
    if (this._fetchCount % YIELD_EVERY_N_FETCHES === 0) {
      try {
        Bun?.gc?.(false);
      } catch {
        // `Bun.gc` is best-effort; tolerate any environment without it.
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  get downloaded(): number {
    return this._downloaded;
  }

  get failed(): number {
    return this._failed;
  }

  get skipped(): number {
    return this._skipped;
  }

  // Turn an image reference from the export into an absolute URL we can fetch.
  // Returns:
  //   - the input unchanged when it is already an `http(s)://...` Ghost
  //     content asset URL (`/.../content/images/...` or `.../content/media/...`)
  //   - `<sourceOrigin><url>` when the input is a Ghost content asset
  //     site-relative path AND a source URL was supplied
  //   - `null` otherwise — relative paths with no source URL, `data:` URIs,
  //     third-party service URLs, `mailto:` etc. The caller treats `null` as
  //     "skip, leave the value alone" so the downloader is safe to call
  //     against every image field.
  private resolveFetchUrl(url: string): string | null {
    if (typeof url !== 'string' || url.length === 0) return null;
    if (isHttpUrl(url)) return isGhostContentAssetUrl(url) ? url : null;
    if (!this.sourceBase) return null;
    if (!isRootRelativeGhostContentAssetPath(url)) return null;
    return `${this.sourceBase}${url}`;
  }

  // Download a single image URL and return the rewritten site-relative URL,
  // or `null` if the input should be left alone (non-http(s), already
  // relative, or download failed).
  async downloadOne(
    url: string,
    opts?: { externalDir?: 'external' | 'bookmarks' },
  ): Promise<string | null> {
    return this.enqueueDownload(() => this.downloadOneLocked(url, opts));
  }

  private async enqueueDownload<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.downloadQueue;
    let release!: () => void;
    this.downloadQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async downloadOneLocked(
    url: string,
    opts?: { externalDir?: 'external' | 'bookmarks' },
  ): Promise<string | null> {
    // `stripGhostUrlPlaceholder` runs over the export before the downloader
    // sees a thing, so what arrives here for Ghost-hosted assets is a
    // site-relative path like `/content/images/2025/06/foo.jpg`, not an
    // absolute URL. When the caller supplied a source URL, expand it back to
    // something fetchable; otherwise we cannot reach the bytes and the
    // download silently no-ops.
    const fetchUrl = this.resolveFetchUrl(url);
    if (fetchUrl === null) {
      if (isHttpUrl(url)) this._skipped += 1;
      return null;
    }
    const cacheKey = opts?.externalDir ? `${opts.externalDir}\0${fetchUrl}` : fetchUrl;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached?.rewrittenUrl ?? null;
    }

    // Fast path: when we can derive the destination file from the URL alone
    // (Ghost-CDN paths and external URLs whose pathname already carries a
    // known image extension), check whether the file is already on disk and
    // skip the network round-trip entirely. This makes re-imports of an
    // unchanged Ghost export effectively instant — most of the wall-clock
    // cost of a fresh import is image fetching, not Markdown writing.
    //
    // We deliberately pass an empty contentType to `derivePaths`; if the
    // URL has no recognisable extension the call returns `.bin` and we fall
    // through to fetching, where the response's `Content-Type` is used.
    const predicted = derivePaths(fetchUrl, '', opts);
    if (!predicted.localPath.endsWith('.bin')) {
      const absPath = join(this.contentRoot, stripContentPrefix(predicted.localPath));
      if (existsSync(absPath)) {
        this.cache.set(cacheKey, { rewrittenUrl: predicted.rewrittenUrl });
        this._skipped += 1;
        this.emit(fetchUrl, 'skipped');
        return predicted.rewrittenUrl;
      }
    }

    this.emit(fetchUrl, 'fetching');
    await this.preFetchBreather();
    let response: Response | undefined;
    let bodyDrained = false;
    try {
      response = await this.fetcher(fetchUrl);
      if (!response.ok) {
        logger.warn(`Failed to download image ${fetchUrl}: HTTP ${response.status}`);
        this.cache.set(cacheKey, null);
        this._failed += 1;
        this.emit(fetchUrl, 'failed');
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
              `Failed to download image ${fetchUrl}: advertised size ${advertised} exceeds max ${this.maxBytes} bytes`,
            );
            this.cache.set(cacheKey, null);
            this._failed += 1;
            this.emit(fetchUrl, 'failed');
            return null;
          }
        }
      }
      const contentType = response.headers.get('content-type') ?? '';
      const read = await readResponseBodyBytes(response, this.maxBytes, fetchUrl);
      bodyDrained = read.drained;
      if (read.tooLarge !== null) {
        logger.warn(
          `Failed to download image ${fetchUrl}: payload ${read.tooLarge} exceeds max ${this.maxBytes} bytes`,
        );
        this.cache.set(cacheKey, null);
        this._failed += 1;
        this.emit(fetchUrl, 'failed');
        return null;
      }
      const buf = read.bytes;
      const { localPath, rewrittenUrl } = derivePaths(fetchUrl, contentType, opts);
      const absPath = join(this.contentRoot, stripContentPrefix(localPath));
      // Defense in depth: pathname normalization in `URL` already strips
      // `..`, but assert we stay under the configured content output root.
      assertWithinContent(this.contentRoot, absPath);
      await ensureDir(dirname(absPath));
      await writeFile(absPath, sanitizeImageAssetBytes(buf, localPath, contentType));
      const entry: CacheEntry = { rewrittenUrl };
      this.cache.set(cacheKey, entry);
      this._downloaded += 1;
      this.emit(fetchUrl, 'done');
      return rewrittenUrl;
    } catch (err) {
      logger.warn(
        `Failed to download image ${fetchUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.cache.set(cacheKey, null);
      this._failed += 1;
      this.emit(fetchUrl, 'failed');
      return null;
    } finally {
      if (!bodyDrained) tryCancelUnreadBody(response?.body);
    }
  }

  // Walk markdown / HTML text and rewrite every image URL we can download.
  async rewriteText(text: string): Promise<string> {
    if (!text) return text;

    const urls = new Set<string>();
    for (const m of text.matchAll(MARKDOWN_IMAGE_RE)) {
      if (m[2]) urls.add(m[2]);
    }
    for (const m of text.matchAll(HTML_IMG_RE)) {
      if (m[3]) urls.add(m[3]);
    }
    for (const m of text.matchAll(CSS_URL_RE)) {
      const url = cssUrlMatchValue(m);
      if (url) urls.add(url);
    }
    for (const m of text.matchAll(HEADER_IMAGE_DATA_ATTR_RE)) {
      if (m[3]) urls.add(m[3]);
    }
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
    // Image-bearing Koenig card shortcodes (`{{< figure ... />}}`,
    // `{{< gallery-image ... />}}`). Walk every `src*` and `srcset*` attr
    // so the canonical image AND the per-`<source>` variants both get
    // downloaded and rewritten — otherwise the post body would still
    // point at `/content/images/...` paths the import never persisted.
    for (const m of text.matchAll(IMAGE_SHORTCODE_RE)) {
      const attrs = m[1];
      if (!attrs) continue;
      SHORTCODE_ATTR_RE.lastIndex = 0;
      let attr = SHORTCODE_ATTR_RE.exec(attrs);
      while (attr !== null) {
        const name = attr[1];
        const value = attr[2];
        if (name && value) {
          if (isImageShortcodeSrcAttr(name)) urls.add(value);
          else if (isImageShortcodeSrcsetAttr(name)) {
            for (const url of parseSrcsetUrls(value)) urls.add(url);
          }
        }
        attr = SHORTCODE_ATTR_RE.exec(attrs);
      }
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
          _quote: string,
          quoted: string,
          _entityQuote: string,
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
      .replace(IMAGE_SHORTCODE_RE, (full, attrs: string) => {
        if (!attrs) return full;
        let changed = false;
        const rewritten = attrs.replace(
          /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g,
          (match, name: string, value: string) => {
            if (isImageShortcodeSrcAttr(name)) {
              const rep = replacements.get(value);
              if (rep) {
                changed = true;
                return `${name}="${rep}"`;
              }
              return match;
            }
            if (isImageShortcodeSrcsetAttr(name)) {
              const next = rewriteSrcset(value, replacements);
              if (next !== value) {
                changed = true;
                return `${name}="${next}"`;
              }
              return match;
            }
            return match;
          },
        );
        return changed ? full.replace(attrs, rewritten) : full;
      })
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

function isGhostContentAssetUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return isRootRelativeGhostContentAssetPath(url.pathname);
  } catch {
    return false;
  }
}

export function isRootRelativeGhostContentAssetPath(pathname: string): boolean {
  return /^\/(?:.*\/)?content\/(?:images|media)\//.test(pathname);
}

// Reduce a user-supplied source URL to a clean base
// (`https://host[:port][/sub/path]`) so the downloader can safely
// concatenate it with a leading-slash path. The pathname is preserved (with
// any trailing slashes stripped) so a Ghost instance mounted under a
// subpath — e.g. `https://example.com/ja/blog/` — resolves to
// `https://example.com/ja/blog/content/images/...` instead of
// `https://example.com/content/images/...`, which would 404 / 403.
//
// Returns undefined when the input is empty / invalid / non-http(s);
// callers then behave as if no source URL was provided at all.
function normalizeSourceBase(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    // Strip trailing slashes so concat with a leading-slash path never
    // produces a `//content/...` double-slash that some CDNs normalise
    // away and others 404.
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${path}`;
  } catch {
    return undefined;
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
  //
  // The `/content/(images|media)/` segment is matched anywhere in the
  // pathname (not anchored to `^`) so a Ghost instance mounted under a
  // subpath — e.g. `https://example.com/ja/blog/content/images/...` —
  // still resolves into `content/images/...` locally instead of falling
  // through to the `external/<hash>` bucket. False-positive risk is
  // negligible: the segment is specific enough that a non-Ghost URL
  // happening to contain `/content/images/<file>` is rare, and the worst
  // case is a single file written under the Ghost layout instead of
  // external — still correctly stored, just in a different folder.
  const ghostMatch = pathname.match(/\/content\/(images|media)\/(.+)$/);
  if (ghostMatch?.[1] && ghostMatch[2] && !ghostMatch[2].includes('..')) {
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
    if (!attrs) continue;
    SHORTCODE_ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null = SHORTCODE_ATTR_RE.exec(attrs);
    while (attr !== null) {
      const name = attr[1];
      const value = attr[2];
      // `isHttpUrl` was the gate here; site-relative `/content/images/...`
      // values silently dropped, so bookmark icon / thumbnail URLs that come
      // out of `stripGhostUrlPlaceholder` as leading-slash paths were never
      // downloaded. `resolveFetchUrl` already rejects anything it can't
      // turn into an absolute URL, so widening to "any non-empty value" is
      // safe — non-fetchable values just no-op at the next step.
      if (name && value && imageAttrs.has(name)) urls.add(value);
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
  if (!attrs) return full;
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
