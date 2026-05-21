import { describe, expect, test } from 'bun:test';
import type { ThemePackage } from '~/theme/types.ts';
import { generateThemeCustomTomlSnippet } from '~/theme/validate-custom.ts';

describe('generateThemeCustomTomlSnippet', () => {
  test('renders a nectar.toml snippet from theme package custom settings', () => {
    const pkg = {
      name: 'custom-theme',
      version: '1.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: true,
      customDefaults: {},
      custom: {
        show_featured: { type: 'boolean', default: true, description: 'Show featured posts.' },
        accent: { type: 'color' },
        layout: { type: 'select', options: ['Grid', 'List'], default: 'Grid' },
      },
    } satisfies ThemePackage;

    const snippet = generateThemeCustomTomlSnippet(pkg);
    expect(snippet).toContain('[theme.custom]');
    expect(snippet).toContain('show_featured = true');
    expect(snippet).toContain('layout = "Grid"');
    expect(snippet).toContain('accent = "#ffffff"');
  });
});
