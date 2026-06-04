// Server-side OGP fetcher for the bookmark insert menu.
//
// Split into three concerns:
//   1. `classifyHost` / `classifyResolvedIp` — SSRF guard (pure).
//   2. `pickMetadata` — pure HTML → OgpMeta with the precedence rules
//      Ghost Koenig uses for bookmark cards.
//   3. `fetchOgp` — runtime fetch with manual redirect, body cap,
//      AbortController timeout, DNS check per hop.

import { Parser } from 'htmlparser2';

interface OgpMeta {
  url: string;
  title: string;
  description: string;
  icon: string;
  thumbnail: string;
  author: string;
  publisher: string;
}

const TEXT_FIELD_MAX = 300;

function trimTo(value: string, max = TEXT_FIELD_MAX): string {
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function resolveUrl(value: string, base: URL): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];

export function classifyHost(hostname: string): 'public' | 'blocked' {
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(h)) return 'blocked';
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return 'blocked';
  // If the hostname parses as a literal IP, defer to the IP classifier.
  if (isIpLiteral(h)) return classifyResolvedIp(h);
  return 'public';
}

export function classifyResolvedIp(ip: string): 'public' | 'blocked' {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower.includes(':')) return classifyIpv6(lower);
  return classifyIpv4(lower);
}

function isIpLiteral(value: string): boolean {
  if (value.includes(':')) return true;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function classifyIpv4(value: string): 'public' | 'blocked' {
  const parts = value.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 'blocked';
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return 'blocked'; // 0.0.0.0/8 unspecified / "this network"
  if (a === 127) return 'blocked'; // loopback
  if (a === 10) return 'blocked'; // private
  if (a === 192 && b === 168) return 'blocked'; // private
  if (a === 172 && b >= 16 && b <= 31) return 'blocked'; // private
  if (a === 169 && b === 254) return 'blocked'; // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return 'blocked'; // CGNAT
  if (a >= 224) return 'blocked'; // multicast + reserved
  return 'public';
}

function classifyIpv6(value: string): 'public' | 'blocked' {
  // Only the dotted-decimal form of ::ffff:<v4> is handled here. Node's
  // dns.lookup always returns IPv4 in dotted-decimal, so the hex form
  // (::ffff:7f00:1) is not reachable from our fetcher's call sites.
  const v4Mapped = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) return classifyIpv4(v4Mapped[1] as string);
  const unspec = value === '::' || value === '0:0:0:0:0:0:0:0';
  if (unspec) return 'blocked';
  if (value === '::1' || /^0:0:0:0:0:0:0:1$/.test(value)) return 'blocked';
  // fc00::/7 — unique local
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return 'blocked';
  // fe80::/10 — link local
  if (/^fe[89ab][0-9a-f]:/.test(value)) return 'blocked';
  // ff00::/8 — multicast
  if (/^ff[0-9a-f]{2}:/.test(value)) return 'blocked';
  return 'public';
}

function parseSizes(raw: string | undefined): number {
  if (!raw) return 0;
  // "32x32" or "16x16 32x32 64x64" — for each WxH pair use the shorter
  // axis (so non-square hints aren't inflated), then return the largest
  // pair across the list.
  const matches = raw.match(/(\d+)x(\d+)/gi);
  if (!matches) return 0;
  let best = 0;
  for (const m of matches) {
    const [w, h] = m.split(/x/i).map((n) => Number(n));
    const size = Math.min(w ?? 0, h ?? 0);
    if (size > best) best = size;
  }
  return best;
}

