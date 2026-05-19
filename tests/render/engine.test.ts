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
});

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
        recommendations_enabled: false,
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
        recommendations_enabled: false,
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
});
