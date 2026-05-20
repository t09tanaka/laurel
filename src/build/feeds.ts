import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Post } from '~/content/model.ts';
import { withBasePath } from '~/util/url.ts';
import { writeHtml } from './emit.ts';
import { renderFeedSafeHtml } from './feed-safe-html.ts';
import { assignPostUrls } from './permalinks.ts';
import { type ResolvedCollection, type RoutesYaml, resolveCollections } from './routes-yaml.ts';
import { absoluteContentUrl, absoluteUrl } from './url.ts';

// Sitemap emission has its own module (./sitemap.ts) so the Ghost 5-file
// layout, the 50k-URL split, and the gzip companions can evolve without
// dragging the RSS surface along. Re-exported here for callers that still
// import from `~/build/feeds.ts`.
export {
  SITEMAP_MAX_URLS_PER_FILE,
  type SitemapChangefreq,
  type SitemapEntry,
  type SitemapKind,
  emitSitemap,
} from './sitemap.ts';

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
  routesYaml?: RoutesYaml;
}): Promise<void> {
  const { config, content, outputDir, limit, routesYaml } = opts;
  await emitRssFeed({
    config,
    posts: content.posts,
    outputDir,
    limit,
    pageFilename: rssPageFilename,
    channel: {
      title: config.site.title,
      description: config.site.description,
      // Channel `<link>` is the absolute homepage URL. Strip the configured
      // base_path's trailing slash so the value byte-matches the historical
      // `${site.url}` shape on root deploys (no trailing slash).
      link: trimTrailingSlash(absoluteUrl('/', config)),
    },
  });

  if (routesYaml !== undefined) {
    await emitCollectionRssFeeds({
      config,
      content,
      outputDir,
      limit,
      collections: resolveCollections(routesYaml),
    });
  }

  // Per-tag and per-author feeds are opt-out via [components.rss].per_tag /
  // per_author. The feeds match Ghost's `/tag/<slug>/rss/` and
  // `/author/<slug>/rss/` routes; channel metadata mirrors the site-wide feed,
  // only the item list is filtered. We always emit a single page per feed (no
  // multi-page pagination) because the per-tag / per-author counts are tiny
  // compared to the global feed in practice — anything that overflows the
  // `RSS_MAX_ITEMS_PER_PAGE` ceiling gets silently truncated to the cap,
  // matching what Ghost does on its own per-tag feed.
  if (config.components.rss.per_tag) {
    for (const tag of content.tags) {
      if (tag.visibility !== 'public') continue;
      const tagPosts = content.postsByTag.get(tag.slug) ?? [];
      if (tagPosts.length === 0) continue;
      await emitRssFeed({
        config,
        posts: tagPosts,
        outputDir,
        limit,
        pageFilename: () => `tag/${tag.slug}/rss/index.xml`,
        channel: {
          title: `${tag.name} - ${config.site.title}`,
          description: tag.description || config.site.description,
          link: absoluteContentUrl(tag.url, config),
        },
      });
    }
  }
  if (config.components.rss.per_author) {
    for (const author of content.authors) {
      const authorPosts = content.postsByAuthor.get(author.slug) ?? [];
      if (authorPosts.length === 0) continue;
      await emitRssFeed({
        config,
        posts: authorPosts,
        outputDir,
        limit,
        pageFilename: () => `author/${author.slug}/rss/index.xml`,
        channel: {
          title: `${author.name} - ${config.site.title}`,
          description: author.bio || config.site.description,
          link: absoluteContentUrl(author.url, config),
        },
      });
    }
  }
}

interface RssChannel {
  title: string;
  description: string;
  link: string;
}

