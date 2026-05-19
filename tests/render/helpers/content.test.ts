import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerContentHelpers } from '~/render/helpers/content.ts';

function makeEngine(): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: {} as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

describe('access helper', () => {
  test('inline use returns false so themes can rely on the contract', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{access}}')({})).toBe('false');
  });

  test('`{{#unless access}}` enters the block (matches Ghost lock-icon flow)', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{#unless access}}LOCK{{/unless}}')({})).toBe('LOCK');
  });

  test('`{{#if access}}` falls through to the inverse', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{#if access}}YES{{else}}NO{{/if}}')({})).toBe('NO');
  });

  test('helper wins over a stray `access` context property', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{access}}')({ access: true })).toBe('false');
  });

  test('block form `{{#access}}…{{else}}…{{/access}}` renders the inverse', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{#access}}YES{{else}}NO{{/access}}')({})).toBe('NO');
  });
});

describe('recommendations helper', () => {
  test('emits an empty placeholder so the Source theme sidebar renders without a missing-helper warning', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{recommendations}}')({})).toBe(
      '<ul class="recommendations" data-nectar-recommendations></ul>',
    );
  });
});
