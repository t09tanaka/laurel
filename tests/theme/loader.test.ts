import { describe, expect, test } from 'bun:test';
import { configSchema } from '~/config/schema.ts';
import { loadTheme } from '~/theme/loader.ts';

describe('loadTheme', () => {
  test('loads the vendored Source theme', async () => {
    const config = configSchema.parse({
      theme: { name: 'source', dir: 'themes' },
      site: { title: 'Example', url: 'https://example.com' },
    });
    const cwd = `${process.cwd()}/example`;
    const theme = await loadTheme({ cwd, config });
    expect(theme.name).toBe('source');
    expect(theme.templates.default).toBeDefined();
    expect(theme.templates.index).toBeDefined();
    expect(theme.templates.post).toBeDefined();
    expect(theme.templates.page).toBeDefined();
    expect(theme.partials['components/navigation']).toBeDefined();
    expect(theme.partials['icons/twitter']).toBeDefined();
    expect(theme.partials['post-card']).toBeDefined();
    expect(theme.assets.size).toBeGreaterThan(0);
    expect(theme.pkg.posts_per_page).toBe(12);
    expect(theme.pkg.image_sizes.xs?.width).toBe(160);
    expect(theme.pkg.customDefaults.site_background_color).toBe('#ffffff');
    expect(Object.keys(theme.locales).length).toBeGreaterThan(0);
  });
});
