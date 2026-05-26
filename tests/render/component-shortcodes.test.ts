import { describe, expect, it } from 'bun:test';
import type { ComponentSnippet } from '../../src/content/model.ts';
import { expandComponentShortcodes } from '../../src/render/component-shortcodes.ts';

function snippet(slug: string, html: string, css = ''): ComponentSnippet {
  return {
    slug,
    description: '',
    html,
    css,
    source: { path: `content/components/${slug}.md`, mtimeMs: 0, size: 0 },
  };
}

function map(...items: ComponentSnippet[]): Map<string, ComponentSnippet> {
  return new Map(items.map((c) => [c.slug, c]));
}

describe('expandComponentShortcodes', () => {
  it('replaces a {slug} shortcode in body text with the component HTML', () => {
    const components = map(snippet('googleAds', '<ins class="ad"></ins>'));
    const out = expandComponentShortcodes('<p>Before {googleAds} after.</p>', components);
    expect(out.html).toBe('<p>Before <ins class="ad"></ins> after.</p>');
    expect([...out.used]).toEqual(['googleAds']);
    expect([...out.missing]).toEqual([]);
  });

  it('leaves unknown shortcodes verbatim and records them as missing', () => {
    const out = expandComponentShortcodes('<p>{nope}</p>', map());
    expect(out.html).toBe('<p>{nope}</p>');
    expect([...out.used]).toEqual([]);
    expect([...out.missing]).toEqual(['nope']);
  });

  it('does not expand inside code, pre, kbd, samp, or var', () => {
    const c = map(snippet('cta', '<button>Buy</button>'));
    const cases = ['code', 'pre', 'kbd', 'samp', 'var'];
    for (const tag of cases) {
      const out = expandComponentShortcodes(`<${tag}>{cta}</${tag}>`, c);
      expect(out.html).toBe(`<${tag}>{cta}</${tag}>`);
      expect(out.used.size).toBe(0);
    }
  });

  it('expands the same shortcode many times and reports the slug once', () => {
    const c = map(snippet('hr', '<hr>'));
    const out = expandComponentShortcodes('<p>{hr} a {hr} b {hr}</p>', c);
    expect(out.html).toBe('<p><hr> a <hr> b <hr></p>');
    expect([...out.used]).toEqual(['hr']);
  });

  it('leaves CSS-like brace expressions in prose untouched', () => {
    const c = map(snippet('cta', '<button>Buy</button>'));
    const out = expandComponentShortcodes('<p>Use p { color: red } in CSS.</p>', c);
    expect(out.html).toBe('<p>Use p { color: red } in CSS.</p>');
    expect(out.used.size).toBe(0);
  });

  it('skips the parse / serialize round-trip when no `{` appears', () => {
    const c = map(snippet('cta', '<button>Buy</button>'));
    const out = expandComponentShortcodes('<p>plain body.</p>', c);
    expect(out.html).toBe('<p>plain body.</p>');
  });
});
