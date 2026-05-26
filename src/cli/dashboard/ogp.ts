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
