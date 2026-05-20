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

  test('object iteration exposes @key for each map entry', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach obj}}{{@key}}:{{this}};{{/foreach}}');
    const out = tpl({ obj: { a: 1, b: 2 } });
    expect(out).toContain('a:1;');
    expect(out).toContain('b:2;');
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

  // Ghost evaluates visibility before from/to/limit. With public and members
  // posts interleaved, `visibility="public" limit=3` must return the first
  // three *public* posts, not the public-survivors of the first three raw
  // positions. The latter would only yield two items here, off by one.
  // Reference: TryGhost/Ghost core/frontend/helpers/foreach.js.
  test('visibility filter is applied before limit (Ghost order)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items visibility="public" limit=3}}{{slug}}|{{/foreach}}',
    );
    const items = [
      { slug: 'a', visibility: 'public' },
      { slug: 'b', visibility: 'members' },
      { slug: 'c', visibility: 'public' },
      { slug: 'd', visibility: 'members' },
      { slug: 'e', visibility: 'public' },
      { slug: 'f', visibility: 'public' },
    ];
    expect(tpl({ items })).toBe('a|c|e|');
  });

  test('visibility filter is applied before from/to window (Ghost order)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items visibility="public" from=2 to=3}}{{slug}}|{{/foreach}}',
    );
    const items = [
      { slug: 'a', visibility: 'public' },
      { slug: 'b', visibility: 'members' },
      { slug: 'c', visibility: 'public' },
      { slug: 'd', visibility: 'members' },
      { slug: 'e', visibility: 'public' },
    ];
    // Public-only view is [a, c, e]; positions 2..3 are [c, e].
    expect(tpl({ items })).toBe('c|e|');
  });

  // Ghost's `visibility=` filter is polymorphic: it compares each item's own
  // `visibility` field. Tags expose `'public' | 'internal'`, so
  // `visibility="public"` should drop internal (hash-prefixed) tags by their
  // `tag.visibility === 'public'` check, matching Ghost's behaviour for
  // `{{#foreach tags visibility="public"}}` blocks.
  test('visibility="public" filters tag-shaped items by tag.visibility === "public"', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach items visibility="public"}}{{slug}}|{{/foreach}}');
    const items = [
      { slug: 'news', visibility: 'public' },
      { slug: 'hash-featured', visibility: 'internal' },
      { slug: 'sports', visibility: 'public' },
    ];
    expect(tpl({ items })).toBe('news|sports|');
  });

  // `visibility="all"` is Ghost's documented escape hatch to bypass the filter,
  // so internal tags must surface alongside public ones when themes ask for it.
  test('visibility="all" keeps internal tags alongside public ones', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach items visibility="all"}}{{slug}}|{{/foreach}}');
    const items = [
      { slug: 'news', visibility: 'public' },
      { slug: 'hash-featured', visibility: 'internal' },
    ];
    expect(tpl({ items })).toBe('news|hash-featured|');
  });

  // Authors have no `visibility` field in Nectar's content graph (mirroring
  // Ghost's API shape). The filter must treat a missing field as public so
  // `{{#foreach authors visibility="public"}}` is a no-op for that resource
  // rather than wiping the iteration empty.
  test('visibility="public" passes through author-shaped items that omit visibility', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#foreach items visibility="public"}}{{slug}}|{{/foreach}}');
    const items = [{ slug: 'alice' }, { slug: 'bob' }];
    expect(tpl({ items })).toBe('alice|bob|');
  });

  test('visibility filter combined with from + limit honours filtered indices', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items visibility="public" from=2 limit=2}}{{slug}}|{{/foreach}}',
    );
    const items = [
      { slug: 'a', visibility: 'public' },
      { slug: 'b', visibility: 'members' },
      { slug: 'c', visibility: 'public' },
      { slug: 'd', visibility: 'members' },
      { slug: 'e', visibility: 'public' },
      { slug: 'f', visibility: 'public' },
    ];
    // Public-only view is [a, c, e, f]; from=2 limit=2 yields [c, e].
    expect(tpl({ items })).toBe('c|e|');
  });

  // Ghost themes wire masonry/grid wrapping through `@rowStart` / `@rowEnd`,
  // which flip on the row boundaries dictated by `columns=`. With columns=3 and
  // 6 items, rowStart fires on positions 0/3 and rowEnd on positions 2/5.
  // Reference: TryGhost/Ghost `core/frontend/helpers/foreach.js`.
  test('columns=3 flags rowStart/rowEnd on row boundaries', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items columns=3}}{{slug}}:{{#if @rowStart}}S{{/if}}{{#if @rowEnd}}E{{/if}}|{{/foreach}}',
    );
    const items = [
      { slug: 'a' },
      { slug: 'b' },
      { slug: 'c' },
      { slug: 'd' },
      { slug: 'e' },
      { slug: 'f' },
    ];
    expect(tpl({ items })).toBe('a:S|b:|c:E|d:S|e:|f:E|');
  });

  // A `columns=` value supplied as a string (the Handlebars literal form) must
  // parse to a number so themes can write `columns="2"` without the helper
  // silently falling back to the default.
  test('columns accepts string literals from the template', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items columns="2"}}{{slug}}:{{#if @rowStart}}S{{/if}}{{#if @rowEnd}}E{{/if}}|{{/foreach}}',
    );
    const items = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }];
    expect(tpl({ items })).toBe('a:S|b:E|c:S|d:E|');
  });

  // The previous implementation hardcoded rowStart/rowEnd to `false`, which
  // broke `{{#if @rowStart}}` wrappers in single-column lists. Defaulting
  // columns to 1 means every item is both the start and end of its own row,
  // so themes that conditionally open/close wrapper elements per iteration
  // get a coherent signal even when columns is omitted entirely.
  test('rowStart/rowEnd both default to true when columns is omitted', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items}}{{slug}}:{{#if @rowStart}}S{{/if}}{{#if @rowEnd}}E{{/if}}|{{/foreach}}',
    );
    const items = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
    expect(tpl({ items })).toBe('a:SE|b:SE|c:SE|');
  });

  // Garbage values (zero, negative, non-numeric) would otherwise divide by
  // zero or yield NaN flags. Collapsing them to 1 keeps the helper's output
  // deterministic instead of leaking `NaN`-shaped booleans into the template.
  test('non-positive or non-numeric columns falls back to 1', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items columns=0}}{{slug}}:{{#if @rowStart}}S{{/if}}{{#if @rowEnd}}E{{/if}}|{{/foreach}}',
    );
    expect(tpl({ items: [{ slug: 'a' }, { slug: 'b' }] })).toBe('a:SE|b:SE|');

    const tpl2 = engine.hb.compile(
      '{{#foreach items columns="oops"}}{{slug}}:{{#if @rowStart}}S{{/if}}{{#if @rowEnd}}E{{/if}}|{{/foreach}}',
    );
    expect(tpl2({ items: [{ slug: 'a' }, { slug: 'b' }] })).toBe('a:SE|b:SE|');
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

  test('space-separated targets match (Ghost accepts both "a b" and "a, b")', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "post page"}}HIT{{else}}MISS{{/is}}');
    expect(tpl({}, { data: { route: { kind: 'page' } } })).toBe('HIT');
    expect(tpl({}, { data: { route: { kind: 'post' } } })).toBe('HIT');
    expect(tpl({}, { data: { route: { kind: 'tag' } } })).toBe('MISS');
  });

  test('mixed comma + whitespace separators all split into targets', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "post,  page tag"}}HIT{{else}}MISS{{/is}}');
    expect(tpl({}, { data: { route: { kind: 'tag' } } })).toBe('HIT');
  });

  test('"author" matches the author route', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "author"}}yes{{/is}}');
    expect(tpl({}, { data: { route: { kind: 'author' } } })).toBe('yes');
  });

  // Cross-theme regression coverage (issue #866). Casper, Source, and Edition
  // all branch on `{{#is "home"}}` vs `{{#is "index"}}` vs `{{#is "paged"}}`
  // with subtly different intents:
  //   - `home`  -> home root only (page 1 of the home archive)
  //   - `index` -> any home archive page (page 1 + paginated /page/2/ + ...)
  //   - `paged` -> any paginated archive (page > 1) regardless of route kind
  // The current implementation already aliases home<->index at the kind
  // level and reads `pagination.page` for `paged`. Lock the cross-theme
  // expectations in tests so future tweaks to the alias map can't regress.
  test('"home" matches the home route on page 1 (issue #866)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "home"}}HIT{{else}}MISS{{/is}}');
    const route = { kind: 'home', data: { pagination: { page: 1 } } };
    expect(tpl({}, { data: { route } })).toBe('HIT');
  });

  test('"index" matches the home route across pagination (issue #866)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "index"}}HIT{{else}}MISS{{/is}}');
    const page1 = { kind: 'home', data: { pagination: { page: 1 } } };
    const page2 = { kind: 'home', data: { pagination: { page: 2 } } };
    expect(tpl({}, { data: { route: page1 } })).toBe('HIT');
    expect(tpl({}, { data: { route: page2 } })).toBe('HIT');
  });

  test('"paged" matches paginated archives regardless of route kind (issue #866)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#is "paged"}}HIT{{else}}MISS{{/is}}');
    expect(tpl({}, { data: { route: { kind: 'home', data: { pagination: { page: 2 } } } } })).toBe(
      'HIT',
    );
    expect(tpl({}, { data: { route: { kind: 'tag', data: { pagination: { page: 3 } } } } })).toBe(
      'HIT',
    );
    expect(tpl({}, { data: { route: { kind: 'home', data: { pagination: { page: 1 } } } } })).toBe(
      'MISS',
    );
  });

  test('"home" and "paged" form complementary partitions of the home archive (issue #866)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const home = engine.hb.compile('{{#is "home"}}HIT{{else}}MISS{{/is}}');
    const paged = engine.hb.compile('{{#is "paged"}}HIT{{else}}MISS{{/is}}');
    const page1 = { kind: 'home', data: { pagination: { page: 1 } } };
    const page2 = { kind: 'home', data: { pagination: { page: 2 } } };
    expect(home({}, { data: { route: page1 } })).toBe('HIT');
    expect(paged({}, { data: { route: page1 } })).toBe('MISS');
    // On page 2 the route still has kind 'home' so `home` itself still
    // matches the kind alias — themes pair `{{#is "home"}}` with
    // `{{^is "paged"}}` (or a body-class check) to scope hero markup to
    // the root. Confirm `paged` flips on so that idiom works.
    expect(paged({}, { data: { route: page2 } })).toBe('HIT');
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

  test('matches when the author slug is present on the context', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has author="jane"}}yes{{else}}no{{/has}}');
    const ctx = { authors: [{ slug: 'jane', name: 'Jane' }] };
    expect(tpl(ctx)).toBe('yes');
  });

  test('falls through to inverse when the requested tag is absent', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="news"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ tags: [] })).toBe('MISS');
  });

  test('falls through to inverse when none of the context tags match the requested tag', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="x"}}A{{else}}B{{/has}}');
    expect(tpl({ tags: [{ slug: 'y', name: 'Y' }] })).toBe('B');
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

  // #455 — `tag="count:>1"` is the inverse hash-key form of `count:tags=">1"`.
  // Themes prefer the shorter form when checking "post has multiple tags" so
  // the helper has to recognize the `count:` prefix on the value side too.
  test('tag="count:>1" matches when the tag collection has more than one entry', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="count:>1"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ tags: [{ slug: 'a' }, { slug: 'b' }] })).toBe('HIT');
    expect(tpl({ tags: [{ slug: 'a' }] })).toBe('MISS');
  });

  test('tag="count:1" with no operator defaults to equality on collection size', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has tag="count:1"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ tags: [{ slug: 'a' }] })).toBe('HIT');
    expect(tpl({ tags: [] })).toBe('MISS');
    expect(tpl({ tags: [{ slug: 'a' }, { slug: 'b' }] })).toBe('MISS');
  });

  // #455 — `any=` / `all=` check the truthiness of a list of property paths on
  // the current context. Plain identifiers walk `this`; `@`-prefixed paths
  // resolve against the data frame (`@labs.foo`, `@site.x`).
  test('any="twitter, facebook" matches when at least one property is truthy on ctx', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has any="twitter, facebook"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ facebook: 'https://example.com/' })).toBe('HIT');
    expect(tpl({ twitter: '@me' })).toBe('HIT');
    expect(tpl({})).toBe('MISS');
    expect(tpl({ twitter: '', facebook: null })).toBe('MISS');
  });

  test('all="twitter, facebook" requires every listed property to be truthy', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has all="twitter, facebook"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({ twitter: '@me', facebook: 'https://example.com/' })).toBe('HIT');
    expect(tpl({ twitter: '@me' })).toBe('MISS');
  });

  test('any="@labs.x" reads from the data frame instead of the context', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has any="@labs.searchEnabled"}}HIT{{else}}MISS{{/has}}');
    expect(tpl({}, { data: { labs: { searchEnabled: true } } })).toBe('HIT');
    expect(tpl({}, { data: { labs: { searchEnabled: false } } })).toBe('MISS');
  });

  // #455 — `number="nth:3"` is Ghost's modulus form on pagination.page. Every
  // page whose 1-indexed position is divisible by N matches. Page 1 must not
  // accidentally satisfy any nth (zero is not the first hit).
  test('number="nth:3" matches every third pagination page', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has number="nth:3"}}HIT{{else}}MISS{{/has}}');
    const pageN = (n: number) => ({ data: { route: { data: { pagination: { page: n } } } } });
    expect(tpl({}, pageN(1))).toBe('MISS');
    expect(tpl({}, pageN(2))).toBe('MISS');
    expect(tpl({}, pageN(3))).toBe('HIT');
    expect(tpl({}, pageN(4))).toBe('MISS');
    expect(tpl({}, pageN(5))).toBe('MISS');
    expect(tpl({}, pageN(6))).toBe('HIT');
  });

  test('number="3" without nth falls back to strict equality on pagination page', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has number="3"}}HIT{{else}}MISS{{/has}}');
    const pageN = (n: number) => ({ data: { route: { data: { pagination: { page: n } } } } });
    expect(tpl({}, pageN(3))).toBe('HIT');
    expect(tpl({}, pageN(2))).toBe('MISS');
  });

  // #455 — `index="0"` compares against the `@index` exposed by `{{#foreach}}`.
  // Themes use it inside an iteration to single out the first / nth element.
  test('index="0" matches when the foreach @index is 0 (first item)', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items}}{{#has index="0"}}[FIRST:{{slug}}]{{else}}({{slug}}){{/has}}{{/foreach}}',
    );
    expect(tpl({ items: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] })).toBe('[FIRST:a](b)(c)');
  });

  test('index=">1" can be used with a range comparator', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#foreach items}}{{#has index=">1"}}[{{slug}}]{{else}}-{{slug}}-{{/has}}{{/foreach}}',
    );
    expect(tpl({ items: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] })).toBe('-a--b-[c]');
  });

  // Ghost's `{{#has}}` treats multiple hash keys as OR: the block enters when
  // any one of the keys matches. Two-key form is the common case (`tag=` plus
  // `slug=`), so verify the OR semantics explicitly.
  test('multiple hash keys OR together: matches when any key matches', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{#has slug="alpha" tag="news"}}HIT{{else}}MISS{{/has}}');
    // slug matches, tag does not
    expect(tpl({ slug: 'alpha', tags: [{ slug: 'foo' }] })).toBe('HIT');
    // tag matches, slug does not
    expect(tpl({ slug: 'beta', tags: [{ slug: 'news' }] })).toBe('HIT');
    // neither matches
    expect(tpl({ slug: 'beta', tags: [{ slug: 'foo' }] })).toBe('MISS');
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

  test('numeric comparators handle string operands lexicographically', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const gt = engine.hb.compile('{{match a ">" b}}');
    const lt = engine.hb.compile('{{match a "<" b}}');
    const ge = engine.hb.compile('{{match a ">=" b}}');
    expect(gt({ a: 'foo', b: 'bar' })).toBe('true');
    expect(lt({ a: 'apple', b: 'banana' })).toBe('true');
    expect(ge({ a: 'foo', b: 'foo' })).toBe('true');
    expect(gt({ a: 'apple', b: 'banana' })).toBe('false');
  });

  test('numeric comparators still work with numeric strings', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const gt = engine.hb.compile('{{match a ">" b}}');
    expect(gt({ a: '10', b: '9' })).toBe('true');
    expect(gt({ a: '9', b: '10' })).toBe('false');
  });

  test('numeric comparators mix numbers and numeric strings', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const gt = engine.hb.compile('{{match a ">" b}}');
    expect(gt({ a: 10, b: '9' })).toBe('true');
    expect(gt({ a: '10', b: 9 })).toBe('true');
  });

  test('"=" coerces between boolean and the string literals "true"/"false"', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const eq = engine.hb.compile('{{match a "=" b}}');
    expect(eq({ a: true, b: 'true' })).toBe('true');
    expect(eq({ a: 'true', b: true })).toBe('true');
    expect(eq({ a: false, b: 'false' })).toBe('true');
    expect(eq({ a: true, b: 'false' })).toBe('false');
  });

  test('two-arg form also coerces "true"/"false" string<->boolean', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const tpl = engine.hb.compile('{{match flag "true"}}');
    expect(tpl({ flag: true })).toBe('true');
    expect(tpl({ flag: false })).toBe('false');
    expect(tpl({ flag: 'true' })).toBe('true');
  });

  test('"!=" inverts the coerced equality result', () => {
    const engine = makeEngine();
    registerBlockHelpers(engine);
    const ne = engine.hb.compile('{{match a "!=" b}}');
    expect(ne({ a: true, b: 'true' })).toBe('false');
    expect(ne({ a: true, b: 'false' })).toBe('true');
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
