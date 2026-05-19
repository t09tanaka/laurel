import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RSS_MAX_ITEMS_PER_PAGE, absolutizeHtmlUrls, emitRss, emitSitemap } from '~/build/feeds.ts';
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
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
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
    expect(xml).toContain('<description>Public intro.</description>');
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
    expect(page1).toContain('<title>Post 1</title>');
    expect(page1).toContain('<title>Post 2</title>');
    expect(page1).not.toContain('<title>Post 3</title>');

    expect(page2).toContain(
      '<atom:link href="https://example.com/rss.xml" rel="prev" type="application/rss+xml"/>',
    );
    expect(page2).toContain(
      '<atom:link href="https://example.com/rss-3.xml" rel="next" type="application/rss+xml"/>',
    );
    expect(page2).toContain('<title>Post 3</title>');
    expect(page2).toContain('<title>Post 4</title>');

    expect(page3).toContain(
      '<atom:link href="https://example.com/rss-2.xml" rel="prev" type="application/rss+xml"/>',
    );
    expect(page3).not.toContain('rel="next"');
    expect(page3).toContain('<title>Post 5</title>');

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

    expect(page1).toContain(`<title>Post ${RSS_MAX_ITEMS_PER_PAGE}</title>`);
    expect(page1).not.toContain(`<title>Post ${RSS_MAX_ITEMS_PER_PAGE + 1}</title>`);
    expect(page1).toContain('rel="next"');
    expect(page2).toContain(`<title>Post ${RSS_MAX_ITEMS_PER_PAGE + 5}</title>`);
    expect(existsSync(join(outputDir, 'rss-3.xml'))).toBe(false);
  });

  test('non-positive limit falls back to a single item per page', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-rss-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitRss({ config, content, outputDir, limit: 0 });
    const xml = readFileSync(join(outputDir, 'rss.xml'), 'utf8');

    expect(xml).toContain('<title>Hello, world</title>');
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
});

describe('emitSitemap', () => {
  test('emits <lastmod> for entries that provide one', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [{ url: '/hello-world/', lastmod: '2026-01-02T03:04:05.000Z' }, { url: '/no-date/' }],
    });
    const xml = readFileSync(join(outputDir, 'sitemap.xml'), 'utf8');

    expect(xml).toContain(
      '<url><loc>https://example.com/hello-world/</loc><lastmod>2026-01-02T03:04:05.000Z</lastmod></url>',
    );
    expect(xml).toContain('<url><loc>https://example.com/no-date/</loc></url>');
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  test('non-ISO lastmod strings pass through unchanged', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sitemap-'));
    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = makeGraph();

    await emitSitemap({
      config,
      content,
      outputDir,
      urls: [{ url: '/x/', lastmod: 'not-a-date' }],
    });
    const xml = readFileSync(join(outputDir, 'sitemap.xml'), 'utf8');

    expect(xml).toContain('<lastmod>not-a-date</lastmod>');
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
    bySlug: {
      posts: new Map([[post.slug, post]]),
      pages: new Map([[page.slug, page]]),
      tags: new Map([[tag.slug, tag]]),
      authors: new Map([[author.slug, author]]),
    },
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
    },
  };
}
