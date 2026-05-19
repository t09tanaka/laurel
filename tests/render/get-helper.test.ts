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
