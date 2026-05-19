import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitContentApiShadows } from '~/build/api.ts';
import { configSchema } from '~/config/schema.ts';
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
      timezone: 'UTC',
      cover_image: undefined,
      logo: undefined,
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
});
