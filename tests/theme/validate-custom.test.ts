import { describe, expect, test } from 'bun:test';
import { configSchema } from '~/config/schema.ts';
import type { ThemePackage } from '~/theme/types.ts';
import { findUnknownThemeCustomKeys, formatThemeCustomIssue } from '~/theme/validate-custom.ts';

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
