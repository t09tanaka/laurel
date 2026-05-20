import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
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

describe('emitRss', () => {
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

  test('uses the post URL with isPermaLink="true" so feed readers can dedupe', async () => {
    // Issue #426: Ghost emits guid as the post URL with isPermaLink="true".
    // Without this, Feedly/NetNewsWire cannot dedupe across feed restarts.
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();
    content.posts = [
      makePost({
        id: 'post-hello-world',
        slug: 'hello-world',
        url: 'https://example.com/hello-world/',
      }),
    ];

    await emitRss({ config, content, outputDir, limit: 10 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<guid isPermaLink="true">https://example.com/hello-world/</guid>');
    expect(xml).not.toContain('isPermaLink="false"');
  });

  test('declares dc and media namespaces and emits <generator>', async () => {
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
      url: 'https://example.com/tag/news/',
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
      url: 'https://example.com/news-1/',
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
      url: 'https://example.com/author/alice/',
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
      url: 'https://example.com/alice-1/',
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
      '<url><loc>https://example.com/hello-world/</loc><lastmod>2026-01-02T03:04:05.000Z</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>',
    );
    expect(pages).toContain(
      '<url><loc>https://example.com/no-date/</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>',
    );
    expect(posts).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
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

    expect(xml).toContain(
      '<loc>https://example.com/hi/</loc><changefreq>weekly</changefreq><priority>1.0</priority>',
    );
    expect(xml).toContain(
      '<loc>https://example.com/lo/</loc><changefreq>weekly</changefreq><priority>0.0</priority>',
    );
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
});

function makeTag(over: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    slug: 'news',
    name: 'News',
    description: '',
    feature_image: undefined,
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
    plaintext: 'hi',
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
