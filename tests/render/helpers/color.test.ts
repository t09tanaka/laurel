import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { LaurelEngine } from '~/render/engine.ts';
import { registerColorHelpers } from '~/render/helpers/color.ts';
import { registerHelpers } from '~/render/helpers/index.ts';

function makeEngine(): LaurelEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {
      build: { base_path: '/' },
      components: {},
      theme: { custom: {} },
    } as unknown as LaurelEngine['config'],
    content: {
      site: {
        title: 'Example',
        url: 'https://example.test',
        locale: 'en',
        timezone: 'UTC',
      },
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
    } as unknown as LaurelEngine['content'],
    theme: {
      name: 'test',
      partials: {},
      assets: new Map(),
      pkg: {
        image_sizes: {},
        posts_per_page: 5,
        card_assets: true,
        custom: {},
        customDefaults: {},
      },
      locales: {},
    } as unknown as LaurelEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map<string, readonly unknown[]>(),
    render() {
      throw new Error('not used');
    },
  } as unknown as LaurelEngine;
}

describe('color helpers', () => {
  test('color_to_rgba converts short hex colors with hash alpha', () => {
    const engine = makeEngine();
    registerColorHelpers(engine);

    expect(engine.hb.compile('{{color_to_rgba "#fff" alpha=0.5}}')({})).toBe(
      'rgba(255, 255, 255, 0.5)',
    );
  });

  test('color_to_rgba supports full hex, rgb syntax, named colors, and percentage alpha', () => {
    const engine = makeEngine();
    registerColorHelpers(engine);

    expect(engine.hb.compile('{{color_to_rgba "#336699"}}')({})).toBe('rgba(51, 102, 153, 1)');
    expect(engine.hb.compile('{{color_to_rgba "rgb(10 20 30)" alpha="25%"}}')({})).toBe(
      'rgba(10, 20, 30, 0.25)',
    );
    expect(engine.hb.compile('{{color_to_rgba "black" alpha=2}}')({})).toBe('rgba(0, 0, 0, 1)');
  });

  test('color_to_rgba returns empty string for missing or invalid colors', () => {
    const engine = makeEngine();
    registerColorHelpers(engine);

    expect(engine.hb.compile('{{color_to_rgba}}')({})).toBe('');
    expect(engine.hb.compile('{{color_to_rgba "not-a-color"}}')({})).toBe('');
  });

  test('contrast_text_color returns dark for light backgrounds and light for dark backgrounds', () => {
    const engine = makeEngine();
    registerColorHelpers(engine);

    expect(engine.hb.compile('{{contrast_text_color "#fff"}}')({})).toBe('dark');
    expect(engine.hb.compile('{{contrast_text_color "#000"}}')({})).toBe('light');
    expect(engine.hb.compile('{{contrast_text_color "rgb(20, 20, 20)"}}')({})).toBe('light');
  });

  test('contrast_text_color defaults to dark for missing or invalid colors', () => {
    const engine = makeEngine();
    registerColorHelpers(engine);

    expect(engine.hb.compile('{{contrast_text_color}}')({})).toBe('dark');
    expect(engine.hb.compile('{{contrast_text_color "not-a-color"}}')({})).toBe('dark');
  });

  test('registerHelpers installs both Ghost color helpers', () => {
    const engine = makeEngine();
    registerHelpers(engine);

    expect(typeof engine.hb.helpers.color_to_rgba).toBe('function');
    expect(typeof engine.hb.helpers.contrast_text_color).toBe('function');
  });
});
