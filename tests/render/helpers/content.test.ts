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

describe('content helper', () => {
  test('downshifts body h1 to h2 so it does not collide with the layout title h1', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<h1 id="what-is-nectar">What is Nectar?</h1>',
    });
    expect(out).toBe('<h2 id="what-is-nectar">What is Nectar?</h2>');
  });

  test('downshifts subsequent headings to preserve outline nesting', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<h1>A</h1><h2>B</h2><h3 class="c">C</h3><h4>D</h4><h5>E</h5>',
    });
    expect(out).toBe('<h2>A</h2><h3>B</h3><h4 class="c">C</h4><h5>D</h5><h6>E</h6>');
  });

  test('caps downshift at h6 so existing h6 stays h6', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<h6>Deep</h6>',
    });
    expect(out).toBe('<h6>Deep</h6>');
  });

  test('leaves non-heading markup untouched', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<p>hello <strong>world</strong></p>',
    });
    expect(out).toBe('<p>hello <strong>world</strong></p>');
  });

  test('truncating excerpt via words still strips tags and skips heading shift', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content words=2}}}')({
      html: '<h1>one two three four</h1>',
    });
    expect(out).toBe('one two');
  });
});
