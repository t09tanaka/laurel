import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { ContentGraph } from '~/content/model.ts';
import type { NectarEngine } from '~/render/engine.ts';
import { registerBlockHelpers } from '~/render/helpers/blocks.ts';

interface MakeEngineOpts {
  content?: Partial<ContentGraph>;
}

function makeEngine(opts: MakeEngineOpts = {}): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: {
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      ...opts.content,
    } as unknown as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map<string, readonly unknown[]>(),
    render() {
      throw new Error('not used');
    },
  };
}

describe('foreach helper', () => {
  test('iterates an array and exposes @index/@number/@first/@last/@even/@odd', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items}}{{@number}}:{{name}}{{#if @first}}*{{/if}}{{#if @last}}!{{/if}}|{{/foreach}}',
    );
    const out = tpl({ items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    expect(out).toBe('1:a*|2:b|3:c!|');
  });

  test('renders the inverse block when the input is empty', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach items}}X{{else}}EMPTY{{/foreach}}');
    expect(tpl({ items: [] })).toBe('EMPTY');
  });

  test('limit + from slice the visible window 1-indexed', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach items limit=2 from=2}}{{this}}|{{/foreach}}');
    expect(tpl({ items: ['a', 'b', 'c', 'd', 'e'] })).toBe('b|c|');
  });

  test('visibility filter drops items whose visibility does not match', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach items visibility="public"}}{{slug}}|{{/foreach}}');
    const items = [
      { slug: 'a', visibility: 'public' },
      { slug: 'b', visibility: 'members' },
      { slug: 'c' },
    ];
    expect(tpl({ items })).toBe('a|c|');
  });
});

describe('is helper', () => {
  test('matches when the route kind is in the requested list', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "post, page"}}HIT{{else}}MISS{{/is}}');
    const out = tpl({}, { data: { route: { kind: 'post' } } });
    expect(out).toBe('HIT');
  });

  test('falls through to inverse when the route kind is missing entirely', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "post"}}HIT{{else}}MISS{{/is}}');
    expect(tpl({}, { data: {} })).toBe('MISS');
  });

  test('"paged" matches only when pagination.page > 1', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "paged"}}HIT{{else}}MISS{{/is}}');
    const route1 = { kind: 'home', data: { pagination: { page: 1 } } };
    const route2 = { kind: 'home', data: { pagination: { page: 2 } } };
    expect(tpl({}, { data: { route: route1 } })).toBe('MISS');
    expect(tpl({}, { data: { route: route2 } })).toBe('HIT');
  });

  test('"home" and "index" are aliases of each other', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "index"}}HIT{{else}}MISS{{/is}}');
    expect(tpl({}, { data: { route: { kind: 'home' } } })).toBe('HIT');
  });
});

describe('has helper', () => {
  test('matches when the tag slug is present on the context', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="news"}}HIT{{else}}MISS{{/has}}');
    const ctx = { tags: [{ slug: 'news', name: 'News' }] };
    expect(tpl(ctx)).toBe('HIT');
  });

  test('comma-separated tag values match if any of them is present', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="news, sports"}}HIT{{else}}MISS{{/has}}');
    const ctx = { tags: [{ slug: 'sports', name: 'Sports' }] };
    expect(tpl(ctx)).toBe('HIT');
  });

  test('falls through to inverse when the requested tag is absent', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="news"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ tags: [] })).toBe('MISS');
  });

  test('number= compares against the current pagination page', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has number="2"}}HIT{{else}}MISS{{/has}}');
    const route = { data: { pagination: { page: 2 } } };
    expect(tpl({}, { data: { route } })).toBe('HIT');
  });

  test('count:tags=">N" matches when the tags array has more than N entries', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has count:tags=">2"}}HIT{{else}}MISS{{/has}}');
    const many = { tags: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] };
    const few = { tags: [{ slug: 'a' }] };
    expect(tpl(many)).toBe('HIT');
    expect(tpl(few)).toBe('MISS');
  });

  test('count:authors=">=N" honours the >= operator', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has count:authors=">=2"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ authors: [{ slug: 'a' }, { slug: 'b' }] })).toBe('HIT');
    expect(tpl({ authors: [{ slug: 'a' }] })).toBe('MISS');
  });

  test('count:tags="<N" / "<=N" / "=N" cover the remaining comparison operators', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const lt = engine.hb.compile('{{#has count:tags="<2"}}HIT{{else}}MISS{{/has}}');
    const lte = engine.hb.compile('{{#has count:tags="<=2"}}HIT{{else}}MISS{{/has}}');
    const eq = engine.hb.compile('{{#has count:tags="=2"}}HIT{{else}}MISS{{/has}}');
    expect(lt({ tags: [{ slug: 'a' }] })).toBe('HIT');
    expect(lt({ tags: [{ slug: 'a' }, { slug: 'b' }] })).toBe('MISS');
    expect(lte({ tags: [{ slug: 'a' }, { slug: 'b' }] })).toBe('HIT');
    expect(lte({ tags: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] })).toBe('MISS');
    expect(eq({ tags: [{ slug: 'a' }, { slug: 'b' }] })).toBe('HIT');
    expect(eq({ tags: [{ slug: 'a' }] })).toBe('MISS');
  });

  test('count:tags="N" without an operator defaults to equality', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has count:tags="1"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ tags: [{ slug: 'a' }] })).toBe('HIT');
    expect(tpl({ tags: [{ slug: 'a' }, { slug: 'b' }] })).toBe('MISS');
  });

  test('count:tags treats a missing collection as length 0', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const gt = engine.hb.compile('{{#has count:tags=">0"}}HIT{{else}}MISS{{/has}}');
    const eqZero = engine.hb.compile('{{#has count:tags="=0"}}HIT{{else}}MISS{{/has}}');
    expect(gt({})).toBe('MISS');
    expect(eqZero({})).toBe('HIT');
  });

  test('count:posts uses a numeric property directly when it is not an array', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has count:posts=">0"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ posts: 5 })).toBe('HIT');
    expect(tpl({ posts: 0 })).toBe('MISS');
  });

  test('count: with a malformed value falls through to inverse', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has count:tags="garbage"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ tags: [{ slug: 'a' }] })).toBe('MISS');
  });
});

