import { describe, expect, spyOn, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag, Tier } from '~/content/model.ts';
import { type NectarEngine, buildContext, buildRootData, createEngine } from '~/render/engine.ts';
import { registerBlockHelpers } from '~/render/helpers/blocks.ts';
import { registerFlowHelpers } from '~/render/helpers/flow.ts';
import { isMemberStubLeaf } from '~/render/member-stub.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle, ThemePackage } from '~/theme/types.ts';
import { logger } from '~/util/logger.ts';

const engine = {} as NectarEngine;

const baseMeta: RouteContext['meta'] = {
  title: '',
  description: '',
  canonical: '',
  image: undefined,
};

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    slug: 'p1',
    title: 'A post',
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
    published_at: '',
    updated_at: '',
    created_at: '',
    reading_time: 0,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tiers: [],
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: '/p1/',
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
    custom_template: undefined,
    comments: false,
    access: false,
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
    slug: 'pg1',
    title: 'A page',
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
    published_at: '',
    updated_at: '',
    created_at: '',
    reading_time: 0,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: '/pg1/',
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

function makeTag(overrides: Partial<Tag> = {}): Tag {
  const slug = overrides.slug ?? 'news';
  return {
    id: `tag-${slug}`,
    slug,
    name: slug,
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
    visibility: slug.startsWith('hash-') ? 'internal' : 'public',
    meta_title: undefined,
    meta_description: undefined,
    url: `/tag/${slug}/`,
    count: { posts: 0 },
    ...overrides,
  };
}

function makeAuthor(overrides: Partial<Author> = {}): Author {
  const slug = overrides.slug ?? 'jane';
  return {
    id: `author-${slug}`,
    slug,
    name: 'Jane',
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
    url: `/author/${slug}/`,
    count: { posts: 0 },
    ...overrides,
  };
}

