import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSearchIndex,
  emitSearchJson,
  emitSearchUiCss,
  runPagefind,
  truncateExcerpt,
} from '~/build/search.ts';
import { configSchema } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-search-'));
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
    html: '<p>Hello world</p>',
    plaintext: 'Hello world',
    excerpt: 'Hello world',
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
    word_count: 2,
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
    feed_html: '<p>Hello world</p>',
    feed_excerpt: 'Hello world',
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    slug: 'about',
    title: 'About',
    html: '<p>About us</p>',
    plaintext: 'About us',
    excerpt: 'About us',
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
    word_count: 2,
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
      title: 'Search Test',
      description: '',
      url: 'https://search.test',
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

describe('truncateExcerpt', () => {
  test('keeps short text untouched', () => {
    expect(truncateExcerpt('Hello world', 30)).toBe('Hello world');
  });

  test('truncates at word boundary and appends ellipsis', () => {
    const text = 'one two three four five';
    expect(truncateExcerpt(text, 3)).toBe('one two three…');
  });

  test('collapses whitespace', () => {
    expect(truncateExcerpt('  one\n  two  ', 30)).toBe('one\n  two');
  });

  test('returns empty string when words is 0', () => {
    expect(truncateExcerpt('one two', 0)).toBe('');
  });

  test('returns empty string for blank input', () => {
    expect(truncateExcerpt('   \n  ', 5)).toBe('');
  });
});

describe('buildSearchIndex', () => {
  test('emits posts, pages, tags, authors with expected fields', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://search.test' },
    });
    const content = makeContent();
    const index = buildSearchIndex({ config, content });
    expect(index.posts).toHaveLength(1);
    expect(index.posts[0]).toMatchObject({
      id: 'post-1',
      slug: 'hello',
      title: 'Hello world',
      url: '/hello/',
      tags: ['news'],
      authors: ['jane'],
    });
    expect(index.pages).toHaveLength(1);
    expect(index.pages[0]).toMatchObject({ slug: 'about', url: '/about/' });
    expect(index.tags).toHaveLength(1);
    expect(index.tags[0]).toMatchObject({ slug: 'news', name: 'News' });
    expect(index.authors).toHaveLength(1);
    expect(index.authors[0]).toMatchObject({ slug: 'jane', name: 'Jane Doe' });
    expect(index.meta.site_url).toBe('https://search.test');
    expect(index.meta.note).toMatch(/NOT Ghost/);
  });

  test('prefers custom_excerpt over auto excerpt', () => {
    const config = configSchema.parse({ site: { title: 'S', url: 'https://x.test' } });
    const content = makeContent({
      posts: [makePost({ excerpt: 'AUTO', custom_excerpt: 'CUSTOM' })],
    });
    const index = buildSearchIndex({ config, content });
    expect(index.posts[0].excerpt).toBe('CUSTOM');
  });

  test('drops members-only and unpublished posts', () => {
    const config = configSchema.parse({ site: { title: 'S', url: 'https://x.test' } });
    const content = makeContent({
      posts: [
        makePost({ id: 'p-public', slug: 'public', visibility: 'public' }),
        makePost({ id: 'p-members', slug: 'members', visibility: 'members' }),
        makePost({ id: 'p-paid', slug: 'paid', visibility: 'paid' }),
        makePost({ id: 'p-draft', slug: 'draft', status: 'draft' }),
      ],
    });
    const index = buildSearchIndex({ config, content });
    expect(index.posts.map((p) => p.slug)).toEqual(['public']);
  });

  test('drops internal tags from the index', () => {
    const config = configSchema.parse({ site: { title: 'S', url: 'https://x.test' } });
    const content = makeContent({
      tags: [
        makeTag({ slug: 'news', visibility: 'public' }),
        makeTag({ id: 'internal-id', slug: 'hash-internal', visibility: 'internal' }),
      ],
    });
    const index = buildSearchIndex({ config, content });
    expect(index.tags.map((t) => t.slug)).toEqual(['news']);
  });

  test('respects include_pages / include_tags / include_authors toggles', () => {
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: {
        search: { include_pages: false, include_tags: false, include_authors: false },
      },
    });
    const content = makeContent();
    const index = buildSearchIndex({ config, content });
    expect(index.pages).toEqual([]);
    expect(index.tags).toEqual([]);
    expect(index.authors).toEqual([]);
    expect(index.posts).toHaveLength(1);
  });

  test('truncates long excerpts to excerpt_words', () => {
    const longExcerpt = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { excerpt_words: 5 } },
    });
    const content = makeContent({ posts: [makePost({ excerpt: longExcerpt })] });
    const index = buildSearchIndex({ config, content });
    expect(index.posts[0].excerpt).toBe('word0 word1 word2 word3 word4…');
  });
});

