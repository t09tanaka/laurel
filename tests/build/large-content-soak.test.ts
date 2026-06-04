import { describe, expect, test } from 'bun:test';
import { planRoutes } from '~/build/routes.ts';
import type { LaurelConfig } from '~/config/schema.ts';
import type { ContentGraph, Post, SiteData } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';

function makeConfig(): LaurelConfig {
  return {
    site: { title: 'Large', url: 'https://example.com', locale: 'en', timezone: 'UTC' },
    theme: { dir: 'themes', name: 'source', custom: {} },
    content: { dir: 'content' },
    build: { output_dir: 'dist', posts_per_page: 25, base_path: '/' },
    components: { tags: { min_posts_per_tag: 1 }, authors: { min_posts_per_author: 1 } },
  } as unknown as LaurelConfig;
}

function makeTheme(): ThemeBundle {
  return {
    name: 'source',
    rootDir: '/themes/source',
    templates: { index: '{{!index}}', post: '{{!post}}' },
    partials: {},
    pkg: {
      name: 'source',
      version: '1.0.0',
      posts_per_page: 25,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    },
    locales: {},
    assets: new Map(),
  };
}

function makeSite(): SiteData {
  return {
    title: 'Large',
    description: '',
    url: 'https://example.com',
    locale: 'en',
    direction: 'ltr',
    timezone: 'UTC',
    accent_color: '#000',
    navigation: [],
    secondary_navigation: [],
    lang: 'en',
    members_enabled: false,
    paid_members_enabled: false,
    members_invite_only: false,
    comments_enabled: false,
    comments_access: 'all',
    recommendations_enabled: false,
  } as unknown as SiteData;
}

function makePost(i: number): Post {
  const slug = `post-${i}`;
  return {
    id: slug,
    slug,
    title: `Post ${i}`,
    html: '<p>Body</p>',
    excerpt: 'Body',
    featured: false,
    page: false,
    published_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    updated_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    created_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    reading_time: 1,
    word_count: 1,
    visibility: 'public',
    status: 'published',
    tags: [],
    authors: [],
    url: `/${slug}/`,
    comments: true,
    feed_html: '',
    feed_excerpt: '',
  } as unknown as Post;
}

describe('large content route-planning soak', () => {
  test('plans 5000 posts within a bounded budget', () => {
    const posts = Array.from({ length: 5000 }, (_, i) => makePost(i + 1));
    const graph = {
      posts,
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(posts.map((post) => [post.slug, post])),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: makeSite(),
    } satisfies ContentGraph;

    const start = performance.now();
    const routes = planRoutes({ config: makeConfig(), content: graph, theme: makeTheme() });
    const elapsedMs = performance.now() - start;

    expect(routes.filter((route) => route.kind === 'post')).toHaveLength(5000);
    expect(routes.length).toBeGreaterThan(5000);
    expect(elapsedMs).toBeLessThan(2500);
  });
});
