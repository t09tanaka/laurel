import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateOgImages } from '~/build/generate-og-images.ts';
import { configSchema } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';

const TEMPLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FFA500"/>
  <text x="60" y="120" font-family="sans-serif" font-size="64" fill="#000">{{title}}</text>
  <text x="60" y="200" font-family="sans-serif" font-size="32" fill="#222">{{author}}</text>
  <text x="60" y="260" font-family="sans-serif" font-size="24" fill="#222">{{site_title}}</text>
</svg>`;

const site: SiteData = {
  title: 'Test Site',
  description: '',
  url: 'https://example.com',
  locale: 'en',
  lang: 'en',
  direction: 'ltr',
  timezone: 'UTC',
  cover_image: undefined,
  logo: undefined,
  logo_width: undefined,
  logo_height: undefined,
  icon: undefined,
  accent_color: '#000',
  navigation: [],
  secondary_navigation: [],
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
};

function makeAuthor(overrides: Partial<Author> = {}): Author {
  return {
    id: 'a1',
    slug: 'alice',
    name: 'Alice',
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
    url: 'https://example.com/author/alice/',
    count: { posts: 1 },
    ...overrides,
  };
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 't1',
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
    ...overrides,
  };
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    slug: 'hello',
    title: 'Hello World',
    html: '',
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
    tiers: [],
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

async function makeFixture(opts: { template?: string } = {}): Promise<{
  cwd: string;
  outputDir: string;
  templatePath: string;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'nectar-og-gen-'));
  const outputDir = join(cwd, 'dist');
  await mkdir(outputDir, { recursive: true });
  const templateRel = 'og-template.svg';
  const templatePath = join(cwd, templateRel);
  await writeFile(templatePath, opts.template ?? TEMPLATE_SVG, 'utf8');
  return { cwd, outputDir, templatePath };
}

describe('generateOgImages', () => {
  test('renders a per-post PNG and points og_image at it', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const post = makePost({ primary_author: makeAuthor() });
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(post.og_image).toBe('/content/images/og/hello.png');
    const outputPath = join(outputDir, 'content/images/og/hello.png');
    expect(existsSync(outputPath)).toBe(true);
    const buf = readFileSync(outputPath);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });

  test('skips posts with any pre-existing image (og_image, twitter_image, feature_image)', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const withOg = makePost({ slug: 'a', og_image: 'https://cdn.example.com/a.png' });
    const withTwitter = makePost({
      slug: 'b',
      twitter_image: 'https://cdn.example.com/b.png',
    });
    const withFeature = makePost({ slug: 'c', feature_image: '/content/images/c.jpg' });
    const content = makeGraph([withOg, withTwitter, withFeature]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(withOg.og_image).toBe('https://cdn.example.com/a.png');
    expect(withTwitter.og_image).toBeUndefined();
    expect(withFeature.og_image).toBeUndefined();
  });

  test('renders pages as well as posts', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const page = makePage();
    const content = makeGraph([], [page]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(page.og_image).toBe('/content/images/og/about.png');
    expect(existsSync(join(outputDir, 'content/images/og/about.png'))).toBe(true);
  });

  test('is a no-op when components.og_images.enabled is false (default)', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { template: 'og-template.svg' } },
    });
    const post = makePost();
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
  });

  test('is a no-op when no template is configured', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { enabled: true } },
    });
    const post = makePost();
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
  });

  test('skips and warns when the template file is missing', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'does-not-exist.svg' } },
    });
    const post = makePost();
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(0);
    expect(post.og_image).toBeUndefined();
    expect(existsSync(join(outputDir, 'content/images/og/hello.png'))).toBe(false);
  });

  test('substitutes title / author / site_title / primary_tag / excerpt placeholders', async () => {
    const template = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
  <text id="t">{{title}}</text>
  <text id="a">{{author}}</text>
  <text id="s">{{site_title}}</text>
  <text id="tag">{{primary_tag}}</text>
  <text id="ex">{{excerpt}}</text>
</svg>`;
    const { cwd, outputDir } = await makeFixture({ template });
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const post = makePost({
      title: 'Hello & Goodbye',
      primary_author: makeAuthor({ name: 'Alice' }),
      primary_tag: makeTag({ name: 'News' }),
      excerpt: 'A summary',
    });
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/og/hello.png'))).toBe(true);
  });

  test('escapes XML-unsafe characters in substituted values to keep the SVG well-formed', async () => {
    const template = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
  <text>{{title}}</text>
</svg>`;
    const { cwd, outputDir } = await makeFixture({ template });
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const post = makePost({ title: '<script>alert("x")</script> & more' });
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/og/hello.png'))).toBe(true);
  });

  test('renders unknown placeholders as empty strings', async () => {
    const template = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
  <text>{{title}}|{{unknown_field}}|done</text>
</svg>`;
    const { cwd, outputDir } = await makeFixture({ template });
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const post = makePost();
    const content = makeGraph([post]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(1);
  });

  test('renders one PNG per post even when titles collide on different slugs', async () => {
    const { cwd, outputDir } = await makeFixture();
    const config = configSchema.parse({
      components: { og_images: { enabled: true, template: 'og-template.svg' } },
    });
    const a = makePost({ slug: 'a', title: 'Same' });
    const b = makePost({ slug: 'b', title: 'Same' });
    const content = makeGraph([a, b]);

    const count = await generateOgImages({ cwd, config, content, outputDir });

    expect(count).toBe(2);
    expect(a.og_image).toBe('/content/images/og/a.png');
    expect(b.og_image).toBe('/content/images/og/b.png');
    expect(existsSync(join(outputDir, 'content/images/og/a.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/og/b.png'))).toBe(true);
  });
});
