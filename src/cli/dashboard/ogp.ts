// Server-side OGP fetcher for the bookmark insert menu.
//
// Split into three concerns:
//   1. `classifyHost` / `classifyResolvedIp` — SSRF guard (pure).
//   2. `pickMetadata` — pure HTML → OgpMeta with the precedence rules
//      Ghost Koenig uses for bookmark cards.
//   3. `fetchOgp` — runtime fetch with manual redirect, body cap,
//      AbortController timeout, DNS check per hop.

import { Parser } from 'htmlparser2';

export interface OgpMeta {
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
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
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
  // Handle the IPv4-mapped form ::ffff:1.2.3.4 by extracting the v4 tail.
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
