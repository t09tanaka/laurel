import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerI18nHelpers } from '~/render/helpers/i18n.ts';

function makeEngine(locales: Record<string, Record<string, string>>, locale = 'en'): NectarEngine {
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

  test('falls back to the key when active locale value is an empty string', () => {
    // Ghost ships en.json with "" for every key as a "use the key" sentinel.
    // Regression guard for icon buttons rendering aria-label="".
    const engine = makeEngine({ en: { Menu: '', 'Search this site': '' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Menu"}}')({})).toBe('Menu');
    expect(engine.hb.compile('{{t "Search this site"}}')({})).toBe('Search this site');
  });

  test('falls back to the key when both active and fallback values are empty', () => {
    const engine = makeEngine({ en: { Menu: '' }, fr: { Menu: '' } }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Menu"}}')({})).toBe('Menu');
  });

  // Issue #469: lookup chain uses `||` semantics so an empty active-locale
  // value falls through to the fallback. Pin down the active-empty,
  // fallback-set path explicitly so a future regression to `??` is caught
  // here, not in downstream theme renders.
  test('empty active-locale value falls through to the English fallback value', () => {
    const engine = makeEngine({ en: { Subscribe: 'Subscribe' }, fr: { Subscribe: '' } }, 'fr');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Subscribe"}}')({})).toBe('Subscribe');
  });

  test('falls back to the key when the key is not in any locale', () => {
    const engine = makeEngine({ en: {} }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Untranslated"}}')({})).toBe('Untranslated');
  });

  test('interpolates named hash placeholders', () => {
    const engine = makeEngine({ en: { 'A collection of {numberOfPosts} posts': '' } }, 'en');
    registerI18nHelpers(engine);
    expect(
      engine.hb.compile('{{t "A collection of {numberOfPosts} posts" numberOfPosts=3}}')({}),
    ).toBe('A collection of 3 posts');
  });

  // Casper-family themes use Ghost's positional `%` placeholder with
  // additional positional args: `{{t "Powered by %" "Ghost"}}`. The previous
  // implementation only consulted `options.hash`, so positional invocations
  // shipped a literal `%` to readers. Issue #1707.
  test('substitutes the positional argument into a `%` placeholder', () => {
    const engine = makeEngine({ en: { 'Powered by %': '' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "Powered by %" "Ghost"}}')({})).toBe('Powered by Ghost');
  });

  test('positional `%` arg wins over a hash entry, but hash still fills {name} placeholders', () => {
    const engine = makeEngine({ en: { 'By % about {topic}': '' } }, 'en');
    registerI18nHelpers(engine);
    expect(engine.hb.compile('{{t "By % about {topic}" "Alice" topic="cats"}}')({})).toBe(
      'By Alice about cats',
    );
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
});
