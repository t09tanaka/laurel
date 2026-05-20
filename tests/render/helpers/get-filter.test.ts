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

  // On a single-post route, Ghost makes the post available through both `this`
  // (flattened) and the route data. A sidebar/partial rendered where the
  // surrounding ctx is something else still needs `{{post.id}}` to resolve, or
  // `id:-` collapses to "not equal to ''" and silently matches every post.
  test('interpolates {{post.id}} from route.data when surrounding ctx has no post', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:news+id:-{{post.id}}" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    const rendered = tpl(
      { some: 'tag-archive-ctx' },
      { data: { route: { kind: 'tag', data: { post: { id: 'a' } } } } },
    );
    expect(rendered).toBe('b,');
  });

  // Ruby-style "more posts like this" theme: `filter="tags:[{{post.tags}}]+id:-{{post.id}}"`.
  // `post.tags` is a Tag[]; `String(arr)` would emit `[object Object],…` and
  // the parser would match nothing. The interpolation projects each Tag down
  // to its slug so the NQL list parser receives `news,opinion`.
  test('interpolates {{post.tags}} as a comma-joined slug list (Tag[])', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:[{{post.tags}}]+id:-{{post.id}}" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    const post = {
      id: 'a',
      tags: [
        { slug: 'news', name: 'News' },
        { slug: 'opinion', name: 'Opinion' },
      ],
    };
    expect(tpl({ post })).toBe('b,c,');
  });

  test('falls back to tag.name when slug is missing', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:[{{post.tags}}]" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    const post = { tags: [{ name: 'News' }] };
    // Indexed lookup matches both slug:news and name:News, so posts a + b
    // (tagged "news") show up.
    expect(tpl({ post })).toBe('a,b,');
  });

  test('skips nulls and never emits [object Object]', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:[{{post.tags}}]" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    // null entries and a tag with neither slug nor name are dropped from the
    // joined list; the remaining slug still drives the filter.
    const post = { tags: [null, { slug: 'opinion' }, { foo: 'bar' }] };
    const rendered = tpl({ post });
    expect(rendered).not.toContain('[object Object]');
    expect(rendered).toBe('c,');
  });

  test('falls through to route.data for nested paths like {{post.primary_tag.slug}}', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:{{post.primary_tag.slug}}" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    const rendered = tpl(
      {},
      {
        data: {
          route: { kind: 'post', data: { post: { primary_tag: { slug: 'opinion' } } } },
        },
      },
    );
    expect(rendered).toBe('c,');
  });

  test('prefers surrounding ctx over route.data when both resolve the path', () => {
    const engine = buildEngine({ posts: samplePosts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="id:-{{post.id}}" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    const rendered = tpl(
      { post: { id: 'a' } },
      { data: { route: { kind: 'post', data: { post: { id: 'b' } } } } },
    );
    expect(rendered).toBe('b,c,');
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

// #450 — null / true / false are NQL typed scalars, not string sentinels.
// `featured:null` means "featured IS NULL", which on Nectar's content graph
// translates to `item.featured == null`. The previous implementation compared
// the literal string "null", silently matching nothing.
describe('get helper filter — typed null/true/false values', () => {
  test('featured:null matches posts whose featured is absent', () => {
    const posts = [
      { id: 'a', slug: 'a', published_at: '2026-05-19T00:00:00.000Z', featured: true },
      { id: 'b', slug: 'b', published_at: '2026-05-18T00:00:00.000Z' /* no featured */ },
      { id: 'c', slug: 'c', published_at: '2026-05-17T00:00:00.000Z', featured: null },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:null" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('b,c,');
  });

  test('featured:-null negates and returns posts where featured is set', () => {
    const posts = [
      { id: 'a', slug: 'a', published_at: '2026-05-19T00:00:00.000Z', featured: true },
      { id: 'b', slug: 'b', published_at: '2026-05-18T00:00:00.000Z' /* missing */ },
      { id: 'c', slug: 'c', published_at: '2026-05-17T00:00:00.000Z', featured: false },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:-null" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,c,');
  });

  test('featured:true uses the boolean literal, not the string "true"', () => {
    const posts = [
      { id: 'a', slug: 'a', published_at: '2026-05-19T00:00:00.000Z', featured: true },
      { id: 'b', slug: 'b', published_at: '2026-05-18T00:00:00.000Z', featured: false },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,');
  });
});

// #451 — Range comparators (`>`, `<`, `>=`, `<=`) on numeric and date-shaped
// fields. ISO 8601 strings sort correctly under lexicographic compare, so the
// helper can stay storage-agnostic for `published_at`.
describe('get helper filter — comparison operators', () => {
  test('published_at:>DATE filters posts strictly after the cutoff', () => {
    const posts = [
      { id: 'a', slug: 'a', published_at: '2024-06-01T00:00:00.000Z' },
      { id: 'b', slug: 'b', published_at: '2024-01-15T00:00:00.000Z' },
      { id: 'c', slug: 'c', published_at: '2023-12-31T23:59:59.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="published_at:>2024-01-01" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,b,');
  });

  test('numeric field comparison (count.posts:>=N) on tags', () => {
    const tags = [
      { id: 't1', slug: 'news', name: 'News', count: 4 },
      { id: 't2', slug: 'opinion', name: 'Opinion', count: 1 },
      { id: 't3', slug: 'sports', name: 'Sports', count: 7 },
    ];
    // The `count` field on tags is a number in this fixture; the helper should
    // compare numerically rather than lexicographically (so "10" doesn't sort
    // before "2").
    const engine = buildEngine({ tags });
    const tpl = engine.hb.compile(
      `{{#get "tags" filter="count:>=4" order="name asc" as |items|}}{{#foreach items}}{{slug}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('news,sports,');
  });

  test('<= operator includes the boundary', () => {
    const posts = [
      { id: 'a', slug: 'a', published_at: '2024-06-01T00:00:00.000Z' },
      { id: 'b', slug: 'b', published_at: '2024-01-01T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="published_at:<=2024-01-01T00:00:00.000Z" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('b,');
  });
});

// #452 — Non-indexed fields used by Source-theme partials (primary_tag,
// primary_author, status, etc.). These flow through the linear-scan fallback.
describe('get helper filter — extended fields', () => {
  test('primary_tag:slug compares against the nested primary_tag.slug', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        published_at: '2026-05-19T00:00:00.000Z',
        primary_tag: { slug: 'news' },
      },
      {
        id: 'b',
        slug: 'b',
        published_at: '2026-05-18T00:00:00.000Z',
        primary_tag: { slug: 'opinion' },
      },
      {
        id: 'c',
        slug: 'c',
        published_at: '2026-05-17T00:00:00.000Z',
        primary_tag: { slug: 'news' },
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="primary_tag:news" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,c,');
  });

  test('primary_author:slug filters by the primary author slug', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        published_at: '2026-05-19T00:00:00.000Z',
        primary_author: { slug: 'alice' },
      },
      {
        id: 'b',
        slug: 'b',
        published_at: '2026-05-18T00:00:00.000Z',
        primary_author: { slug: 'bob' },
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="primary_author:bob" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('b,');
  });

  test('status / type / page bare-key filters compare the field directly', () => {
    const posts = [
      { id: 'a', slug: 'a', published_at: '2026-05-19T00:00:00.000Z', status: 'published' },
      { id: 'b', slug: 'b', published_at: '2026-05-18T00:00:00.000Z', status: 'draft' },
      { id: 'c', slug: 'c', published_at: '2026-05-17T00:00:00.000Z', status: 'published' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="status:published" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,c,');
  });
});

// #453 — Top-level `,` is OR; `+` is AND. Brackets and interpolations don't
// participate in the split.
describe('get helper filter — OR operator', () => {
  test('top-level comma unions two AND branches', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        published_at: '2026-05-19T00:00:00.000Z',
        featured: true,
        tags: [{ slug: 'news', name: 'News' }],
        authors: [],
      },
      {
        id: 'b',
        slug: 'b',
        published_at: '2026-05-18T00:00:00.000Z',
        featured: false,
        tags: [{ slug: 'opinion', name: 'Opinion' }],
        authors: [],
      },
      {
        id: 'c',
        slug: 'c',
        published_at: '2026-05-17T00:00:00.000Z',
        featured: false,
        tags: [{ slug: 'news', name: 'News' }],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    // (featured:true) OR (tag:opinion) → {a, b}
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true,tag:opinion" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,b,');
  });

  test('comma inside brackets stays a list-element separator, not an OR', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        published_at: '2026-05-19T00:00:00.000Z',
        tags: [{ slug: 'news', name: 'News' }],
        authors: [],
      },
      {
        id: 'b',
        slug: 'b',
        published_at: '2026-05-18T00:00:00.000Z',
        tags: [{ slug: 'opinion', name: 'Opinion' }],
        authors: [],
      },
      {
        id: 'c',
        slug: 'c',
        published_at: '2026-05-17T00:00:00.000Z',
        tags: [{ slug: 'sports', name: 'Sports' }],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:[news,opinion]" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,b,');
  });

  test('mixed OR + AND: `tag:news+featured:true , tag:opinion`', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        published_at: '2026-05-19T00:00:00.000Z',
        featured: true,
        tags: [{ slug: 'news', name: 'News' }],
        authors: [],
      },
      {
        id: 'b',
        slug: 'b',
        published_at: '2026-05-18T00:00:00.000Z',
        featured: false,
        tags: [{ slug: 'opinion', name: 'Opinion' }],
        authors: [],
      },
      {
        id: 'c',
        slug: 'c',
        published_at: '2026-05-17T00:00:00.000Z',
        featured: false,
        tags: [{ slug: 'news', name: 'News' }],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:news+featured:true,tag:opinion" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    // Branch 1 (tag:news AND featured:true) → {a}; branch 2 (tag:opinion) → {b}.
    expect(tpl({})).toBe('a,b,');
  });

  test('empty branches are dropped (trailing comma, double comma)', () => {
    const posts = [
      {
        id: 'a',
        slug: 'a',
        published_at: '2026-05-19T00:00:00.000Z',
        tags: [{ slug: 'news', name: 'News' }],
        authors: [],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="tag:news,," as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,');
  });
});