export function pickMetadata(html: string, finalUrl: URL): OgpMeta {
  let ogTitle = '';
  let twTitle = '';
  let docTitle = '';
  let ogDesc = '';
  let twDesc = '';
  let metaDesc = '';
  let ogImageSecure = '';
  let ogImage = '';
  let twImage = '';
  let siteName = '';
  let author = '';
  let articleAuthor = '';
  let bestIconHref = '';
  let bestIconSize = -1;

  let inTitle = false;
  const titleBuf: string[] = [];

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'title') {
          inTitle = true;
          return;
        }
        if (name === 'meta') {
          const prop = (attrs.property ?? '').toLowerCase();
          const nameAttr = (attrs.name ?? '').toLowerCase();
          const content = attrs.content ?? '';
          if (!content) return;
          if (prop === 'og:title') ogTitle = content;
          else if (prop === 'og:description') ogDesc = content;
          else if (prop === 'og:image') ogImage = content;
          else if (prop === 'og:image:secure_url') ogImageSecure = content;
          else if (prop === 'og:site_name') siteName = content;
          else if (prop === 'article:author') articleAuthor = content;
          else if (nameAttr === 'twitter:title') twTitle = content;
          else if (nameAttr === 'twitter:description') twDesc = content;
          else if (nameAttr === 'twitter:image') twImage = content;
          else if (nameAttr === 'description') metaDesc = content;
          else if (nameAttr === 'author') author = content;
          return;
        }
        if (name === 'link') {
          const rel = (attrs.rel ?? '').toLowerCase();
          if (!rel.includes('icon')) return;
          const href = attrs.href ?? '';
          if (!href) return;
          const size = parseSizes(attrs.sizes);
          if (size > bestIconSize) {
            bestIconSize = size;
            bestIconHref = href;
          }
        }
      },
      ontext(text) {
        if (inTitle) titleBuf.push(text);
      },
      onclosetag(name) {
        if (name === 'title') inTitle = false;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  docTitle = titleBuf.join('').trim();

  const title = ogTitle || twTitle || docTitle;
  const description = ogDesc || twDesc || metaDesc;
  const thumbnailRaw = ogImageSecure || ogImage || twImage;
  const thumbnail = thumbnailRaw ? resolveUrl(thumbnailRaw, finalUrl) : '';
  const iconRaw = bestIconHref || '/favicon.ico';
  const icon = resolveUrl(iconRaw, finalUrl);
  const publisher = siteName || finalUrl.hostname;
  const finalAuthor = author || articleAuthor;

  return {
    url: finalUrl.toString(),
    title: trimTo(title),
    description: trimTo(description),
    icon: trimTo(icon),
    thumbnail: trimTo(thumbnail),
    author: trimTo(finalAuthor),
    publisher: trimTo(publisher),
  };
}

type FetchOgpError = 'invalid_url' | 'blocked' | 'timeout' | 'fetch_failed' | 'no_metadata';

type FetchOgpResult = { ok: true; meta: OgpMeta } | { ok: false; error: FetchOgpError };

export interface FetchOgpOptions {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  lookup: (hostname: string) => Promise<string>;
  timeoutMs: number;
  maxBytes: number;
  /** Maximum number of redirects to follow (in addition to the initial request). */
  maxRedirects: number;
}

const USER_AGENT = 'Laurel-OGP/1.0 (+laurel)';

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

async function guardHost(
  url: URL,
  lookup: FetchOgpOptions['lookup'],
): Promise<'public' | 'blocked'> {
  if (classifyHost(url.hostname) === 'blocked') return 'blocked';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.includes(':')) {
    // Public literal IP — the blocked case was caught above; skip DNS lookup.
    return 'public';
  }
  try {
    const ip = await lookup(url.hostname);
    return classifyResolvedIp(ip);
  } catch {
    return 'blocked';
  }
}

async function readCappedHtml(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(buf);
}

export async function fetchOgp(raw: string, options: FetchOgpOptions): Promise<FetchOgpResult> {
  const startUrl = parseUrl(raw);
  if (!startUrl) return { ok: false, error: 'invalid_url' };

  let current = startUrl;
  let hops = 0;
  while (hops <= options.maxRedirects) {
    const guard = await guardHost(current, options.lookup);
    if (guard === 'blocked') return { ok: false, error: 'blocked' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await options.fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'timeout' };
      }
      return { ok: false, error: 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, error: 'fetch_failed' };
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, error: 'fetch_failed' };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, error: 'blocked' };
      }
      current = next;
      hops += 1;
      continue;
    }

    if (response.status >= 400) return { ok: false, error: 'fetch_failed' };

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: false, error: 'no_metadata' };
    }

    const html = await readCappedHtml(response, options.maxBytes);
    const meta = pickMetadata(html, current);
    if (!meta.title && !meta.description && !meta.thumbnail) {
      return { ok: false, error: 'no_metadata' };
    }
    return { ok: true, meta };
  }
  return { ok: false, error: 'fetch_failed' };
}
