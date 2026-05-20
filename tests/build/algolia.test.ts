import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAlgoliaRecords, emitAlgoliaRecords, emitDocSearchCss } from '~/build/algolia.ts';
import { configSchema } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-algolia-'));
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-id',
    slug: 'news',
    name: 'News',
    description: '',
    feature_image: undefined,
    visibility: 'public',
    meta_title: undefined,
    meta_description: undefined,
    url: '/tag/news/',
    count: { posts: 1 },
    ...overrides,
  };
}

function makeAuthor(overrides: Partial<Author> = {}): Author {
  return {
    id: 'author-id',
    slug: 'jane',
    name: 'Jane Doe',
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
    url: '/author/jane/',
    ...overrides,
  };
}

function makePost(overrides: Partial<Post> = {}): Post {
  const tag = makeTag();
  const author = makeAuthor();
  return {
    id: 'post-1',
    slug: 'hello',
    title: 'Hello world',
    html: '<p>Hello handlebars world</p>',
    plaintext: 'Hello handlebars world',
    excerpt: 'Hello handlebars world',
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
    word_count: 3,
    visibility: 'public',
    status: 'published',
    tags: [tag],
    primary_tag: tag,
    authors: [author],
    primary_author: author,
    url: '/hello/',
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
    feed_html: '<p>Hello handlebars world</p>',
    feed_excerpt: 'Hello handlebars world',
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    slug: 'about',
    title: 'About us',
    html: '<p>About the project</p>',
    plaintext: 'About the project',
    excerpt: 'About the project',
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
    word_count: 3,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: '/about/',
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
    ...overrides,
  };
}

function makeContent(overrides: Partial<ContentGraph> = {}): ContentGraph {
  const post = makePost();
  const page = makePage();
  const tag = makeTag();
  const author = makeAuthor();
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
      title: 'Algolia Test',
      description: '',
      url: 'https://algolia.test',
      locale: 'en',
      direction: 'ltr',
      timezone: 'UTC',
      cover_image: undefined,
      logo: undefined,
      logo_width: undefined,
      logo_height: undefined,
      icon: undefined,
      accent_color: '#ff00ff',
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
    ...overrides,
  };
}

describe('buildAlgoliaRecords', () => {
  test('emits records for posts, pages, tags, authors with objectID', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://algolia.test', accent_color: '#ff00ff' },
      components: { search: { emit_algolia_records: true } },
    });
    const bundle = buildAlgoliaRecords({ config, content: makeContent() });
    expect(bundle.records.map((r) => r.objectID)).toEqual([
      'post:post-1',
      'page:page-1',
      'tag:tag-id',
      'author:author-id',
    ]);
    const post = bundle.records.find((r) => r.objectID === 'post:post-1');
    expect(post).toMatchObject({
      url: '/hello/',
      title: 'Hello world',
      type: 'post',
      tags: ['news'],
      authors: ['jane'],
      published_at: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.meta.site_url).toBe('https://algolia.test');
    expect(bundle.meta.note).toMatch(/algoliasearch/);
  });

  test('drops members-only and unpublished posts', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { emit_algolia_records: true } },
    });
    const content = makeContent({
      posts: [
        makePost({ id: 'p-public', slug: 'public', visibility: 'public' }),
        makePost({ id: 'p-members', slug: 'members', visibility: 'members' }),
        makePost({ id: 'p-draft', slug: 'draft', status: 'draft' }),
      ],
    });
    const bundle = buildAlgoliaRecords({ config, content });
    const postIds = bundle.records.filter((r) => r.type === 'post').map((r) => r.objectID);
    expect(postIds).toEqual(['post:p-public']);
  });

  test('respects include_* toggles', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: {
        search: {
          emit_algolia_records: true,
          include_pages: false,
          include_tags: false,
          include_authors: false,
        },
      },
    });
    const bundle = buildAlgoliaRecords({ config, content: makeContent() });
    expect(bundle.records.map((r) => r.type)).toEqual(['post']);
  });
});

describe('emitAlgoliaRecords', () => {
  test('writes .nectar/algolia-records.json when toggle is on', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { emit_algolia_records: true } },
    });
    const dest = await emitAlgoliaRecords({ config, content: makeContent(), outputDir });
    expect(dest).toBe(join(outputDir, '.nectar', 'algolia-records.json'));
    const body = JSON.parse(readFileSync(dest as string, 'utf8'));
    expect(body.records.length).toBeGreaterThan(0);
    expect(body.records[0].objectID).toBeDefined();
    expect(body.meta.site_url).toBe('https://x.test');
  });

  test('skips when toggle is off (default)', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: {} },
    });
    const dest = await emitAlgoliaRecords({ config, content: makeContent(), outputDir });
    expect(dest).toBeNull();
    expect(existsSync(join(outputDir, '.nectar', 'algolia-records.json'))).toBe(false);
  });

  test('skips when search is disabled', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false, emit_algolia_records: true } },
    });
    const dest = await emitAlgoliaRecords({ config, content: makeContent(), outputDir });
    expect(dest).toBeNull();
  });
});

describe('emitDocSearchCss', () => {
  test('writes search/algolia-docsearch.css with accent color from config', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test', accent_color: '#abcdef' },
      components: { search: { emit_algolia_records: true } },
    });
    const dest = await emitDocSearchCss({ config, outputDir });
    expect(dest).toBe(join(outputDir, 'search', 'algolia-docsearch.css'));
    const body = readFileSync(dest as string, 'utf8');
    expect(body).toContain('--docsearch-primary-color: #abcdef');
    expect(body).toContain('.DocSearch-Hit');
  });

  test('skips when toggle is off', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: {} },
    });
    const dest = await emitDocSearchCss({ config, outputDir });
    expect(dest).toBeNull();
  });
});
