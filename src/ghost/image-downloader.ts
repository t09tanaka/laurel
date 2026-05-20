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
  private readonly cwd: string;
  private readonly fetcher: typeof fetch;
  private readonly imagesRoot: string;
  private readonly maxBytes: number;
  // Per-URL cache. `null` means a prior attempt failed; future calls reuse
  // that verdict instead of re-fetching.
  private readonly cache = new Map<string, CacheEntry | null>();
  private _downloaded = 0;
  private _failed = 0;

  constructor(opts: GhostImageDownloaderOptions) {
    this.cwd = opts.cwd;
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
    this.imagesRoot = resolve(opts.cwd, 'content', 'images');
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
  async downloadOne(url: string): Promise<string | null> {
    if (!isHttpUrl(url)) return null;

    const cached = this.cache.get(url);
    if (cached !== undefined) {
      return cached?.rewrittenUrl ?? null;
    }

    try {
      const response = await this.fetcher(url);
      if (!response.ok) {
        logger.warn(`Failed to download image ${url}: HTTP ${response.status}`);
        this.cache.set(url, null);
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
            this.cache.set(url, null);
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
        this.cache.set(url, null);
        this._failed += 1;
        return null;
      }
      const { localPath, rewrittenUrl } = derivePaths(url, contentType);
      const absPath = join(this.cwd, localPath);
      // Defense in depth: pathname normalization in `URL` already strips
      // `..`, but assert we stay under content/images/ before writing.
      assertWithinImages(this.imagesRoot, absPath);
      await ensureDir(dirname(absPath));
      await writeFile(absPath, buf);
      const entry: CacheEntry = { rewrittenUrl };
      this.cache.set(url, entry);
      this._downloaded += 1;
      return rewrittenUrl;
    } catch (err) {
      logger.warn(
        `Failed to download image ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.cache.set(url, null);
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
    if (urls.size === 0) return text;

    const replacements = new Map<string, string>();
    for (const url of urls) {
      const rep = await this.downloadOne(url);
      if (rep) replacements.set(url, rep);
    }
    if (replacements.size === 0) return text;

    return text
      .replace(MARKDOWN_IMAGE_RE, (full, alt: string, url: string, title?: string) => {
        const rep = replacements.get(url);
        return rep ? `![${alt}](${rep}${title ?? ''})` : full;
      })
      .replace(HTML_IMG_RE, (full, before: string, quote: string, url: string, after: string) => {
        const rep = replacements.get(url);
        return rep ? `<img${before}src=${quote}${rep}${quote}${after}>` : full;
      });
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
  return {
    localPath: join('content', 'images', 'external', file),
    rewrittenUrl: `/content/images/external/${file}`,
  };
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

function assertWithinImages(imagesRoot: string, candidate: string): void {
  const resolvedBase = resolve(imagesRoot);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(resolvedBase + sep)) {
    throw new Error(
      `Refusing to write downloaded image outside content/images: candidate=${resolvedCandidate} base=${resolvedBase}`,
    );
  }
}