// Core RSS renderer shared between the global feed and per-tag / per-author
// feeds. `pageFilename(page)` decides where each page lands on disk so the
// global feed keeps its `rss.xml` + `rss-N.xml` layout while archive feeds
// (always single-page in practice) write to `tag/<slug>/rss/index.xml` etc.
async function emitRssFeed(opts: {
  config: NectarConfig;
  posts: Post[];
  outputDir: string;
  limit: number;
  pageFilename: (page: number) => string;
  pageHref?: (page: number) => string;
  channel: RssChannel;
}): Promise<void> {
  const { config, posts, outputDir, limit, pageFilename, pageHref, channel } = opts;
  // `base` is the configured public site URL with a stable slashless shape.
  // Route URLs go through `absoluteUrl`; feed body assets still use the lighter
  // root-relative attribute rewrite because they are not route permalinks.
  const base = config.site.url.replace(/\/$/, '');
  const basePath = config.build.base_path || '/';
  const perPage = Math.max(1, Math.min(limit, RSS_MAX_ITEMS_PER_PAGE));
  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
  // Ghost's default-on behavior would inline post.html into every <item>,
  // which makes 10k-item feeds reach hundreds of MB. Default `false` keeps
  // the feed lean: only the excerpt ships, and aggregators that need the
  // body re-fetch the post URL (which Ghost-compat readers do already).
  // Opt back into `true` when the audience is hard-aggregated (Newsletter
  // generators, archive crawlers) and bandwidth is not a concern. See #517.
  const fullContent = config.components.rss.full_content;

  const lastBuildDate = computeLastBuildDate(posts);
  const imageBlock = renderChannelImage(config, base, basePath);

  // Compose the host-relative feed URL once per page. atom:link href entries
  // must be fully-qualified (RSS readers need an absolute origin), and they
  // live under `base_path` on subpath deploys (e.g. `/blog/rss.xml`).
  const filenameHref = (page: number) =>
    pageHref !== undefined ? pageHref(page) : absoluteUrl(pageFilename(page), config);
  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * perPage;
    const pagePosts = posts.slice(start, start + perPage);
    const items = pagePosts
      .map((post) => renderItem(post, config, base, fullContent, basePath))
      .join('');
    const filename = pageFilename(page);
    const selfHref = filenameHref(page);
    const atomLinks: string[] = [
      `<atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml"/>`,
    ];
    if (page > 1) {
      const prevHref = filenameHref(page - 1);
      atomLinks.push(
        `<atom:link href="${escapeXml(prevHref)}" rel="prev" type="application/rss+xml"/>`,
      );
    }
    if (page < totalPages) {
      const nextHref = filenameHref(page + 1);
      atomLinks.push(
        `<atom:link href="${escapeXml(nextHref)}" rel="next" type="application/rss+xml"/>`,
      );
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>${escapeXml(channel.title)}</title>
<link>${escapeXml(channel.link)}</link>
<description>${escapeXml(channel.description)}</description>
<language>${escapeXml(config.site.locale)}</language>
<lastBuildDate>${lastBuildDate}</lastBuildDate>
<generator>Nectar</generator>
${atomLinks.join('\n')}${imageBlock}
${items}
</channel>
</rss>`;
    await writeHtml(outputDir, filename, xml);
  }
}

async function emitCollectionRssFeeds(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  limit: number;
  collections: readonly ResolvedCollection[];
}): Promise<void> {
  const { config, content, outputDir, limit, collections } = opts;
  if (collections.length === 0) return;
  const assignments = assignPostUrls(content.posts, collections);

  for (const collection of collections) {
    if (collection.rss === false) continue;
    const collectionPosts = content.posts.filter(
      (post) => assignments.get(post.id)?.collection === collection,
    );
    if (collectionPosts.length === 0) continue;
    await emitRssFeed({
      config,
      posts: collectionPosts,
      outputDir,
      limit,
      pageFilename: (page) => collectionRssPageFilename(collection.url, page),
      pageHref: (page) => collectionRssPageHref(collection.url, page, config),
      channel: {
        title: collectionRssTitle(collection, config),
        description: config.site.description,
        link: absoluteContentUrl(collection.url, config),
      },
    });
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

function renderChannelImage(config: NectarConfig, base: string, basePath: string): string {
  if (!config.site.logo) return '';
  const logoUrl = toAbsoluteUrl(base, basePath, config.site.logo);
  // The channel image's `<link>` points at the deployed homepage, not the
  // raw host root, so subpath deploys send users to `https://host/blog/`
  // instead of `https://host/`.
  const homeLink = trimTrailingSlash(absoluteUrl('/', config));
  return [
    '\n<image>',
    `<url>${escapeXml(logoUrl)}</url>`,
    `<title>${escapeXml(config.site.title)}</title>`,
    `<link>${escapeXml(homeLink || base)}</link>`,
    '</image>',
  ].join('');
}

// Compose an external URL from a (host, base_path, value) triple. `value`
// is either an absolute http(s) URL (returned unchanged) or a root-relative
// path (e.g. `/content/images/foo.jpg`). When `base_path` is non-trivial
// (`/blog/`), the path is rebased so the asset lives under the deployed
// subpath rather than the raw host root.
function toAbsoluteUrl(base: string, basePath: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${base}${withBasePath(basePath, value)}`;
}

// Strip the trailing slash for joins like `${origin}${base_path}` so the
// composed string keeps the historical "no trailing slash on the home URL"
// shape callers depend on (e.g. RSS channel link, robots.txt). `/` collapses
// to the empty string so root deploys keep producing `https://host` exactly.
function trimTrailingSlash(value: string): string {
  if (!value || value === '/') return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

// Page 1 keeps the canonical `rss.xml` filename so existing feed-reader
// subscriptions and `<link rel="alternate">` autodiscovery URLs stay valid.
// Subsequent pages use `rss-N.xml` (N >= 2).
function rssPageFilename(page: number): string {
  return page === 1 ? 'rss.xml' : `rss-${page}.xml`;
}

function collectionRssPageFilename(collectionUrl: string, page: number): string {
  const base = collectionRssRoute(collectionUrl, page).replace(/^\/+/, '').replace(/\/+$/, '');
  return base ? `${base}/index.xml` : 'rss/index.xml';
}

function collectionRssPageHref(collectionUrl: string, page: number, config: NectarConfig): string {
  return absoluteUrl(collectionRssRoute(collectionUrl, page), config);
}

function collectionRssRoute(collectionUrl: string, page: number): string {
  const clean = collectionUrl.replace(/\/+$/, '');
  const prefix = clean === '' ? '' : clean.startsWith('/') ? clean : `/${clean}`;
  const base = `${prefix}/rss/`;
  return page === 1 ? base : `${base}${page}/`;
}

function collectionRssTitle(collection: ResolvedCollection, config: NectarConfig): string {
  const label = collection.url
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (!label) return config.site.title;
  const title = label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return title ? `${title} - ${config.site.title}` : config.site.title;
}

function renderItem(
  post: ContentGraph['posts'][number],
  config: NectarConfig,
  base: string,
  fullContent: boolean,
  basePath = '/',
): string {
  // `post.url` is path-only when it comes from the loader, but older tests and
  // ad-hoc callers may still pass absolute values. Resolve both shapes once,
  // matching the route emitter's trailing-slash canonicalisation.
  const link = absoluteContentUrl(post.url, config);
  // Absolutise only when we plan to ship the HTML body. Skipping the regex
  // walk when `fullContent=false` is the whole point of #517: at 10k items
  // the rewrite-then-discard cost was the second-largest slice of feed time.
  // Pass `basePath` through so root-relative srcs in the body land under
  // `https://host/blog/...` rather than the raw host root.
  const html = fullContent
    ? absolutizeHtmlUrls(renderFeedSafeHtml(post.feed_html), base, basePath)
    : '';
  const guid = post.uuid ?? link;
  const guidIsPermaLink = post.uuid ? 'false' : 'true';
  const parts: string[] = [
    '<item>',
    `<title><![CDATA[${escapeCdata(post.title)}]]></title>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="${guidIsPermaLink}">${escapeXml(guid)}</guid>`,
    `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>`,
  ];
  // dc:creator per author (Ghost emits one per author, primary first). Authors
  // already come in primary-first order from the content graph.
  for (const author of post.authors) {
    parts.push(`<dc:creator><![CDATA[${escapeCdata(author.name)}]]></dc:creator>`);
  }
  // category per tag — feed readers (Feedly, NetNewsWire) surface these as
  // labels. Skip internal tags (Ghost convention: '#'-prefixed slug).
  for (const tag of post.tags) {
    if (tag.visibility !== 'public') continue;
    parts.push(`<category><![CDATA[${escapeCdata(tag.name)}]]></category>`);
  }
  // media:content advertises the feature image to readers that render
  // thumbnails (Feedly, Inoreader). Ghost always emits this when present.
  if (post.feature_image) {
    const mediaUrl = toAbsoluteUrl(base, basePath, post.feature_image);
    parts.push(`<media:content url="${escapeXml(mediaUrl)}" medium="image"/>`);
  }
  // CDATA is required for both description (when title/excerpt contains
  // HTML/special chars) and content:encoded (full HTML body). Entity-escaping
  // makes Feedly / NetNewsWire show literal <p> tags as text. See issue #427.
  parts.push(`<description><![CDATA[${escapeCdata(post.feed_excerpt)}]]></description>`);
  // `<content:encoded>` is opt-in via [components.rss].full_content. Default
  // off keeps feeds an order of magnitude smaller; subscribers who want the
  // body see the post link and re-fetch the canonical URL. See backlog #517.
  if (fullContent) {
    parts.push(`<content:encoded><![CDATA[${escapeCdata(html)}]]></content:encoded>`);
  }
  parts.push('</item>');
  return parts.join('');
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
// `basePath` defaults to `'/'` so existing callers (non-build callers, tests)
// keep their root-deploy behaviour while build-time callers thread the
// configured `[build].base_path` through.
export function absolutizeHtmlUrls(html: string, base: string, basePath = '/'): string {
  if (!html || !base) return html;
  const origin = base.replace(/\/$/, '');
  const withAttrs = html.replace(URL_ATTR_RE, (match, attr, quote, value) => {
    const abs = toAbsolute(value, origin, basePath);
    return abs === value ? match : `${attr}=${quote}${abs}${quote}`;
  });
  return withAttrs.replace(SRCSET_ATTR_RE, (match, quote, value) => {
    const rewritten = rewriteSrcset(value, origin, basePath);
    return rewritten === value ? match : `srcset=${quote}${rewritten}${quote}`;
  });
}

function toAbsolute(value: string, base: string, basePath: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return value;
  if (trimmed.startsWith('//')) return value;
  if (trimmed.startsWith('#')) return value;
  if (!trimmed.startsWith('/')) return value;
  return `${base}${withBasePath(basePath, trimmed)}`;
}

function rewriteSrcset(value: string, base: string, basePath: string): string {
  return value
    .split(',')
    .map((part) => {
      const segment = part.trim();
      if (!segment) return part;
      const [url, ...descriptors] = segment.split(/\s+/);
      if (!url) return part;
      const abs = toAbsolute(url, base, basePath);
      const leading = part.match(/^\s*/)?.[0] ?? '';
      const trailing = part.match(/\s*$/)?.[0] ?? '';
      const rest = descriptors.length > 0 ? ` ${descriptors.join(' ')}` : '';
      return `${leading}${abs}${rest}${trailing}`;
    })
    .join(',');
}
