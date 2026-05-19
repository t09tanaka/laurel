import { describe, expect, test } from 'bun:test';
import { configSchema } from '~/config/schema.ts';
import type { ThemePackage } from '~/theme/types.ts';
import {
  findInvalidThemeCustomValues,
  findUnknownThemeCustomKeys,
  formatThemeCustomIssue,
  formatThemeCustomValueIssue,
  sanitizeThemeCustomValues,
} from '~/theme/validate-custom.ts';

function makePkg(custom: ThemePackage['custom']): ThemePackage {
  return {
    name: 'test-theme',
    version: '0.0.0',
    posts_per_page: 5,
    image_sizes: {},
    card_assets: false,
    custom,
    customDefaults: {},
  };
}

describe('findUnknownThemeCustomKeys', () => {
  test('returns empty when every key is declared by the theme', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { title_font: 'Modern sans-serif' } },
    });
    const pkg = makePkg({ title_font: { type: 'select', options: ['Modern sans-serif'] } });
    expect(findUnknownThemeCustomKeys({ config, pkg })).toEqual([]);
  });

  test('flags typos with a did-you-mean suggestion', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { titel_font: 'Elegant serif' } },
    });
    const pkg = makePkg({ title_font: { type: 'select', options: ['Elegant serif'] } });
    const issues = findUnknownThemeCustomKeys({ config, pkg });
    expect(issues).toEqual([{ key: 'titel_font', suggestion: 'title_font' }]);
  });

  test('flags wholly unknown keys without a suggestion', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { totally_unrelated: 'x' } },
    });
    const pkg = makePkg({ title_font: { type: 'select', options: ['Modern sans-serif'] } });
    const issues = findUnknownThemeCustomKeys({ config, pkg });
    expect(issues).toEqual([{ key: 'totally_unrelated' }]);
  });

  test('skips validation entirely when the theme declares no custom schema', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { anything: 'goes' } },
    });
    const pkg = makePkg({});
    expect(findUnknownThemeCustomKeys({ config, pkg })).toEqual([]);
  });
});

describe('formatThemeCustomIssue', () => {
  test('renders a did-you-mean hint when a suggestion is available', () => {
    expect(formatThemeCustomIssue({ key: 'titel_font', suggestion: 'title_font' }, 'source')).toBe(
      'unknown `[theme.custom].titel_font` — not declared by theme "source" (did you mean `title_font`?)',
    );
  });

  test('omits the hint when there is no nearby match', () => {
    expect(formatThemeCustomIssue({ key: 'totally_unrelated' }, 'source')).toBe(
      'unknown `[theme.custom].totally_unrelated` — not declared by theme "source"',
    );
  });
});

