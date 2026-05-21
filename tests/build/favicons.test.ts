import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFavicons, copyFavicons } from '~/build/favicons.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';

function makeConfig(siteOverrides: Partial<NectarConfig['site']> = {}): NectarConfig {
  return {
    site: {
      title: 'Test',
      description: '',
      url: 'https://example.com',
      locale: 'en',
      timezone: 'UTC',
      accent_color: '#222222',
      ...siteOverrides,
    },
    theme: { name: 'source', dir: 'themes', custom: {} },
    content: {
      posts_dir: 'content/posts',
      pages_dir: 'content/pages',
      authors_dir: 'content/authors',
      tags_dir: 'content/tags',
      assets_dir: 'content/images',
      visibility_policy: 'truncate',
      paywall_word_count: 300,
    },
    build: {
      output_dir: 'dist',
      base_path: '/',
      posts_per_page: 12,
      copy_content_assets: true,
      max_image_bytes: 0,
    },
    navigation: [],
    secondary_navigation: [],
    components: {} as NectarConfig['components'],
  } as unknown as NectarConfig;
}

function makeTheme(assets: Record<string, string> = {}): ThemeBundle {
  const assetMap = new Map<string, ThemeAsset>();
  for (const [logical, sourcePath] of Object.entries(assets)) {
    assetMap.set(logical, {
      logicalPath: logical,
      fingerprintedPath: logical,
      sourcePath,
      hash: 'deadbeef',
      integrity: 'sha384-deadbeef',
      size: 1,
    });
  }
  return {
    name: 'source',
    rootDir: '/tmp/theme',
    templates: {},
    partials: {},
    pkg: {
      name: 'source',
      version: '1.0.0',
      posts_per_page: 12,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    },
    locales: {},
    assets: assetMap,
  };
}

describe('computeFavicons', () => {
  test('returns an empty set when neither theme nor site.icon provide anything', () => {
    const result = computeFavicons({
      config: makeConfig(),
      theme: makeTheme(),
      cwd: '/tmp/site',
    });
    expect(result.links).toEqual([]);
    expect(result.copies).toEqual([]);
  });

  test('picks up well-known theme favicon files and emits matching <link>s', () => {
    const result = computeFavicons({
      config: makeConfig(),
      theme: makeTheme({
        'assets/favicon.ico': '/themes/source/assets/favicon.ico',
        'assets/favicon-32x32.png': '/themes/source/assets/favicon-32x32.png',
        'assets/apple-touch-icon.png': '/themes/source/assets/apple-touch-icon.png',
        'assets/safari-pinned-tab.svg': '/themes/source/assets/safari-pinned-tab.svg',
        'assets/site.webmanifest': '/themes/source/assets/site.webmanifest',
      }),
      cwd: '/tmp/site',
    });
    const rels = result.links.map((l) => `${l.rel}|${l.sizes ?? ''}`);
    expect(rels).toContain('icon|');
    expect(rels).toContain('icon|32x32');
    expect(rels).toContain('apple-touch-icon|180x180');
    expect(rels).toContain('mask-icon|');
    expect(rels).toContain('manifest|');
    const maskIcon = result.links.find((l) => l.rel === 'mask-icon');
    expect(maskIcon?.color).toBe('#222222');
    expect(result.copies.map((c) => c.outputPath).sort()).toEqual(
      [
        'apple-touch-icon.png',
        'favicon-32x32.png',
        'favicon.ico',
        'safari-pinned-tab.svg',
        'site.webmanifest',
      ].sort(),
    );
  });

  test('falls back to site.icon when theme ships no favicons', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-fav-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/logo.svg'), '<svg/>');
    const result = computeFavicons({
      config: makeConfig({ icon: '/content/images/logo.svg' }),
      theme: makeTheme(),
      cwd,
    });
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toEqual({
      rel: 'icon',
      href: '/favicon.svg',
      type: 'image/svg+xml',
    });
    expect(result.copies).toHaveLength(1);
    expect(result.copies[0]?.outputPath).toBe('favicon.svg');
  });

  test('emits apple-touch-icon when site.icon is PNG and theme has none', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-fav-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/logo.png'), 'png');
    const result = computeFavicons({
      config: makeConfig({ icon: '/content/images/logo.png' }),
      theme: makeTheme(),
      cwd,
    });
    const apple = result.links.find((l) => l.rel === 'apple-touch-icon');
    expect(apple).toBeDefined();
    expect(apple?.href).toBe('/favicon.png');
  });

  test('does not duplicate apple-touch-icon when theme already provides one', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-fav-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/logo.png'), 'png');
    const result = computeFavicons({
      config: makeConfig({ icon: '/content/images/logo.png' }),
      theme: makeTheme({
        'assets/apple-touch-icon.png': '/themes/source/assets/apple-touch-icon.png',
      }),
      cwd,
    });
    const appleLinks = result.links.filter((l) => l.rel === 'apple-touch-icon');
    expect(appleLinks).toHaveLength(1);
    expect(appleLinks[0]?.href).toBe('/apple-touch-icon.png');
  });

  test('skips site.icon when theme already provides rel=icon', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-fav-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/logo.svg'), '<svg/>');
    const result = computeFavicons({
      config: makeConfig({ icon: '/content/images/logo.svg' }),
      theme: makeTheme({
        'assets/favicon.ico': '/themes/source/assets/favicon.ico',
      }),
      cwd,
    });
    expect(result.links.map((l) => l.href)).toEqual(['/favicon.ico']);
  });

  test('passes a remote site.icon through as-is without copying', () => {
    const result = computeFavicons({
      config: makeConfig({ icon: 'https://cdn.example.com/favicon.png' }),
      theme: makeTheme(),
      cwd: '/tmp/site',
    });
    expect(result.copies).toEqual([]);
    expect(result.links).toEqual([
      { rel: 'icon', href: 'https://cdn.example.com/favicon.png', type: 'image/png' },
    ]);
  });

  test('refuses site.icon paths that traverse outside cwd', () => {
    const result = computeFavicons({
      config: makeConfig({ icon: '../escape.png' }),
      theme: makeTheme(),
      cwd: '/tmp/site',
    });
    expect(result.links).toEqual([]);
    expect(result.copies).toEqual([]);
  });

  test('skips site.icon when the source file does not exist', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-fav-'));
    const result = computeFavicons({
      config: makeConfig({ icon: '/content/images/missing.png' }),
      theme: makeTheme(),
      cwd,
    });
    expect(result.links).toEqual([]);
  });
});

describe('copyFavicons', () => {
  test('copies each declared source file into the output dir', async () => {
    const src = await mkdtemp(join(tmpdir(), 'nectar-fav-src-'));
    const out = await mkdtemp(join(tmpdir(), 'nectar-fav-out-'));
    await writeFile(join(src, 'favicon.ico'), 'ico-bytes');
    await writeFile(join(src, 'apple-touch-icon.png'), 'png-bytes');

    const count = await copyFavicons(
      {
        links: [],
        copies: [
          { sourcePath: join(src, 'favicon.ico'), outputPath: 'favicon.ico' },
          { sourcePath: join(src, 'apple-touch-icon.png'), outputPath: 'apple-touch-icon.png' },
        ],
      },
      out,
    );
    expect(count).toBe(2);
    expect(existsSync(join(out, 'favicon.ico'))).toBe(true);
    const body = await readFile(join(out, 'favicon.ico'), 'utf8');
    expect(body).toBe('ico-bytes');
  });
});
