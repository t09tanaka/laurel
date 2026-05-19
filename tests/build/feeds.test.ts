import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { absolutizeHtmlUrls, emitRss } from '~/build/feeds.ts';
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
