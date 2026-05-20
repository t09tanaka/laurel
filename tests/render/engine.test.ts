import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post, Tag } from '~/content/model.ts';
import { type NectarEngine, buildContext, buildRootData, createEngine } from '~/render/engine.ts';
import { registerBlockHelpers } from '~/render/helpers/blocks.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle, ThemePackage } from '~/theme/types.ts';

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
    comments: false,
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
    visibility: slug.startsWith('hash-') ? 'internal' : 'public',
    meta_title: undefined,
    meta_description: undefined,
    url: `/tag/${slug}/`,
    count: { posts: 0 },
    ...overrides,
  };
}

describe('buildContext', () => {
  test('on a post route, ctx.post is the post object', () => {
    const post = makePost();
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
          meta_title: undefined,
          meta_description: undefined,
          url: '/author/jane/',
        },
      },
      meta: baseMeta,
    };
    const authorTokens = String(buildContext(engine, authorRoute).body_class).split(' ');
    expect(authorTokens).toContain('author-template');
    expect(authorTokens).toContain('archive-template');
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
    const route: RouteContext = {
      kind: 'home',
      url: '/',
      outputPath: 'index.html',
      template: 'home',
      data: {},
      meta: baseMeta,
    };
    const data = buildRootData(engine, route);
    const config = data.config as Record<string, unknown>;
    expect(config.build).toBeUndefined();
    expect(config.theme).toBeUndefined();
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

  // Issue #122: Source theme reads `@member` in header / footer / CTA / nav /
  // post-list. Nectar has no logged-in viewer, so `@member` must be undefined
  // on every route. The data frame must still ship the key so themes don't see
  // a missing-property warning under strict mode and so the falsy-branch
  // semantics are deterministic across routes.
  test('@member is undefined on every route kind (issue #122)', () => {
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
      expect(data.member).toBeUndefined();
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
});

// Regression coverage for issue #1131: some Ghost themes use `{{> post}}` from
// a custom layout to render the post body. Templates were registered as
// partials using the raw source, which still carried the `{{!< default}}`
// layout directive. That directive must not survive into the partial — when a
// custom layout already extends `default`, re-including the post template
// would otherwise re-stamp the layout into the inner body, producing
// duplicated output or surprising the helpers that walk `@root.body`.
describe('createEngine — templates registered as partials (issue #1131)', () => {
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
    expect(typeof partial).toBe('string');
    const partialSource = partial as string;
    expect(partialSource).not.toContain('{{!< default}}');
    expect(partialSource).toContain('<article>{{post.title}}</article>');
  });

  test('templates with no layout directive register as partials with the original source', () => {
    const theme = makeTheme({
      home: '<section>{{@site.title}}</section>',
    });
    const engine = createEngine({ config: makeConfig(), content: makeContent(), theme });
    expect(engine.hb.partials.home).toBe('<section>{{@site.title}}</section>');
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
    expect(engine.hb.partials.index).toBe(
      '<section data-source="partial">theme partial body</section>',
    );
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
    expect(engine.hb.partials['__template__/index']).toBe(
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
    expect(engine.hb.partials.post).toBe('<article>{{post.title}}</article>');
    expect(engine.hb.partials['__template__/post']).toBe('<article>{{post.title}}</article>');
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
    expect(engine.hb.partials.search).toBe('<!-- theme search override -->');
    expect(engine.hb.partials['partials/search']).toBe('<!-- theme search override -->');
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
    expect(engine.hb.partials.paywall).toBe('<!-- theme paywall override -->');
    expect(engine.hb.partials['partials/paywall']).toBe('<!-- theme paywall override -->');
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
