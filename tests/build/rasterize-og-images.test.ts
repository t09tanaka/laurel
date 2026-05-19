import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rasterizeOgImages } from '~/build/rasterize-og-images.ts';
import { configSchema } from '~/config/schema.ts';
import type { ContentGraph, Page, Post, SiteData } from '~/content/model.ts';

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FFA500"/>
  <rect x="100" y="100" width="400" height="200" fill="#222"/>
</svg>`;

const site: SiteData = {
  title: 'Test',
  description: '',
  url: 'https://example.com',
  locale: 'en',
  lang: 'en',
  direction: 'ltr',
  timezone: 'UTC',
  accent_color: '#000',
  navigation: [],
  secondary_navigation: [],
  cover_image: undefined,
  logo: undefined,
  logo_width: undefined,
  logo_height: undefined,
  icon: undefined,
  twitter: undefined,
  facebook: undefined,
  members_enabled: false,
  paid_members_enabled: false,
  members_invite_only: false,
  recommendations_enabled: false,
};

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    slug: 'hello',
    title: 'Hello',
    html: '',
    plaintext: '',
    excerpt: '',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    featured: false,
    page: false,
    published_at: '2026-01-01',
    updated_at: '2026-01-01',
    created_at: '2026-01-01',
    reading_time: 1,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: 'https://example.com/hello/',
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
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'pg1',
    slug: 'about',
    title: 'About',
    html: '',
    plaintext: '',
    excerpt: '',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    page: true,
    published_at: '2026-01-01',
    updated_at: '2026-01-01',
    created_at: '2026-01-01',
    reading_time: 1,
    word_count: 0,
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
    ...overrides,
  };
}

function makeGraph(posts: Post[], pages: Page[] = []): ContentGraph {
  return {
    posts,
    pages,
    tags: [],
    authors: [],
    bySlug: {
      posts: new Map(posts.map((p) => [p.slug, p])),
      pages: new Map(pages.map((p) => [p.slug, p])),
      tags: new Map(),
      authors: new Map(),
    },
    postsByTag: new Map(),
    postsByAuthor: new Map(),
    site,
  };
}

async function makeAssetsFixture(svgFiles: Record<string, string>): Promise<{
  cwd: string;
  outputDir: string;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'nectar-og-raster-'));
  await mkdir(join(cwd, 'content/images'), { recursive: true });
  const outputDir = join(cwd, 'dist');
  await mkdir(outputDir, { recursive: true });
  for (const [name, body] of Object.entries(svgFiles)) {
    const target = join(cwd, 'content/images', name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, body, 'utf8');
  }
  return { cwd, outputDir };
}

describe('rasterizeOgImages', () => {
  test('rasterises SVG feature images to PNG and points og_image at them', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({ 'cover.svg': SAMPLE_SVG });
    const config = configSchema.parse({});
    const post = makePost({ feature_image: '/content/images/cover.svg' });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(post.og_image).toBe('/content/images/cover.og.png');
    expect(existsSync(join(outputDir, 'content/images/cover.og.png'))).toBe(true);
    const buf = readFileSync(join(outputDir, 'content/images/cover.og.png'));
    // PNG signature
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  test('skips posts that already have an explicit og_image override', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({ 'cover.svg': SAMPLE_SVG });
    const config = configSchema.parse({});
    const post = makePost({
      feature_image: '/content/images/cover.svg',
      og_image: 'https://cdn.example.com/explicit.jpg',
    });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBe('https://cdn.example.com/explicit.jpg');
    expect(existsSync(join(outputDir, 'content/images/cover.og.png'))).toBe(false);
  });

  test('skips non-SVG feature images', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({});
    const config = configSchema.parse({});
    const post = makePost({ feature_image: '/content/images/photo.jpg' });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
  });

  test('skips remote SVG URLs (out of sandbox)', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({});
    const config = configSchema.parse({});
    const post = makePost({ feature_image: 'https://cdn.example.com/cover.svg' });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
  });

  test('rasterises pages as well as posts', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({ 'about.svg': SAMPLE_SVG });
    const config = configSchema.parse({});
    const page = makePage({ feature_image: '/content/images/about.svg' });
    const content = makeGraph([], [page]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(page.og_image).toBe('/content/images/about.og.png');
    expect(existsSync(join(outputDir, 'content/images/about.og.png'))).toBe(true);
  });

  test('rasterises each unique SVG only once even when shared across posts', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({ 'shared.svg': SAMPLE_SVG });
    const config = configSchema.parse({});
    const a = makePost({ slug: 'a', feature_image: '/content/images/shared.svg' });
    const b = makePost({ slug: 'b', feature_image: '/content/images/shared.svg' });
    const content = makeGraph([a, b]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(a.og_image).toBe('/content/images/shared.og.png');
    expect(b.og_image).toBe('/content/images/shared.og.png');
  });

  test('is a no-op when components.opengraph.rasterize_svg is disabled', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({ 'cover.svg': SAMPLE_SVG });
    const config = configSchema.parse({
      components: { opengraph: { rasterize_svg: false } },
    });
    const post = makePost({ feature_image: '/content/images/cover.svg' });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
    expect(existsSync(join(outputDir, 'content/images/cover.og.png'))).toBe(false);
  });

  test('is a no-op when components.opengraph.enabled is false', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({ 'cover.svg': SAMPLE_SVG });
    const config = configSchema.parse({
      components: { opengraph: { enabled: false } },
    });
    const post = makePost({ feature_image: '/content/images/cover.svg' });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
  });

  test('refuses to traverse outside the assets root', async () => {
    const { cwd, outputDir } = await makeAssetsFixture({});
    const config = configSchema.parse({});
    const post = makePost({ feature_image: '/content/images/../../etc/cover.svg' });
    const content = makeGraph([post]);

    const count = await rasterizeOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
  });
});
