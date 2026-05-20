import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitContentApiStubs } from '~/build/content-api.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

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
    feed_html: '',
    feed_excerpt: '',
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

function makeGraph(over: Partial<ContentGraph> = {}): ContentGraph {
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
      description: 'A site',
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
      navigation: [{ label: 'Home', url: '/' }],
      secondary_navigation: [],
      lang: 'en',
      twitter: undefined,
      facebook: undefined,
      members_enabled: false,
      paid_members_enabled: false,
      members_invite_only: false,
      recommendations_enabled: false,
    },
    ...over,
  };
}

describe('emitContentApiStubs', () => {
  test('writes all four artifacts under outputDir', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    expect(existsSync(join(outputDir, 'content', 'posts.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'content', 'settings.json'))).toBe(true);
    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
    expect(existsSync(join(outputDir, '_headers.cf'))).toBe(true);
  });

  test('posts.json shape includes posts array and meta.pagination', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.posts.length).toBe(1);
    expect(body.posts[0].slug).toBe('hello-world');
    expect(body.posts[0].url).toBe('https://example.com/hello-world/');
    expect(body.meta).toBeDefined();
    expect(body.meta.pagination).toEqual({
      page: 1,
      limit: 1,
      pages: 1,
      total: 1,
      next: null,
      prev: null,
    });
  });

  test('posts.json embeds tags, primary_tag, authors, primary_author', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    const post = body.posts[0];
    expect(Array.isArray(post.tags)).toBe(true);
    expect(post.tags[0].slug).toBe('news');
    expect(post.primary_tag.slug).toBe('news');
    expect(Array.isArray(post.authors)).toBe(true);
    expect(post.authors[0].slug).toBe('casper');
    expect(post.primary_author.slug).toBe('casper');
    // prev / next link refs are explicitly NOT serialized.
    expect(Object.hasOwn(post, 'prev')).toBe(false);
    expect(Object.hasOwn(post, 'next')).toBe(false);
  });

  test('posts.json excludes draft and scheduled posts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    const draft = makePost({ id: 'post-2', slug: 'draft', status: 'draft' });
    const scheduled = makePost({ id: 'post-3', slug: 'sched', status: 'scheduled' });
    const graph = makeGraph({ posts: [makePost(), draft, scheduled] });
    await emitContentApiStubs({ content: graph, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(body.posts.length).toBe(1);
    expect(body.posts[0].slug).toBe('hello-world');
  });

  test('settings.json shape includes settings object with required fields', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'settings.json'), 'utf8'));
    expect(body.settings).toBeDefined();
    expect(body.settings.title).toBe('Site');
    expect(body.settings.description).toBe('A site');
    expect(body.settings.url).toBe('https://example.com');
    expect(body.settings.locale).toBe('en');
    expect(body.settings.lang).toBe('en');
    expect(body.settings.timezone).toBe('UTC');
    expect(body.settings.accent_color).toBe('#222');
    expect(body.settings.navigation).toEqual([{ label: 'Home', url: '/' }]);
  });

  test('settings.json hardcodes members fields to false / empty', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    // Even if the underlying site says members are enabled, the stub forces
    // them off because Nectar is static-only and cannot authenticate.
    const graph = makeGraph();
    graph.site.members_enabled = true;
    graph.site.paid_members_enabled = true;
    graph.site.members_invite_only = true;
    await emitContentApiStubs({ content: graph, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'settings.json'), 'utf8'));
    expect(body.settings.members_enabled).toBe(false);
    expect(body.settings.paid_members_enabled).toBe(false);
    expect(body.settings.members_invite_only).toBe(false);
    expect(body.settings.portal_plans).toEqual([]);
    expect(body.settings.portal_products).toEqual([]);
  });

  test('_headers contains Access-Control-* lines on /content/*', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = readFileSync(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('/content/*');
    expect(body).toContain('Access-Control-Allow-Origin: *');
    expect(body).toContain('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
    expect(body).toContain('Access-Control-Allow-Headers: Content-Type, Authorization');
    expect(body).toContain('Cache-Control: public, max-age=300');
  });

  test('_headers.cf contains the same CORS body as _headers', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const netlify = readFileSync(join(outputDir, '_headers'), 'utf8');
    const cloudflare = readFileSync(join(outputDir, '_headers.cf'), 'utf8');
    expect(cloudflare).toBe(netlify);
  });

  test('prepends CORS rule onto an existing _headers without clobbering', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    const existing = '/*\n  X-Frame-Options: SAMEORIGIN\n';
    await writeFile(join(outputDir, '_headers'), existing, 'utf8');

    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = readFileSync(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('/content/*');
    expect(body).toContain('Access-Control-Allow-Origin: *');
    expect(body).toContain('X-Frame-Options: SAMEORIGIN');
    // Sanity check ordering: CORS rule for `/content/*` precedes the
    // catch-all `/*` so first-match platforms pick it up.
    expect(body.indexOf('/content/*')).toBeLessThan(body.indexOf('/*\n  X-Frame'));
  });

  test('is idempotent: a second run does not duplicate the CORS rule', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });
    const first = readFileSync(join(outputDir, '_headers'), 'utf8');

    await emitContentApiStubs({ content: makeGraph(), outputDir });
    const second = readFileSync(join(outputDir, '_headers'), 'utf8');

    expect(second).toBe(first);
  });
});