describe('match helper', () => {
  test('two-argument form returns the strict equality result', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{match a b}}');
    expect(tpl({ a: 'x', b: 'x' })).toBe('true');
    expect(tpl({ a: 'x', b: 'y' })).toBe('false');
  });

  test('three-argument form honours the comparison operator', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const ge = engine.hb.compile('{{match a ">=" b}}');
    const tilde = engine.hb.compile('{{match a "~" b}}');
    expect(ge({ a: 5, b: 3 })).toBe('true');
    expect(ge({ a: 1, b: 3 })).toBe('false');
    expect(tilde({ a: 'hello world', b: 'world' })).toBe('true');
    expect(tilde({ a: 'hello', b: 'world' })).toBe('false');
  });

  test('block form renders inverse when no condition matches', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#match a "=" b}}HIT{{else}}MISS{{/match}}');
    expect(tpl({ a: 1, b: 2 })).toBe('MISS');
  });
});

describe('get helper', () => {
  test('renders the iteration block with the loaded resource', () => {
    const engine = makeEngine({
      content: {
        posts: [
          { title: 'A', published_at: '2026-05-01' },
          { title: 'B', published_at: '2026-05-02' },
        ],
      } as unknown as Partial<ContentGraph>,
    });
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#get "posts"}}{{#each this}}{{title}}|{{/each}}{{/get}}');
    expect(tpl({})).toBe('A|B|');
  });

  test('renders the inverse block when nothing matches', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#get "posts"}}HIT{{else}}EMPTY{{/get}}');
    expect(tpl({})).toBe('EMPTY');
  });
});

describe('post/page/tag/author context helpers', () => {
  test('post block enters the body when a post is attached to the route', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#post}}{{title}}{{else}}NONE{{/post}}');
    const data = { route: { data: { post: { title: 'Hello' } } } };
    expect(tpl({}, { data })).toBe('Hello');
  });

  test('post block falls through to inverse when no post is present', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#post}}HIT{{else}}NONE{{/post}}');
    expect(tpl({}, { data: { route: {} } })).toBe('NONE');
  });
});

describe('prev_post / next_post helpers', () => {
  test('prev_post enters the older sibling and exposes its fields', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#prev_post}}{{title}}@{{url}}{{else}}NONE{{/prev_post}}');
    const ctx = { title: 'Current', prev: { title: 'Older', url: '/older/' } };
    expect(tpl(ctx)).toBe('Older@/older/');
  });

  test('next_post enters the newer sibling and exposes its fields', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#next_post}}{{title}}@{{url}}{{else}}NONE{{/next_post}}');
    const ctx = { title: 'Current', next: { title: 'Newer', url: '/newer/' } };
    expect(tpl(ctx)).toBe('Newer@/newer/');
  });

  test('prev_post falls through to inverse when the current post has no older sibling', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#prev_post}}HIT{{else}}NONE{{/prev_post}}');
    expect(tpl({ title: 'Only', prev: undefined })).toBe('NONE');
  });

  test('next_post falls through to inverse when the current post has no newer sibling', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#next_post}}HIT{{else}}NONE{{/next_post}}');
    expect(tpl({ title: 'Only', next: undefined })).toBe('NONE');
  });

  test('prev_post reads the route post when called outside an explicit post context', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#prev_post}}{{title}}{{else}}NONE{{/prev_post}}');
    const data = { route: { data: { post: { title: 'Current', prev: { title: 'Older' } } } } };
    expect(tpl({}, { data })).toBe('Older');
  });

  test('next_post reads the route post when called outside an explicit post context', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#next_post}}{{title}}{{else}}NONE{{/next_post}}');
    const data = { route: { data: { post: { title: 'Current', next: { title: 'Newer' } } } } };
    expect(tpl({}, { data })).toBe('Newer');
  });
});
