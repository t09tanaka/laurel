import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { renderFeedSafeHtml } from '~/build/feed-safe-html.ts';
import {
  RSS_MAX_ITEMS_PER_PAGE,
  SITEMAP_MAX_URLS_PER_FILE,
  type SitemapEntry,
  absolutizeHtmlUrls,
  emitRss,
  emitSitemap,
} from '~/build/feeds.ts';
import { configSchema } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

describe('absolutizeHtmlUrls', () => {
  const base = 'https://example.com';

  test('rewrites root-relative href to absolute URL', () => {
    expect(absolutizeHtmlUrls('<a href="/about">about</a>', base)).toBe(
      '<a href="https://example.com/about">about</a>',
    );
  });

  test('rewrites root-relative src to absolute URL', () => {
    expect(absolutizeHtmlUrls('<img src="/content/images/foo.png">', base)).toBe(
      '<img src="https://example.com/content/images/foo.png">',
    );
  });

  test('handles single-quoted attribute values', () => {
    expect(absolutizeHtmlUrls("<a href='/x'>x</a>", base)).toBe(
      "<a href='https://example.com/x'>x</a>",
    );
  });

  test('rewrites video poster attribute', () => {
    expect(absolutizeHtmlUrls('<video poster="/media/p.jpg"></video>', base)).toBe(
      '<video poster="https://example.com/media/p.jpg"></video>',
    );
  });

  test('leaves absolute http(s) URLs untouched', () => {
    const html =
      '<a href="https://other.example/post">link</a><img src="http://cdn.example/x.png">';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves protocol-relative URLs untouched', () => {
    const html = '<img src="//cdn.example/x.png">';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves mailto: and tel: URLs untouched', () => {
    const html = '<a href="mailto:a@b.com">m</a><a href="tel:+1234">t</a>';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves anchor-only hrefs untouched', () => {
    const html = '<a href="#section">jump</a>';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves relative (non-root) URLs untouched', () => {
    const html = '<a href="next-post/">next</a>';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('rewrites srcset entries that are root-relative', () => {
    const html = '<img srcset="/a.png 1x, /b.png 2x">';
    expect(absolutizeHtmlUrls(html, base)).toBe(
      '<img srcset="https://example.com/a.png 1x, https://example.com/b.png 2x">',
    );
  });

  test('mixed srcset rewrites only relative entries', () => {
    const html = '<img srcset="https://cdn.example/x.png 1x, /y.png 2x">';
    expect(absolutizeHtmlUrls(html, base)).toBe(
      '<img srcset="https://cdn.example/x.png 1x, https://example.com/y.png 2x">',
    );
  });

  test('strips trailing slash on base before joining', () => {
    expect(absolutizeHtmlUrls('<a href="/x">x</a>', 'https://example.com/')).toBe(
      '<a href="https://example.com/x">x</a>',
    );
  });

  test('returns original html when base is empty', () => {
    const html = '<a href="/x">x</a>';
    expect(absolutizeHtmlUrls(html, '')).toBe(html);
  });

  test('returns original html when html is empty', () => {
    expect(absolutizeHtmlUrls('', base)).toBe('');
  });

  test('rewrites multiple attributes within the same tag', () => {
    expect(absolutizeHtmlUrls('<a href="/p"><img src="/i.png"></a>', base)).toBe(
      '<a href="https://example.com/p"><img src="https://example.com/i.png"></a>',
    );
  });
});

describe('renderFeedSafeHtml', () => {
  test('converts Koenig bookmark cards to a link and description', () => {
    const html = renderFeedSafeHtml(`
      <figure class="kg-card kg-bookmark-card">
        <a class="kg-bookmark-container" href="https://example.com/post">
          <div class="kg-bookmark-content">
            <div class="kg-bookmark-title">Bookmark Title</div>
            <div class="kg-bookmark-description">A linked summary.</div>
          </div>
        </a>
      </figure>
    `);

    expect(html).toBe(
      '<p><a href="https://example.com/post">Bookmark Title</a></p><p>A linked summary.</p>',
    );
    expect(html).not.toContain('kg-bookmark-card');
  });

  test('converts Koenig embed iframes to links and strips unsafe runtime tags', () => {
    const html = renderFeedSafeHtml(`
      <figure class="kg-card kg-embed-card">
        <iframe src="https://www.youtube-nocookie.com/embed/abc" title="Video title"></iframe>
        <script src="https://cdn.example/widget.js"></script>
      </figure>
    `);

    expect(html).toBe(
      '<p><a href="https://www.youtube-nocookie.com/embed/abc">Video title</a></p>',
    );
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
  });

  test('converts Koenig gallery cards to image lists', () => {
    const html = renderFeedSafeHtml(`
      <figure class="kg-card kg-gallery-card">
        <div class="kg-gallery-image"><img src="/content/images/one.jpg" alt="One" width="600"></div>
        <div class="kg-gallery-image"><img src="/content/images/two.jpg" alt="Two" height="400"></div>
        <figcaption>Gallery caption</figcaption>
      </figure>
    `);

    expect(html).toBe(
      '<ul><li><img src="/content/images/one.jpg" alt="One" width="600"></li><li><img src="/content/images/two.jpg" alt="Two" height="400"></li></ul><p>Gallery caption</p>',
    );
  });

  test('converts Koenig audio and video cards to download links', () => {
    const html = renderFeedSafeHtml(`
      <div class="kg-card kg-audio-card">
        <audio src="/content/audio/episode.mp3" controls></audio>
        <div class="kg-audio-title">Episode 1</div>
      </div>
      <figure class="kg-card kg-video-card">
        <div class="kg-video-container"><video src="/content/video/clip.mp4" controls></video></div>
        <figcaption>Launch clip</figcaption>
      </figure>
    `);

    expect(html.replace(/>\s+</g, '><')).toBe(
      '<p><a href="/content/audio/episode.mp3">Download audio: Episode 1</a></p><p><a href="/content/video/clip.mp4">Download video: Launch clip</a></p>',
    );
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('<video');
  });
});

describe('emitRss', () => {
  test('streams RSS pages instead of joining every item into one XML string', () => {
    const source = readFileSync(resolve(import.meta.dir, '../../src/build/feeds.ts'), 'utf8');
    const writeRssPageStart = source.indexOf('async function writeRssPage');
    const writeRssPageEnd = source.indexOf('function rssHashConfig');
    const writeRssPageSource = source.slice(writeRssPageStart, writeRssPageEnd);

    expect(source).toContain('writeTextStream(outputDir, filename');
    expect(writeRssPageStart).toBeGreaterThanOrEqual(0);
    expect(writeRssPageEnd).toBeGreaterThan(writeRssPageStart);
    expect(writeRssPageSource).toContain('for (const post of opts.pagePosts)');
    expect(writeRssPageSource).toContain('await writer.write(renderItem(');
    expect(writeRssPageSource).not.toContain('.map(');
    expect(writeRssPageSource).not.toContain('opts.pagePosts.join');
    expect(writeRssPageSource).not.toContain('renderItem(post)).join');
    expect(writeRssPageSource).not.toContain('writeHtml(');
    expect(writeRssPageSource).not.toContain('writeFile(');
  });

  test('declares atom namespace and emits atom:link rel="self"', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(xml).toContain(
      '<atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/>',
    );
  });

  test('skips rewriting unchanged RSS files when the feed hash matches', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-cache-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.sources = {
      posts: new Map([
        [content.posts[0]?.id ?? 'post-1', { path: 'hello.md', mtimeMs: 1, size: 10 }],
      ]),
      pages: new Map(),
      tags: new Map(),
      authors: new Map(),
    };
    const firstFeeds = {};

    await emitRss({ config, content, outputDir, limit: 10, nextFeeds: firstFeeds });
    const before = (await stat(join(outputDir, 'rss.xml'))).mtimeMs;
    await Bun.sleep(20);
    const secondFeeds = {};
    await emitRss({
      config,
      content,
      outputDir,
      limit: 10,
      previousFeeds: firstFeeds,
      nextFeeds: secondFeeds,
    });
    const after = (await stat(join(outputDir, 'rss.xml'))).mtimeMs;

    expect(after).toBe(before);
    expect(secondFeeds).toEqual(firstFeeds);
  });

  test('uses post.feed_html instead of post.html so paywalled bodies do not leak', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { full_content: true } },
    });
    const content = makeGraph();
    const post = content.posts[0];
    if (!post) throw new Error('expected fixture post');
    post.visibility = 'paid';
    post.html = '<p>Public intro.</p><p>Secret members-only paragraph that must not leak.</p>';
    post.feed_html =
      '<p>Public intro.</p><div class="gh-paywall-stub">Subscribe to read more.</div>';
    post.excerpt = 'Public intro. Secret members-only paragraph that must not leak.';
    post.feed_excerpt = 'Public intro.';

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).not.toContain('Secret members-only paragraph');
    expect(xml).toContain('Public intro.');
    expect(xml).toContain('gh-paywall-stub');
    expect(xml).toContain('<description><![CDATA[Public intro.]]></description>');
  });

  test('atom:link self honors trailing slash on site.url', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com/' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain(
      '<atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/>',
    );
  });

  test('canonicalizes RSS route URLs with trailing_slash = never', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-canonical-never-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { trailing_slash: 'never' },
    });
    const content = makeGraph();
    const tag = makeTag({ url: '/tag/news/' });
    content.tags = [tag];
    content.posts = [makePost({ url: '/hello-world/', tags: [tag], primary_tag: tag })];
    content.postsByTag = new Map([[tag.slug, content.posts]]);

    await emitRss({ config, content, outputDir, limit: 10 });

    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');
    expect(xml).toContain('<link>https://example.com/hello-world</link>');
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/hello-world</guid>');
    expect(xml).not.toContain('https://example.com/hello-world/');

    const tagXml = readFileSync(join(outputDir, 'tag/news/rss/index.xml'), 'utf8');
    expect(tagXml).toContain('<link>https://example.com/tag/news</link>');
  });

  test('single-page feeds emit only rss.xml without prev/next atom links', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 20 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).not.toContain('rel="next"');
    expect(xml).not.toContain('rel="prev"');
    expect(existsSync(join(outputDir, 'rss-2.xml'))).toBe(false);
  });

  test('paginates overflow posts into rss-N.xml with atom prev/next links', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = Array.from({ length: 5 }, (_, i) =>
      makePost({
        id: `post-${i + 1}`,
        slug: `post-${i + 1}`,
        title: `Post ${i + 1}`,
        url: `https://example.com/post-${i + 1}/`,
      }),
    );

    await emitRss({ config, content, outputDir, limit: 2 });

    const page1 = readFileSync(join(outputDir, 'rss.xml'), 'utf8');
    const page2 = readFileSync(join(outputDir, 'rss-2.xml'), 'utf8');
    const page3 = readFileSync(join(outputDir, 'rss-3.xml'), 'utf8');

    expect(page1).toContain(
      '<atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(page1).toContain(
      '<atom:link href="https://example.com/rss-2.xml" rel="next" type="application/rss+xml"/>',
    );
    expect(page1).not.toContain('rel="prev"');
    expect(page1).toContain('<title><![CDATA[Post 1]]></title>');
    expect(page1).toContain('<title><![CDATA[Post 2]]></title>');
    expect(page1).not.toContain('<title><![CDATA[Post 3]]></title>');

    expect(page2).toContain(
      '<atom:link href="https://example.com/rss.xml" rel="prev" type="application/rss+xml"/>',
    );
    expect(page2).toContain(
      '<atom:link href="https://example.com/rss-3.xml" rel="next" type="application/rss+xml"/>',
    );
    expect(page2).toContain('<title><![CDATA[Post 3]]></title>');
    expect(page2).toContain('<title><![CDATA[Post 4]]></title>');

    expect(page3).toContain(
      '<atom:link href="https://example.com/rss-2.xml" rel="prev" type="application/rss+xml"/>',
    );
    expect(page3).not.toContain('rel="next"');
    expect(page3).toContain('<title><![CDATA[Post 5]]></title>');

    expect(existsSync(join(outputDir, 'rss-4.xml'))).toBe(false);
  });

  test('hard-clamps items per page to RSS_MAX_ITEMS_PER_PAGE', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = Array.from({ length: RSS_MAX_ITEMS_PER_PAGE + 5 }, (_, i) =>
      makePost({
        id: `post-${i + 1}`,
        slug: `post-${i + 1}`,
        title: `Post ${i + 1}`,
        url: `https://example.com/post-${i + 1}/`,
      }),
    );

    await emitRss({ config, content, outputDir, limit: 10_000 });

    const page1 = readFileSync(join(outputDir, 'rss.xml'), 'utf8');
    const page2 = readFileSync(join(outputDir, 'rss-2.xml'), 'utf8');

    expect(page1).toContain(`<title><![CDATA[Post ${RSS_MAX_ITEMS_PER_PAGE}]]></title>`);
    expect(page1).not.toContain(`<title><![CDATA[Post ${RSS_MAX_ITEMS_PER_PAGE + 1}]]></title>`);
    expect(page1).toContain('rel="next"');
    expect(page2).toContain(`<title><![CDATA[Post ${RSS_MAX_ITEMS_PER_PAGE + 5}]]></title>`);
    expect(existsSync(join(outputDir, 'rss-3.xml'))).toBe(false);
  });

  test('non-positive limit falls back to a single item per page', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 0 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<title><![CDATA[Hello, world]]></title>');
  });

  test('splits literal "]]>" inside post html so CDATA does not terminate early', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { full_content: true } },
    });
    const content = makeGraph();
    const post = content.posts[0];
    if (!post) throw new Error('expected fixture post');
    post.feed_html = '<p>before ]]> after</p>';

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    const open = xml.indexOf('<content:encoded>');
    const close = xml.indexOf('</content:encoded>');
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    const section = xml.slice(open + '<content:encoded>'.length, close);
    expect(section).toBe('<![CDATA[<p>before ]]]]><![CDATA[> after</p>]]>');
    expect(xml.indexOf(']]></content:encoded>')).toBe(close - ']]>'.length);
  });

  test('empty content emits a single rss.xml with no items', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [];

    await emitRss({ config, content, outputDir, limit: 20 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).not.toContain('<item>');
    expect(xml).not.toContain('rel="next"');
    expect(existsSync(join(outputDir, 'rss-2.xml'))).toBe(false);
  });

  test('emits <lastBuildDate> derived from the most recent post timestamp', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [
      makePost({
        id: 'older',
        slug: 'older',
        title: 'Older',
        url: 'https://example.com/older/',
        published_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
      makePost({
        id: 'newer',
        slug: 'newer',
        title: 'Newer',
        url: 'https://example.com/newer/',
        published_at: '2026-03-15T12:00:00.000Z',
        updated_at: '2026-04-20T09:30:00.000Z',
      }),
    ];

    await emitRss({ config, content, outputDir, limit: 20 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    const expected = new Date('2026-04-20T09:30:00.000Z').toUTCString();
    expect(xml).toContain(`<lastBuildDate>${expected}</lastBuildDate>`);
  });

  test('emits <image> when site.logo is configured', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({
      site: {
        title: 'My Site',
        url: 'https://example.com',
        logo: '/assets/logo.svg',
      },
    });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 20 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<image>');
    expect(xml).toContain('<url>https://example.com/assets/logo.svg</url>');
    expect(xml.match(/<image>[\s\S]*?<title>My Site<\/title>[\s\S]*?<\/image>/)).not.toBeNull();
    expect(
      xml.match(/<image>[\s\S]*?<link>https:\/\/example\.com<\/link>[\s\S]*?<\/image>/),
    ).not.toBeNull();
  });

  test('preserves absolute logo URLs without rewriting against site.url', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({
      site: {
        title: 'T',
        url: 'https://example.com',
        logo: 'https://cdn.example.org/logo.png',
      },
    });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 20 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<url>https://cdn.example.org/logo.png</url>');
  });

  test('uses the post UUID as the RSS guid when available', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    const uuid = '11111111-2222-5333-8444-555555555555';
    content.posts = [
      makePost({
        id: 'post-hello-world',
        uuid,
        slug: 'hello-world',
        url: 'https://example.com/hello-world/',
      }),
    ];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain(`<guid isPermaLink="false">${uuid}</guid>`);
    expect(xml).toContain('<link>https://example.com/hello-world/</link>');
  });

  test('declares dc and media namespaces and emits channel metadata', async () => {
    // Issue #428: Ghost-conformant channel declares dc / atom / media / content
    // namespaces and a <generator> element.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(xml).toContain('<generator>Nectar</generator>');
    expect(xml).toContain('<docs>https://www.rssboard.org/rss-specification</docs>');
    expect(xml).toContain('<ttl>60</ttl>');
  });

  test('emits configured RSS ttl in channel metadata', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-ttl-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { ttl: 15 } },
    });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<ttl>15</ttl>');
  });

  test('wraps content:encoded HTML in CDATA, not entity-escaped', async () => {
    // Issue #427: entity-escaping makes Feedly show literal <p> tags as text.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { full_content: true } },
    });
    const content = makeGraph();
    const post = content.posts[0];
    if (!post) throw new Error('expected fixture post');
    post.feed_html = '<p>Hello <strong>world</strong> & friends</p>';

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain(
      '<content:encoded><![CDATA[<p>Hello <strong>world</strong> & friends</p>]]></content:encoded>',
    );
    // No entity-escaped HTML tags should leak outside CDATA for content:encoded.
    expect(xml).not.toContain('&lt;p&gt;Hello');
  });

  test('wraps title and description in CDATA even with special characters', async () => {
    // Issue #427: titles with `&`/`<` should not be entity-escaped — Ghost
    // wraps them in CDATA so readers render them verbatim.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [
      makePost({
        title: 'Tips & Tricks: <Code Edition>',
        feed_excerpt: 'A & B & C',
      }),
    ];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<title><![CDATA[Tips & Tricks: <Code Edition>]]></title>');
    expect(xml).toContain('<description><![CDATA[A & B & C]]></description>');
  });

  test('emits <category> per public tag, skipping internal tags', async () => {
    // Issue #428: Ghost emits <category> per tag, with internal tags
    // ('hash'-prefixed slug, visibility=internal) skipped.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    const newsTag = makeTag({ id: 't-news', slug: 'news', name: 'News' });
    const releaseTag = makeTag({ id: 't-release', slug: 'release', name: 'Release Notes' });
    const internalTag = makeTag({
      id: 't-internal',
      slug: 'hash-internal',
      name: 'Internal',
      visibility: 'internal',
    });
    content.posts = [
      makePost({
        tags: [newsTag, releaseTag, internalTag],
        primary_tag: newsTag,
      }),
    ];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<category><![CDATA[News]]></category>');
    expect(xml).toContain('<category><![CDATA[Release Notes]]></category>');
    expect(xml).not.toContain('<category><![CDATA[Internal]]></category>');
  });

  test('emits <dc:creator> per author', async () => {
    // Issue #428: Ghost emits <dc:creator> for each author. Authors come in
    // primary-first order from the content graph.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    const casper = makeAuthor({ id: 'a-1', slug: 'casper', name: 'Casper' });
    const ghosty = makeAuthor({ id: 'a-2', slug: 'ghosty', name: 'Ghosty McGhostface' });
    content.posts = [
      makePost({
        authors: [casper, ghosty],
        primary_author: casper,
      }),
    ];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<dc:creator><![CDATA[Casper]]></dc:creator>');
    expect(xml).toContain('<dc:creator><![CDATA[Ghosty McGhostface]]></dc:creator>');
    // Primary author should come first.
    const casperIdx = xml.indexOf('<dc:creator><![CDATA[Casper]]></dc:creator>');
    const ghostyIdx = xml.indexOf('<dc:creator><![CDATA[Ghosty McGhostface]]></dc:creator>');
    expect(casperIdx).toBeLessThan(ghostyIdx);
  });

  test('emits <media:content> when post.feature_image is set', async () => {
    // Issue #428: Feedly/Inoreader surface media:content as the item thumbnail.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [makePost({ feature_image: '/content/images/cover.jpg' })];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain(
      '<media:content url="https://example.com/content/images/cover.jpg" medium="image"/>',
    );
  });

  test('preserves absolute feature_image URLs without rewriting against site.url', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [makePost({ feature_image: 'https://cdn.example.org/c.jpg' })];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<media:content url="https://cdn.example.org/c.jpg" medium="image"/>');
  });

  test('omits <media:content> when post.feature_image is not set', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [makePost({ feature_image: undefined })];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).not.toContain('<media:content');
  });

  test('omits <image> when site.logo is not set', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 20 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).not.toContain('<image>');
  });

  test('full_content=false (default) emits only <description>, never <content:encoded>', async () => {
    // Backlog #517: 10k items * 30KB inline body = 300MB feeds.
    // Default keeps the feed lean; aggregators that need the body re-fetch.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    const post = content.posts[0];
    if (!post) throw new Error('expected fixture post');
    post.feed_html = '<p>Body that must NOT ship in the feed when full_content is off.</p>';
    post.feed_excerpt = 'Lean excerpt only.';

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<description><![CDATA[Lean excerpt only.]]></description>');
    expect(xml).not.toContain('<content:encoded>');
    expect(xml).not.toContain('Body that must NOT ship');
  });

  test('full_content=true emits <content:encoded> with the post HTML body', async () => {
    // Backlog #517: opt-in for the Ghost-default behavior. Bandwidth-heavy
    // but useful when aggregators rely on the full body in the feed.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { full_content: true } },
    });
    const content = makeGraph();
    const post = content.posts[0];
    if (!post) throw new Error('expected fixture post');
    post.feed_html = '<p>Full body should ship.</p>';
    post.feed_excerpt = 'short';

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<description><![CDATA[short]]></description>');
    expect(xml).toContain(
      '<content:encoded><![CDATA[<p>Full body should ship.</p>]]></content:encoded>',
    );
  });

  test('full_content=true emits feed-safe Koenig card HTML without mutating page HTML', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-feed-safe-cards-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { full_content: true } },
    });
    const rawHtml = [
      '<p>Intro.</p>',
      '<figure class="kg-card kg-bookmark-card"><a class="kg-bookmark-container" href="/linked"><div class="kg-bookmark-title">Linked post</div><div class="kg-bookmark-description">Short summary.</div></a></figure>',
      '<figure class="kg-card kg-embed-card"><iframe src="https://player.vimeo.com/video/123" title="Vimeo clip"></iframe></figure>',
      '<figure class="kg-card kg-gallery-card"><div class="kg-gallery-image"><img src="/content/images/a.jpg" alt="A"></div><div class="kg-gallery-image"><img src="/content/images/b.jpg" alt="B"></div></figure>',
      '<div class="kg-card kg-audio-card"><audio src="/content/audio/podcast.mp3" controls></audio><div class="kg-audio-title">Podcast</div></div>',
      '<figure class="kg-card kg-video-card"><div class="kg-video-container"><video src="/content/video/clip.mp4" controls></video></div><figcaption>Clip</figcaption></figure>',
    ].join('');
    const content = makeGraph();
    const post = content.posts[0];
    if (!post) throw new Error('expected fixture post');
    post.html = rawHtml;
    post.feed_html = rawHtml;

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(post.html).toBe(rawHtml);
    expect(xml).toContain('<p>Intro.</p>');
    expect(xml).toContain('<a href="https://example.com/linked">Linked post</a>');
    expect(xml).toContain('<p>Short summary.</p>');
    expect(xml).toContain('<a href="https://player.vimeo.com/video/123">Vimeo clip</a>');
    expect(xml).toContain('<img src="https://example.com/content/images/a.jpg" alt="A">');
    expect(xml).toContain(
      '<a href="https://example.com/content/audio/podcast.mp3">Download audio: Podcast</a>',
    );
    expect(xml).toContain(
      '<a href="https://example.com/content/video/clip.mp4">Download video: Clip</a>',
    );
    expect(xml).not.toContain('<iframe');
    expect(xml).not.toContain('<script');
    expect(xml).not.toContain('<audio');
    expect(xml).not.toContain('<video');
    expect(xml).not.toContain('kg-bookmark-card');
  });
});

