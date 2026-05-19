import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerBlockHelpers } from '~/render/helpers/blocks.ts';

function buildEngine(content: {
  posts?: unknown[];
  tags?: unknown[];
  authors?: unknown[];
  pages?: unknown[];
}): NectarEngine {
  const hb = Handlebars.create();
  const engine = {
    hb,
    config: {} as NectarEngine['config'],
    content: {
      posts: content.posts ?? [],
      tags: content.tags ?? [],
      authors: content.authors ?? [],
      pages: content.pages ?? [],
    } as unknown as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map<string, readonly unknown[]>(),
    render: () => '',
  } as NectarEngine;
  registerBlockHelpers(engine);
  return engine;
}

const samplePosts = [
  {
    id: 'a',
    slug: 'a',
    title: 'A',
    published_at: '2026-05-19T00:00:00.000Z',
    featured: true,
    tags: [{ slug: 'news', name: 'News' }],
    authors: [{ slug: 'alice', name: 'Alice' }],
  },
  {
    id: 'b',
    slug: 'b',
    title: 'B',
    published_at: '2026-05-18T00:00:00.000Z',
    featured: false,
    tags: [{ slug: 'news', name: 'News' }],
    authors: [{ slug: 'bob', name: 'Bob' }],
  },
  {
    id: 'c',
    slug: 'c',
    title: 'C',
    published_at: '2026-05-17T00:00:00.000Z',
    featured: true,
    tags: [{ slug: 'opinion', name: 'Opinion' }],
    authors: [{ slug: 'alice', name: 'Alice' }],
  },
];

describe('get helper filter via secondary indexes', () => {
  test('filters by tag slug using the index', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:news" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,b,');
    expect(engine.filterIndexCache?.has('posts')).toBe(true);
  });

  test('filters by tag name (not just slug) using the index', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:Opinion" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('c,');
  });

  test('intersects AND clauses across indexed keys', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:news+author:alice" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,');
  });

  test('handles negation against the indexed set', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:news+id:-{{post.id}}" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({ post: { id: 'a' } })).toBe('b,');
  });

  test('handles list values like tag:[a,b]', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:[news,opinion]" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,b,c,');
  });

  test('falls back to a per-item evaluation for unindexed keys', () => {
    const engine = buildEngine({
      posts: [
        { ...samplePosts[0], visibility: 'public' },
        { ...samplePosts[1], visibility: 'members' },
        { ...samplePosts[2], visibility: 'public' },
      ],
    });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="visibility:members" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('b,');
  });

  test('caches the index across calls', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    tpl({});
    const built = engine.filterIndexCache?.get('posts');
    tpl({});
    expect(engine.filterIndexCache?.get('posts')).toBe(built);
  });

  test('index lookup beats linear scan by orders of magnitude on large sets', () => {
    const N = 5_000;
    const posts = Array.from({ length: N }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      title: `T${i}`,
      published_at: '2026-05-19T00:00:00.000Z',
      featured: i % 50 === 0,
      tags: [{ slug: i % 3 === 0 ? 'news' : 'other', name: i % 3 === 0 ? 'News' : 'Other' }],
      authors: [{ slug: 'alice', name: 'Alice' }],
    }));
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true+tag:news" limit=10 as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    const first = tpl({});
    expect(first.length).toBeGreaterThan(0);

    const start = performance.now();
    for (let i = 0; i < 50; i += 1) tpl({});
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// Source theme's `partials/components/featured.hbs` wraps its `<section>` inside
// `{{#get "posts" filter="featured:true"}}` so that when no post is marked
// featured the whole section is suppressed. Before #1007 we only ever
// exercised the path where featured posts existed; these tests pin down the
// empty-result behavior so a future change to `applyGetFilter` can't silently
// start emitting an empty `<section class="gh-featured">` on the home page.
describe('get helper filter on empty featured result', () => {
  test('skips the block body when filter="featured:true" matches nothing', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        title: 'A',
        published_at: '2026-05-19T00:00:00.000Z',
        featured: false,
        tags: [],
        authors: [],
      },
      {
        id: 'b',
        slug: 'b',
        title: 'B',
        published_at: '2026-05-18T00:00:00.000Z',
        featured: false,
        tags: [],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `<wrap>{{#get "posts" filter="featured:true" as |featured|}}<section>{{#foreach featured}}{{id}},{{/foreach}}</section>{{/get}}</wrap>`,
    );
    expect(tpl({})).toBe('<wrap></wrap>');
  });

  test('renders the {{else}} branch when filter="featured:true" matches nothing', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        title: 'A',
        published_at: '2026-05-19T00:00:00.000Z',
        featured: false,
        tags: [],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true" as |featured|}}<section>{{#foreach featured}}{{id}},{{/foreach}}</section>{{else}}no-featured{{/get}}`,
    );
    expect(tpl({})).toBe('no-featured');
  });

  test('returns empty when the posts collection itself is empty', () => {
    const engine = buildEngine({ posts: [] });
    const tpl = engine.hb.compile(
      `<wrap>{{#get "posts" filter="featured:true" as |featured|}}<section>{{#foreach featured}}{{id}},{{/foreach}}</section>{{/get}}</wrap>`,
    );
    expect(tpl({})).toBe('<wrap></wrap>');
  });

  test('builds the featured index bucket even when no post is featured', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        title: 'A',
        published_at: '2026-05-19T00:00:00.000Z',
        featured: false,
        tags: [],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true" as |featured|}}hit{{else}}miss{{/get}}`,
    );
    tpl({});
    // Index must be populated so subsequent `featured:false` lookups also use
    // the secondary index instead of falling back to a linear scan.
    const featuredMap = engine.filterIndexCache?.get('posts')?.get('featured');
    expect(featuredMap).toBeDefined();
    expect(featuredMap?.get('false')?.size).toBe(1);
    expect(featuredMap?.has('true')).toBe(false);
  });

  test('still hits the index on subsequent featured:false call after empty featured:true', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        title: 'A',
        published_at: '2026-05-19T00:00:00.000Z',
        featured: false,
        tags: [],
        authors: [],
      },
      {
        id: 'b',
        slug: 'b',
        title: 'B',
        published_at: '2026-05-18T00:00:00.000Z',
        featured: false,
        tags: [],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tplTrue = engine.hb.compile(
      `{{#get "posts" filter="featured:true" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{else}}empty{{/get}}`,
    );
    const tplFalse = engine.hb.compile(
      `{{#get "posts" filter="featured:false" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tplTrue({})).toBe('empty');
    expect(tplFalse({})).toBe('a,b,');
  });
});