describe('emitSearchJson', () => {
  test('writes content/search.json when engine is json', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
    });
    const content = makeContent();
    const dest = await emitSearchJson({ config, content, outputDir });
    expect(dest).toBe(join(outputDir, 'content', 'search.json'));
    const body = JSON.parse(readFileSync(join(outputDir, 'content', 'search.json'), 'utf8'));
    expect(body.posts[0].slug).toBe('hello');
    expect(body.meta).toBeDefined();
  });

  test('writes content/search.json when engine is json+pagefind', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'json+pagefind' } },
    });
    const content = makeContent();
    const dest = await emitSearchJson({ config, content, outputDir });
    expect(dest).toBe(join(outputDir, 'content', 'search.json'));
    expect(existsSync(join(outputDir, 'content', 'search.json'))).toBe(true);
  });

  test('skips emission when engine is pagefind only', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'pagefind' } },
    });
    const content = makeContent();
    const dest = await emitSearchJson({ config, content, outputDir });
    expect(dest).toBeNull();
    expect(existsSync(join(outputDir, 'content', 'search.json'))).toBe(false);
  });

  test('skips emission when disabled', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false } },
    });
    const content = makeContent();
    const dest = await emitSearchJson({ config, content, outputDir });
    expect(dest).toBeNull();
    expect(existsSync(join(outputDir, 'content', 'search.json'))).toBe(false);
  });
});

// Issue #1135: a default `{{> search}}` partial is useless without matching
// CSS, so the search component ships a starter stylesheet that themes can
// link from `search/search.css`. Emission is gated on the search component
// being enabled — engine choice is irrelevant because every engine variant
// reuses the same default markup.
describe('emitSearchUiCss', () => {
  test('writes search/search.css with the configured accent color', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test', accent_color: '#abc123' },
    });
    const dest = await emitSearchUiCss({ config, outputDir });
    expect(dest).toBe(join(outputDir, 'search', 'search.css'));
    const css = readFileSync(join(outputDir, 'search', 'search.css'), 'utf8');
    expect(css).toContain('--nectar-search-accent: #abc123;');
    expect(css).toContain('.nectar-search__input');
    expect(css).toContain('.nectar-search__results');
  });

  test('emits even when the engine is pagefind-only (markup is engine-agnostic)', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'pagefind' } },
    });
    const dest = await emitSearchUiCss({ config, outputDir });
    expect(dest).toBe(join(outputDir, 'search', 'search.css'));
    expect(existsSync(join(outputDir, 'search', 'search.css'))).toBe(true);
  });

  test('skips emission when the search component is disabled', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false } },
    });
    const dest = await emitSearchUiCss({ config, outputDir });
    expect(dest).toBeNull();
    expect(existsSync(join(outputDir, 'search', 'search.css'))).toBe(false);
  });
});

describe('runPagefind', () => {
  test('returns false and logs a warning when binary is missing', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: {
        search: {
          engine: 'pagefind',
          pagefind_bin: '/nonexistent/path/to/pagefind-binary-xyz',
        },
      },
    });
    const ok = await runPagefind({ config, outputDir });
    expect(ok).toBe(false);
  });

  test('returns false when engine does not include pagefind', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { engine: 'json' } },
    });
    const ok = await runPagefind({ config, outputDir });
    expect(ok).toBe(false);
  });

  test('returns false when search is disabled', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'S', url: 'https://x.test' },
      components: { search: { enabled: false, engine: 'pagefind' } },
    });
    const ok = await runPagefind({ config, outputDir });
    expect(ok).toBe(false);
  });
});
