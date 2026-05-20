import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitContentApiStubs } from '~/build/content-api.ts';
import { routesYamlSchema } from '~/build/routes-yaml.ts';
import { configSchema } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

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
    expect(existsSync(join(outputDir, 'content', '404.json'))).toBe(true);
    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
    expect(existsSync(join(outputDir, '_headers.cf'))).toBe(true);
  });

  test('emits a Ghost-shaped 404 error envelope for static Content API misses (#742)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-404-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', '404.json'), 'utf8'));
    expect(body).toEqual({
      errors: [
        {
          message: 'Resource not found error, cannot read post.',
          context: 'The requested Content API resource was not found.',
          type: 'NotFoundError',
          details: null,
          property: null,
          help: null,
          code: null,
          id: 'nectar-content-api-404',
        },
      ],
    });
  });

  test('duo emit: posts / tags / authors / settings each land at both .json and /index.json (#215)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    for (const resource of ['posts', 'tags', 'authors', 'settings']) {
      // Bare resource path: `dist/content/<resource>.json`.
      expect(existsSync(join(outputDir, 'content', `${resource}.json`))).toBe(true);
      // Directory-index variant: `dist/content/<resource>/index.json`.
      expect(existsSync(join(outputDir, 'content', resource, 'index.json'))).toBe(true);

      // The two payloads must be byte-identical so an SDK that resolves
      // `/content/posts/` to `index.json` and one that hits the bare `.json`
      // see exactly the same payload.
      const flat = readFileSync(join(outputDir, 'content', `${resource}.json`), 'utf8');
      const dirIndex = readFileSync(join(outputDir, 'content', resource, 'index.json'), 'utf8');
      expect(dirIndex).toBe(flat);
    }
  });

  test('tags.json and authors.json have Ghost canonical meta.pagination shape (#216)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const tagsBody = JSON.parse(readFileSync(join(outputDir, 'content', 'tags.json'), 'utf8'));
    expect(Array.isArray(tagsBody.tags)).toBe(true);
    expect(tagsBody.meta.pagination).toEqual({
      page: 1,
      limit: 1,
      pages: 1,
      total: 1,
      next: null,
      prev: null,
    });

    const authorsBody = JSON.parse(
      readFileSync(join(outputDir, 'content', 'authors.json'), 'utf8'),
    );
    expect(Array.isArray(authorsBody.authors)).toBe(true);
    expect(authorsBody.meta.pagination.page).toBe(1);
    expect(authorsBody.meta.pagination.total).toBe(1);
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

  test('post.url is absolute and preserves base_path plus routes.yaml permalink (#769)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-content-api-post-url-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/tags'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: Hello
date: 2026-01-01T00:00:00Z
tags:
  - News
---

Hello.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/tags/news.md'),
      `---
name: News
---
`,
      'utf8',
    );
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      build: { base_path: '/base/' },
    });
    const routesYaml = routesYamlSchema.parse({
      collections: {
        '/news/': { permalink: '/news/{slug}/', filter: 'tag:news' },
      },
    });
    const content = await loadContent({ cwd, config, routesYaml });
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-post-url-out-'));

    await emitContentApiStubs({ content, outputDir, basePath: config.build.base_path });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(content.posts[0]?.url).toBe('/base/news/hello/');
    expect(body.posts[0].url).toBe('https://example.com/base/news/hello/');
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

  test('tags.json serializes tag social and code injection fields', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-tag-fields-'));
    const tag = makeTag({
      og_title: 'News OG',
      og_description: 'News OG description',
      og_image: '/content/images/news-og.jpg',
      twitter_title: 'News Twitter',
      twitter_description: 'News Twitter description',
      twitter_image: '/content/images/news-twitter.jpg',
      codeinjection_head: '<meta name="tag-head" content="news">',
      codeinjection_foot: '<script>window.__tag = "news"</script>',
    });
    await emitContentApiStubs({
      content: makeGraph({
        tags: [tag],
        posts: [makePost({ tags: [tag], primary_tag: tag })],
      }),
      outputDir,
    });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'tags.json'), 'utf8'));
    expect(body.tags[0]).toMatchObject({
      og_title: 'News OG',
      og_description: 'News OG description',
      og_image: '/content/images/news-og.jpg',
      twitter_title: 'News Twitter',
      twitter_description: 'News Twitter description',
      twitter_image: '/content/images/news-twitter.jpg',
      codeinjection_head: '<meta name="tag-head" content="news">',
      codeinjection_foot: '<script>window.__tag = "news"</script>',
    });
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

  test('optionally emits Apache .htaccess under content with the CORS headers', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir, emitHtaccess: true });

    const body = readFileSync(join(outputDir, 'content', '.htaccess'), 'utf8');
    expect(body).toContain('Header always set Access-Control-Allow-Origin "*"');
    expect(body).toContain('Header always set Access-Control-Allow-Methods "GET, HEAD, OPTIONS"');
    expect(body).toContain(
      'Header always set Access-Control-Allow-Headers "Content-Type, Authorization"',
    );
    expect(body).toContain('Header set Cache-Control "public, max-age=300"');
    expect(body).toContain('Header set Cache-Control "public, max-age=3600"');
  });

  test('does not emit content .htaccess unless requested', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    expect(existsSync(join(outputDir, 'content', '.htaccess'))).toBe(false);
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

  test('emits pages.json with per-page shards (#750)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    expect(existsSync(join(outputDir, 'content', 'pages.json'))).toBe(true);
    const collection = JSON.parse(readFileSync(join(outputDir, 'content', 'pages.json'), 'utf8'));
    expect(Array.isArray(collection.pages)).toBe(true);
    expect(collection.pages[0].slug).toBe('about');

    // Per-slug and per-id shards.
    expect(existsSync(join(outputDir, 'content', 'pages', 'slug', 'about.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'content', 'pages', 'page-1.json'))).toBe(true);
    const single = JSON.parse(
      readFileSync(join(outputDir, 'content', 'pages', 'slug', 'about.json'), 'utf8'),
    );
    expect(single.pages).toHaveLength(1);
    expect(single.pages[0].slug).toBe('about');
  });

  test('emits authors.json with count.posts (#749)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'authors.json'), 'utf8'));
    expect(body.authors[0].count).toEqual({ posts: 1 });
  });

  test('emits public tags with count.posts ordered by name asc (#753)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-tags-'));
    const alpha = makeTag({ id: 'tag-alpha', slug: 'alpha', name: 'Alpha', count: { posts: 0 } });
    const zulu = makeTag({ id: 'tag-zulu', slug: 'zulu', name: 'Zulu', count: { posts: 0 } });
    const internal = makeTag({
      id: 'tag-internal',
      slug: 'hash-internal',
      name: '#internal',
      visibility: 'internal',
      count: { posts: 0 },
    });
    const posts = [
      makePost({ id: 'p-alpha-1', slug: 'alpha-1', tags: [alpha], primary_tag: alpha }),
      makePost({ id: 'p-zulu', slug: 'zulu', tags: [zulu], primary_tag: zulu }),
      makePost({ id: 'p-alpha-2', slug: 'alpha-2', tags: [alpha], primary_tag: alpha }),
      makePost({
        id: 'p-alpha-draft',
        slug: 'alpha-draft',
        status: 'draft',
        tags: [alpha],
        primary_tag: alpha,
      }),
    ];
    await emitContentApiStubs({
      content: makeGraph({ tags: [zulu, internal, alpha], posts }),
      outputDir,
    });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'tags.json'), 'utf8'));
    expect(body.tags.map((tag: { slug: string }) => tag.slug)).toEqual(['alpha', 'zulu']);
    expect(body.tags.map((tag: { count: { posts: number } }) => tag.count.posts)).toEqual([2, 1]);
    expect(body.meta.pagination.total).toBe(2);
  });

  test('emits absolute tag.url in tags.json with base_path and custom taxonomy path (#773)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-tag-url-'));
    const news = makeTag({
      id: 'tag-news',
      slug: 'news',
      name: 'News',
      url: '/category/news/',
      count: { posts: 0 },
    });
    await emitContentApiStubs({
      content: makeGraph({
        site: { ...makeGraph().site, url: 'https://example.com' },
        tags: [news],
        posts: [makePost({ tags: [news], primary_tag: news })],
      }),
      outputDir,
      basePath: '/blog/',
    });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'tags.json'), 'utf8'));
    expect(body.tags[0].url).toBe('https://example.com/blog/category/news/');
  });

  test('emits per-slug public tag shards and skips internal tags (#753)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-tags-'));
    const news = makeTag({ id: 'tag-news', slug: 'news', name: 'News', count: { posts: 0 } });
    const internal = makeTag({
      id: 'tag-internal',
      slug: 'hash-internal',
      name: '#internal',
      visibility: 'internal',
      count: { posts: 0 },
    });
    await emitContentApiStubs({
      content: makeGraph({
        tags: [internal, news],
        posts: [makePost({ tags: [news, internal], primary_tag: news })],
      }),
      outputDir,
    });

    const flat = readFileSync(join(outputDir, 'content', 'tags', 'slug', 'news.json'), 'utf8');
    const dirIndex = readFileSync(
      join(outputDir, 'content', 'tags', 'slug', 'news', 'index.json'),
      'utf8',
    );
    expect(dirIndex).toBe(flat);
    const bySlug = JSON.parse(flat);
    expect(bySlug.tags).toHaveLength(1);
    expect(bySlug.tags[0]).toMatchObject({ slug: 'news', visibility: 'public' });
    expect(bySlug.tags[0].count).toEqual({ posts: 1 });
    expect(existsSync(join(outputDir, 'content', 'tags', 'slug', 'hash-internal.json'))).toBe(
      false,
    );
  });

  test('emits per-post shards by id and by slug (#752)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    const id = '0123456789abcdefabcdef12';
    await emitContentApiStubs({ content: makeGraph({ posts: [makePost({ id })] }), outputDir });

    expect(existsSync(join(outputDir, 'content', 'posts', `${id}.json`))).toBe(true);
    expect(existsSync(join(outputDir, 'content', 'posts', 'slug', 'hello-world.json'))).toBe(true);

    const bySlug = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', 'slug', 'hello-world.json'), 'utf8'),
    );
    const byId = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', `${id}.json`), 'utf8'),
    );
    expect(bySlug.posts).toHaveLength(1);
    expect(byId.posts).toHaveLength(1);
    expect(bySlug.posts[0].id).toBe(id);
    expect(bySlug.posts[0].id).toMatch(/^[0-9a-f]{24}$/);
    expect(byId.posts[0].slug).toBe('hello-world');
  });

  test('emits paginated posts shards (#751)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    // 3 posts, page size 2 → 2 pages.
    const posts = [
      makePost({ id: 'p1', slug: 'p1' }),
      makePost({ id: 'p2', slug: 'p2' }),
      makePost({ id: 'p3', slug: 'p3' }),
    ];
    const graph = makeGraph({ posts });
    await emitContentApiStubs({ content: graph, outputDir, postsPerPage: 2 });

    expect(existsSync(join(outputDir, 'content', 'posts', 'page', '1.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'content', 'posts', 'page', '2.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'content', 'posts', 'page', '1', 'index.json'))).toBe(true);

    const page1 = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', 'page', '1.json'), 'utf8'),
    );
    expect(page1.posts).toHaveLength(2);
    expect(page1.meta.pagination.page).toBe(1);
    expect(page1.meta.pagination.pages).toBe(2);
    expect(page1.meta.pagination.next).toBe(2);
    expect(page1.meta.pagination.prev).toBeNull();
    expect(typeof page1.meta.pagination.next).toBe('number');

    const page2 = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', 'page', '2.json'), 'utf8'),
    );
    expect(page2.posts).toHaveLength(1);
    expect(page2.meta.pagination.next).toBeNull();
    expect(page2.meta.pagination.prev).toBe(1);
    expect(typeof page2.meta.pagination.prev).toBe('number');
  });

  test('emits per-tag pre-baked filtered shards (#757)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-content-api-stubs-'));
    const otherTag = makeTag({ id: 'tag-2', slug: 'tech', name: 'Tech' });
    const newsTag = makeTag();
    const postNews = makePost({ id: 'p-news', slug: 'p-news', tags: [newsTag] });
    const postTech = makePost({
      id: 'p-tech',
      slug: 'p-tech',
      tags: [otherTag],
      primary_tag: otherTag,
    });
    const graph = makeGraph({
      posts: [postNews, postTech],
      tags: [newsTag, otherTag],
    });
    await emitContentApiStubs({ content: graph, outputDir });

    const newsBody = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', 'tag', 'news.json'), 'utf8'),
    );
    expect(newsBody.posts).toHaveLength(1);
    expect(newsBody.posts[0].slug).toBe('p-news');

    const techBody = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', 'tag', 'tech.json'), 'utf8'),
    );
    expect(techBody.posts).toHaveLength(1);
    expect(techBody.posts[0].slug).toBe('p-tech');
  });

  test('absolute_urls rewrites html src/href to absolute (#743)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-absolute-urls-'));
    const post = makePost({
      html: '<p><a href="/foo/">foo</a> <img src="/images/x.png"/></p>',
    });
    const graph = makeGraph({ posts: [post] });
    await emitContentApiStubs({ content: graph, outputDir, absoluteUrls: true });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(body.posts[0].html).toContain('href="https://example.com/foo/"');
    expect(body.posts[0].html).toContain('src="https://example.com/images/x.png"');
  });

  test('absolute_urls leaves already-absolute and protocol-relative URLs alone', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-absolute-urls-'));
    const post = makePost({
      html: '<a href="https://other.example/x">x</a> <img src="//cdn.example/y.png"/>',
    });
    const graph = makeGraph({ posts: [post] });
    await emitContentApiStubs({ content: graph, outputDir, absoluteUrls: true });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(body.posts[0].html).toContain('https://other.example/x');
    expect(body.posts[0].html).toContain('//cdn.example/y.png');
    // No double-prefix.
    expect(body.posts[0].html).not.toContain('https://example.comhttps://');
  });

  test('absolute_urls honours base_path', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-absolute-urls-'));
    const post = makePost({ html: '<a href="/x">x</a>' });
    const graph = makeGraph({ posts: [post] });
    await emitContentApiStubs({
      content: graph,
      outputDir,
      absoluteUrls: true,
      basePath: '/blog',
    });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(body.posts[0].html).toContain('href="https://example.com/blog/x"');
  });

  test('strips members-only body content for non-public visibility (#759)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-strip-'));
    const post = makePost({
      visibility: 'members',
      html: '<p>secret members content</p>',
      plaintext: 'secret members content',
      excerpt: 'secret excerpt',
    });
    const graph = makeGraph({ posts: [post] });
    await emitContentApiStubs({ content: graph, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    expect(body.posts[0].html).toBe('');
    expect(body.posts[0].plaintext).toBe('');
    expect(body.posts[0].excerpt).toBe('');
    // Metadata still appears so the consumer can render a members-only card.
    expect(body.posts[0].title).toBe('Hello, world');
    expect(body.posts[0].visibility).toBe('members');
  });

  test('emits access: "public" on every post in the dump (#764)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-access-'));
    const memberPost = makePost({
      id: 'p-member',
      slug: 'p-member',
      visibility: 'paid',
    });
    const publicPost = makePost();
    const graph = makeGraph({ posts: [publicPost, memberPost] });
    await emitContentApiStubs({ content: graph, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    for (const p of body.posts as Array<{ access: string }>) {
      expect(p.access).toBe('public');
    }
  });

  test('emits post and page UUIDs separately from ObjectId ids', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-uuid-'));
    const post = makePost({
      id: '64d3f8e1a51f2b7c9d0e1234',
      uuid: '0b8520bf-f7c5-5b5a-a24f-c97f3e53433c',
    });
    const page = makePage({
      id: '64d3f8e1a51f2b7c9d0e5678',
      uuid: 'fd0eae19-1931-5a46-83b1-0877c36b6c7b',
    });
    await emitContentApiStubs({ content: makeGraph({ posts: [post], pages: [page] }), outputDir });

    const posts = JSON.parse(readFileSync(join(outputDir, 'content', 'posts.json'), 'utf8'));
    const pages = JSON.parse(readFileSync(join(outputDir, 'content', 'pages.json'), 'utf8'));
    expect(posts.posts[0].id).toBe(post.id);
    expect(posts.posts[0].uuid).toBe(post.uuid);
    expect(posts.posts[0].uuid).not.toBe(posts.posts[0].id);
    expect(pages.pages[0].id).toBe(page.id);
    expect(pages.pages[0].uuid).toBe(page.uuid);
    expect(pages.pages[0].uuid).not.toBe(pages.pages[0].id);
  });

  test('pagination next/prev are numbers, not URLs (#760)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-pagination-'));
    const posts = Array.from({ length: 5 }, (_, i) => makePost({ id: `p-${i}`, slug: `p-${i}` }));
    await emitContentApiStubs({
      content: makeGraph({ posts }),
      outputDir,
      postsPerPage: 2,
    });

    const page2 = JSON.parse(
      readFileSync(join(outputDir, 'content', 'posts', 'page', '2.json'), 'utf8'),
    );
    expect(typeof page2.meta.pagination.next).toBe('number');
    expect(typeof page2.meta.pagination.prev).toBe('number');
    expect(page2.meta.pagination.next).toBe(3);
    expect(page2.meta.pagination.prev).toBe(1);
  });

  test('_headers includes per-resource cache-control TTLs (#755)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-cache-control-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = readFileSync(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('/content/posts/*');
    expect(body).toContain('Cache-Control: public, max-age=300');
    expect(body).toContain('/content/tags/*');
    expect(body).toContain('/content/authors/*');
    expect(body).toContain('Cache-Control: public, max-age=3600');
    // More-specific rules precede the catch-all so first-match platforms
    // apply the right TTL.
    expect(body.indexOf('/content/posts/*')).toBeLessThan(body.indexOf('/content/*\n'));
  });

  test('author.url is /author/<slug>/ rooted at site.url + base_path (#754)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-author-url-'));
    await emitContentApiStubs({ content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'authors.json'), 'utf8'));
    expect(body.authors[0].url).toBe('https://example.com/author/casper/');
  });
});