// Issue #786: per-tag and per-author RSS feeds matching Ghost's
// `/tag/<slug>/rss/` and `/author/<slug>/rss/` routes.
describe('emitRss per-tag and per-author feeds (issue #786)', () => {
  test('emits tag/<slug>/rss/index.xml with only posts tagged with that tag', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-pertag-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const news = makeTag({
      id: 'tag-news',
      slug: 'news',
      name: 'News',
      url: '/tag/news/',
    });
    const tutorials = makeTag({
      id: 'tag-tut',
      slug: 'tutorials',
      name: 'Tutorials',
      url: 'https://example.com/tag/tutorials/',
    });
    const newsPost = makePost({
      id: 'p-news',
      slug: 'news-1',
      title: 'News Post',
      url: '/news-1/',
      tags: [news],
      primary_tag: news,
    });
    const tutPost = makePost({
      id: 'p-tut',
      slug: 'tut-1',
      title: 'Tutorial Post',
      url: 'https://example.com/tut-1/',
      tags: [tutorials],
      primary_tag: tutorials,
    });
    const content: ContentGraph = {
      ...makeGraph(),
      posts: [newsPost, tutPost],
      tags: [news, tutorials],
      postsByTag: new Map([
        [news.slug, [newsPost]],
        [tutorials.slug, [tutPost]],
      ]),
    };

    await emitRss({ config, content, outputDir, limit: 20 });

    const newsXml = readFileSync(join(outputDir, 'tag/news/rss/index.xml'), 'utf8');
    expect(newsXml).toContain('<title><![CDATA[News Post]]></title>');
    expect(newsXml).not.toContain('<title><![CDATA[Tutorial Post]]></title>');
    expect(newsXml).toContain('<title>News - T</title>');
    expect(newsXml).toContain(
      '<atom:link href="https://example.com/tag/news/rss/index.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(newsXml).toContain('<link>https://example.com/tag/news/</link>');
    expect(newsXml).toContain('<link>https://example.com/news-1/</link>');

    const tutXml = readFileSync(join(outputDir, 'tag/tutorials/rss/index.xml'), 'utf8');
    expect(tutXml).toContain('<title><![CDATA[Tutorial Post]]></title>');
    expect(tutXml).not.toContain('<title><![CDATA[News Post]]></title>');
  });

  test('skips internal tags and tags with no posts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-pertag-skip-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const internalTag = makeTag({
      id: 'tag-internal',
      slug: 'hash-internal',
      name: '#internal',
      visibility: 'internal',
    });
    const emptyTag = makeTag({ id: 'tag-empty', slug: 'empty', name: 'Empty' });
    const newsTag = makeTag({ slug: 'news', name: 'News' });
    const post = makePost({ tags: [newsTag], primary_tag: newsTag });
    const content: ContentGraph = {
      ...makeGraph(),
      posts: [post],
      tags: [internalTag, emptyTag, newsTag],
      postsByTag: new Map([
        [internalTag.slug, [post]],
        [emptyTag.slug, []],
        [newsTag.slug, [post]],
      ]),
    };

    await emitRss({ config, content, outputDir, limit: 20 });

    expect(existsSync(join(outputDir, 'tag/hash-internal/rss/index.xml'))).toBe(false);
    expect(existsSync(join(outputDir, 'tag/empty/rss/index.xml'))).toBe(false);
    expect(existsSync(join(outputDir, 'tag/news/rss/index.xml'))).toBe(true);
  });

  test('emits author/<slug>/rss/index.xml with only posts authored by that author', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-perauthor-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const alice = makeAuthor({
      id: 'a-alice',
      slug: 'alice',
      name: 'Alice',
      url: '/author/alice/',
    });
    const bob = makeAuthor({
      id: 'a-bob',
      slug: 'bob',
      name: 'Bob',
      url: 'https://example.com/author/bob/',
    });
    const alicePost = makePost({
      id: 'p-a',
      slug: 'alice-1',
      title: 'Alice Post',
      url: '/alice-1/',
      authors: [alice],
      primary_author: alice,
    });
    const bobPost = makePost({
      id: 'p-b',
      slug: 'bob-1',
      title: 'Bob Post',
      url: 'https://example.com/bob-1/',
      authors: [bob],
      primary_author: bob,
    });
    const content: ContentGraph = {
      ...makeGraph(),
      posts: [alicePost, bobPost],
      authors: [alice, bob],
      postsByAuthor: new Map([
        [alice.slug, [alicePost]],
        [bob.slug, [bobPost]],
      ]),
    };

    await emitRss({ config, content, outputDir, limit: 20 });

    const aliceXml = readFileSync(join(outputDir, 'author/alice/rss/index.xml'), 'utf8');
    expect(aliceXml).toContain('<title><![CDATA[Alice Post]]></title>');
    expect(aliceXml).not.toContain('<title><![CDATA[Bob Post]]></title>');
    expect(aliceXml).toContain('<title>Alice - T</title>');
    expect(aliceXml).toContain(
      '<atom:link href="https://example.com/author/alice/rss/index.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(aliceXml).toContain('<link>https://example.com/author/alice/</link>');
    expect(aliceXml).toContain('<link>https://example.com/alice-1/</link>');

    const bobXml = readFileSync(join(outputDir, 'author/bob/rss/index.xml'), 'utf8');
    expect(bobXml).toContain('<title><![CDATA[Bob Post]]></title>');
  });

  test('per_tag = false suppresses tag feeds; per_author = false suppresses author feeds', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-disabled-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { rss: { per_tag: false, per_author: false } },
    });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 20 });

    // Site-wide feed is still emitted.
    expect(existsSync(join(outputDir, 'rss.xml'))).toBe(true);
    // Per-tag / per-author dirs do not exist.
    expect(existsSync(join(outputDir, 'tag/news/rss/index.xml'))).toBe(false);
    expect(existsSync(join(outputDir, 'author/casper/rss/index.xml'))).toBe(false);
  });
});

