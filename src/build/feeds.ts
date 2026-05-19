import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { writeHtml } from './emit.ts';

export async function emitSitemap(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  urls: string[];
}): Promise<void> {
  const base = opts.config.site.url.replace(/\/$/, '');
  const entries = opts.urls
    .map((u) => `<url><loc>${escapeXml(`${base}${u}`)}</loc></url>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  await writeHtml(opts.outputDir, 'sitemap.xml', xml);
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
      return [
        '<item>',
        `<title>${escapeXml(post.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>`,
        `<description>${escapeXml(post.excerpt)}</description>`,
        `<content:encoded><![CDATA[${post.html}]]></content:encoded>`,
        '</item>',
      ].join('');
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${escapeXml(config.site.title)}</title>
<link>${escapeXml(base)}</link>
<description>${escapeXml(config.site.description)}</description>
<language>${escapeXml(config.site.locale)}</language>
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
