import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitContentApiShadows } from '~/build/api.ts';
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

function numberedWords(count: number, start = 1): string[] {
  return Array.from({ length: count }, (_, i) => `w${String(start + i).padStart(2, '0')}`);
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

describe('emitContentApiShadows', () => {
  test('writes Ghost Content API JSON shadows under ghost/api/content/', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const posts = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8'));
    expect(posts.posts).toHaveLength(1);
    expect(posts.posts[0].slug).toBe('hello-world');
    expect(posts.posts[0].primary_author.slug).toBe('casper');
    expect(posts.meta.pagination).toMatchObject({ page: 1, total: 1, pages: 1 });

    const pages = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/pages.json'), 'utf8'));
    expect(pages.pages[0].slug).toBe('about');

    const authors = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/authors.json'), 'utf8'),
    );
    expect(authors.authors[0].slug).toBe('casper');

    const tags = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/tags.json'), 'utf8'));
    expect(tags.tags[0].slug).toBe('news');

    const settings = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/settings.json'), 'utf8'),
    );
    expect(settings.settings.title).toBe('Site');
    expect(settings.settings.url).toBe('https://example.com');
    expect(settings.settings.locale).toBe('en');
    expect(settings.settings.direction).toBe('ltr');
    expect(settings.settings.members_enabled).toBe(false);
    expect(settings.settings.paid_members_enabled).toBe(false);
    expect(settings.settings.members_invite_only).toBe(false);
    expect(settings.settings.recommendations_enabled).toBe(false);

    const notFound = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/404.json'), 'utf8'),
    );
    expect(notFound.errors[0]).toMatchObject({
      message: 'Resource not found error, cannot read post.',
      type: 'NotFoundError',
      id: 'nectar-content-api-404',
    });
    expect(notFound.errors[0].details).toBeNull();
  });

  test('serializes generated post excerpts as Ghost-style 50 plaintext words (#771)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-api-excerpt-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-excerpt-out-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/authors'), { recursive: true });
    await mkdir(join(cwd, 'content/tags'), { recursive: true });

    await writeFile(
      join(cwd, 'content/posts/generated.md'),
      `---
title: Generated excerpt
date: 2026-01-01T00:00:00Z
unsafe_html: true
---

<p>w01 <strong>w02</strong></p>

${numberedWords(53, 3).join(' ')}
`,
      'utf8',
    );

    const config = configSchema.parse({ site: { title: 'T', url: 'https://example.com' } });
    const content = await loadContent({ cwd, config });
    await emitContentApiShadows({ config, content, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8'));
    expect(body.posts[0].custom_excerpt).toBeNull();
    expect(body.posts[0].excerpt).toBe(numberedWords(50).join(' '));
    expect(body.posts[0].excerpt).not.toContain('<strong>');
    expect(body.posts[0].excerpt.split(/\s+/)).toHaveLength(50);
  });

  test('writes per-slug single-resource files under ghost/api/content/<resource>/slug/<slug>.json', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const post = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/posts/slug/hello-world.json'), 'utf8'),
    );
    expect(post.posts).toHaveLength(1);
    expect(post.posts[0].slug).toBe('hello-world');

    const tag = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/tags/slug/news.json'), 'utf8'),
    );
    expect(tag.tags[0].slug).toBe('news');
  });

  test('serializes undefined frontmatter fields as null (Ghost API contract)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const posts = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8'));
    expect(posts.posts[0].feature_image).toBeNull();
    expect(posts.posts[0].canonical_url).toBeNull();
  });

  test('also writes directory-index variants for trailing-slash SDK requests', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const flatPosts = readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8');
    const dirPosts = readFileSync(join(outputDir, 'ghost/api/content/posts/index.json'), 'utf8');
    expect(dirPosts).toBe(flatPosts);

    const flatPages = readFileSync(join(outputDir, 'ghost/api/content/pages.json'), 'utf8');
    const dirPages = readFileSync(join(outputDir, 'ghost/api/content/pages/index.json'), 'utf8');
    expect(dirPages).toBe(flatPages);

    const flatAuthors = readFileSync(join(outputDir, 'ghost/api/content/authors.json'), 'utf8');
    const dirAuthors = readFileSync(
      join(outputDir, 'ghost/api/content/authors/index.json'),
      'utf8',
    );
    expect(dirAuthors).toBe(flatAuthors);

    const flatTags = readFileSync(join(outputDir, 'ghost/api/content/tags.json'), 'utf8');
    const dirTags = readFileSync(join(outputDir, 'ghost/api/content/tags/index.json'), 'utf8');
    expect(dirTags).toBe(flatTags);

    const flatSettings = readFileSync(join(outputDir, 'ghost/api/content/settings.json'), 'utf8');
    const dirSettings = readFileSync(
      join(outputDir, 'ghost/api/content/settings/index.json'),
      'utf8',
    );
    expect(dirSettings).toBe(flatSettings);
  });

  test('also writes per-slug directory-index variants', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const flatPost = readFileSync(
      join(outputDir, 'ghost/api/content/posts/slug/hello-world.json'),
      'utf8',
    );
    const dirPost = readFileSync(
      join(outputDir, 'ghost/api/content/posts/slug/hello-world/index.json'),
      'utf8',
    );
    expect(dirPost).toBe(flatPost);

    const flatTag = readFileSync(join(outputDir, 'ghost/api/content/tags/slug/news.json'), 'utf8');
    const dirTag = readFileSync(
      join(outputDir, 'ghost/api/content/tags/slug/news/index.json'),
      'utf8',
    );
    expect(dirTag).toBe(flatTag);
  });

  test('emits _redirects with trailing-slash rewrite rules for collections and slugs', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const redirects = readFileSync(join(outputDir, '_redirects'), 'utf8');

    expect(redirects).toContain(
      '/ghost/api/content/posts/  /ghost/api/content/posts/index.json  200',
    );
    expect(redirects).toContain(
      '/ghost/api/content/pages/  /ghost/api/content/pages/index.json  200',
    );
    expect(redirects).toContain(
      '/ghost/api/content/authors/  /ghost/api/content/authors/index.json  200',
    );
    expect(redirects).toContain(
      '/ghost/api/content/tags/  /ghost/api/content/tags/index.json  200',
    );
    expect(redirects).toContain(
      '/ghost/api/content/settings/  /ghost/api/content/settings/index.json  200',
    );
    expect(redirects).toContain(
      '/ghost/api/content/posts/slug/hello-world/  /ghost/api/content/posts/slug/hello-world/index.json  200',
    );
    expect(redirects).toContain(
      '/ghost/api/content/tags/slug/news/  /ghost/api/content/tags/slug/news/index.json  200',
    );
  });

  test('respects build.base_path when emitting _redirects rules', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-'));
    const config = configSchema.parse({
      site: { title: 'T' },
      build: { base_path: '/blog/' },
    });
    const content = makeGraph();

    await emitContentApiShadows({ config, content, outputDir });

    const redirects = readFileSync(join(outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain(
      '/blog/ghost/api/content/posts/  /blog/ghost/api/content/posts/index.json  200',
    );
    expect(redirects).toContain(
      '/blog/ghost/api/content/posts/slug/hello-world/  /blog/ghost/api/content/posts/slug/hello-world/index.json  200',
    );
  });

  test('emits per-id post and page shadows (#752)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-perid-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    await emitContentApiShadows({ config, content: makeGraph(), outputDir });

    const postById = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/posts/post-1.json'), 'utf8'),
    );
    expect(postById.posts).toHaveLength(1);
    expect(postById.posts[0].slug).toBe('hello-world');

    const pageById = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/pages/page-1.json'), 'utf8'),
    );
    expect(pageById.pages).toHaveLength(1);
  });

  test('emits paginated posts shadows (#751)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-paginated-'));
    const config = configSchema.parse({
      site: { title: 'T' },
      components: { content_api: { posts_per_page: 1 } },
    });
    const tag = makeTag();
    const author = makeAuthor();
    const posts = [
      makePost({ id: 'a', slug: 'a' }),
      makePost({ id: 'b', slug: 'b' }),
      makePost({ id: 'c', slug: 'c' }),
    ];
    const graph: ContentGraph = {
      ...makeGraph(),
      posts,
      bySlug: {
        posts: new Map(posts.map((p) => [p.slug, p])),
        pages: new Map(),
        tags: new Map([[tag.slug, tag]]),
        authors: new Map([[author.slug, author]]),
      },
      postsByTag: new Map([[tag.slug, posts]]),
      postsByAuthor: new Map([[author.slug, posts]]),
    };
    await emitContentApiShadows({ config, content: graph, outputDir });

    const page2 = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/posts/page/2.json'), 'utf8'),
    );
    expect(page2.posts).toHaveLength(1);
    expect(page2.meta.pagination).toMatchObject({ page: 2, pages: 3, next: 3, prev: 1 });
    expect(typeof page2.meta.pagination.next).toBe('number');
    expect(typeof page2.meta.pagination.prev).toBe('number');
  });

  test('emits per-tag pre-baked shards (#757)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-pertag-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    await emitContentApiShadows({ config, content: makeGraph(), outputDir });

    const tagPosts = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/posts/tag/news.json'), 'utf8'),
    );
    expect(tagPosts.posts).toHaveLength(1);
    expect(tagPosts.posts[0].slug).toBe('hello-world');
  });

  test('authors include count.posts (#749)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-author-count-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    await emitContentApiShadows({ config, content: makeGraph(), outputDir });

    const authors = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/authors.json'), 'utf8'),
    );
    expect(authors.authors[0].count).toEqual({ posts: 1 });
  });

  test('tags include public count.posts ordered by name asc (#753)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-tag-count-'));
    const config = configSchema.parse({ site: { title: 'T' } });
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
      makePost({ id: 'p-zulu', slug: 'zulu', tags: [zulu], primary_tag: zulu }),
      makePost({ id: 'p-alpha-1', slug: 'alpha-1', tags: [alpha], primary_tag: alpha }),
      makePost({ id: 'p-alpha-2', slug: 'alpha-2', tags: [alpha], primary_tag: alpha }),
      makePost({
        id: 'p-alpha-draft',
        slug: 'alpha-draft',
        status: 'draft',
        tags: [alpha],
        primary_tag: alpha,
      }),
    ];
    await emitContentApiShadows({
      config,
      content: { ...makeGraph(), tags: [zulu, internal, alpha], posts },
      outputDir,
    });

    const tags = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/tags.json'), 'utf8'));
    expect(tags.tags.map((tag: { slug: string }) => tag.slug)).toEqual(['alpha', 'zulu']);
    expect(tags.tags.map((tag: { count: { posts: number } }) => tag.count.posts)).toEqual([2, 1]);
    expect(tags.meta.pagination.total).toBe(2);
  });

  test('tag responses emit absolute tag.url with base_path and custom taxonomy path (#773)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-tag-url-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      build: { base_path: '/blog/' },
    });
    const news = makeTag({
      id: 'tag-news',
      slug: 'news',
      name: 'News',
      url: '/category/news/',
      count: { posts: 0 },
    });
    await emitContentApiShadows({
      config,
      content: {
        ...makeGraph(),
        site: { ...makeGraph().site, url: 'https://example.com' },
        tags: [news],
        posts: [makePost({ tags: [news], primary_tag: news })],
      },
      outputDir,
    });

    const collection = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/tags.json'), 'utf8'),
    );
    expect(collection.tags[0].url).toBe('https://example.com/blog/category/news/');

    const single = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/tags/slug/news.json'), 'utf8'),
    );
    expect(single.tags[0].url).toBe('https://example.com/blog/category/news/');
  });

  test('tag slug shadows are public-only and carry count.posts (#753)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-tag-slug-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const news = makeTag({ id: 'tag-news', slug: 'news', name: 'News', count: { posts: 0 } });
    const internal = makeTag({
      id: 'tag-internal',
      slug: 'hash-internal',
      name: '#internal',
      visibility: 'internal',
      count: { posts: 0 },
    });
    await emitContentApiShadows({
      config,
      content: {
        ...makeGraph(),
        tags: [internal, news],
        posts: [makePost({ tags: [news, internal], primary_tag: news })],
      },
      outputDir,
    });

    const tag = JSON.parse(
      readFileSync(join(outputDir, 'ghost/api/content/tags/slug/news.json'), 'utf8'),
    );
    expect(tag.tags[0]).toMatchObject({ slug: 'news', visibility: 'public' });
    expect(tag.tags[0].count).toEqual({ posts: 1 });
    expect(() =>
      readFileSync(join(outputDir, 'ghost/api/content/tags/slug/hash-internal.json'), 'utf8'),
    ).toThrow();
    const redirects = readFileSync(join(outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain(
      '/ghost/api/content/tags/slug/news/  /ghost/api/content/tags/slug/news/index.json  200',
    );
    expect(redirects).not.toContain('/ghost/api/content/tags/slug/hash-internal/');
  });

  test('absolute_urls rewrites html to absolute URLs (#743)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-abs-'));
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com' },
      components: { content_api: { absolute_urls: true } },
    });
    const tag = makeTag();
    const author = makeAuthor();
    const post = makePost({ html: '<a href="/foo/">x</a>' });
    const graph: ContentGraph = {
      ...makeGraph(),
      posts: [post],
      tags: [tag],
      authors: [author],
      bySlug: {
        posts: new Map([[post.slug, post]]),
        pages: new Map(),
        tags: new Map([[tag.slug, tag]]),
        authors: new Map([[author.slug, author]]),
      },
      postsByTag: new Map([[tag.slug, [post]]]),
      postsByAuthor: new Map([[author.slug, [post]]]),
    };
    await emitContentApiShadows({ config, content: graph, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8'));
    expect(body.posts[0].html).toContain('href="https://example.com/foo/"');
  });

  test('emits access: "public" on every post (#764)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-access-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    await emitContentApiShadows({ config, content: makeGraph(), outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8'));
    expect(body.posts[0].access).toBe('public');
  });

  test('strips members-only body content from non-public posts (#759)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-api-strip-'));
    const config = configSchema.parse({ site: { title: 'T' } });
    const tag = makeTag();
    const author = makeAuthor();
    const post = makePost({
      visibility: 'members',
      html: '<p>secret</p>',
      plaintext: 'secret',
      excerpt: 'secret',
    });
    const graph: ContentGraph = {
      ...makeGraph(),
      posts: [post],
      tags: [tag],
      authors: [author],
      bySlug: {
        posts: new Map([[post.slug, post]]),
        pages: new Map(),
        tags: new Map([[tag.slug, tag]]),
        authors: new Map([[author.slug, author]]),
      },
      postsByTag: new Map([[tag.slug, [post]]]),
      postsByAuthor: new Map([[author.slug, [post]]]),
    };
    await emitContentApiShadows({ config, content: graph, outputDir });

    const body = JSON.parse(readFileSync(join(outputDir, 'ghost/api/content/posts.json'), 'utf8'));
    expect(body.posts[0].html).toBe('');
    expect(body.posts[0].plaintext).toBe('');
    expect(body.posts[0].excerpt).toBe('');
    expect(body.posts[0].visibility).toBe('members');
  });
});