describe('emitRss per-collection feeds (issue #967)', () => {
  test('emits collection/rss/index.xml with only posts assigned to that collection', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-collection-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const blogTag = makeTag({
      id: 'tag-blog',
      slug: 'blog',
      name: 'Blog',
    });
    const changelogTag = makeTag({
      id: 'tag-changelog',
      slug: 'changelog',
      name: 'Changelog',
    });
    const blogPost = makePost({
      id: 'p-blog',
      slug: 'blog-post',
      title: 'Blog Post',
      url: '/blog/blog-post/',
      tags: [blogTag],
      primary_tag: blogTag,
    });
    const changelogPost = makePost({
      id: 'p-changelog',
      slug: 'ship-it',
      title: 'Ship It',
      url: '/changelog/ship-it/',
      tags: [changelogTag],
      primary_tag: changelogTag,
    });
    const content: ContentGraph = {
      ...makeGraph(),
      posts: [blogPost, changelogPost],
      tags: [blogTag, changelogTag],
      postsByTag: new Map([
        [blogTag.slug, [blogPost]],
        [changelogTag.slug, [changelogPost]],
      ]),
    };
    const routesYaml = {
      routes: {},
      collections: {
        '/blog/': {
          permalink: '/blog/{slug}/',
          filter: 'tag:blog',
        },
        '/changelog/': {
          permalink: '/changelog/{slug}/',
          filter: 'tag:changelog',
        },
      },
    };

    await emitRss({ config, content, outputDir, limit: 20, routesYaml });

    const blogXml = readFileSync(join(outputDir, 'blog/rss/index.xml'), 'utf8');
    expect(blogXml).toContain('<title><![CDATA[Blog Post]]></title>');
    expect(blogXml).not.toContain('<title><![CDATA[Ship It]]></title>');
    expect(blogXml).toContain('<title>Blog - T</title>');
    expect(blogXml).toContain('<link>https://example.com/blog/</link>');
    expect(blogXml).toContain(
      '<atom:link href="https://example.com/blog/rss/" rel="self" type="application/rss+xml"/>',
    );
    expect(blogXml).toContain('<link>https://example.com/blog/blog-post/</link>');

    const changelogXml = readFileSync(join(outputDir, 'changelog/rss/index.xml'), 'utf8');
    expect(changelogXml).toContain('<title><![CDATA[Ship It]]></title>');
    expect(changelogXml).not.toContain('<title><![CDATA[Blog Post]]></title>');
  });

  test('skips collections with rss disabled', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-collection-off-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const hiddenTag = makeTag({
      id: 'tag-hidden',
      slug: 'hidden',
      name: 'Hidden',
    });
    const post = makePost({
      id: 'p-hidden',
      slug: 'hidden-post',
      tags: [hiddenTag],
      primary_tag: hiddenTag,
    });
    const content: ContentGraph = {
      ...makeGraph(),
      posts: [post],
      tags: [hiddenTag],
      postsByTag: new Map([[hiddenTag.slug, [post]]]),
    };
    const routesYaml = {
      routes: {},
      collections: {
        '/hidden/': {
          permalink: '/hidden/{slug}/',
          filter: 'tag:hidden',
          rss: false,
        },
      },
    };

    await emitRss({ config, content, outputDir, limit: 20, routesYaml });

    expect(existsSync(join(outputDir, 'hidden/rss/index.xml'))).toBe(false);
  });
});