describe('buildContext', () => {
  test('on a post route, ctx.post is the post object', () => {
    const post = makePost({ uuid: '11111111-2222-5333-8444-555555555555' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.post).toBe(post);
    expect(ctx.uuid).toBe(post.uuid);
    expect((ctx.post as Post).uuid).toBe(post.uuid);
    expect(ctx.page).toBe(false);
  });

  test('on a page route, ctx.page is the page and ctx.post is NOT set (issue #156)', () => {
    const page = makePage();
    const route: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.page).toBe(page);
    expect(ctx.post).toBeUndefined();
  });

  test('post and page routes keep Ghost root and nested title lookups compatible', () => {
    const tpl = Handlebars.compile('{{title}}|{{post.title}}|{{page.title}}');
    const post = makePost({ title: 'Nested post title' });
    const page = makePage({ title: 'Nested page title' });

    const postContext = buildContext(engine, {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    });
    const pageContext = buildContext(engine, {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page },
      meta: baseMeta,
    });

    expect(tpl(postContext)).toBe('Nested post title|Nested post title|');
    expect(tpl(pageContext)).toBe('Nested page title||Nested page title');
  });

  test('page root copy does not read the page flag before setting ctx.page', () => {
    const page = makePage();
    let pageFlagReads = 0;
    Object.defineProperty(page, 'page', {
      configurable: true,
      enumerable: true,
      get() {
        pageFlagReads += 1;
        return true;
      },
    });
    const route: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page },
      meta: baseMeta,
    };

    const ctx = buildContext(engine, route);

    expect(ctx.title).toBe(page.title);
    expect(ctx.page).toBe(page);
    expect(pageFlagReads).toBe(1);
  });

  test('routes without pagination still expose a page-1 pagination context (issue #1709)', () => {
    const homeRoute: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    expect(buildContext(engine, homeRoute).pagination).toEqual({ page: 1, pages: 1, total: 0 });

    const pageRoute: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page: makePage() },
      meta: baseMeta,
    };
    expect(buildContext(engine, pageRoute).pagination).toEqual({ page: 1, pages: 1, total: 0 });
  });

  test('routes with pagination preserve the route pagination object (issue #1709)', () => {
    const pagination = makePagination(2);
    const route: RouteContext = {
      kind: 'home',
      url: '/page/2/',
      outputPath: 'page/2/index.html',
      template: 'home',
      data: { pagination },
      meta: baseMeta,
    };
    expect(buildContext(engine, route).pagination).toBe(pagination);
  });

  // Regression coverage for issue #1111: Ghost's body_class includes a
  // `tag-<slug>` token for every tag on the current post (Source theme styles
  // hook into these). Internal tags carry `hash-<name>` slugs, so they must
  // surface as `tag-hash-<name>` without a custom code path.
  test('post body_class includes tag-<slug> tokens for every post tag (issue #1111)', () => {
    const post = makePost({
      tags: [makeTag({ slug: 'news' }), makeTag({ slug: 'features' })],
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.body_class).split(' ');
    expect(tokens).toContain('post-template');
    expect(tokens).toContain('tag-news');
    expect(tokens).toContain('tag-features');
  });

  test('post body_class surfaces internal tags as tag-hash-<name> (issue #1111)', () => {
    const post = makePost({
      tags: [makeTag({ slug: 'news' }), makeTag({ slug: 'hash-cta' })],
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.body_class).split(' ');
    expect(tokens).toContain('tag-news');
    expect(tokens).toContain('tag-hash-cta');
  });

  test('non-post routes do not gain per-post tag tokens (issue #1111)', () => {
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.body_class).split(' ');
    expect(tokens.filter((t) => t.startsWith('tag-'))).toEqual([]);
  });

  test('duplicate tags on a post emit a single tag-<slug> token (issue #1111)', () => {
    const post = makePost({
      tags: [makeTag({ slug: 'news' }), makeTag({ slug: 'news' })],
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.body_class).split(' ');
    expect(tokens.filter((t) => t === 'tag-news')).toHaveLength(1);
  });

  // Regression coverage for issue #1119: Ghost's post_class is richer than
  // just `post` + tag/featured tokens. Themes (including Source) hook layout
  // into `no-image`/`image`, `page`, and `no-content`, so the minimal output
  // dropped visual states for stub posts and page templates.
  test('post post_class includes `image` when feature_image is set (issue #1119)', () => {
    const post = makePost({ feature_image: '/img.jpg', html: '<p>hi</p>' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.post_class).split(' ');
    expect(tokens).toContain('post');
    expect(tokens).toContain('image');
    expect(tokens).not.toContain('no-image');
    expect(tokens).not.toContain('no-content');
    expect(tokens).not.toContain('page');
  });

  test('post post_class falls back to `no-image` when feature_image is missing (issue #1119)', () => {
    const post = makePost({ html: '<p>hi</p>' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.post_class).split(' ');
    expect(tokens).toContain('no-image');
    expect(tokens).not.toContain('image');
  });

  test('post post_class adds `no-content` when the body is empty (issue #1119)', () => {
    const post = makePost({ html: '   ' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.post_class).split(' ');
    expect(tokens).toContain('no-content');
  });

  test('featured posts keep both `featured` and `image` tokens together (issue #1119)', () => {
    const post = makePost({
      featured: true,
      feature_image: '/img.jpg',
      html: '<p>hi</p>',
      tags: [makeTag({ slug: 'news' })],
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.post_class).split(' ');
    expect(tokens).toContain('featured');
    expect(tokens).toContain('image');
    expect(tokens).toContain('tag-news');
  });

  test('post post_class adds `access` for public visibility (issue #984)', () => {
    const post = makePost({ feature_image: '/img.jpg', html: '<p>hi</p>', visibility: 'public' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).post_class).split(' ');
    expect(tokens).toContain('access');
    expect(tokens).not.toContain('members-only');
    expect(tokens).not.toContain('paid-only');
  });

  test('post post_class adds `members-only` for members visibility (issue #984)', () => {
    const post = makePost({ html: '<p>hi</p>', visibility: 'members' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).post_class).split(' ');
    expect(tokens).toContain('members-only');
    expect(tokens).toContain('no-image');
    expect(tokens).not.toContain('access');
    expect(tokens).not.toContain('paid-only');
  });

  test('post post_class adds `paid-only` for paid and tier-filtered visibility (issue #984)', () => {
    for (const visibility of ['paid', 'tiers', 'filter'] as const) {
      const post = makePost({ feature_image: '/img.jpg', html: '<p>hi</p>', visibility });
      const route: RouteContext = {
        kind: 'post',
        url: `/${visibility}/`,
        outputPath: `${visibility}/index.html`,
        template: 'post',
        data: { post },
        meta: baseMeta,
      };
      const tokens = String(buildContext(engine, route).post_class).split(' ');
      expect(tokens).toContain('paid-only');
      expect(tokens).not.toContain('access');
      expect(tokens).not.toContain('members-only');
    }
  });

  test('page post_class includes the `page` token (issue #1119)', () => {
    const page = makePage({ feature_image: '/img.jpg', html: '<p>hi</p>' });
    const route: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.post_class).split(' ');
    expect(tokens).toContain('post');
    expect(tokens).toContain('page');
    expect(tokens).toContain('image');
  });

  test('page post_class with empty body gets both `no-image` and `no-content` (issue #1119)', () => {
    const page = makePage({ html: '' });
    const route: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    const tokens = String(ctx.post_class).split(' ');
    expect(tokens).toContain('no-image');
    expect(tokens).toContain('no-content');
    expect(tokens).toContain('page');
  });

  test('on an error route, ctx.statusCode and ctx.message are exposed (issue #1006)', () => {
    const route: RouteContext = {
      kind: 'error',
      url: '/404.html',
      outputPath: '404.html',
      template: 'error-404',
      data: { error: { statusCode: 404, message: 'Page not found' } },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.statusCode).toBe(404);
    expect(ctx.message).toBe('Page not found');
    expect(ctx.error).toEqual({ statusCode: 404, message: 'Page not found' });
  });

  test('ctx.access is true on every route so {{#unless access}} skips gated branches (issue #157)', () => {
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post: makePost() },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.access).toBe(true);
  });

  test('ctx.is_popup is explicitly false on static routes (issue #1721)', () => {
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.is_popup).toBe(false);
    expect(Object.hasOwn(ctx, 'is_popup')).toBe(true);
  });

  // Cross-theme body_class variants (issue #862). Ghost emits route-kind
  // template tokens that themes hook for layout; Source ships separate CSS
  // for the home root, paginated archives, the error page, and aggregated
  // listings. We mirror that scoping so a single CSS rule like
  // `body.home-template .gh-head` only fires on the home root, not on
  // `/page/2/` which is structurally an archive.
  test('home route page 1 carries `home-template` and not `archive-template` (issue #862)', () => {
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: { pagination: makePagination(1) },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).body_class).split(' ');
    expect(tokens).toContain('home-template');
    expect(tokens).not.toContain('archive-template');
    expect(tokens).not.toContain('paged');
  });

  test('home route page > 1 swaps `home-template` for `archive-template` + `paged` (issue #862)', () => {
    const route: RouteContext = {
      kind: 'home',
      url: '/page/2/',
      outputPath: 'page/2/index.html',
      template: 'home',
      data: { pagination: makePagination(2) },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).body_class).split(' ');
    expect(tokens).not.toContain('home-template');
    expect(tokens).toContain('archive-template');
    expect(tokens).toContain('paged');
  });

  test('home route without a pagination object still emits `home-template` (issue #862)', () => {
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).body_class).split(' ');
    expect(tokens).toContain('home-template');
  });

  test('error routes emit `error-template` for theme-side 404 styling (issue #862)', () => {
    const route: RouteContext = {
      kind: 'error',
      url: '/404.html',
      outputPath: '404.html',
      template: 'error-404',
      data: { error: { statusCode: 404, message: 'Not found' } },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).body_class).split(' ');
    expect(tokens).toContain('error-template');
  });

  test('tag and author archive routes still carry `archive-template` (issue #862)', () => {
    const tagRoute: RouteContext = {
      kind: 'tag',
      url: '/tag/news/',
      outputPath: 'tag/news/index.html',
      template: 'tag',
      data: { tag: makeTag({ slug: 'news' }) },
      meta: baseMeta,
    };
    const tagTokens = String(buildContext(engine, tagRoute).body_class).split(' ');
    expect(tagTokens).toContain('tag-template');
    expect(tagTokens).toContain('archive-template');

    const authorRoute: RouteContext = {
      kind: 'author',
      url: '/author/jane/',
      outputPath: 'author/jane/index.html',
      template: 'author',
      data: {
        author: {
          id: 'a1',
          slug: 'jane',
          name: 'Jane',
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
          accent_color: undefined,
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
          url: '/author/jane/',
          count: { posts: 0 },
        },
      },
      meta: baseMeta,
    };
    const authorTokens = String(buildContext(engine, authorRoute).body_class).split(' ');
    expect(authorTokens).toContain('author-template');
    expect(authorTokens).toContain('archive-template');
  });

  test('resource routes include per-resource body_class slug modifiers (issue #979)', () => {
    const postRoute: RouteContext = {
      kind: 'post',
      url: '/source-news/',
      outputPath: 'source-news/index.html',
      template: 'post',
      data: { post: makePost({ slug: 'source-news' }) },
      meta: baseMeta,
    };
    const pageRoute: RouteContext = {
      kind: 'page',
      url: '/about-us/',
      outputPath: 'about-us/index.html',
      template: 'page',
      data: { page: makePage({ slug: 'about-us' }) },
      meta: baseMeta,
    };
    const tagRoute: RouteContext = {
      kind: 'tag',
      url: '/tag/product/',
      outputPath: 'tag/product/index.html',
      template: 'tag',
      data: { tag: makeTag({ slug: 'product' }) },
      meta: baseMeta,
    };
    const authorRoute: RouteContext = {
      kind: 'author',
      url: '/author/jane/',
      outputPath: 'author/jane/index.html',
      template: 'author',
      data: { author: makeAuthor({ slug: 'jane' }) },
      meta: baseMeta,
    };

    expect(String(buildContext(engine, postRoute).body_class).split(' ')).toContain(
      'post-template-source-news',
    );
    expect(String(buildContext(engine, pageRoute).body_class).split(' ')).toContain(
      'page-template-about-us',
    );
    expect(String(buildContext(engine, tagRoute).body_class).split(' ')).toEqual(
      expect.arrayContaining(['tag-template-product', 'tag-product']),
    );
    expect(String(buildContext(engine, authorRoute).body_class).split(' ')).toEqual(
      expect.arrayContaining(['author-template-jane', 'author-jane']),
    );
  });

  test('resource body_class slug modifiers sanitize unsafe slug text (issue #979)', () => {
    const route: RouteContext = {
      kind: 'post',
      url: '/hello-world/',
      outputPath: 'hello-world/index.html',
      template: 'post',
      data: {
        post: makePost({
          slug: 'Hello World',
          tags: [makeTag({ slug: 'Feature Launch' })],
        }),
      },
      meta: baseMeta,
    };
    const bodyClass = String(buildContext(engine, route).body_class);
    const tokens = bodyClass.split(' ');

    expect(tokens).toContain('post-template-hello-world');
    expect(tokens).toContain('tag-feature-launch');
    expect(tokens).not.toContain('post-template-Hello');
    expect(tokens).not.toContain('World');
    expect(bodyClass).not.toContain('Hello World');
    expect(bodyClass).not.toContain('Feature Launch');
  });

  test('tag archive context exposes tag theme fields at root and under tag', () => {
    const tag = makeTag({
      slug: 'news',
      accent_color: '#e91e63',
      og_title: 'News OG',
      og_description: 'News OG description',
      og_image: '/content/images/news-og.jpg',
      twitter_title: 'News Twitter',
      twitter_description: 'News Twitter description',
      twitter_image: '/content/images/news-twitter.jpg',
      codeinjection_head: '<meta name="tag-head" content="news">',
      codeinjection_foot: '<script>window.__tag = "news"</script>',
    });
    const route: RouteContext = {
      kind: 'tag',
      url: '/tag/news/',
      outputPath: 'tag/news/index.html',
      template: 'tag',
      data: { tag },
      meta: baseMeta,
    };

    expect(buildContext(engine, route)).toMatchObject({
      tag,
      accent_color: '#e91e63',
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

  test('author archive context exposes author SEO fields at root and under author', () => {
    const author = {
      id: 'author-jane',
      slug: 'jane',
      name: 'Jane',
      bio: '',
      profile_image: undefined,
      cover_image: '/content/images/jane-cover.jpg',
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
      accent_color: '#7851a9',
      meta_title: undefined,
      meta_description: undefined,
      og_title: 'Jane OG',
      og_description: 'Jane OG description',
      og_image: '/content/images/jane-og.jpg',
      twitter_title: 'Jane Twitter',
      twitter_description: 'Jane Twitter description',
      twitter_image: '/content/images/jane-twitter.jpg',
      codeinjection_head: '<meta name="author-head" content="jane">',
      codeinjection_foot: '<script>window.__author = "jane"</script>',
      url: '/author/jane/',
      count: { posts: 0 },
    };
    const route: RouteContext = {
      kind: 'author',
      url: '/author/jane/',
      outputPath: 'author/jane/index.html',
      template: 'author',
      data: { author },
      meta: baseMeta,
    };

    expect(buildContext(engine, route)).toMatchObject({
      author,
      feature_image: '/content/images/jane-cover.jpg',
      accent_color: '#7851a9',
      og_title: 'Jane OG',
      og_description: 'Jane OG description',
      og_image: '/content/images/jane-og.jpg',
      twitter_title: 'Jane Twitter',
      twitter_description: 'Jane Twitter description',
      twitter_image: '/content/images/jane-twitter.jpg',
      codeinjection_head: '<meta name="author-head" content="jane">',
      codeinjection_foot: '<script>window.__author = "jane"</script>',
    });
  });

  // Cross-theme post_class variants (issue #871). Casper / Source emit both
  // the legacy `image` token and the newer `feature-image` / `image-cover`
  // tokens together so theme CSS can hook either selector.
  test('post_class with a feature image emits all three image markers together (issue #871)', () => {
    const post = makePost({ feature_image: '/img.jpg', html: '<p>hi</p>' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).post_class).split(' ');
    expect(tokens).toContain('image');
    expect(tokens).toContain('feature-image');
    expect(tokens).toContain('image-cover');
    expect(tokens).not.toContain('no-image');
  });

  test('post_class without a feature image emits `no-image` and no feature-image variants (issue #871)', () => {
    const post = makePost({ html: '<p>hi</p>' });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const tokens = String(buildContext(engine, route).post_class).split(' ');
    expect(tokens).toContain('no-image');
    expect(tokens).not.toContain('image');
    expect(tokens).not.toContain('feature-image');
    expect(tokens).not.toContain('image-cover');
  });

  test('feature_image_caption renders as trusted HTML in root and post block contexts (issue #865)', () => {
    const post = makePost({
      feature_image_caption: 'Photo by <a href="https://ok.test">Alice</a> &amp; <em>Bob</em>',
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const hb = Handlebars.create();
    const blockEngine = {
      ...engine,
      hb,
      content: { posts: [], pages: [], tags: [], authors: [], tiers: [] },
      sortedCache: new Map<string, readonly unknown[]>(),
    } as unknown as NectarEngine;
    registerBlockHelpers(blockEngine);

    const ctx = buildContext(blockEngine, route);
    const data = { route };
    const tpl = hb.compile('{{feature_image_caption}}|{{#post}}{{feature_image_caption}}{{/post}}');

    expect(tpl(ctx, { data })).toBe(
      'Photo by <a href="https://ok.test">Alice</a> &amp; <em>Bob</em>|Photo by <a href="https://ok.test">Alice</a> &amp; <em>Bob</em>',
    );
    expect(post.feature_image_caption).toBe(
      'Photo by <a href="https://ok.test">Alice</a> &amp; <em>Bob</em>',
    );
  });

  test('feature_image_caption renders as trusted HTML when posts are iterated (issue #865)', () => {
    const post = makePost({
      feature_image_caption: 'Credit <strong>Casper</strong>',
    });
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: { posts: [post] },
      meta: baseMeta,
    };
    const hb = Handlebars.create();
    const blockEngine = {
      ...engine,
      hb,
      content: { posts: [post], pages: [], tags: [], authors: [], tiers: [] },
      sortedCache: new Map<string, readonly unknown[]>(),
    } as unknown as NectarEngine;
    registerBlockHelpers(blockEngine);

    const ctx = buildContext(blockEngine, route);
    const tpl = hb.compile(
      '{{#foreach posts}}<figcaption>{{feature_image_caption}}</figcaption>{{/foreach}}',
    );

    expect(tpl(ctx, { data: { route } })).toBe(
      '<figcaption>Credit <strong>Casper</strong></figcaption>',
    );
    expect(post.feature_image_caption).toBe('Credit <strong>Casper</strong>');
  });
});

function makePagination(page: number): RouteContext['data']['pagination'] {
  return {
    page,
    prev: page > 1 ? page - 1 : undefined,
    next: undefined,
    pages: Math.max(page, 1),
    total: 0,
    limit: 10,
    prev_url: undefined,
    next_url: undefined,
    base_url: '/',
  };
}

describe('buildRootData', () => {
  function makeEngine(pkg: Partial<ThemePackage> = {}): NectarEngine {
    const themePkg: ThemePackage = {
      name: 'theme',
      version: '0.0.0',
      posts_per_page: 7,
      image_sizes: { xs: { width: 160 } },
      card_assets: true,
      custom: {},
      customDefaults: {},
      ...pkg,
    };
    return {
      config: {
        theme: { custom: {} },
        build: { posts_per_page: 99 },
      } as unknown as NectarEngine['config'],
      content: {
        site: { locale: 'en' },
      } as unknown as NectarEngine['content'],
      theme: { pkg: themePkg } as unknown as NectarEngine['theme'],
    } as NectarEngine;
  }

  function makeRoute(kind: RouteContext['kind'] = 'home'): RouteContext {
    return {
      kind,
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
  }

  test('@config exposes the Ghost-shaped fields from the theme package (issue #102)', () => {
    const engine = makeEngine();
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    expect(data.config).toEqual({
      posts_per_page: 7,
      image_sizes: { xs: { width: 160 } },
      card_assets: true,
    });
  });

  test('@config does not leak the raw NectarConfig shape (no nested build/theme keys)', () => {
    const engine = makeEngine();
    const route = makeRoute();
    const data = buildRootData(engine, route);
    const config = data.config as Record<string, unknown>;
    expect(config.build).toBeUndefined();
    expect(config.theme).toBeUndefined();
  });

  test('body_class carries the precomputed text color class from theme background', () => {
    const engine = makeEngine({
      custom: { site_background_color: { type: 'color' } },
      customDefaults: { site_background_color: '#111111' },
    });
    const route = makeRoute();
    const context = buildContext(engine, route);
    const data = buildRootData(engine, route);

    expect(data.text_color_class).toBe('has-light-text');
    expect(String(context.body_class).split(' ')).toContain('has-light-text');
  });

  test('text color class falls back to configured accent_color when no background custom exists', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      site: { accent_color: '#111111' },
    } as unknown as NectarEngine['config'];
    const data = buildRootData(engine, makeRoute());

    expect(data.text_color_class).toBe('has-light-text');
  });

  test('@site.icon falls back to the configured site icon for theme templates (issue #1705)', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      site: {
        icon: '/content/images/site-icon.svg',
      },
    } as unknown as NectarEngine['config'];
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const site = data.site as { icon?: string };
    expect(site.icon).toBe('/content/images/site-icon.svg');

    const hb = Handlebars.create();
    const tpl = hb.compile('{{@site.icon}}');
    expect(tpl({}, { data })).toBe('/content/images/site-icon.svg');
  });

  test('@setting is a cross-theme alias for the enriched @site context (issue #315)', () => {
    const engine = makeEngine();
    engine.content = {
      ...engine.content,
      site: {
        locale: 'en',
        title: 'Alias Site',
        paid_members_enabled: true,
        navigation: [{ label: 'Members', url: '/members/' }],
      },
    } as unknown as NectarEngine['content'];
    const route: RouteContext = {
      kind: 'page',
      url: '/members/',
      outputPath: 'members/index.html',
      template: 'page',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    expect(data.setting).toBe(data.site);
    expect(data.blog).toBe(data.site);

    const hb = Handlebars.create();
    const tpl = hb.compile(
      [
        '{{@site.title}}',
        '|{{@setting.title}}',
        '|{{@site.paid_members_enabled}}',
        '|{{@setting.paid_members_enabled}}',
        '|{{#each @setting.navigation}}{{slug}}:{{current}}{{/each}}',
      ].join(''),
    );
    expect(tpl({}, { data })).toBe('Alias Site|Alias Site|true|true|members:true');
  });

  test('@site.url strips trailing slashes before themes access it (issue #976)', () => {
    const engine = makeEngine();
    engine.content = {
      ...engine.content,
      site: {
        locale: 'en',
        title: 'Theme URL Site',
        url: 'https://example.com/blog//',
      },
    } as unknown as NectarEngine['content'];
    const data = buildRootData(engine, makeRoute());
    const site = data.site as { url: string };

    expect(site.url).toBe('https://example.com/blog');
    expect(data.setting).toBe(data.site);
    expect(data.blog).toBe(data.site);

    const hb = Handlebars.create();
    const tpl = hb.compile('{{@site.url}}|{{@setting.url}}|{{@blog.url}}');
    expect(tpl({}, { data })).toBe(
      'https://example.com/blog|https://example.com/blog|https://example.com/blog',
    );
  });

  test('Journal-style @setting.paid_members_enabled blocks follow @site (issue #719)', () => {
    const renderPaidMembersBranch = (paid_members_enabled: boolean) => {
      const engine = makeEngine();
      engine.content = {
        ...engine.content,
        site: {
          locale: 'en',
          title: 'Journal Alias Site',
          paid_members_enabled,
        },
      } as unknown as NectarEngine['content'];
      const data = buildRootData(engine, makeRoute());
      const hb = Handlebars.create();
      const tpl = hb.compile(
        '{{#if @setting.paid_members_enabled}}paid-members{{else}}free-members{{/if}}',
      );

      return tpl({}, { data });
    };

    expect(renderPaidMembersBranch(true)).toBe('paid-members');
    expect(renderPaidMembersBranch(false)).toBe('free-members');
  });

  test('@site exposes comments settings to Ghost theme guards (issue #962)', () => {
    const engine = makeEngine();
    engine.content = {
      ...engine.content,
      site: {
        locale: 'en',
        title: 'Comments Site',
        comments_enabled: false,
        comments_access: 'members',
      },
    } as unknown as NectarEngine['content'];
    const data = buildRootData(engine, makeRoute());
    const hb = Handlebars.create();
    const tpl = hb.compile(
      '{{#unless @site.comments_enabled}}comments-off{{/unless}}|{{@site.comments_access}}|{{@setting.comments_access}}',
    );

    expect(tpl({}, { data })).toBe('comments-off|members|members');
  });

  test('@site exposes Portal settings to Ghost theme guards (issue #964)', () => {
    const engine = makeEngine();
    engine.content = {
      ...engine.content,
      site: {
        locale: 'en',
        title: 'Portal Site',
        portal_button: true,
        portal_button_icon: 'icon-2',
        portal_button_signup_text: 'Join now',
        portal_button_style: 'icon-and-text',
        portal_name: 'Nectar Portal',
        portal_plans: ['free', 'monthly'],
        portal_signup_checkbox_required: true,
        portal_signup_terms_html: '<p>Terms apply</p>',
        signup_url: 'https://portal.example/signup/',
      },
    } as unknown as NectarEngine['content'];
    const data = buildRootData(engine, makeRoute());
    const hb = Handlebars.create();
    const tpl = hb.compile(
      '{{#if @site.portal_button}}button{{/if}}|{{@site.portal_button_icon}}|{{@site.portal_button_signup_text}}|{{@site.portal_button_style}}|{{@site.portal_name}}|{{@site.portal_plans.length}}|{{#if @setting.portal_signup_checkbox_required}}terms{{/if}}|{{@site.portal_signup_terms_html}}|{{@setting.signup_url}}',
    );

    expect(tpl({}, { data })).toBe(
      'button|icon-2|Join now|icon-and-text|Nectar Portal|2|terms|&lt;p&gt;Terms apply&lt;/p&gt;|https://portal.example/signup/',
    );
  });

  // Regression coverage for issue #111: the Source theme renders the home grid
  // with `{{#get "posts" include="authors" limit=@config.posts_per_page}}`. The
  // `get` helper falls back to 15 when `limit` is undefined, which would mask
  // a broken `@config.posts_per_page` plumb. Confirm the helper actually picks
  // up the theme's value via the data frame buildRootData hands to render.
  test('{{#get "posts" limit=@config.posts_per_page}} honors the theme value (issue #111)', () => {
    const themePkg: ThemePackage = {
      name: 'theme',
      version: '0.0.0',
      posts_per_page: 4,
      image_sizes: {},
      card_assets: true,
      custom: {},
      customDefaults: {},
    };
    const posts = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      title: `T${i}`,
      published_at: `2026-05-${String(20 - i).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const hb = Handlebars.create();
    const engine = {
      hb,
      config: {
        theme: { custom: {} },
        build: { posts_per_page: 99 },
      } as unknown as NectarEngine['config'],
      content: {
        site: { locale: 'en' },
        posts,
        pages: [],
        tags: [],
        authors: [],
      } as unknown as NectarEngine['content'],
      theme: { pkg: themePkg } as unknown as NectarEngine['theme'],
      templates: {},
      layouts: {},
      sortedCache: new Map<string, readonly unknown[]>(),
      render: () => '',
    } as NectarEngine;
    registerBlockHelpers(engine);
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const tpl = hb.compile(
      `{{#get "posts" limit=@config.posts_per_page as |items|}}{{#each items}}{{id}},{{/each}}{{/get}}`,
    );
    const out = tpl({}, { data });
    expect(out).toBe('p0,p1,p2,p3,');
  });

  test('Headline-style index get limit reads theme package posts_per_page (issue #714)', () => {
    const themePkg: ThemePackage = {
      name: 'headline',
      version: '0.0.0',
      posts_per_page: 3,
      image_sizes: {},
      card_assets: true,
      custom: {},
      customDefaults: {},
    };
    const posts = Array.from({ length: 8 }, (_, i) =>
      makePost({
        id: `p${i}`,
        title: `Headline ${i}`,
        published_at: `2026-05-${String(20 - i).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const hb = Handlebars.create();
    const engine = {
      hb,
      config: {
        theme: { custom: {} },
        build: { posts_per_page: 99 },
      } as unknown as NectarEngine['config'],
      content: {
        site: { locale: 'en' },
        posts,
        pages: [],
        tags: [],
        authors: [],
      } as unknown as NectarEngine['content'],
      theme: { pkg: themePkg } as unknown as NectarEngine['theme'],
      templates: {},
      layouts: {},
      sortedCache: new Map<string, readonly unknown[]>(),
      render: () => '',
    } as NectarEngine;
    registerBlockHelpers(engine);
    const route: RouteContext = {
      kind: 'index',
      url: '/',
      outputPath: 'index.html',
      template: 'index',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const config = data.config as Record<string, unknown>;
    expect(config.posts_per_page).toBe(3);
    expect(config.build).toBeUndefined();

    const tpl = hb.compile(
      [
        '{{#get "posts" limit=@config.posts_per_page as |headline_posts|}}',
        '{{#foreach headline_posts}}{{id}},{{/foreach}}',
        '{{/get}}',
      ].join(''),
    );
    expect(tpl({}, { data })).toBe('p0,p1,p2,');
  });

  // Issue #122 / #974: Source theme reads `@member` in header / footer / CTA /
  // nav / post-list. Nectar has no logged-in viewer, so `@member` must behave
  // falsy on every route while still allowing strict path access such as
  // `@member.paid`.
  test('@member is a safe unauthenticated stub on every route kind (issues #122, #974)', () => {
    const engine = makeEngine();
    const routes: RouteContext['kind'][] = ['home', 'post', 'page', 'tag', 'author', 'index'];
    for (const kind of routes) {
      const route: RouteContext = {
        kind,
        url: '/',
        outputPath: 'index.html',
        template: 'home',
        data: {},
        meta: baseMeta,
      };
      const data = buildRootData(engine, route);
      expect(data).toHaveProperty('member');
      expect(isMemberStubLeaf(data.member)).toBe(true);
    }
  });

  test('Source-style {{#unless @member}} / {{@member.paid}} idioms behave as unauthenticated (issue #122)', () => {
    const engine = makeEngine();
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const hb = Handlebars.create();
    registerFlowHelpers({ hb } as NectarEngine);
    const tpl = hb.compile(
      [
        '{{#unless @member}}signin{{/unless}}',
        '|{{#if @member}}greeting{{/if}}',
        '|name:{{@member.name}}',
        '|{{#unless @member.paid}}upsell{{/unless}}',
      ].join(''),
    );
    expect(tpl({}, { data })).toBe('signin||name:|upsell');
  });

  test('strict @member.paid paths render empty without losing unauthenticated branches (issue #974)', () => {
    const engine = makeEngine();
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const hb = Handlebars.create();
    registerFlowHelpers({ hb } as NectarEngine);
    const tpl = hb.compile(
      [
        '{{#unless @member}}signin{{else}}account{{/unless}}',
        '|paid:[{{@member.paid}}]',
        '|tier:[{{@member.tier.name}}]',
        '|{{#if @member}}yes{{else}}no{{/if}}',
        '|with:{{#with @member}}yes{{else}}no{{/with}}',
      ].join(''),
      { strict: true },
    );
    expect(tpl({}, { data })).toBe('signin|paid:[]|tier:[]|no|with:no');
  });

  test('Journal-style {{^if @member.paid}} renders inverse branch for the safe member stub', () => {
    const engine = makeEngine();
    const route: RouteContext = {
      kind: 'index',
      url: '/',
      outputPath: 'index.html',
      template: 'index',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const hb = Handlebars.create();
    registerFlowHelpers({ hb } as NectarEngine);
    const tpl = hb.compile('{{^if @member.paid}}upsell{{/if}}');
    expect(tpl({}, { data })).toBe('upsell');
  });

  // Issue #1300: `[components.preview].member.paid = true` opts into a designer
  // preview of the Casper / Edition signed-in CTA. The synthetic @member must
  // make `{{#if @member}}` truthy and `{{@member.paid}}` carry through, while
  // the {{else}} branch of `{{#unless @member}}` renders.
  test('@member is injected from [components.preview].member when configured', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      components: {
        preview: { member: { paid: true, name: 'Preview User' } },
      },
    } as unknown as NectarEngine['config'];
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    expect(data.member).toEqual({ paid: true, name: 'Preview User' });
    const hb = Handlebars.create();
    const tpl = hb.compile(
      [
        '{{#unless @member}}signin{{else}}account{{/unless}}',
        '|name:{{@member.name}}',
        '|paid:{{@member.paid}}',
      ].join(''),
    );
    expect(tpl({}, { data })).toBe('account|name:Preview User|paid:true');
  });

  test('preview member email is only emitted when set (no literal "undefined" string)', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      components: { preview: { member: { paid: false } } },
    } as unknown as NectarEngine['config'];
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    expect(data.member).toEqual({ paid: false });
    const member = data.member as Record<string, unknown>;
    expect('email' in member).toBe(false);
    expect('name' in member).toBe(false);
  });

  // Issues #489 / #490: themes that probe richer Ghost shape (`@member.tier.name`,
  // `@member.subscriptions.0.status`) would otherwise pull `undefined` out of
  // `tier` and trip up any JS-side helper that does non-null-safe chaining.
  // The preview member is wrapped in a Proxy so missing-key access returns a
  // recursive falsy stub; the documented `paid` / `name` / `email` fields the
  // operator opted into pass through untouched.
  test('preview member chained access on missing keys never crashes and renders empty', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      components: { preview: { member: { paid: true, name: 'Preview User' } } },
    } as unknown as NectarEngine['config'];
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const member = data.member as unknown as Record<string, unknown> & {
      tier: { name: string; nested: { deeper: string } };
    };

    // Operator-set fields pass through verbatim.
    expect(member.paid).toBe(true);
    expect(member.name).toBe('Preview User');

    // Missing-key chained access does not crash, returns a safe stub.
    const tier = member.tier;
    expect(tier).toBeDefined();
    expect(() => tier.name).not.toThrow();
    expect(() => tier.nested.deeper).not.toThrow();

    // `in` operator reports false for missing keys so `{{#if (lookup
    // @member "tier")}}` branches as unset.
    expect('tier' in member).toBe(false);

    // Handlebars renders missing chained access as empty.
    const hb = Handlebars.create();
    const tpl = hb.compile(
      '[{{@member.tier.name}}][{{@member.subscriptions.0.status}}][{{@member.anything}}]',
    );
    expect(tpl({}, { data })).toBe('[][][]');
  });

  test('preview member subscriptions expose Krabi account fields safely (issue #720)', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      components: {
        preview: {
          member: {
            paid: true,
            name: 'Preview User',
            default_payment_card_last4: '4242',
            subscriptions: [
              {
                cancel_at_period_end: false,
                current_period_end: '2026-06-30',
                plan: {
                  currency_symbol: '$',
                  interval: 'month',
                },
              },
            ],
          },
        },
      },
    } as unknown as NectarEngine['config'];
    const data = buildRootData(engine, makeRoute());
    const hb = Handlebars.create();
    registerBlockHelpers({ ...engine, hb } as NectarEngine);
    const tpl = hb.compile(
      [
        'card:{{@member.default_payment_card_last4}}',
        '{{#foreach @member.subscriptions}}',
        '|cancel:{{cancel_at_period_end}}',
        '|end:{{current_period_end}}',
        '|price:{{plan.currency_symbol}}/{{plan.interval}}',
        '{{/foreach}}',
      ].join(''),
    );

    expect(tpl({}, { data })).toBe('card:4242|cancel:false|end:2026-06-30|price:$/month');
  });

  test('preview member partial subscriptions keep Krabi account chains empty instead of crashing (issue #720)', () => {
    const engine = makeEngine();
    engine.config = {
      ...engine.config,
      components: {
        preview: {
          member: {
            paid: true,
            subscriptions: [{}],
          },
        },
      },
    } as unknown as NectarEngine['config'];
    const data = buildRootData(engine, makeRoute());
    const member = data.member as unknown as Record<string, unknown> & {
      subscriptions: Array<{
        plan: { currency_symbol: string; interval: string };
        default_payment_card_last4: string;
      }>;
    };

    expect(() => member.subscriptions[0]?.plan.currency_symbol).not.toThrow();

    const hb = Handlebars.create();
    registerBlockHelpers({ ...engine, hb } as NectarEngine);
    const tpl = hb.compile(
      '{{#foreach @member.subscriptions}}[{{cancel_at_period_end}}][{{current_period_end}}][{{plan.currency_symbol}}][{{plan.interval}}]{{/foreach}}',
    );

    expect(tpl({}, { data })).toBe('[][][][]');
  });

  // Issue #418: themes branch on `@labs` to gate features behind a Ghost
  // "Labs" toggle. Nectar has no labs surface, so the data frame must still
  // ship an empty object so `{{#if @labs.foo}}` is deterministically falsy.
  test('@labs is exposed as an empty object so {{#if @labs.*}} is always falsy', () => {
    const engine = makeEngine();
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    expect(data.labs).toEqual({});
    const hb = Handlebars.create();
    const tpl = hb.compile('{{#if @labs.activitypub}}yes{{else}}no{{/if}}');
    expect(tpl({}, { data })).toBe('no');
  });

  // Issue #422: per-route enrichment computes `slug` from the label and
  // `current` against `route.url`, with trailing-slash normalisation so that
  // a config-side `/about` matches a route URL of `/about/`.
  test('@site.navigation items carry computed slug / current per-route', () => {
    const themePkg: ThemePackage = {
      name: 'theme',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: true,
      custom: {},
      customDefaults: {},
    };
    const engine = {
      config: {
        theme: { custom: {} },
        build: {},
      } as unknown as NectarEngine['config'],
      content: {
        site: {
          locale: 'en',
          navigation: [
            { label: 'Home', url: '/' },
            { label: 'Tag Archive', url: '/tag/news/' },
            { label: 'About Us', url: '/about' },
          ],
          secondary_navigation: [{ label: 'RSS Feed', url: '/rss.xml' }],
        },
      } as unknown as NectarEngine['content'],
      theme: { pkg: themePkg } as unknown as NectarEngine['theme'],
    } as NectarEngine;
    const route: RouteContext = {
      kind: 'page',
      url: '/about/',
      outputPath: 'about/index.html',
      template: 'page',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const site = data.site as {
      navigation: { label: string; url: string; slug: string; current: boolean }[];
      secondary_navigation: { label: string; url: string; slug: string; current: boolean }[];
    };
    expect(site.navigation).toEqual([
      { label: 'Home', url: '/', slug: 'home', current: false },
      { label: 'Tag Archive', url: '/tag/news/', slug: 'tag-archive', current: false },
      { label: 'About Us', url: '/about', slug: 'about-us', current: true },
    ]);
    expect(site.secondary_navigation[0]).toMatchObject({
      label: 'RSS Feed',
      slug: 'rss-feed',
      current: false,
    });
  });

  // Issue #324: Wave / Alto / London guard their secondary nav rendering with
  // `{{#unless @site.secondary_navigation}}` (or the inverse `{{#if}}`).
  // Handlebars treats `[]` as truthy because it is an object, so an empty
  // configured `secondary_navigation` would silently never trigger the
  // fallback. The render layer coerces an empty list to `undefined` so the
  // guards behave as expected.
  test('@site.secondary_navigation is undefined when the configured array is empty', () => {
    const themePkg: ThemePackage = {
      name: 'theme',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: true,
      custom: {},
      customDefaults: {},
    };
    const engine = {
      config: { theme: { custom: {} }, build: {} } as unknown as NectarEngine['config'],
      content: {
        site: {
          locale: 'en',
          navigation: [],
          secondary_navigation: [],
        },
      } as unknown as NectarEngine['content'],
      theme: { pkg: themePkg } as unknown as NectarEngine['theme'],
    } as NectarEngine;
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const site = data.site as { secondary_navigation: unknown };
    expect(site.secondary_navigation).toBeUndefined();

    // Confirm the {{#unless}} branch actually fires now.
    const hb = Handlebars.create();
    const tpl = hb.compile(
      '{{#unless @site.secondary_navigation}}fallback{{else}}has-nav{{/unless}}',
    );
    expect(tpl({}, { data })).toBe('fallback');
  });

  test('@site.build exposes deploy metadata to templates when present', () => {
    const themePkg: ThemePackage = {
      name: 'theme',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: true,
      custom: {},
      customDefaults: {},
    };
    const engine = {
      config: { theme: { custom: {} }, build: {} } as unknown as NectarEngine['config'],
      content: {
        site: {
          locale: 'en',
          navigation: [],
          secondary_navigation: [],
          build: {
            provider: 'cloudflare_pages',
            build_id: 'build-42',
            branch: 'feature/docs',
            commit_sha: 'abc123def456',
          },
        },
      } as unknown as NectarEngine['content'],
      theme: { pkg: themePkg } as unknown as NectarEngine['theme'],
    } as NectarEngine;
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const hb = Handlebars.create();
    const tpl = hb.compile(
      '{{@site.build.provider}}|{{@site.build.build_id}}|{{@site.build.branch}}|{{@site.build.commit_sha}}',
    );
    expect(tpl({}, { data })).toBe('cloudflare_pages|build-42|feature/docs|abc123def456');
  });
});

// Regression coverage for issue #1131: some Ghost themes use `{{> post}}` from
// a custom layout to render the post body. Templates were registered as
// partials using the raw source, which still carried the `{{!< default}}`
// layout directive. That directive must not survive into the partial — when a
// custom layout already extends `default`, re-including the post template
// would otherwise re-stamp the layout into the inner body, producing
// duplicated output or surprising the helpers that walk `@root.body`.
describe('createEngine — templates registered as partials (issue #1131)', () => {
  function makeTheme(
    templates: Record<string, string>,
    partials: Record<string, string> = {},
  ): ThemeBundle {
    const pkg: ThemePackage = {
      name: 'fixture',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    };
    return {
      name: 'fixture',
      rootDir: '/tmp/themes/fixture',
      templates,
      partials,
      pkg,
      locales: {},
      assets: new Map(),
    };
  }

  function makeConfig(): NectarConfig {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        lang: 'en',
        navigation: [],
        secondary_navigation: [],
      },
      build: { output_dir: 'dist', base_path: '' },
      components: {},
      theme: { dir: 'themes', name: 'fixture', custom: {} },
      recommendations: [],
    } as unknown as NectarConfig;
  }

  function makeContent(): ContentGraph {
    return {
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      site: {
        title: 'Example',
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
        accent_color: '#000',
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
    } as unknown as ContentGraph;
  }

  test('registers the layout-stripped body for templates that declare a layout', () => {
    const theme = makeTheme({
      default: '<!doctype html><body>{{{body}}}</body>',
      post: '{{!< default}}\n<article>{{post.title}}</article>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const partial = engine.hb.partials.post;
    expect(typeof partial).toBe('function');
    const partialSource = (partial as { __nectarSource?: string }).__nectarSource ?? '';
    expect(partialSource).not.toContain('{{!< default}}');
    expect(partialSource).toContain('<article>{{post.title}}</article>');
  });

  test('templates with no layout directive register as partials with the original source', () => {
    const theme = makeTheme({
      home: '<section>{{@site.title}}</section>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const partial = engine.hb.partials.home as Handlebars.TemplateDelegate;
    expect(typeof partial).toBe('function');
    expect((partial as { __nectarSource?: string }).__nectarSource).toBe(
      '<section>{{@site.title}}</section>',
    );
  });

  test('renders primary_tag.accent_color in Ruby-style post CSS variables', () => {
    const tag = makeTag({ slug: 'ruby', name: 'Ruby', accent_color: '#b6174b' });
    const post = makePost({ tags: [tag], primary_tag: tag });
    const theme = makeTheme({
      post: '<style>.gh-article{--tag-color: {{primary_tag.accent_color}};}</style>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const html = engine.render({
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    });

    expect(html).toContain('--tag-color: #b6174b');
  });

  test('Dawn-style match on pagination.page falls through on non-paginated routes (issue #1709)', () => {
    const theme = makeTheme({
      home: '{{#match pagination.page 2}}page2{{else}}not-page2{{/match}}',
      page: '{{#match pagination.page 2}}page2{{else}}not-page2{{/match}}',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const homeRoute: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    expect(engine.render(homeRoute)).toBe('not-page2');

    const pageRoute: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page: makePage() },
      meta: baseMeta,
    };
    expect(engine.render(pageRoute)).toBe('not-page2');
  });

  test('Journal-style collection copy can gate on numeric pagination.total (issue #718)', () => {
    const theme = makeTheme({
      tag: [
        '{{#match pagination.total ">" 1}}',
        '{{t "A collection of {numberOfIssues} issues" numberOfIssues=pagination.total}}',
        '{{else}}',
        'single-or-empty',
        '{{/match}}',
      ].join(''),
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const route: RouteContext = {
      kind: 'tag',
      url: '/tag/news/',
      outputPath: 'tag/news/index.html',
      template: 'tag',
      data: {
        pagination: {
          page: 1,
          pages: 2,
          prev: undefined,
          next: 2,
          total: 3,
          limit: 2,
          prev_url: undefined,
          next_url: '/tag/news/page/2/',
          base_url: '/tag/news/',
        },
        posts: [],
      },
      meta: baseMeta,
    };

    expect(engine.render(route)).toBe('A collection of 3 issues');
  });

  test('post partial hashes resolve tiers from the post context', () => {
    const premium: Tier = {
      id: 'premium',
      slug: 'premium',
      name: 'Premium',
      description: '',
      type: 'paid',
      active: true,
      visibility: 'public',
      trial_days: 0,
      monthly_price: 9,
      yearly_price: 90,
      currency: 'USD',
      welcome_page_url: undefined,
      benefits: [],
    };
    const theme = makeTheme(
      {
        post: '{{> "content-cta" tiers=tiers}}',
      },
      {
        'content-cta': '{{#each tiers}}{{slug}}={{monthly_price}}{{else}}none{{/each}}',
      },
    );
    const post = makePost({ visibility: 'tiers', tiers: [premium] });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };

    expect(engine.render(route)).toBe('premium=9');
  });

  test('partials included inside foreach can read the current item feature_image (issue #1710)', () => {
    const theme = makeTheme(
      {
        home: '{{#foreach posts}}{{> "srcset"}}{{/foreach}}',
      },
      {
        srcset: '<img src="{{img_url feature_image size="s"}}">',
      },
    );
    theme.pkg.image_sizes = { s: { width: 320 } };
    const posts = [
      makePost({ slug: 'a', feature_image: '/content/images/a.jpg' }),
      makePost({ slug: 'b', feature_image: '/content/images/b.jpg' }),
    ];
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const html = engine.render({
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: { posts },
      meta: baseMeta,
    });

    expect(html).toBe(
      '<img src="/content/images/size/w320/a.jpg"><img src="/content/images/size/w320/b.jpg">',
    );
  });

  test('partials included inside foreach authors resolve social_url against the author context (issue #1723)', () => {
    const theme = makeTheme(
      {
        post: '{{#foreach authors}}{{> "author-box"}}{{/foreach}}',
      },
      {
        'author-box': [
          '<section data-author="{{slug}}">',
          '<a data-kind="twitter" href="{{social_url type="twitter"}}">{{name}}</a>',
          '<a data-kind="facebook" href="{{social_url type="facebook"}}"></a>',
          '<a data-kind="linkedin" href="{{social_url type="linkedin"}}"></a>',
          '<a data-kind="bluesky" href="{{social_url type="bluesky"}}"></a>',
          '<a data-kind="mastodon" href="{{social_url type="mastodon"}}"></a>',
          '<a data-kind="threads" href="{{social_url type="threads"}}"></a>',
          '<a data-kind="tiktok" href="{{social_url type="tiktok"}}"></a>',
          '<a data-kind="youtube" href="{{social_url type="youtube"}}"></a>',
          '<a data-kind="instagram" href="{{social_url type="instagram"}}"></a>',
          '</section>',
        ].join(''),
      },
    );
    const author = {
      id: 'author-1',
      slug: 'wave-author',
      name: 'Wave Author',
      bio: '',
      profile_image: undefined,
      cover_image: undefined,
      website: undefined,
      location: undefined,
      twitter: '@wave_author',
      facebook: 'wave.author',
      linkedin: 'wave-author',
      bluesky: 'wave-author.example',
      mastodon: '@wave@author.example',
      threads: 'wave_author',
      tiktok: 'wave_author',
      youtube: '@wave-author',
      instagram: 'wave_author',
      meta_title: undefined,
      meta_description: undefined,
      url: '/author/wave-author/',
      count: { posts: 1 },
    };
    const post = {
      ...makePost({
        authors: [author],
        primary_author: author,
      }),
      twitter: '@post_account',
      facebook: 'post.account',
      linkedin: 'post-account',
      bluesky: 'post-account.example',
      mastodon: '@post@post.example',
      threads: 'post_account',
      tiktok: 'post_account',
      youtube: '@post-account',
      instagram: 'post_account',
    } as Post & {
      twitter: string;
      facebook: string;
      linkedin: string;
      bluesky: string;
      mastodon: string;
      threads: string;
      tiktok: string;
      youtube: string;
      instagram: string;
    };
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const html = engine.render({
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    });

    expect(html).toBe(
      [
        '<section data-author="wave-author">',
        '<a data-kind="twitter" href="https://twitter.com/wave_author">Wave Author</a>',
        '<a data-kind="facebook" href="https://facebook.com/wave.author"></a>',
        '<a data-kind="linkedin" href="https://www.linkedin.com/in/wave-author"></a>',
        '<a data-kind="bluesky" href="https://bsky.app/profile/wave-author.example"></a>',
        '<a data-kind="mastodon" href="https://author.example/@wave"></a>',
        '<a data-kind="threads" href="https://www.threads.net/@wave_author"></a>',
        '<a data-kind="tiktok" href="https://www.tiktok.com/@wave_author"></a>',
        '<a data-kind="youtube" href="https://www.youtube.com/wave-author"></a>',
        '<a data-kind="instagram" href="https://www.instagram.com/wave_author"></a>',
        '</section>',
      ].join(''),
    );
  });

  // Issue #680: keep the render-engine helper smoke exact. The helper unit
  // tests cover branches; this pins the byte-level HTML shape after
  // createEngine wires the helpers, root data frame, and route context
  // together.
  test('render-engine helper smoke output is byte-for-byte stable (issue #680)', () => {
    const theme = makeTheme({
      post: [
        '{{navigation}}',
        '|{{pagination}}',
        '|{{#link href="/about/" target="_blank" class="cta"}}About{{/link}}',
        '|{{asset "css/screen.css"}}',
        '|{{img_url feature_image size="s" format="webp" absolute=true}}',
        '|{{url absolute=true}}',
      ].join(''),
    });
    theme.pkg.image_sizes = { s: { width: 320 } };
    const content = makeContent();
    content.site.navigation = [
      { label: 'Home', url: '/' },
      { label: 'Hello', url: '/hello/' },
    ];
    const engine = createEngine({ config: makeConfig(), content, theme });
    const post = makePost({
      title: 'Hello',
      url: '/hello/',
      feature_image: '/content/images/hero.jpg',
    });

    const html = engine.render({
      kind: 'post',
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'post',
      data: {
        post,
        pagination: {
          page: 2,
          pages: 3,
          total: 30,
          limit: 10,
          prev: 1,
          next: 3,
          prev_url: '/page/1/',
          next_url: '/page/3/',
          base_url: '/',
        },
      },
      meta: baseMeta,
    });

    expect(html).toBe(
      [
        '<ul class="nav"><li class="nav-home"><a href="/">Home</a></li><li class="nav-hello" aria-current="page"><a href="/hello/" aria-current="page">Hello</a></li></ul>',
        '<nav class="pagination" role="navigation" aria-label="Pagination"><a class="newer-posts" href="/page/1/">&larr; Newer Posts</a><span class="page-number">Page 2 of 3</span><a class="older-posts" href="/page/3/">Older Posts &rarr;</a></nav>',
        '<a href="/about/" class="cta" target="_blank" rel="noopener noreferrer">About</a>',
        '/assets/css/screen.css',
        'https://example.com/content/images/size/w320/format/webp/hero.jpg',
        'https://example.com/hello/',
      ].join('|'),
    );
  });

  // Issue #1305: themes (Edition, Source) use `{{> "content" width="wide"}}`
  // to pass layout flags down to the partial body. Handlebars supports this
  // natively as long as we call `hb.registerPartial` with the partial source
  // (which we do), so this is a regression / contract test: if a future
  // refactor of `registerPartials` ever pre-compiles partials without the
  // `noEscape` flag or breaks hash arg pass-through, the test will catch it.
  test('hash params flow into partial bodies (issue #1305)', () => {
    const theme = makeTheme({
      default: '<!doctype html><body>{{{body}}}</body>',
      post: '{{!< default}}\n{{> "content" width="wide" tone="dark"}}',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    // Theme-shipped partial that reads its hash params via the partial scope.
    engine.hb.registerPartial(
      'content',
      '<article class="kg-width-{{width}} kg-tone-{{tone}}">{{post.title}}</article>',
    );
    const post: Post = makePost({ title: 'Hash' });
    const route: RouteContext = {
      kind: 'post',
      url: '/hash/',
      outputPath: 'hash/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const html = engine.render(route);
    expect(html).toContain('<article class="kg-width-wide kg-tone-dark">Hash</article>');
  });

  test('theme partial hash params create a partial scope for header background (issue #727)', () => {
    const theme = makeTheme(
      {
        post: '{{> "header" background=feature_image}}',
      },
      {
        header:
          '{{#if background}}<header data-background="{{background}}">{{title}}</header>{{else}}no background{{/if}}',
      },
    );
    const post: Post = makePost({
      title: 'Liebling header',
      feature_image: '/content/images/liebling-cover.jpg',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    const html = engine.render({
      kind: 'post',
      url: '/liebling-header/',
      outputPath: 'liebling-header/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    });

    expect(html).toBe(
      '<header data-background="/content/images/liebling-cover.jpg">Liebling header</header>',
    );
  });

  test('nested templates resolve parent-directory layout directives (issue #721)', () => {
    const theme = makeTheme({
      'default-wide': '<!doctype html><body data-layout="wide">{{{body}}}</body>',
      'members/account': '{{!< ../default-wide}}\n<main data-template="account">Account</main>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const route: RouteContext = {
      kind: 'home',
      url: '/account/',
      outputPath: 'account/index.html',
      template: 'members/account',
      data: {},
      meta: baseMeta,
    };

    expect(engine.templateLayoutNames?.get('members/account')).toBe('default-wide');
    expect(engine.render(route)).toBe(
      '<!doctype html><body data-layout="wide"><main data-template="account">Account</main></body>',
    );
  });

  test('parent-directory partial includes fail with a policy error', () => {
    const theme = makeTheme({
      home: '{{> "../components/header"}}',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };

    expect(() => engine.render(route)).toThrow(
      "Unsupported partial include '../components/header'",
    );
    expect(() => engine.render(route)).toThrow('cannot use ../ parent segments');
  });

  test('Windows-style partial paths register under POSIX names (issue #991)', () => {
    const theme = makeTheme(
      {
        home: '<main>{{> "components/card"}}</main>',
      },
      {
        'components\\card': '<article data-partial="card">Card</article>',
      },
    );
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };

    expect(typeof engine.hb.partials['components/card']).toBe('function');
    expect(engine.render(route)).toBe('<main><article data-partial="card">Card</article></main>');
  });

  test('missing theme partials render empty and warn once instead of crashing (issue #990)', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const theme = makeTheme({
        home: '<span>before</span>{{> "icons/avatar"}}<span>after</span>{{> "icons/avatar"}}',
      });
      const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
      const route: RouteContext = {
        kind: 'home',
        url: '/',
        outputPath: 'index.html',
        template: 'home',
        data: {},
        meta: baseMeta,
      };

      expect(engine.render(route)).toBe('<span>before</span><span>after</span>');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("missing partial 'icons/avatar'");
      expect(typeof engine.hb.partials['missing-partial']).toBe('function');
    } finally {
      warn.mockRestore();
    }
  });

  test('partial parse errors include the theme partial file and source line', () => {
    const theme = makeTheme(
      {
        home: '{{> "post-card"}}',
      },
      {
        'post-card': ['<article>', '  <h2>{{title}}</h2>', '  {{foo bar=}}', '</article>'].join(
          '\n',
        ),
      },
    );
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };

    expect(() => engine.render(route)).toThrow('Theme partial');
    expect(() => engine.render(route)).toThrow('{{foo bar=}}');

    try {
      engine.render(route);
      throw new Error('expected render to fail');
    } catch (err) {
      expect(err).toMatchObject({
        file: '/tmp/themes/fixture/partials/post-card.hbs',
        line: 3,
      });
    }
  });

  test('helper render errors include the calling template location', () => {
    const theme = makeTheme({
      home: ['<main>', '  {{boom}}', '</main>'].join('\n'),
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    engine.hb.registerHelper('boom', () => {
      throw new Error('exploded');
    });
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };

    expect(() => engine.render(route)).toThrow("Handlebars helper 'boom' failed");
    expect(() => engine.render(route)).toThrow('{{boom}}');

    try {
      engine.render(route);
      throw new Error('expected render to fail');
    } catch (err) {
      expect(err).toMatchObject({
        file: '/tmp/themes/fixture/home.hbs',
        line: 2,
        col: 3,
      });
    }
  });

  test('custom layout that includes {{> post}} renders only one layout wrapper, not two', () => {
    const theme = makeTheme({
      default: '<!doctype html><html><body data-layout="default">{{{body}}}</body></html>',
      post: '{{!< default}}\n<article class="post">{{post.title}}</article>',
      'custom-post': '{{!< default}}\n<section class="custom">{{> post}}</section>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const post: Post = makePost({ title: 'Hello' });
    const route: RouteContext = {
      kind: 'post',
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'custom-post',
      data: { post },
      meta: baseMeta,
    };
    const html = engine.render(route);
    expect(html.match(/data-layout="default"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<section class="custom">');
    expect(html).toContain('<article class="post">Hello</article>');
  });

  // Issue #435 / #185 / #186 / #187 / #192: child template `contentFor` →
  // parent layout `block`. The engine seeds a per-render `__blocks` bucket on
  // the shared data frame so the inner render writes and the layout reads
  // from the same object.
  test('contentFor in inner template flows through to {{{block}}} in layout', () => {
    const theme = makeTheme({
      default:
        '<html><head>{{{block "head"}}}</head><body>{{{body}}}{{{block "scripts"}}}</body></html>',
      post: [
        '{{!< default}}',
        '{{#contentFor "head"}}<meta name="x" content="y">{{/contentFor}}',
        '{{#contentFor "scripts"}}<script src="a.js"></script>{{/contentFor}}',
        '<article>{{post.title}}</article>',
      ].join('\n'),
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const post: Post = makePost({ title: 'Hi' });
    const route: RouteContext = {
      kind: 'post',
      url: '/hi/',
      outputPath: 'hi/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const html = engine.render(route);
    expect(html).toContain('<head><meta name="x" content="y"></head>');
    expect(html).toContain('<article>Hi</article>');
    expect(html).toContain('<script src="a.js"></script></body>');
  });

  test('contentFor in theme partial flows through to {{{block}}} in layout head (issue #724)', () => {
    const theme = makeTheme(
      {
        default: '<html><head>{{{block "herobackground"}}}</head><body>{{{body}}}</body></html>',
        post: '{{!< default}}\n{{> "hero"}}\n<article>{{post.title}}</article>',
      },
      {
        hero: [
          '{{#contentFor "herobackground"}}',
          '<style>.hero{background-image:url({{feature_image}})}</style>',
          '{{/contentFor}}',
          '<header>{{title}}</header>',
        ].join(''),
      },
    );
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const post: Post = makePost({ title: 'Hi', feature_image: '/content/images/hero.jpg' });
    const route: RouteContext = {
      kind: 'post',
      url: '/hi/',
      outputPath: 'hi/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const html = engine.render(route);
    expect(html).toContain(
      '<head><style>.hero{background-image:url(/content/images/hero.jpg)}</style></head>',
    );
    expect(html).toContain('<header>Hi</header>');
    expect(html).toContain('<article>Hi</article>');
  });

  test('contentFor blocks do not leak across routes', () => {
    const theme = makeTheme({
      default: '<html>{{{block "head"}}}|{{{body}}}</html>',
      post: '{{!< default}}\n{{#contentFor "head"}}H={{post.title}}{{/contentFor}}P',
      page: '{{!< default}}\nQ',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const first = engine.render({
      kind: 'post',
      url: '/a/',
      outputPath: 'a/index.html',
      template: 'post',
      data: { post: makePost({ title: 'A' }) },
      meta: baseMeta,
    });
    const second = engine.render({
      kind: 'page',
      url: '/b/',
      outputPath: 'b/index.html',
      template: 'page',
      data: {},
      meta: baseMeta,
    });
    expect(first).toContain('H=A|');
    // Second render must not see the first render's "head" content.
    expect(second).toBe('<html>|Q</html>');
  });

  // Biron uses `{{{error.message}}}` for a runtime subscribe POST error
  // display. Nectar does not seed that context on normal static routes, and
  // Handlebars should resolve the missing path to an empty string rather than
  // crashing the render.
  test('missing runtime error context renders empty on normal routes (issue #1704)', () => {
    const theme = makeTheme({
      index: '<main>before{{{error.message}}}after</main>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const html = engine.render({
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'index',
      data: {},
      meta: baseMeta,
    });
    expect(html).toBe('<main>beforeafter</main>');
  });

  test('Wave-style popup guard renders without adding the popup class (issue #1721)', () => {
    const theme = makeTheme({
      default: '<body class="{{#if is_popup}}popup{{/if}}">{{{body}}}</body>',
      index: '{{!< default}}<main>body</main>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const html = engine.render({
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'index',
      data: {},
      meta: baseMeta,
    });
    expect(html).toBe('<body class=""><main>body</main></body>');
  });
});

// Issue #552: template-as-partial registration must not clobber a theme
// partial of the same bare name. A theme that ships `partials/index.hbs`
// expects `{{> index}}` to resolve to its partial, not to the layout-stripped
// body of `index.hbs`. The template body stays reachable via the dedicated
// `__template__/<name>` namespace as an escape hatch.
describe('createEngine — template-as-partial namespace collision (issue #552)', () => {
  function makeTheme(opts: {
    templates?: Record<string, string>;
    partials?: Record<string, string>;
  }): ThemeBundle {
    const pkg: ThemePackage = {
      name: 'fixture',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    };
    return {
      name: 'fixture',
      rootDir: '/tmp/themes/fixture',
      templates: opts.templates ?? {},
      partials: opts.partials ?? {},
      pkg,
      locales: {},
      assets: new Map(),
    };
  }

  function makeConfig(): NectarConfig {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        lang: 'en',
        navigation: [],
        secondary_navigation: [],
      },
      build: { output_dir: 'dist', base_path: '' },
      components: {},
      theme: { dir: 'themes', name: 'fixture', custom: {} },
      recommendations: [],
    } as unknown as NectarConfig;
  }

  function makeContent(): ContentGraph {
    return {
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      site: {
        title: 'Example',
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
        accent_color: '#000',
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
    } as unknown as ContentGraph;
  }

  test('a theme partial named `index` wins over the index.hbs template body on `{{> index}}`', () => {
    const theme = makeTheme({
      templates: {
        index: '<section data-source="template">template body</section>',
        home: '{{> index}}',
      },
      partials: {
        index: '<section data-source="partial">theme partial body</section>',
      },
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    expect(typeof engine.hb.partials.index).toBe('function');
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const html = engine.render(route);
    expect(html).toContain('data-source="partial"');
    expect(html).not.toContain('data-source="template"');
  });

  test('exposes the template body under `__template__/<name>` even when a same-named theme partial exists', () => {
    const theme = makeTheme({
      templates: {
        index: '<section data-source="template">template body</section>',
      },
      partials: {
        index: '<section data-source="partial">theme partial body</section>',
      },
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const partial = engine.hb.partials['__template__/index'] as Handlebars.TemplateDelegate;
    expect(typeof partial).toBe('function');
    expect(partial({}, { data: {} })).toBe(
      '<section data-source="template">template body</section>',
    );
  });

  test('without a colliding theme partial, the template body stays reachable under its bare name', () => {
    const theme = makeTheme({
      templates: {
        post: '<article>{{post.title}}</article>',
      },
      partials: {},
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const postPartial = engine.hb.partials.post as Handlebars.TemplateDelegate;
    const templatePartial = engine.hb.partials['__template__/post'] as Handlebars.TemplateDelegate;
    expect(typeof postPartial).toBe('function');
    expect(typeof templatePartial).toBe('function');
    expect(postPartial({ post: { title: 'Hello' } }, { data: {} })).toBe(
      '<article>Hello</article>',
    );
    expect(templatePartial({ post: { title: 'Hello' } }, { data: {} })).toBe(
      '<article>Hello</article>',
    );
  });
});

// Issue #1135: Nectar ships a default `{{> search}}` partial so themes can
// drop in the search widget without authoring markup themselves. Themes that
// prefer their own UI must still be able to override by shipping
// `partials/search.hbs`.
describe('createEngine — default search partial (issue #1135)', () => {
  function makeTheme(opts: {
    templates?: Record<string, string>;
    partials?: Record<string, string>;
  }): ThemeBundle {
    const pkg: ThemePackage = {
      name: 'fixture',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    };
    return {
      name: 'fixture',
      rootDir: '/tmp/themes/fixture',
      templates: opts.templates ?? {},
      partials: opts.partials ?? {},
      pkg,
      locales: {},
      assets: new Map(),
    };
  }

  function makeConfig(): NectarConfig {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        lang: 'en',
        navigation: [],
        secondary_navigation: [],
      },
      build: { output_dir: 'dist', base_path: '' },
      components: {},
      theme: { dir: 'themes', name: 'fixture', custom: {} },
      recommendations: [],
    } as unknown as NectarConfig;
  }

  function makeContent(): ContentGraph {
    return {
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      site: {
        title: 'Example',
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
        accent_color: '#000',
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
    } as unknown as ContentGraph;
  }

  test('registers a default `search` partial themes can include via {{> search}}', () => {
    const theme = makeTheme({});
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const partial = engine.hb.partials.search;
    expect(typeof partial).toBe('string');
    const source = partial as string;
    expect(source).toContain('<search');
    expect(source).toContain('</search>');
    expect(source).toContain('data-nectar-search');
    expect(source).toContain('data-nectar-search-results');
  });

  test('the default `search` partial is also reachable as `partials/search`', () => {
    const theme = makeTheme({});
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    expect(engine.hb.partials['partials/search']).toBe(engine.hb.partials.search);
  });

  test('theme-supplied `partials/search.hbs` overrides the built-in default', () => {
    const theme = makeTheme({
      partials: { search: '<!-- theme search override -->' },
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const search = engine.hb.partials.search as Handlebars.TemplateDelegate;
    const qualified = engine.hb.partials['partials/search'] as Handlebars.TemplateDelegate;
    expect(search({}, { data: {} })).toBe('<!-- theme search override -->');
    expect(qualified({}, { data: {} })).toBe('<!-- theme search override -->');
  });

  test('a theme can render {{> search}} without shipping its own partial', () => {
    const theme = makeTheme({
      templates: {
        index: '<main>{{> search}}</main>',
      },
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'index',
      data: {},
      meta: baseMeta,
    };
    const html = engine.render(route);
    expect(html).toContain('<search class="nectar-search" data-nectar-search-root>');
    expect(html).toContain('data-nectar-search');
    expect(html).toContain('data-nectar-search-results');
  });

  // Issue #207: Nectar also ships a default `{{> paywall}}` partial used in
  // place of gated content. Same override semantics as the search partial.
  test('registers a default `paywall` partial themes can include via {{> paywall}}', () => {
    const theme = makeTheme({});
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const partial = engine.hb.partials.paywall;
    expect(typeof partial).toBe('string');
    const source = partial as string;
    expect(source).toContain('data-portal="signup"');
    expect(source).toContain('gh-paywall');
  });

  test('the default `paywall` partial is also reachable as `partials/paywall`', () => {
    const theme = makeTheme({});
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    expect(engine.hb.partials['partials/paywall']).toBe(engine.hb.partials.paywall);
  });

  test('theme-supplied `partials/paywall.hbs` overrides the built-in default', () => {
    const theme = makeTheme({
      partials: { paywall: '<!-- theme paywall override -->' },
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const paywall = engine.hb.partials.paywall as Handlebars.TemplateDelegate;
    const qualified = engine.hb.partials['partials/paywall'] as Handlebars.TemplateDelegate;
    expect(paywall({}, { data: {} })).toBe('<!-- theme paywall override -->');
    expect(qualified({}, { data: {} })).toBe('<!-- theme paywall override -->');
  });
});

describe('createEngine — Bulletin feature image width custom setting', () => {
  function makeTheme(customDefaults: Record<string, unknown>): ThemeBundle {
    const pkg: ThemePackage = {
      name: 'bulletin',
      version: '1.0.0',
      posts_per_page: 10,
      image_sizes: {},
      card_assets: true,
      custom: {
        feature_image_width: {
          type: 'select',
          options: ['Full', 'Wide', 'Small'],
          default: 'Wide',
        },
      },
      customDefaults,
    };
    return {
      name: 'bulletin',
      rootDir: '/tmp/themes/bulletin',
      templates: {
        post: [
          '{{!< default}}',
          '<article class="gh-article">',
          '{{> "article"}}',
          '</article>',
        ].join('\n'),
        default: '<!doctype html><body>{{{body}}}</body>',
      },
      partials: {
        article:
          '<header class="gh-article-header gh-canvas{{#match @custom.feature_image_width "Full"}} image-full{{else match @custom.feature_image_width "=" "Wide"}} image-wide{{/match}}">{{title}}</header>',
      },
      pkg,
      locales: {},
      assets: new Map(),
    };
  }

  function makeConfig(custom: Record<string, unknown> = {}): NectarConfig {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        lang: 'en',
        navigation: [],
        secondary_navigation: [],
      },
      build: { output_dir: 'dist', base_path: '' },
      components: {},
      theme: { dir: 'themes', name: 'bulletin', custom },
      recommendations: [],
    } as unknown as NectarConfig;
  }

  function makeContent(): ContentGraph {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        accent_color: '#000000',
      },
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      byId: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
    };
  }

  test('default Wide value triggers Bulletin image-wide header class', () => {
    const engine = createEngine({
      config: makeConfig(),
      content: makeContent(),
      theme: makeTheme({ feature_image_width: 'Wide' }),
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/wide/',
      outputPath: 'wide/index.html',
      template: 'post',
      data: { post: makePost({ title: 'Wide header' }) },
      meta: baseMeta,
    };

    const html = engine.render(route);
    expect(html).toContain('gh-article-header gh-canvas image-wide');
    expect(html).not.toContain('image-full');
  });

  test('config override string remains matchable by Bulletin article partial', () => {
    const engine = createEngine({
      config: makeConfig({ feature_image_width: 'Wide' }),
      content: makeContent(),
      theme: makeTheme({ feature_image_width: 'Small' }),
    });
    const route: RouteContext = {
      kind: 'post',
      url: '/wide/',
      outputPath: 'wide/index.html',
      template: 'post',
      data: { post: makePost({ title: 'Wide override' }) },
      meta: baseMeta,
    };

    const html = engine.render(route);
    expect(html).toContain('gh-article-header gh-canvas image-wide');
  });
});

describe('createEngine — Solo header section layout custom setting', () => {
  function makeTheme(customDefaults: Record<string, unknown>): ThemeBundle {
    const pkg: ThemePackage = {
      name: 'solo',
      version: '1.0.0',
      posts_per_page: 10,
      image_sizes: {},
      card_assets: true,
      custom: {
        header_section_layout: {
          type: 'select',
          options: ['Typographic profile', 'Side by side'],
          default: 'Typographic profile',
        },
      },
      customDefaults,
    };
    return {
      name: 'solo',
      rootDir: '/tmp/themes/solo',
      templates: {
        index:
          '<section class="gh-header{{#match @custom.header_section_layout "Typographic profile"}} is-typographic{{/match}}">Solo</section>',
      },
      partials: {},
      pkg,
      locales: {},
      assets: new Map(),
    };
  }

  function makeConfig(custom: Record<string, unknown> = {}): NectarConfig {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        lang: 'en',
        navigation: [],
        secondary_navigation: [],
      },
      build: { output_dir: 'dist', base_path: '' },
      components: {},
      theme: { dir: 'themes', name: 'solo', custom },
      recommendations: [],
    } as unknown as NectarConfig;
  }

  function makeContent(): ContentGraph {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        accent_color: '#000000',
      },
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      byId: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
    };
  }

  function makeRoute(): RouteContext {
    return {
      kind: 'index',
      url: '/',
      outputPath: 'index.html',
      template: 'index',
      data: {},
      meta: baseMeta,
    };
  }

  test('default Typographic profile value remains matchable by Solo default template', () => {
    const engine = createEngine({
      config: makeConfig(),
      content: makeContent(),
      theme: makeTheme({ header_section_layout: 'Typographic profile' }),
    });

    expect(engine.render(makeRoute())).toContain('gh-header is-typographic');
  });

  test('config override Typographic profile remains matchable by Solo default template', () => {
    const engine = createEngine({
      config: makeConfig({ header_section_layout: 'Typographic profile' }),
      content: makeContent(),
      theme: makeTheme({ header_section_layout: 'Side by side' }),
    });

    expect(engine.render(makeRoute())).toContain('gh-header is-typographic');
  });
});

// Issue #150: renderRoute() must reuse the precompiled inner+layout delegates
// from createEngine() instead of re-running hb.compile per route. On a 10k post
// blog the regression cost is ~20k extra compile passes plus the AST GC churn.
// These tests pin the contract: engine.templates / engine.layouts are populated
// at createEngine time and renderRoute is a pure lookup afterwards.
describe('createEngine — precompiled template+layout cache (issue #150)', () => {
  function makeTheme(templates: Record<string, string>): ThemeBundle {
    const pkg: ThemePackage = {
      name: 'fixture',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    };
    return {
      name: 'fixture',
      rootDir: '/tmp/themes/fixture',
      templates,
      partials: {},
      pkg,
      locales: {},
      assets: new Map(),
    };
  }

  function makeConfig(): NectarConfig {
    return {
      site: {
        title: 'Example',
        description: 'desc',
        url: 'https://example.com',
        locale: 'en',
        timezone: 'UTC',
        lang: 'en',
        navigation: [],
        secondary_navigation: [],
      },
      build: { output_dir: 'dist', base_path: '' },
      components: {},
      theme: { dir: 'themes', name: 'fixture', custom: {} },
      recommendations: [],
    } as unknown as NectarConfig;
  }

  function makeContent(): ContentGraph {
    return {
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: {
        posts: new Map(),
        pages: new Map(),
        tags: new Map(),
        authors: new Map(),
      },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      site: {
        title: 'Example',
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
        accent_color: '#000',
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
    } as unknown as ContentGraph;
  }

  test('engine.templates and engine.layouts are populated for every theme template at createEngine time', () => {
    const theme = makeTheme({
      default: '<!doctype html><body>{{{body}}}</body>',
      post: '{{!< default}}\n<article>{{post.title}}</article>',
      home: '<section>{{@site.title}}</section>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    expect(typeof engine.templates.default).toBe('function');
    expect(typeof engine.templates.post).toBe('function');
    expect(typeof engine.templates.home).toBe('function');
    expect(typeof engine.layouts.default).toBe('function');
    expect(typeof engine.layouts.post).toBe('function');
    expect(typeof engine.layouts.home).toBe('function');
  });

  test('rendering the same route 100 times triggers zero additional hb.compile calls', () => {
    const theme = makeTheme({
      default: '<!doctype html><body data-layout="default">{{{body}}}</body>',
      post: '{{!< default}}\n<article>{{post.title}}</article>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });

    // Spy on hb.compile AFTER createEngine returns. Every compile call from
    // here on means a route render is doing work it shouldn't be doing.
    const originalCompile = engine.hb.compile.bind(engine.hb);
    let compileCount = 0;
    engine.hb.compile = ((...args: Parameters<typeof Handlebars.compile>) => {
      compileCount += 1;
      return originalCompile(...args);
    }) as typeof Handlebars.compile;

    const post: Post = makePost({ title: 'Hello' });
    const route: RouteContext = {
      kind: 'post',
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };

    for (let i = 0; i < 100; i += 1) {
      engine.render(route);
    }
    expect(compileCount).toBe(0);
  });

  test('renderRoute reuses the same compiled delegate references across calls', () => {
    const theme = makeTheme({
      default: '<!doctype html><body>{{{body}}}</body>',
      post: '{{!< default}}\n<article>{{post.title}}</article>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    const innerBefore = engine.templates.post;
    const layoutBefore = engine.layouts.default;
    const post: Post = makePost({ title: 'Hello' });
    const route: RouteContext = {
      kind: 'post',
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    engine.render(route);
    engine.render(route);
    expect(engine.templates.post).toBe(innerBefore);
    expect(engine.layouts.default).toBe(layoutBefore);
  });
});
