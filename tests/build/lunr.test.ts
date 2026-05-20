import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetLunrCacheForTests,
  buildLunrIndex,
  emitLunrIndex,
  emitLunrWidget,
  searchEngineEmitsLunr,
} from '~/build/lunr.ts';
import { configSchema } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-lunr-'));
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-id',
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
    count: { posts: 1 },
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
      title: 'Lunr Test',
      description: '',
      url: 'https://lunr.test',
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
    ...overrides,
  };
}

describe('searchEngineEmitsLunr', () => {
  test('matches lunr engines', () => {
    expect(searchEngineEmitsLunr('lunr')).toBe(true);
    expect(searchEngineEmitsLunr('json+lunr')).toBe(true);
    expect(searchEngineEmitsLunr('json')).toBe(false);
    expect(searchEngineEmitsLunr('pagefind')).toBe(false);
    expect(searchEngineEmitsLunr('json+pagefind')).toBe(false);
  });
});

describe('buildLunrIndex', () => {
  test('builds a lunr index over posts, pages, tags, authors with docs', async () => {
    __resetLunrCacheForTests();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://lunr.test' },
      components: { search: { engine: 'lunr' } },
    });
    const content = makeContent();
    const bundle = await buildLunrIndex({ config, content });
    expect(bundle).not.toBeNull();
    if (!bundle) return;
    expect(bundle.docs.map((d) => d.id)).toEqual([
      'post:post-1',
      'page:page-1',
      'tag:tag-id',
      'author:author-id',
    ]);
    const post = bundle.docs.find((d) => d.id === 'post:post-1');
    expect(post).toMatchObject({
      url: '/hello/',
      title: 'Hello world',
      tags: ['news'],
      authors: ['jane'],
      kind: 'post',
    });
    expect(bundle.meta.site_url).toBe('https://lunr.test');
    expect(bundle.meta.note).toMatch(/Lunr/);
    expect(bundle.index).toBeDefined();
  });

  test('drops members-only and unpublished posts', async () => {
    __resetLunrCacheForTests();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'lunr' } },
    });
    const content = makeContent({
      posts: [
        makePost({ id: 'p-public', slug: 'public', visibility: 'public' }),
        makePost({ id: 'p-members', slug: 'members', visibility: 'members' }),
        makePost({ id: 'p-draft', slug: 'draft', status: 'draft' }),
      ],
    });
    const bundle = await buildLunrIndex({ config, content });
    expect(bundle).not.toBeNull();
    const postIds = (bundle?.docs ?? []).filter((d) => d.kind === 'post').map((d) => d.id);
    expect(postIds).toEqual(['post:p-public']);
  });

  test('respects include_* toggles', async () => {
    __resetLunrCacheForTests();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: {
        search: {
          engine: 'lunr',
          include_pages: false,
          include_tags: false,
          include_authors: false,
        },
      },
    });
    const content = makeContent();
    const bundle = await buildLunrIndex({ config, content });
    const kinds = (bundle?.docs ?? []).map((d) => d.kind);
    expect(kinds).toEqual(['post']);
  });
});

describe('emitLunrIndex', () => {
  test('writes search-index.json at the output root when engine is lunr', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'lunr' } },
    });
    const content = makeContent();
    const dest = await emitLunrIndex({ config, content, outputDir });
    expect(dest).toBe(join(outputDir, 'search-index.json'));
    const body = JSON.parse(readFileSync(join(outputDir, 'search-index.json'), 'utf8'));
    expect(body.docs).toBeDefined();
    expect(body.index).toBeDefined();
    expect(body.meta.site_url).toBe('https://x.test');
  });

  test('writes search-index.json when engine is json+lunr', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'json+lunr' } },
    });
    const content = makeContent();
    const dest = await emitLunrIndex({ config, content, outputDir });
    expect(dest).toBe(join(outputDir, 'search-index.json'));
    expect(existsSync(join(outputDir, 'search-index.json'))).toBe(true);
  });

  test('skips emission when engine is json only', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'json' } },
    });
    const content = makeContent();
    const dest = await emitLunrIndex({ config, content, outputDir });
    expect(dest).toBeNull();
    expect(existsSync(join(outputDir, 'search-index.json'))).toBe(false);
  });

  test('skips emission when search is disabled', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false, engine: 'lunr' } },
    });
    const content = makeContent();
    const dest = await emitLunrIndex({ config, content, outputDir });
    expect(dest).toBeNull();
  });
});

describe('emitLunrWidget', () => {
  test('writes search/widget.js (and lunr.min.js when lunr is installed)', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'lunr' } },
    });
    const result = await emitLunrWidget({ config, outputDir });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.widget).toBe(join(outputDir, 'search', 'widget.js'));
    const widgetBody = readFileSync(result.widget, 'utf8');
    expect(widgetBody).toContain('data-nectar-search');
    expect(widgetBody).toContain('lunr.Index.load');
    // The lunr optional dep is present in this repo, so the runtime bundle
    // should ship alongside the widget. If lunr is ever removed from
    // optionalDependencies the assertion will need to be loosened.
    expect(result.runtime).toBe(join(outputDir, 'search', 'lunr.min.js'));
    const runtimeBody = readFileSync(result.runtime as string, 'utf8');
    expect(runtimeBody.length).toBeGreaterThan(1000);
    expect(runtimeBody).toContain('lunr');
  });

  test('skips emission when engine does not include lunr', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'pagefind' } },
    });
    const result = await emitLunrWidget({ config, outputDir });
    expect(result).toBeNull();
    expect(existsSync(join(outputDir, 'search', 'widget.js'))).toBe(false);
  });

  test('skips emission when search is disabled', async () => {
    __resetLunrCacheForTests();
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false, engine: 'lunr' } },
    });
    const result = await emitLunrWidget({ config, outputDir });
    expect(result).toBeNull();
  });
});