describe('emitSitemap', () => {
  test('sitemap.xml is always a <sitemapindex> referencing all four Ghost sub-sitemaps', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        { url: '/hello-world/', lastmod: '2026-01-02T03:04:05.000Z', kind: 'posts' },
        { url: '/about/', kind: 'pages' },
        { url: '/tag/news/', kind: 'tags' },
        { url: '/author/jane/', kind: 'authors' },
      ],
    });

    const index = readFileSync(join(outputDir, 'sitemap.xml'), 'utf8');
    expect(index).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(index).toContain('<loc>https://example.com/sitemap-posts.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-pages.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-tags.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-authors.xml</loc>');
    expect(index).not.toContain('<urlset');

    for (const file of [
      'sitemap-posts.xml',
      'sitemap-pages.xml',
      'sitemap-tags.xml',
      'sitemap-authors.xml',
    ]) {
      expect(existsSync(join(outputDir, file))).toBe(true);
    }
  });

  test('per-kind sub-sitemaps emit <lastmod>, <changefreq>, <priority> for every entry', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        { url: '/hello-world/', lastmod: '2026-01-02T03:04:05.000Z', kind: 'posts' },
        { url: '/no-date/', kind: 'pages' },
      ],
    });

    const posts = readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8');
    const pages = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');

    expect(posts).toContain(
      [
        '  <url>',
        '    <loc>https://example.com/hello-world/</loc>',
        '    <lastmod>2026-01-02T03:04:05.000Z</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ].join('\n'),
    );
    expect(pages).toContain(
      [
        '  <url>',
        '    <loc>https://example.com/no-date/</loc>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.6</priority>',
        '  </url>',
      ].join('\n'),
    );
    expect(posts).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(posts).toContain('\n  <url>\n');
  });

  test('post sub-sitemap emits image extension entries for feature images', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        {
          url: '/hello-world/',
          lastmod: '2026-01-02T03:04:05.000Z',
          kind: 'posts',
          images: [
            {
              url: '/content/images/cover.jpg',
              caption: 'Photo by <a href="https://credit.test">Ada &amp; Bob</a>',
            },
          ],
        },
        { url: '/no-image/', kind: 'posts' },
      ],
    });

    const posts = readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8');
    const pages = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');

    expect(posts).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    );
    expect(posts).toContain(
      [
        '  <url>',
        '    <loc>https://example.com/hello-world/</loc>',
        '      <image:image>',
        '        <image:loc>https://example.com/content/images/cover.jpg</image:loc>',
        '        <image:caption>Photo by Ada &amp; Bob</image:caption>',
        '      </image:image>',
        '    <lastmod>2026-01-02T03:04:05.000Z</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ].join('\n'),
    );
    expect(posts).toContain('<loc>https://example.com/no-image/</loc>');
    expect(pages).not.toContain('xmlns:image=');
  });

  test('post sub-sitemap skips feature image URLs that cannot be sitemap image loc values', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        {
          url: '/inline/',
          kind: 'posts',
          images: [{ url: 'data:image/png;base64,AAAA', caption: 'Inline data URI' }],
        },
      ],
    });

    const posts = readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8');
    expect(posts).not.toContain('xmlns:image=');
    expect(posts).not.toContain('<image:image>');
    expect(posts).toContain('<loc>https://example.com/inline/</loc>');
  });

  test('sitemap XML escapes values and strips XML-forbidden control characters', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-xml-escape-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        {
          url: '/a&b/"quoted"/',
          kind: 'posts',
          images: [{ url: '/content/images/cover.jpg', caption: 'A\u0001&B "caption"' }],
        },
      ],
    });

    const posts = readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8');
    expect(posts).toContain('<loc>https://example.com/a&amp;b/%22quoted%22/</loc>');
    expect(posts).toContain('<image:caption>A&amp;B &quot;caption&quot;</image:caption>');
    expect(posts).not.toContain('\u0001');
  });

  test('canonicalizes sitemap route URLs with trailing_slash = never', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-canonical-never-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { trailing_slash: 'never' },
    });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        { url: '/hello-world/', kind: 'posts' },
        { url: '/tag/news/', kind: 'tags' },
        { url: '/about/', kind: 'pages' },
      ],
    });

    const posts = readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8');
    expect(posts).toContain('<loc>https://example.com/hello-world</loc>');
    expect(posts).not.toContain('https://example.com/hello-world/');

    const tags = readFileSync(join(outputDir, 'sitemap-tags.xml'), 'utf8');
    expect(tags).toContain('<loc>https://example.com/tag/news</loc>');

    const index = readFileSync(join(outputDir, 'sitemap.xml'), 'utf8');
    expect(index).toContain('<loc>https://example.com/sitemap-posts.xml</loc>');
    expect(index).not.toContain('example.com//sitemap');
  });

  test('uses Ghost priorities: posts 0.7, pages 0.6, tags 0.6, authors 0.6', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        { url: '/p/', kind: 'posts' },
        { url: '/pg/', kind: 'pages' },
        { url: '/t/', kind: 'tags' },
        { url: '/a/', kind: 'authors' },
      ],
    });

    expect(readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8')).toContain(
      '<priority>0.7</priority>',
    );
    expect(readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8')).toContain(
      '<priority>0.6</priority>',
    );
    expect(readFileSync(join(outputDir, 'sitemap-tags.xml'), 'utf8')).toContain(
      '<priority>0.6</priority>',
    );
    expect(readFileSync(join(outputDir, 'sitemap-authors.xml'), 'utf8')).toContain(
      '<priority>0.6</priority>',
    );
  });

  test('non-ISO lastmod strings pass through unchanged', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [{ url: '/x/', lastmod: 'not-a-date', kind: 'pages' }],
    });
    const xml = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');

    expect(xml).toContain('<lastmod>not-a-date</lastmod>');
  });

  test('unclassified entries fall back to monthly/0.5 defaults under sitemap-pages', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [{ url: '/ad-hoc/' }],
    });
    // Unclassified entries land in the 'pages' bucket (see comment in
    // bucketSitemapEntriesByKind); the per-entry monthly/0.5 defaults still
    // win over the kind defaults because the entry has no kind.
    const xml = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');

    expect(xml).toContain('<changefreq>monthly</changefreq>');
    expect(xml).toContain('<priority>0.5</priority>');
  });

  test('caller can override changefreq and priority per entry', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [{ url: '/', kind: 'pages', changefreq: 'daily', priority: 1.0 }],
    });
    const xml = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');

    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain('<priority>1.0</priority>');
  });

  test('clamps out-of-range priority into [0.0, 1.0]', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        { url: '/hi/', kind: 'pages', priority: 9.9 },
        { url: '/lo/', kind: 'pages', priority: -3 },
      ],
    });
    const xml = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');

    expect(xml).toContain('    <loc>https://example.com/hi/</loc>');
    expect(xml).toContain('    <changefreq>weekly</changefreq>');
    expect(xml).toContain('    <priority>1.0</priority>');
    expect(xml).toContain('    <loc>https://example.com/lo/</loc>');
    expect(xml).toContain('    <priority>0.0</priority>');
  });

  test('above the 50k URL cap, per-kind sub-sitemaps split into -2.xml, -3.xml ...', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    const overflow = SITEMAP_MAX_URLS_PER_FILE + 1;
    const urls: SitemapEntry[] = [];
    for (let i = 0; i < overflow; i++) {
      urls.push({ url: `/p-${i}/`, kind: 'posts', lastmod: '2026-01-01T00:00:00.000Z' });
    }
    urls.push({ url: '/about/', kind: 'pages', lastmod: '2026-02-02T00:00:00.000Z' });
    urls.push({ url: '/tag/news/', kind: 'tags', lastmod: '2026-03-03T00:00:00.000Z' });
    urls.push({ url: '/author/jane/', kind: 'authors', lastmod: '2026-04-04T00:00:00.000Z' });

    await emitSitemap({ config, content, outputDir, urls });

    const index = readFileSync(join(outputDir, 'sitemap.xml'), 'utf8');
    expect(index).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(index).toContain('<loc>https://example.com/sitemap-posts.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-posts-2.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-pages.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-tags.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-authors.xml</loc>');

    const posts1 = readFileSync(join(outputDir, 'sitemap-posts.xml'), 'utf8');
    expect(posts1).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(posts1).toContain('<loc>https://example.com/p-0/</loc>');
    expect(posts1).toContain('<changefreq>weekly</changefreq>');
    expect(posts1).toContain('<priority>0.7</priority>');

    const posts2 = readFileSync(join(outputDir, 'sitemap-posts-2.xml'), 'utf8');
    expect(posts2).toContain(`<loc>https://example.com/p-${SITEMAP_MAX_URLS_PER_FILE}/</loc>`);

    const tags = readFileSync(join(outputDir, 'sitemap-tags.xml'), 'utf8');
    expect(tags).toContain('<loc>https://example.com/tag/news/</loc>');

    expect(existsSync(join(outputDir, 'sitemap-pages-2.xml'))).toBe(false);
  });

  test('empty per-kind buckets still emit a sub-sitemap with no urls', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    // Only feed posts. Pages, tags, authors must still get their canonical
    // empty <urlset> file so external consumers can hard-code the URL.
    const urls: SitemapEntry[] = [
      { url: '/hello/', kind: 'posts', lastmod: '2026-01-01T00:00:00.000Z' },
    ];

    await emitSitemap({ config, content, outputDir, urls });

    for (const file of [
      'sitemap-posts.xml',
      'sitemap-pages.xml',
      'sitemap-tags.xml',
      'sitemap-authors.xml',
    ]) {
      expect(existsSync(join(outputDir, file))).toBe(true);
    }
    const emptyPages = readFileSync(join(outputDir, 'sitemap-pages.xml'), 'utf8');
    expect(emptyPages).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(emptyPages).not.toContain('<url>');

    const index = readFileSync(join(outputDir, 'sitemap.xml'), 'utf8');
    expect(index).toContain('<loc>https://example.com/sitemap-pages.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-tags.xml</loc>');
    expect(index).toContain('<loc>https://example.com/sitemap-authors.xml</loc>');
  });

  test('emits gzip companions for every sitemap and the index', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [
        { url: '/hello/', kind: 'posts' },
        { url: '/about/', kind: 'pages' },
        { url: '/tag/news/', kind: 'tags' },
        { url: '/author/jane/', kind: 'authors' },
      ],
    });

    for (const file of [
      'sitemap.xml',
      'sitemap-posts.xml',
      'sitemap-pages.xml',
      'sitemap-tags.xml',
      'sitemap-authors.xml',
    ]) {
      const xml = readFileSync(join(outputDir, file), 'utf8');
      const gzPath = join(outputDir, `${file}.gz`);
      expect(existsSync(gzPath)).toBe(true);
      // Gunzip must roundtrip back to the exact XML payload.
      const gunzipped = gunzipSync(readFileSync(gzPath)).toString('utf8');
      expect(gunzipped).toBe(xml);
    }
  });

  test('skips rewriting unchanged sitemap files and gzip companions when hashes match', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-cache-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.sources = {
      posts: new Map([
        [content.posts[0]?.id ?? 'post-1', { path: 'hello.md', mtimeMs: 1, size: 10 }],
      ]),
      pages: new Map(),
      tags: new Map(),
      authors: new Map(),
    };
    const urls: SitemapEntry[] = [{ url: '/hello/', kind: 'posts' }];
    const firstFeeds = {};

    await emitSitemap({ config, content, outputDir, urls, nextFeeds: firstFeeds });
    const beforeXml = (await stat(join(outputDir, 'sitemap-posts.xml'))).mtimeMs;
    const beforeGz = (await stat(join(outputDir, 'sitemap-posts.xml.gz'))).mtimeMs;
    await Bun.sleep(20);
    const secondFeeds = {};
    await emitSitemap({
      config,
      content,
      outputDir,
      urls,
      previousFeeds: firstFeeds,
      nextFeeds: secondFeeds,
    });

    expect((await stat(join(outputDir, 'sitemap-posts.xml'))).mtimeMs).toBe(beforeXml);
    expect((await stat(join(outputDir, 'sitemap-posts.xml.gz'))).mtimeMs).toBe(beforeGz);
    expect(secondFeeds).toEqual(firstFeeds);
  });
});

