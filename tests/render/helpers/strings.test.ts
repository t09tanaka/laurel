import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerStringHelpers } from '~/render/helpers/strings.ts';

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
  };
}

describe('concat helper', () => {
  test('joins all positional arguments with no separator by default', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile('{{concat a b c}}');
    expect(tpl({ a: 'foo', b: '-', c: 'bar' })).toBe('foo-bar');
  });

  test('honours separator= and coerces non-string values via String()', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile('{{concat a b c separator=", "}}');
    expect(tpl({ a: 1, b: true, c: 'x' })).toBe('1, true, x');
  });
});

describe('encode helper', () => {
  test('percent-encodes characters that are unsafe in URLs', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile('{{encode value}}');
    expect(tpl({ value: 'a b/c?d=e' })).toBe('a%20b%2Fc%3Fd%3De');
  });

  test('treats undefined as an empty string instead of throwing', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile('{{encode missing}}');
    expect(tpl({})).toBe('');
  });

  test('safely encodes values embedded in share URL query strings', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const mailto = engine.hb.compile('mailto:?subject={{encode title}}');
    const twitter = engine.hb.compile('https://twitter.com/intent/tweet?text={{encode title}}');
    const data = { title: 'Hi & welcome' };

    expect(mailto(data)).toBe('mailto:?subject=Hi%20%26%20welcome');
    expect(twitter(data)).toBe('https://twitter.com/intent/tweet?text=Hi%20%26%20welcome');
  });
});

describe('upper / lower helpers', () => {
  test('upper uppercases the string value', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    expect(engine.hb.compile('{{upper value}}')({ value: 'Hello' })).toBe('HELLO');
  });

  test('lower lowercases the string value and tolerates undefined', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    expect(engine.hb.compile('{{lower value}}')({ value: 'HELLO' })).toBe('hello');
    expect(engine.hb.compile('{{lower missing}}')({})).toBe('');
  });
});

describe('plural helper', () => {
  test('singular template fires when count is 1', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile(
      '{{plural count empty="none" singular="% post" plural="% posts"}}',
    );
    expect(tpl({ count: 1 })).toBe('1 post');
  });

  test('plural template fires when count is greater than 1 and % is replaced', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile(
      '{{plural count empty="none" singular="% post" plural="% posts"}}',
    );
    expect(tpl({ count: 5 })).toBe('5 posts');
  });

  test('empty template fires when count is 0, falling back to plural when empty is unset', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const withEmpty = engine.hb.compile(
      '{{plural count empty="No posts" singular="% post" plural="% posts"}}',
    );
    const withoutEmpty = engine.hb.compile('{{plural count singular="% post" plural="% posts"}}');
    expect(withEmpty({ count: 0 })).toBe('No posts');
    expect(withoutEmpty({ count: 0 })).toBe('0 posts');
  });

  test('non-numeric count is coerced via Number() (NaN takes the plural branch)', () => {
    const engine = makeEngine();
    registerStringHelpers(engine);
    const tpl = engine.hb.compile('{{plural count empty="0" singular="one" plural="many %"}}');
    expect(tpl({ count: 'not-a-number' })).toBe('many NaN');
  });
});
