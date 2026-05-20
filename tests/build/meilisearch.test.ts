import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMeilisearchDocuments, emitMeilisearchRecords } from '~/build/meilisearch.ts';
import { configSchema } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-meilisearch-'));
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
      title: 'Meilisearch Test',
      description: '',
      url: 'https://meili.test',
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
    ...overrides,
  };
}

describe('buildMeilisearchDocuments', () => {
  test('emits docs with sanitized ids and a content snippet', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://meili.test' },
      components: { search: { emit_meilisearch_records: true } },
    });
    const bundle = buildMeilisearchDocuments({ config, content: makeContent() });
    expect(bundle.documents.map((d) => d.id)).toEqual([
      'post_post-1',
      'page_page-1',
      'tag_tag-id',
      'author_author-id',
    ]);
    // Meilisearch ID grammar: only [a-zA-Z0-9-_].
    for (const doc of bundle.documents) {
      expect(doc.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
    const post = bundle.documents.find((d) => d.id === 'post_post-1');
    expect(post).toMatchObject({
      url: '/hello/',
      title: 'Hello world',
      type: 'post',
      tags: ['news'],
      authors: ['jane'],
    });
    expect(bundle.meta.note).toMatch(/meilisearch-js/);
  });

  test('sanitizes ids that contain forbidden characters', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { emit_meilisearch_records: true } },
    });
    const content = makeContent({
      posts: [makePost({ id: 'has spaces & colons:1', slug: 'p' })],
    });
    const bundle = buildMeilisearchDocuments({ config, content });
    const post = bundle.documents.find((d) => d.type === 'post');
    expect(post?.id).toBe('post_has_spaces___colons_1');
    expect(post?.id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  test('drops members-only and unpublished posts', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { emit_meilisearch_records: true } },
    });
    const content = makeContent({
      posts: [
        makePost({ id: 'p-public', slug: 'public', visibility: 'public' }),
        makePost({ id: 'p-members', slug: 'members', visibility: 'members' }),
        makePost({ id: 'p-draft', slug: 'draft', status: 'draft' }),
      ],
    });
    const bundle = buildMeilisearchDocuments({ config, content });
    const postIds = bundle.documents.filter((d) => d.type === 'post').map((d) => d.id);
    expect(postIds).toEqual(['post_p-public']);
  });

  test('respects include_* toggles', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: {
        search: {
          emit_meilisearch_records: true,
          include_pages: false,
          include_tags: false,
          include_authors: false,
        },
      },
    });
    const bundle = buildMeilisearchDocuments({ config, content: makeContent() });
    expect(bundle.documents.map((d) => d.type)).toEqual(['post']);
  });
});

describe('emitMeilisearchRecords', () => {
  test('writes .nectar/meilisearch-records.json when toggle is on', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { emit_meilisearch_records: true } },
    });
    const dest = await emitMeilisearchRecords({ config, content: makeContent(), outputDir });
    expect(dest).toBe(join(outputDir, '.nectar', 'meilisearch-records.json'));
    const body = JSON.parse(readFileSync(dest as string, 'utf8'));
    expect(body.documents.length).toBeGreaterThan(0);
    expect(body.documents[0].id).toBeDefined();
    expect(body.meta.site_url).toBe('https://x.test');
  });

  test('skips when toggle is off (default)', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: {} },
    });
    const dest = await emitMeilisearchRecords({ config, content: makeContent(), outputDir });
    expect(dest).toBeNull();
    expect(existsSync(join(outputDir, '.nectar', 'meilisearch-records.json'))).toBe(false);
  });

  test('skips when search is disabled', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false, emit_meilisearch_records: true } },
    });
    const dest = await emitMeilisearchRecords({ config, content: makeContent(), outputDir });
    expect(dest).toBeNull();
  });
});