function makeTag(over: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    slug: 'news',
    name: 'News',
    description: '',
    feature_image: undefined,
    accent_color: undefined,
    og_title: undefined,
    og_description: undefined,
    og_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    twitter_image: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    visibility: 'public',
    meta_title: undefined,
    meta_description: undefined,
    url: 'https://example.com/tag/news/',
    count: { posts: 1 },
    ...over,
  };
}

function makeAuthor(over: Partial<Author> = {}): Author {
  return {
    id: 'author-1',
    slug: 'casper',
    name: 'Casper',
    bio: '',
    profile_image: undefined,
    cover_image: undefined,
    website: undefined,
    location: undefined,
    twitter: undefined,
    facebook: undefined,
    linkedin: undefined,
    bluesky: undefined,
    mastodon: undefined,
    threads: undefined,
    tiktok: undefined,
    youtube: undefined,
    instagram: undefined,
    meta_title: undefined,
    meta_description: undefined,
    url: 'https://example.com/author/casper/',
    count: { posts: 1 },
    ...over,
  };
}

function makePost(over: Partial<Post> = {}): Post {
  const tag = makeTag();
  const author = makeAuthor();
  return {
    id: 'post-1',
    slug: 'hello-world',
    title: 'Hello, world',
    html: '<p>hi</p>',
    excerpt: 'hi',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    featured: false,
    page: false,
    published_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    reading_time: 1,
    word_count: 1,
    visibility: 'public',
    status: 'published',
    tags: [tag],
    primary_tag: tag,
    authors: [author],
    primary_author: author,
    url: 'https://example.com/hello-world/',
    canonical_url: undefined,
    meta_title: undefined,
    meta_description: undefined,
    og_title: undefined,
    og_description: undefined,
    og_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    twitter_image: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    comments: true,
    prev: undefined,
    next: undefined,
    feed_html: '<p>hi</p>',
    feed_excerpt: 'hi',
    ...over,
  };
}

