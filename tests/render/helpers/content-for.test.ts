import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { ContentGraph } from '~/content/model.ts';
import type { LaurelEngine } from '~/render/engine.ts';
import { registerContentForHelpers } from '~/render/helpers/content-for.ts';

function makeEngine(): LaurelEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as LaurelEngine['config'],
    content: {
      posts: [],
      pages: [],
      tags: [],
      authors: [],
    } as unknown as ContentGraph,
    theme: {} as LaurelEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map<string, readonly unknown[]>(),
    render() {
      throw new Error('not used');
    },
  } as unknown as LaurelEngine;
}

describe('contentFor / block helpers', () => {
  test('contentFor produces no output by itself', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const tpl = engine.hb.compile('A{{#contentFor "head"}}<meta>{{/contentFor}}B');
    const data = { __blocks: {} as Record<string, string> };
    expect(tpl({}, { data })).toBe('AB');
    expect(data.__blocks.head).toBe('<meta>');
  });

  test('block reads accumulated contentFor output via shared data frame', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const inner = engine.hb.compile(
      '{{#contentFor "scripts"}}<script src="a"></script>{{/contentFor}}body',
    );
    const layout = engine.hb.compile('<head>{{{block "scripts"}}}</head><body>{{{body}}}</body>');
    const data = { __blocks: {} as Record<string, string> };
    const innerHtml = inner({}, { data });
    const out = layout({ body: new engine.hb.SafeString(innerHtml) }, { data });
    expect(out).toContain('<head><script src="a"></script></head>');
    expect(out).toContain('<body>body</body>');
  });

  test('multiple contentFor "name" calls concatenate in order', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const inner = engine.hb.compile(
      '{{#contentFor "head"}}<a>{{/contentFor}}{{#contentFor "head"}}<b>{{/contentFor}}body',
    );
    const layout = engine.hb.compile('{{{block "head"}}}|{{{body}}}');
    const data = { __blocks: {} as Record<string, string> };
    const innerHtml = inner({}, { data });
    const out = layout({ body: new engine.hb.SafeString(innerHtml) }, { data });
    expect(out).toBe('<a><b>|body');
  });

  test('distinct slot names do not bleed into each other', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const inner = engine.hb.compile(
      '{{#contentFor "head"}}H{{/contentFor}}{{#contentFor "foot"}}F{{/contentFor}}',
    );
    const layout = engine.hb.compile('H={{{block "head"}}};F={{{block "foot"}}}');
    const data = { __blocks: {} as Record<string, string> };
    inner({}, { data });
    expect(layout({}, { data })).toBe('H=H;F=F');
  });

  test('block with no matching contentFor emits empty string', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const layout = engine.hb.compile('before|{{{block "missing"}}}|after');
    const data = { __blocks: {} as Record<string, string> };
    expect(layout({}, { data })).toBe('before||after');
  });

  test('contentFor body can reference outer context', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const inner = engine.hb.compile('{{#contentFor "title"}}{{name}} page{{/contentFor}}');
    const layout = engine.hb.compile('<title>{{{block "title"}}}</title>');
    const data = { __blocks: {} as Record<string, string> };
    inner({ name: 'Hello' }, { data });
    expect(layout({}, { data })).toBe('<title>Hello page</title>');
  });

  test('block output is not double-escaped when contentFor emits raw HTML', () => {
    const engine = makeEngine();
    registerContentForHelpers(engine);
    // contentFor body uses {{{ }}} so the HTML hits __blocks raw; block then
    // wraps in SafeString so layout's {{{block}}} re-emits unescaped.
    const inner = engine.hb.compile('{{#contentFor "head"}}{{{html}}}{{/contentFor}}');
    const layout = engine.hb.compile('{{{block "head"}}}');
    const data = { __blocks: {} as Record<string, string> };
    inner({ html: '<link rel="stylesheet">' }, { data });
    expect(layout({}, { data })).toBe('<link rel="stylesheet">');
  });

  test('lazy __blocks initialisation when caller forgot to seed it', () => {
    // Direct callers (tests, isolated helpers) may forget to seed __blocks on
    // the data frame; the helper degrades to a self-initialising no-op rather
    // than crashing on `undefined.head`.
    const engine = makeEngine();
    registerContentForHelpers(engine);
    const tpl = engine.hb.compile('{{#contentFor "x"}}v{{/contentFor}}done');
    expect(tpl({})).toBe('done');
  });
});
