import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerFlowHelpers } from '~/render/helpers/flow.ts';

function makeEngine(): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: {} as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map<string, readonly unknown[]>(),
    render() {
      throw new Error('not used');
    },
  } as unknown as NectarEngine;
}

describe('or helper', () => {
  test('block form enters when any value is truthy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#or a b c}}HIT{{else}}MISS{{/or}}');
    expect(tpl({ a: false, b: 0, c: 'x' })).toBe('HIT');
  });

  test('block form falls through to inverse when every value is falsy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#or a b c}}HIT{{else}}MISS{{/or}}');
    expect(tpl({ a: false, b: 0, c: '' })).toBe('MISS');
  });

  test('inline form returns the first truthy value', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{or a b c}}');
    expect(tpl({ a: '', b: 'second', c: 'third' })).toBe('second');
  });

  test('inline form returns empty string when nothing is truthy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{or a b}}');
    expect(tpl({ a: 0, b: false })).toBe('');
  });
});

describe('and helper', () => {
  test('block form enters when all values are truthy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#and a b c}}HIT{{else}}MISS{{/and}}');
    expect(tpl({ a: 1, b: 'x', c: true })).toBe('HIT');
  });

  test('block form falls through to inverse when any value is falsy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#and a b}}HIT{{else}}MISS{{/and}}');
    expect(tpl({ a: 1, b: '' })).toBe('MISS');
  });

  test('inline form returns the last value when all are truthy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{and a b c}}');
    expect(tpl({ a: 1, b: 2, c: 'tail' })).toBe('tail');
  });
});

describe('not helper', () => {
  test('block form enters when the value is falsy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#not value}}HIT{{else}}MISS{{/not}}');
    expect(tpl({ value: false })).toBe('HIT');
  });

  test('block form falls through to inverse when the value is truthy', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#not value}}HIT{{else}}MISS{{/not}}');
    expect(tpl({ value: 'x' })).toBe('MISS');
  });
});

describe('eq helper', () => {
  test('block form enters when both arguments are strictly equal', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#eq a b}}HIT{{else}}MISS{{/eq}}');
    expect(tpl({ a: 'x', b: 'x' })).toBe('HIT');
  });

  test('block form falls through when types differ (no coercion)', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#eq a b}}HIT{{else}}MISS{{/eq}}');
    expect(tpl({ a: 1, b: '1' })).toBe('MISS');
  });

  test('inline form returns the boolean result for use as a sub-expression', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{eq a b}}');
    expect(tpl({ a: 'x', b: 'x' })).toBe('true');
    expect(tpl({ a: 'x', b: 'y' })).toBe('false');
  });
});

describe('access helper', () => {
  test('inline form is truthy because members are out of scope', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{access}}');
    expect(tpl({})).toBe('true');
  });

  test('inline form via sub-expression is truthy', () => {
    // Themes that explicitly defer to the helper (rather than relying on the
    // context-seeded `access` property) write `{{#unless (access)}}`. This
    // exercises the helper's direct return path.
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#unless (access)}}LOCKED{{else}}OPEN{{/unless}}');
    expect(tpl({})).toBe('OPEN');
  });

  test('block form invokes fn with the current context', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#access}}HIT:{{name}}{{else}}MISS{{/access}}');
    expect(tpl({ name: 'reader' })).toBe('HIT:reader');
  });

  test('block form always enters fn (no inverse for unauthenticated builds)', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{#access}}OPEN{{else}}LOCKED{{/access}}');
    expect(tpl({})).toBe('OPEN');
  });
});

describe('lookup helper', () => {
  test('resolves a dynamic property name on an object', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{lookup post field}}');
    expect(tpl({ field: 'title', post: { title: 'Dynamic title' } })).toBe('Dynamic title');
  });

  test('resolves a dynamic array index', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{lookup tags index}}');
    expect(tpl({ index: 1, tags: ['news', 'featured'] })).toBe('featured');
  });

  test('keeps Handlebars prototype access guard for unsafe keys', () => {
    const engine = makeEngine();
    registerFlowHelpers(engine);
    const tpl = engine.hb.compile('{{lookup obj key}}');
    expect(tpl({ key: '__proto__', obj: { title: 'safe' } })).toBe('');
    expect(tpl({ key: 'constructor', obj: {} })).toBe('');
  });
});