function makePage(over: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    slug: 'about',
    title: 'About',
    html: '<p>about</p>',
    plaintext: 'about',
    excerpt: 'about',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    page: true,
    published_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    reading_time: 1,
    word_count: 1,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: 'https://example.com/about/',
    canonical_url: undefined,
    meta_title: undefined,
    meta_description: undefined,
    og_title: undefined,
    og_description: undefined,
    og_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    twitter_image: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    show_title_and_feature_image: true,
    custom_template: undefined,
    ...over,
  };
}

function makeGraph(): ContentGraph {
  const tag = makeTag();
  const author = makeAuthor();
  const post = makePost();
  const page = makePage();
  return {
    posts: [post],
    pages: [page],
    tags: [tag],
    authors: [author],
    tiers: [],
    bySlug: {
      posts: new Map([[post.slug, post]]),
      pages: new Map([[page.slug, page]]),
      tags: new Map([[tag.slug, tag]]),
      authors: new Map([[author.slug, author]]),
    },
    postsByTag: new Map([[tag.slug, [post]]]),
    postsByAuthor: new Map([[author.slug, [post]]]),
    site: {
      title: 'Site',
      description: 'desc',
      url: 'https://example.com',
      locale: 'en',
      direction: 'ltr',
      timezone: 'UTC',
      cover_image: undefined,
      logo: undefined,
      logo_width: undefined,
      logo_height: undefined,
      icon: undefined,
      accent_color: '#222',
      navigation: [],
      secondary_navigation: [],
      lang: 'en',
      twitter: undefined,
      facebook: undefined,
      members_enabled: false,
      paid_members_enabled: false,
      members_invite_only: false,
      comments_enabled: false,
      comments_access: 'all',
      recommendations_enabled: false,
      meta_title: undefined,
      meta_description: undefined,
      og_image: undefined,
      og_title: undefined,
      og_description: undefined,
      twitter_image: undefined,
      twitter_title: undefined,
      twitter_description: undefined,
      codeinjection_head: undefined,
      codeinjection_foot: undefined,
    },
  };
}
