import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerBlockHelpers } from '~/render/helpers/blocks.ts';

function buildEngine(content: {
  posts?: unknown[];
  tags?: unknown[];
  authors?: unknown[];
  pages?: unknown[];
  tiers?: unknown[];
  postsByAuthor?: Map<string, unknown[]>;
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
      tiers: content.tiers ?? [],
      postsByAuthor: content.postsByAuthor ?? new Map<string, unknown[]>(),
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

describe('get helper memoization', () => {
  test('reuses the loader-sorted posts array when order matches the default', () => {
    const posts = [
      { id: 'a', title: 'A', published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'b', title: 'B', published_at: '2026-05-18T00:00:00.000Z' },
      { id: 'c', title: 'C', published_at: '2026-05-17T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );

    const first = tpl({});
    const second = tpl({});

    expect(first).toBe('a,b,c,');
    expect(second).toBe(first);
    // Default order should not populate the cache — the loader's array is reused as-is.
    expect(engine.sortedCache.size).toBe(0);
  });

  test('defaults posts to the loader-provided published_at desc order', () => {
    const posts = [
      { id: 'newest', title: 'Newest', published_at: '2026-05-20T00:00:00.000Z' },
      { id: 'middle', title: 'Middle', published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'oldest', title: 'Oldest', published_at: '2026-05-18T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );

    expect(tpl({})).toBe('newest,middle,oldest,');
  });

  test('memoizes non-default orderings across invocations', () => {
    const posts = [
      { id: 'a', title: 'Banana', published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'b', title: 'Apple', published_at: '2026-05-18T00:00:00.000Z' },
      { id: 'c', title: 'Cherry', published_at: '2026-05-17T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" order="title asc" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );

    const first = tpl({});
    const second = tpl({});

    expect(first).toBe('b,a,c,');
    expect(second).toBe(first);
    expect(engine.sortedCache.has('posts|title asc')).toBe(true);
    expect(engine.sortedCache.size).toBe(1);

    const cached = engine.sortedCache.get('posts|title asc');
    // Calling the helper again must not replace the cached array.
    tpl({});
    expect(engine.sortedCache.get('posts|title asc')).toBe(cached);
  });

  test('orders string fields with case-insensitive locale comparison', () => {
    const posts = [
      { id: 'upper-beta', title: 'Beta', published_at: '2026-05-20T00:00:00.000Z' },
      { id: 'lower-beta', title: 'beta', published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'upper-alpha', title: 'Alpha', published_at: '2026-05-18T00:00:00.000Z' },
      { id: 'lower-alpha', title: 'alpha', published_at: '2026-05-17T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" order="title asc" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );

    expect(tpl({})).toBe('upper-alpha,lower-alpha,upper-beta,lower-beta,');
  });

  test('applying a filter does not change the sorted-then-filtered output', () => {
    const posts = [
      { id: 'a', title: 'A', featured: true, published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'b', title: 'B', featured: false, published_at: '2026-05-18T00:00:00.000Z' },
      { id: 'c', title: 'C', featured: true, published_at: '2026-05-17T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true" as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('a,c,');
  });

  test('limit caps the output without disturbing the cached sort', () => {
    const posts = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      title: `T${i}`,
      published_at: `2026-05-${String(50 - i).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=3 as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('p0,p1,p2,');
  });

  test('does not mutate the loader-owned posts array', () => {
    const posts = [
      { id: 'a', title: 'B', published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'b', title: 'A', published_at: '2026-05-18T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const snapshot = posts.slice();
    const tpl = engine.hb.compile(
      `{{#get "posts" order="title asc" as |items|}}{{#foreach items}}{{id}}{{/foreach}}{{/get}}`,
    );
    tpl({});
    expect(posts).toEqual(snapshot);
  });
});

describe('get helper pagination metadata', () => {
  function buildPosts(n: number): { id: string; published_at: string }[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      published_at: `2026-05-${String(n - i).padStart(2, '0')}T00:00:00.000Z`,
    }));
  }

  test('exposes pagination via @pagination on the data frame', () => {
    const engine = buildEngine({ posts: buildPosts(12) });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=5}}{{@pagination.page}}/{{@pagination.pages}} total={{@pagination.total}} prev={{@pagination.prev}} next={{@pagination.next}}{{/get}}`,
    );
    expect(tpl({})).toBe('1/3 total=12 prev= next=2');
  });

  test('exposes pagination via the second block param', () => {
    const engine = buildEngine({ posts: buildPosts(10) });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=4 page=2 as |items meta|}}page={{meta.pagination.page}} count={{items.length}} next={{meta.pagination.next}}{{/get}}`,
    );
    expect(tpl({})).toBe('page=2 count=4 next=3');
  });

  test('exposes pagination fields directly on the second block param', () => {
    const engine = buildEngine({ posts: buildPosts(10) });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=4 page=2 as |items pagination|}}resource={{pagination.resource}} page={{pagination.page}} limit={{pagination.limit}} pages={{pagination.pages}} total={{pagination.total}} prev={{pagination.prev}} next={{pagination.next}} count={{items.length}}{{/get}}`,
    );
    expect(tpl({})).toBe('resource=posts page=2 limit=4 pages=3 total=10 prev=1 next=3 count=4');
  });

  test('honours the page hash by offsetting the slice', () => {
    const engine = buildEngine({ posts: buildPosts(10) });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=3 page=2 as |items|}}{{#foreach items}}{{id}},{{/foreach}}{{/get}}`,
    );
    expect(tpl({})).toBe('p3,p4,p5,');
  });

  test('clamps requested pages beyond the last page', () => {
    const engine = buildEngine({ posts: buildPosts(5) });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=2 page=99 as |items meta|}}page={{meta.pagination.page}} count={{items.length}} prev={{meta.pagination.prev}} next={{meta.pagination.next}}{{/get}}`,
    );
    // Page 3 of 3 (pages=ceil(5/2)=3), holds 1 item, prev=2, next=null.
    expect(tpl({})).toBe('page=3 count=1 prev=2 next=');
  });

  test('limit="all" collapses to a single page covering every match', () => {
    const engine = buildEngine({ posts: buildPosts(7) });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit="all" as |items meta|}}pages={{meta.pagination.pages}} total={{meta.pagination.total}} count={{items.length}} prev={{meta.pagination.prev}} next={{meta.pagination.next}}{{/get}}`,
    );
    expect(tpl({})).toBe('pages=1 total=7 count=7 prev= next=');
  });

  test('renders inverse and skips pagination wiring when results are empty', () => {
    const engine = buildEngine({ posts: [] });
    const tpl = engine.hb.compile(
      `{{#get "posts" limit=5}}n={{@pagination.total}}{{else}}empty{{/get}}`,
    );
    expect(tpl({})).toBe('empty');
  });

  test('pagination accounts for filter results, not the unfiltered total', () => {
    const posts = [
      { id: 'a', featured: true, published_at: '2026-05-19T00:00:00.000Z' },
      { id: 'b', featured: false, published_at: '2026-05-18T00:00:00.000Z' },
      { id: 'c', featured: true, published_at: '2026-05-17T00:00:00.000Z' },
      { id: 'd', featured: true, published_at: '2026-05-16T00:00:00.000Z' },
      { id: 'e', featured: false, published_at: '2026-05-15T00:00:00.000Z' },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" filter="featured:true" limit=2}}{{@pagination.total}}/{{@pagination.pages}}{{/get}}`,
    );
    expect(tpl({})).toBe('3/2');
  });
});

describe('get helper include= parameter', () => {
  test('include="tags,authors" is accepted for posts and preserves the result data', () => {
    const posts = [
      {
        id: 'p1',
        title: 'One',
        published_at: '2026-05-20T00:00:00.000Z',
        tags: [{ slug: 'news' }],
        authors: [{ slug: 'alice' }],
      },
      {
        id: 'p2',
        title: 'Two',
        published_at: '2026-05-19T00:00:00.000Z',
        tags: [{ slug: 'notes' }],
        authors: [{ slug: 'bob' }],
      },
    ];
    const engine = buildEngine({ posts });
    const tpl = engine.hb.compile(
      `{{#get "posts" include="tags,authors" as |items|}}{{#foreach items}}{{id}}:{{tags.0.slug}}/{{authors.0.slug}},{{/foreach}}{{/get}}`,
    );

    expect(() => tpl({})).not.toThrow();
    expect(tpl({})).toBe('p1:news/alice,p2:notes/bob,');
  });

  test('include="count.posts" exposes tag counts populated by the loader', () => {
    const tags = [
      { id: 't1', slug: 'news', name: 'News', count: { posts: 4 } },
      { id: 't2', slug: 'opinion', name: 'Opinion', count: { posts: 2 } },
    ];
    const engine = buildEngine({ tags });
    const tpl = engine.hb.compile(
      `{{#get "tags" include="count.posts" order="name asc" as |items|}}{{#each items}}{{slug}}={{count.posts}},{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('news=4,opinion=2,');
  });

  test('include="count.posts" resolves author counts from postsByAuthor', () => {
    const authors = [
      { id: 'a1', slug: 'alice', name: 'Alice' },
      { id: 'a2', slug: 'bob', name: 'Bob' },
      { id: 'a3', slug: 'carol', name: 'Carol' },
    ];
    const postsByAuthor = new Map<string, unknown[]>([
      ['alice', [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]],
      ['bob', [{ id: 'p4' }]],
      ['carol', []],
    ]);
    const engine = buildEngine({ authors, postsByAuthor });
    const tpl = engine.hb.compile(
      `{{#get "authors" include="count.posts" order="name asc" as |items|}}{{#each items}}{{slug}}={{count.posts}},{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('alice=3,bob=1,carol=0,');
  });

  test('include="count.posts" does not mutate the shared author objects', () => {
    const authors = [{ id: 'a1', slug: 'alice', name: 'Alice' }];
    const postsByAuthor = new Map<string, unknown[]>([['alice', [{ id: 'p1' }, { id: 'p2' }]]]);
    const engine = buildEngine({ authors, postsByAuthor });
    const tpl = engine.hb.compile(
      `{{#get "authors" include="count.posts" as |items|}}{{#each items}}{{count.posts}}{{/each}}{{/get}}`,
    );
    tpl({});
    expect((authors[0] as { count?: unknown }).count).toBeUndefined();
  });

  test('include with comma-separated tokens still resolves count.posts for authors', () => {
    const authors = [{ id: 'a1', slug: 'alice', name: 'Alice' }];
    const postsByAuthor = new Map<string, unknown[]>([['alice', [{ id: 'p1' }, { id: 'p2' }]]]);
    const engine = buildEngine({ authors, postsByAuthor });
    const tpl = engine.hb.compile(
      `{{#get "authors" include="authors,count.posts" as |items|}}{{#each items}}{{count.posts}}{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('2');
  });

  test('without include the author objects pass through untouched (no count attached)', () => {
    const authors = [{ id: 'a1', slug: 'alice', name: 'Alice' }];
    const postsByAuthor = new Map<string, unknown[]>([['alice', [{ id: 'p1' }, { id: 'p2' }]]]);
    const engine = buildEngine({ authors, postsByAuthor });
    const tpl = engine.hb.compile(
      `{{#get "authors" as |items|}}{{#each items}}[{{slug}}|{{count.posts}}]{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('[alice|]');
  });

  test('preserves an explicit count.posts already set on the author (no recompute)', () => {
    const authors = [{ id: 'a1', slug: 'alice', name: 'Alice', count: { posts: 99 } }];
    const postsByAuthor = new Map<string, unknown[]>([['alice', [{ id: 'p1' }, { id: 'p2' }]]]);
    const engine = buildEngine({ authors, postsByAuthor });
    const tpl = engine.hb.compile(
      `{{#get "authors" include="count.posts" as |items|}}{{#each items}}{{count.posts}}{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('99');
  });

  test('author with missing postsByAuthor entry falls back to zero', () => {
    const authors = [{ id: 'a1', slug: 'ghost', name: 'Ghost' }];
    const engine = buildEngine({ authors, postsByAuthor: new Map() });
    const tpl = engine.hb.compile(
      `{{#get "authors" include="count.posts" as |items|}}{{#each items}}{{count.posts}}{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('0');
  });
});

describe('get helper tiers resource', () => {
  test('iterates declarative tiers in config order', () => {
    const tiers = [
      { id: 'free', slug: 'free', name: 'Free', type: 'free', monthly_price: undefined },
      { id: 'premium', slug: 'premium', name: 'Premium', type: 'paid', monthly_price: 9 },
    ];
    const engine = buildEngine({ tiers });
    const tpl = engine.hb.compile(
      `{{#get "tiers" as |items|}}{{#each items}}{{slug}}:{{type}};{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('free:free;premium:paid;');
  });

  test('filters tiers by indexed `slug` clause', () => {
    const tiers = [
      { id: 'free', slug: 'free', name: 'Free', type: 'free' },
      { id: 'premium', slug: 'premium', name: 'Premium', type: 'paid', monthly_price: 9 },
    ];
    const engine = buildEngine({ tiers });
    const tpl = engine.hb.compile(
      `{{#get "tiers" filter="slug:premium" as |items|}}{{#each items}}{{name}}={{monthly_price}}{{/each}}{{/get}}`,
    );
    expect(tpl({})).toBe('Premium=9');
  });

  test('renders inverse block when tiers is empty', () => {
    const engine = buildEngine({ tiers: [] });
    const tpl = engine.hb.compile(`{{#get "tiers"}}has tiers{{else}}no tiers{{/get}}`);
    expect(tpl({})).toBe('no tiers');
  });
});
