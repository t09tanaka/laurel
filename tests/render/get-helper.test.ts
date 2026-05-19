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
