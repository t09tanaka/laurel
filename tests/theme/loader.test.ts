import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from '~/config/schema.ts';
import { loadTheme } from '~/theme/loader.ts';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-theme-loader-'));
  return await fn(dir);
}

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
    expect(theme.pkg.custom.header_text?.group).toBe('homepage');
    expect(theme.pkg.custom.header_text?.visibility).toBe('header_style:[Landing, Search]');
    expect(Object.keys(theme.locales).length).toBeGreaterThan(0);
  });

  test('loads every partial under partials even when templates do not reference them', async () => {
    await withTempDir(async (cwd) => {
      const themeRoot = join(cwd, 'themes', 'london');
      await mkdir(join(themeRoot, 'partials', 'icons'), { recursive: true });
      await writeFile(join(themeRoot, 'default.hbs'), '{{{body}}}', 'utf8');
      await writeFile(join(themeRoot, 'index.hbs'), '<main>London</main>', 'utf8');
      await writeFile(
        join(themeRoot, 'partials', 'icons', 'avatar.hbs'),
        '<svg>avatar</svg>',
        'utf8',
      );
      await writeFile(
        join(themeRoot, 'partials', 'icons', 'ghost-logo.hbs'),
        '<svg>ghost</svg>',
        'utf8',
      );
      await writeFile(
        join(themeRoot, 'partials', 'icons', 'infinity.hbs'),
        '<svg>infinity</svg>',
        'utf8',
      );

      const config = configSchema.parse({
        theme: { name: 'london', dir: 'themes' },
        site: { title: 'London', url: 'https://london.example.com' },
      });

      const theme = await loadTheme({ cwd, config });

      expect(theme.templates.default).toBe('{{{body}}}');
      expect(theme.templates.index).toBe('<main>London</main>');
      expect(theme.partials['icons/avatar']).toBe('<svg>avatar</svg>');
      expect(theme.partials['icons/ghost-logo']).toBe('<svg>ghost</svg>');
      expect(theme.partials['icons/infinity']).toBe('<svg>infinity</svg>');
    });
  });

  // #855: themes shipped as npm packages live under node_modules/<spec>/
  // rather than `<cwd>/themes/<name>/`. The loader falls back to
  // `node_modules/<theme.dir>` when nothing exists at the local-directory
  // location.
  test('resolves theme.dir as an npm package name when local dir is missing', async () => {
    await withTempDir(async (cwd) => {
      const pkgRoot = join(cwd, 'node_modules', 'nectar-theme-mini');
      await mkdir(pkgRoot, { recursive: true });
      await writeFile(join(pkgRoot, 'package.json'), JSON.stringify({ name: 'nectar-theme-mini' }));
      await writeFile(
        join(pkgRoot, 'default.hbs'),
        '<!doctype html><html><body>{{{body}}}</body></html>',
        'utf8',
      );
      const config = configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        theme: { name: 'mini', dir: 'nectar-theme-mini' },
      });
      const theme = await loadTheme({ cwd, config });
      expect(theme.templates.default).toBeDefined();
    });
  });

  test('resolves @scope/name npm package specs', async () => {
    await withTempDir(async (cwd) => {
      const pkgRoot = join(cwd, 'node_modules', '@nectar', 'theme-scoped');
      await mkdir(pkgRoot, { recursive: true });
      await writeFile(
        join(pkgRoot, 'package.json'),
        JSON.stringify({ name: '@nectar/theme-scoped' }),
      );
      await writeFile(join(pkgRoot, 'default.hbs'), 'hi', 'utf8');
      const config = configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        theme: { name: 'scoped', dir: '@nectar/theme-scoped' },
      });
      const theme = await loadTheme({ cwd, config });
      expect(theme.templates.default).toBe('hi');
    });
  });

  test('prefers local `themes/<name>` over node_modules when both exist', async () => {
    await withTempDir(async (cwd) => {
      const localRoot = join(cwd, 'themes', 'mini');
      await mkdir(localRoot, { recursive: true });
      await writeFile(join(localRoot, 'default.hbs'), 'LOCAL', 'utf8');
      // Plant a node_modules clash to prove the local dir wins.
      const pkgRoot = join(cwd, 'node_modules', 'themes');
      await mkdir(pkgRoot, { recursive: true });
      await writeFile(join(pkgRoot, 'package.json'), JSON.stringify({ name: 'themes' }));
      await writeFile(join(pkgRoot, 'default.hbs'), 'NPM', 'utf8');
      const config = configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        theme: { name: 'mini', dir: 'themes' },
      });
      const theme = await loadTheme({ cwd, config });
      expect(theme.templates.default).toBe('LOCAL');
    });
  });

  test('preserves numeric and boolean locale values', async () => {
    await withTempDir(async (cwd) => {
      const themeRoot = join(cwd, 'themes', 'mini');
      await mkdir(join(themeRoot, 'locales'), { recursive: true });
      await writeFile(join(themeRoot, 'default.hbs'), 'hi', 'utf8');
      await writeFile(
        join(themeRoot, 'locales', 'en.json'),
        JSON.stringify({
          Title: 'Title',
          Count: 3,
          Enabled: true,
          Disabled: false,
        }),
        'utf8',
      );
      const config = configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        theme: { name: 'mini', dir: 'themes' },
      });

      const theme = await loadTheme({ cwd, config });

      expect(theme.locales.en).toEqual({
        Title: 'Title',
        Count: 3,
        Enabled: true,
        Disabled: false,
      });
    });
  });
});
