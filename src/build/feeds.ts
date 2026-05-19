import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { writeHtml } from './emit.ts';

export interface SitemapEntry {
  url: string;
  lastmod?: string | undefined;
}

export async function emitSitemap(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  urls: SitemapEntry[];
}): Promise<void> {
  const base = opts.config.site.url.replace(/\/$/, '');
  const entries = opts.urls
    .map((entry) => {
      const loc = `<loc>${escapeXml(`${base}${entry.url}`)}</loc>`;
      const lastmod = entry.lastmod
        ? `<lastmod>${escapeXml(formatLastmod(entry.lastmod))}</lastmod>`
        : '';
      return `<url>${loc}${lastmod}</url>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  await writeHtml(opts.outputDir, 'sitemap.xml', xml);
}

// Sitemap protocol accepts W3C datetime; pass ISO timestamps through and fall back
// to the raw string so callers can pre-format if they prefer date-only.
function formatLastmod(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

// Hard upper bound on items emitted in a single RSS page. Users who set
// components.rss.items above this number get clamped silently — feed readers
// choke on multi-megabyte XML payloads, and Ghost itself paginates at 15-25
// per page. 250 is generous enough to cover non-paginated callers while still
// keeping each file bounded.
export const RSS_MAX_ITEMS_PER_PAGE = 250;

export async function emitRss(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  limit: number;
}): Promise<void> {
  const { config, content, outputDir, limit } = opts;
  const base = config.site.url.replace(/\/$/, '');
  const perPage = Math.max(1, Math.min(limit, RSS_MAX_ITEMS_PER_PAGE));
  const totalPages = Math.max(1, Math.ceil(content.posts.length / perPage));

  const lastBuildDate = computeLastBuildDate(content.posts);
  const imageBlock = renderChannelImage(config, base);

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * perPage;
    const pagePosts = content.posts.slice(start, start + perPage);
    const items = pagePosts.map((post) => renderItem(post, base)).join('');
    const filename = rssPageFilename(page);
    const selfHref = `${base}/${filename}`;
    const atomLinks: string[] = [
      `<atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml"/>`,
    ];
    if (page > 1) {
      const prevHref = `${base}/${rssPageFilename(page - 1)}`;
      atomLinks.push(
        `<atom:link href="${escapeXml(prevHref)}" rel="prev" type="application/rss+xml"/>`,
      );
    }
    if (page < totalPages) {
      const nextHref = `${base}/${rssPageFilename(page + 1)}`;
      atomLinks.push(
        `<atom:link href="${escapeXml(nextHref)}" rel="next" type="application/rss+xml"/>`,
      );
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(config.site.title)}</title>
<link>${escapeXml(base)}</link>
<description>${escapeXml(config.site.description)}</description>
<language>${escapeXml(config.site.locale)}</language>
<lastBuildDate>${lastBuildDate}</lastBuildDate>
${atomLinks.join('\n')}${imageBlock}
${items}
</channel>
</rss>`;
    await writeHtml(outputDir, filename, xml);
  }
}

// Use the most recent post timestamp so lastBuildDate is deterministic across
// rebuilds when content hasn't changed; feed readers rely on it for polling
// decisions. Fall back to wall-clock only when the feed has no posts at all.
function computeLastBuildDate(posts: ContentGraph['posts']): string {
  let latest = 0;
  for (const post of posts) {
    for (const candidate of [post.updated_at, post.published_at]) {
      const ts = Date.parse(candidate);
      if (!Number.isNaN(ts) && ts > latest) {
        latest = ts;
        break;
      }
    }
  }
  return new Date(latest > 0 ? latest : Date.now()).toUTCString();
}

function renderChannelImage(config: NectarConfig, base: string): string {
  if (!config.site.logo) return '';
  const logoUrl = toAbsoluteUrl(base, config.site.logo);
  return [
    '\n<image>',
    `<url>${escapeXml(logoUrl)}</url>`,
    `<title>${escapeXml(config.site.title)}</title>`,
    `<link>${escapeXml(base)}</link>`,
    '</image>',
  ].join('');
}

function toAbsoluteUrl(base: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${base}${value.startsWith('/') ? value : `/${value}`}`;
}

// Page 1 keeps the canonical `rss.xml` filename so existing feed-reader
// subscriptions and `<link rel="alternate">` autodiscovery URLs stay valid.
// Subsequent pages use `rss-N.xml` (N >= 2).
function rssPageFilename(page: number): string {
  return page === 1 ? 'rss.xml' : `rss-${page}.xml`;
}

function renderItem(post: ContentGraph['posts'][number], base: string): string {
  const link = `${base}${new URL(post.url).pathname}`;
  const html = absolutizeHtmlUrls(post.feed_html, base);
  return [
    '<item>',
    `<title>${escapeXml(post.title)}</title>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="false">${escapeXml(post.id)}</guid>`,
    `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>`,
    `<description>${escapeXml(post.feed_excerpt)}</description>`,
    `<content:encoded><![CDATA[${escapeCdata(html)}]]></content:encoded>`,
    '</item>',
  ].join('');
}

// A literal `]]>` inside post.html (e.g. a code sample about XML CDATA) would
// terminate the surrounding CDATA section prematurely and corrupt the feed.
// Per the XML spec, split each occurrence so the first `]]` closes the current
// section and a fresh `<![CDATA[>` opens a new one around the trailing `>`.
function escapeCdata(value: string): string {
  return value.replace(/]]>/g, ']]]]><![CDATA[>');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const URL_ATTR_RE = /\b(href|src|poster)\s*=\s*(["'])([^"']*)\2/gi;
const SRCSET_ATTR_RE = /\bsrcset\s*=\s*(["'])([^"']*)\1/gi;

// RSS readers fetch the feed from rss.xml's URL, but post content is hosted at the
// post's canonical URL. Relative URLs in post.html misresolve against the feed
// origin, so rewrite root-relative URLs to absolute form against site.url.
export function absolutizeHtmlUrls(html: string, base: string): string {
  if (!html || !base) return html;
  const origin = base.replace(/\/$/, '');
  const withAttrs = html.replace(URL_ATTR_RE, (match, attr, quote, value) => {
    const abs = toAbsolute(value, origin);
    return abs === value ? match : `${attr}=${quote}${abs}${quote}`;
  });
  return withAttrs.replace(SRCSET_ATTR_RE, (match, quote, value) => {
    const rewritten = rewriteSrcset(value, origin);
    return rewritten === value ? match : `srcset=${quote}${rewritten}${quote}`;
  });
}

function toAbsolute(value: string, base: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return value;
  if (trimmed.startsWith('//')) return value;
  if (trimmed.startsWith('#')) return value;
  if (!trimmed.startsWith('/')) return value;
  return `${base}${trimmed}`;
}

function rewriteSrcset(value: string, base: string): string {
  return value
    .split(',')
    .map((part) => {
      const segment = part.trim();
      if (!segment) return part;
      const [url, ...descriptors] = segment.split(/\s+/);
      if (!url) return part;
      const abs = toAbsolute(url, base);
      const leading = part.match(/^\s*/)?.[0] ?? '';
      const trailing = part.match(/\s*$/)?.[0] ?? '';
      const rest = descriptors.length > 0 ? ` ${descriptors.join(' ')}` : '';
      return `${leading}${abs}${rest}${trailing}`;
    })
    .join(',');
}
