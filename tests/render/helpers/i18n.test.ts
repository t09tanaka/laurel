import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerI18nHelpers } from '~/render/helpers/i18n.ts';
import { registerStringHelpers } from '~/render/helpers/strings.ts';
import type { ThemeLocaleMap } from '~/theme/types.ts';

function makeEngine(locales: ThemeLocaleMap, locale = 'en'): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: { site: { locale } } as NectarEngine['content'],
    theme: { locales } as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

describe('t helper', () => {
  test('lang helper returns the active site locale code', () => {
    const engine = makeEngine({ en: {} }, 'pt-BR');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{lang}}')({})).toBe('pt-BR');
  });

  test('returns the active locale value when present', () => {
    const engine = makeEngine({ en: { Search: '' }, fr: { Search: 'Rechercher' } }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Search"}}')({})).toBe('Rechercher');
  });

  test('falls back to the English value when active locale is missing the key', () => {
    const engine = makeEngine({ en: { Search: 'Search' }, fr: {} }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Search"}}')({})).toBe('Search');
  });

  test('returns an empty string when the active locale value is an empty string', () => {
    // Ghost treats an existing locale entry as authoritative even when its
    // value is "", so this must not fall back to the key.
    const engine = makeEngine({ en: { Featured: '' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Featured"}}')({})).toBe('');
  });

  test('returns an empty active-locale value instead of the English fallback value', () => {
    const engine = makeEngine({ en: { Featured: 'Featured' }, fr: { Featured: '' } }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Featured"}}')({})).toBe('');
  });

  test('returns an empty active-locale value when both active and fallback values are empty', () => {
    const engine = makeEngine({ en: { Menu: '' }, fr: { Menu: '' } }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Menu"}}')({})).toBe('');
  });

  test('falls back to the English value when active locale is missing the key, even when empty', () => {
    const engine = makeEngine({ en: { Subscribe: '' }, fr: {} }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Subscribe"}}')({})).toBe('');
  });

  test('falls back to the key when the key is not in any locale', () => {
    const engine = makeEngine({ en: {} }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Untranslated"}}')({})).toBe('Untranslated');
  });

  test('interpolates named hash placeholders', () => {
    const engine = makeEngine({
      en: { 'A collection of {numberOfPosts} posts': 'A collection of {numberOfPosts} posts' },
    });
    registerI18nHelpers(engine);
    expect(
      engine.hb.compile('{{t "A collection of {numberOfPosts} posts" numberOfPosts=3}}')({}),
    ).toBe('A collection of 3 posts');
  });

  test('keeps double-stash interpolation values as plain text for Handlebars escaping', () => {
    const engine = makeEngine({
      en: { 'Math says {value}': 'Math says {value}' },
    });
    registerI18nHelpers(engine);

    expect(
      engine.hb.compile('{{t "Math says {value}" value=value}}')({ value: '2 > 1 && 1 < 2' }),
    ).toBe('Math says 2 &gt; 1 &amp;&amp; 1 &lt; 2');
  });

  test('strips markup from named interpolation values before triple-stash output', () => {
    const engine = makeEngine({
      en: { 'Hello {name}': 'Hello {name}' },
    });
    registerI18nHelpers(engine);

    expect(
      engine.hb.compile('{{{t "Hello {name}" name=name}}}')({
        name: '<img src=x onerror=alert(1)>Alice <strong>Admin</strong>',
      }),
    ).toBe('Hello Alice Admin');
  });

  test('preserves SafeString HTML from concat subexpressions in triple-stash output', () => {
    const engine = makeEngine({
      en: { 'in {primaryTag}': 'in {primaryTag}' },
    });
    registerI18nHelpers(engine);
    registerStringHelpers(engine);

    const tpl = engine.hb.compile(
      '{{{t "in {primaryTag}" primaryTag=(concat "<a href=\\"/tag/news/\\">" tag "</a>")}}}',
    );
    expect(tpl({ tag: 'News' })).toBe('in <a href="/tag/news/">News</a>');
  });

  // Casper-family themes use Ghost's positional `%` placeholder with
  // additional positional args: `{{t "Powered by %" "Ghost"}}`. The previous
  // implementation only consulted `options.hash`, so positional invocations
  // shipped a literal `%` to readers. Issue #1707.
  test('substitutes the positional argument into a `%` placeholder', () => {
    const engine = makeEngine({ en: { 'Powered by %': 'Powered by %' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Powered by %" "Ghost"}}')({})).toBe('Powered by Ghost');
  });

  test('strips markup from positional interpolation values before triple-stash output', () => {
    const engine = makeEngine({ en: { 'Powered by %': 'Powered by <strong>%</strong>' } }, 'en');
    registerI18nHelpers(engine);
    expect(
      engine.hb.compile('{{{t "Powered by %" "<em>Ghost</em><script>alert(1)</script>"}}}')({}),
    ).toBe('Powered by <strong>Ghost</strong>');
  });

  test('positional `%` arg wins over a hash entry, but hash still fills {name} placeholders', () => {
    const engine = makeEngine({ en: { 'By % about {topic}': 'By % about {topic}' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "By % about {topic}" "Alice" topic="cats"}}')({})).toBe(
      'By Alice about cats',
    );
  });

  test('substitutes numbered positional `%` placeholders by index', () => {
    const engine = makeEngine({ en: { '%1 has %2 posts': '%1 has %2 posts' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "%1 has %2 posts" "Alice" 3}}')({})).toBe('Alice has 3 posts');
  });

  test('leaves missing numbered `%` placeholders unchanged', () => {
    const engine = makeEngine({ en: { '%1 has %2 posts': '%1 has %2 posts' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "%1 has %2 posts" "Alice"}}')({})).toBe('Alice has %2 posts');
  });

  test('does not substitute bare `%` from an arbitrary hash value', () => {
    const engine = makeEngine({ en: { 'By % about {topic}': 'By % about {topic}' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "By % about {topic}" topic="cats" author="Alice"}}')({})).toBe(
      'By % about cats',
    );
  });

  test('substitutes bare `%` from explicit count-like hash values', () => {
    const engine = makeEngine({ en: { 'Page % of {total}': 'Page % of {total}' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Page % of {total}" total=10 page=2}}')({})).toBe('Page 2 of 10');
  });

  test('substitutes bare `%` from a single numeric hash value', () => {
    const engine = makeEngine({ en: { 'Page %': 'Page %' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Page %" current=2}}')({})).toBe('Page 2');
  });

  test('escapes HTML in translation output through normal Handlebars rendering', () => {
    const engine = makeEngine({ en: { Alert: '<strong>Alert</strong>' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Alert"}}')({})).toBe('&lt;strong&gt;Alert&lt;/strong&gt;');
  });

  test('substitutes the first count-like hash value into a `%` placeholder', () => {
    const engine = makeEngine({ en: { 'Page %': 'Page %' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Page %" page=3}}')({})).toBe('Page 3');
  });

  test('fills named placeholders and uses the first count-like hash value for `%`', () => {
    const engine = makeEngine({ en: { 'Page % of {pages}': 'Page % of {pages}' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Page % of {pages}" page=4 pages=9}}')({})).toBe('Page 4 of 9');
  });

  test('Casper de.json placeholder is rendered when active locale is de', () => {
    const engine = makeEngine(
      {
        en: { 'Powered by %': '' },
        de: { 'Powered by %': 'Betrieben durch %' },
      },
      'de',
    );
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Powered by %" "Casper"}}')({})).toBe('Betrieben durch Casper');
  });

  test('uses route.locale for t and lang when rendering a localized route', () => {
    const engine = makeEngine(
      {
        en: { Greeting: 'Hello' },
        ja: { Greeting: 'こんにちは' },
      },
      'en',
    );
    registerI18nHelpers(engine);
    const tpl = engine.hb.compile('{{lang}}:{{t "Greeting"}}');
    expect(tpl({}, { data: { route: { locale: 'ja' } } })).toBe('ja:こんにちは');
  });

  test('stringifies numeric and boolean locale values', () => {
    const engine = makeEngine({
      en: {
        Count: 3,
        Enabled: true,
        Disabled: false,
      },
    });
    registerI18nHelpers(engine);

    expect(engine.hb.compile('{{t "Count"}}')({})).toBe('3');
    expect(engine.hb.compile('{{t "Enabled"}}')({})).toBe('true');
    expect(engine.hb.compile('{{t "Disabled"}}')({})).toBe('false');
  });
});