describe('findInvalidThemeCustomValues', () => {
  test('flags a select value that is not one of the declared options', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { title_font: 'Comic Sans' } },
    });
    const pkg = makePkg({
      title_font: {
        type: 'select',
        options: ['Modern sans-serif', 'Elegant serif', 'Consistent mono'],
      },
    });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([
      {
        key: 'title_font',
        reason:
          '`Comic Sans` is not one of `Modern sans-serif`, `Elegant serif`, `Consistent mono`',
      },
    ]);
  });

  test('suggests the closest valid select option when the value is a near-miss', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { title_font: 'Elegent serif' } },
    });
    const pkg = makePkg({
      title_font: {
        type: 'select',
        options: ['Modern sans-serif', 'Elegant serif', 'Consistent mono'],
      },
    });
    const issues = findInvalidThemeCustomValues({ config, pkg });
    expect(issues).toEqual([
      {
        key: 'title_font',
        reason:
          '`Elegent serif` is not one of `Modern sans-serif`, `Elegant serif`, `Consistent mono`',
        suggestion: 'Elegant serif',
      },
    ]);
  });

  test('accepts a select value that matches one of the options', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { title_font: 'Elegant serif' } },
    });
    const pkg = makePkg({
      title_font: {
        type: 'select',
        options: ['Modern sans-serif', 'Elegant serif'],
      },
    });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([]);
  });

  test('skips select validation when the theme declares no options', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { title_font: 'Anything' } },
    });
    const pkg = makePkg({ title_font: { type: 'select' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([]);
  });

  test('flags a boolean setting that received a string', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { show_author: 'yes' } },
    });
    const pkg = makePkg({ show_author: { type: 'boolean' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([
      { key: 'show_author', reason: 'expected boolean, got string `yes`' },
    ]);
  });

  test('accepts a boolean setting that received a boolean', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { show_author: false } },
    });
    const pkg = makePkg({ show_author: { type: 'boolean' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([]);
  });

  test('flags a text setting that received a number', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { signup_heading: 42 } },
    });
    const pkg = makePkg({ signup_heading: { type: 'text' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([
      { key: 'signup_heading', reason: 'expected string, got number `42`' },
    ]);
  });

  test('flags a color setting that is not a hex string', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { site_background_color: 'red' } },
    });
    const pkg = makePkg({ site_background_color: { type: 'color' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([
      {
        key: 'site_background_color',
        reason: '`red` is not a valid hex color (e.g. `#ffffff`)',
      },
    ]);
  });

  test('accepts a 6-digit hex color', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { site_background_color: '#ffffff' } },
    });
    const pkg = makePkg({ site_background_color: { type: 'color' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([]);
  });

  test('accepts a 3-digit and 8-digit hex color', () => {
    const config3 = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { site_background_color: '#fff' } },
    });
    const config8 = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { site_background_color: '#ffffffaa' } },
    });
    const pkg = makePkg({ site_background_color: { type: 'color' } });
    expect(findInvalidThemeCustomValues({ config: config3, pkg })).toEqual([]);
    expect(findInvalidThemeCustomValues({ config: config8, pkg })).toEqual([]);
  });

  test('flags an image setting that received a boolean', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { hero_image: true } },
    });
    const pkg = makePkg({ hero_image: { type: 'image' } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([
      { key: 'hero_image', reason: 'expected image path string, got boolean `true`' },
    ]);
  });

  test('does not flag keys that the theme does not declare', () => {
    const config = configSchema.parse({
      site: { title: 'Blog' },
      theme: { custom: { totally_unrelated: 'whatever' } },
    });
    const pkg = makePkg({ title_font: { type: 'select', options: ['Modern sans-serif'] } });
    expect(findInvalidThemeCustomValues({ config, pkg })).toEqual([]);
  });
});

describe('sanitizeThemeCustomValues', () => {
  test('keeps a valid hex color untouched', () => {
    const result = sanitizeThemeCustomValues(
      { site_background_color: '#fafafa' },
      { site_background_color: { type: 'color' } },
    );
    expect(result.site_background_color).toBe('#fafafa');
  });

  test('strips a CSS-breakout payload from a color-typed key (issue #560)', () => {
    const payload = "red; } body { display: none } @import url('//evil.tld/x.css'); /*";
    const result = sanitizeThemeCustomValues(
      { site_background_color: payload },
      { site_background_color: { type: 'color' } },
    );
    expect(result.site_background_color).toBe('');
  });

  test('strips a malicious theme default the same way as user config', () => {
    const result = sanitizeThemeCustomValues(
      { site_background_color: 'red; }/**/x:url("//evil")' },
      { site_background_color: { type: 'color' } },
    );
    expect(result.site_background_color).toBe('');
  });

  test('strips a non-string color value', () => {
    const result = sanitizeThemeCustomValues(
      { site_background_color: 42 },
      { site_background_color: { type: 'color' } },
    );
    expect(result.site_background_color).toBe('');
  });

  test('leaves non-color keys alone even if they look unsafe', () => {
    const result = sanitizeThemeCustomValues(
      { signup_heading: '} body { display: none } /*' },
      { signup_heading: { type: 'text' } },
    );
    expect(result.signup_heading).toBe('} body { display: none } /*');
  });

  test('does not introduce keys that were not in the input', () => {
    const result = sanitizeThemeCustomValues({}, { site_background_color: { type: 'color' } });
    expect('site_background_color' in result).toBe(false);
  });
});

describe('formatThemeCustomValueIssue', () => {
  test('renders a did-you-mean hint when a suggestion is available', () => {
    expect(
      formatThemeCustomValueIssue(
        {
          key: 'title_font',
          reason: '`Elegent serif` is not one of `Elegant serif`',
          suggestion: 'Elegant serif',
        },
        'source',
      ),
    ).toBe(
      'invalid value for `[theme.custom].title_font` in theme "source": `Elegent serif` is not one of `Elegant serif` (did you mean `Elegant serif`?)',
    );
  });

  test('omits the hint when there is no suggestion', () => {
    expect(
      formatThemeCustomValueIssue(
        { key: 'show_author', reason: 'expected boolean, got string `yes`' },
        'source',
      ),
    ).toBe(
      'invalid value for `[theme.custom].show_author` in theme "source": expected boolean, got string `yes`',
    );
  });
});
