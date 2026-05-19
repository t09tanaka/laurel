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
});
