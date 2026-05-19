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

export async function emitRss(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  limit: number;
}): Promise<void> {
  const { config, content, outputDir, limit } = opts;
  const base = config.site.url.replace(/\/$/, '');
  const items = content.posts
    .slice(0, limit)
    .map((post) => {
      const link = `${base}${new URL(post.url).pathname}`;
      const html = absolutizeHtmlUrls(post.html, base);
      return [
        '<item>',
        `<title>${escapeXml(post.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>`,
        `<description>${escapeXml(post.excerpt)}</description>`,
        `<content:encoded><![CDATA[${html}]]></content:encoded>`,
        '</item>',
      ].join('');
    })
    .join('');
  const selfHref = `${base}/rss.xml`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(config.site.title)}</title>
<link>${escapeXml(base)}</link>
<description>${escapeXml(config.site.description)}</description>
<language>${escapeXml(config.site.locale)}</language>
<atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>`;
  await writeHtml(outputDir, 'rss.xml', xml);
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
