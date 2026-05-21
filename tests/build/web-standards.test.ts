import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FaviconSet } from '~/build/favicons.ts';
import { emitFeedAlias, feedAliasHtml } from '~/build/feed-alias.ts';
import { htmlBuildId, injectHtmlBuildAttribute } from '~/build/html-metadata.ts';
import {
  GENERATED_WEB_MANIFEST_PATH,
  buildWebManifest,
  emitWebManifest,
} from '~/build/web-manifest.ts';
import type { NectarConfig } from '~/config/schema.ts';

function makeConfig(overrides: Partial<NectarConfig> = {}): NectarConfig {
  return {
    site: {
      title: 'Nectar Test',
      description: 'A static site',
      url: 'https://example.com',
      locale: 'en',
      timezone: 'UTC',
      accent_color: '#123456',
    },
    build: {
      output_dir: 'dist',
      base_path: '/blog/',
      posts_per_page: 12,
      trailing_slash: 'always',
      copy_content_assets: true,
      max_image_bytes: 0,
      allow_code_injection: false,
      include_future_posts: false,
      emit_email_only_stub: false,
      minify_html: false,
      precompress: false,
      metadata: {},
    },
    ...overrides,
  } as NectarConfig;
}

describe('injectHtmlBuildAttribute', () => {
  test('builds a stable 16-character sha256 label from the final HTML', () => {
    expect(htmlBuildId('<html></html>')).toMatch(/^[0-9a-f]{16}$/);
    expect(htmlBuildId('<html></html>')).toBe(htmlBuildId('<html></html>'));
    expect(htmlBuildId('<html>x</html>')).not.toBe(htmlBuildId('<html></html>'));
  });

  test('adds data-build to the opening html tag', () => {
    const html = '<!doctype html><html lang="en"><head></head><body></body></html>';

    expect(injectHtmlBuildAttribute(html, 'abc123')).toContain(
      '<html lang="en" data-build="abc123">',
    );
  });

  test('preserves an existing data-build attribute', () => {
    const html = '<html data-build="user"><body></body></html>';

    expect(injectHtmlBuildAttribute(html, 'abc123')).toBe(html);
  });
});

describe('feed alias', () => {
  test('renders a noindex refresh page to the RSS feed', () => {
    const html = feedAliasHtml('/blog/rss.xml');

    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/blog/rss.xml">');
    expect(html).toContain('<link rel="canonical" href="/blog/rss.xml">');
  });

  test('writes feed/index.html when enabled', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-feed-alias-'));

    await expect(emitFeedAlias({ outputDir, enabled: true, basePath: '/blog/' })).resolves.toBe(
      true,
    );
    const html = await readFile(join(outputDir, 'feed/index.html'), 'utf8');
    expect(html).toContain('url=/blog/rss.xml');
  });
});

describe('web manifest', () => {
  const emptyFavicons: FaviconSet = { links: [], copies: [] };

  test('builds a manifest with deploy base path and theme color', () => {
    const manifest = buildWebManifest(makeConfig(), emptyFavicons.links);

    expect(manifest).toMatchObject({
      name: 'Nectar Test',
      short_name: 'Nectar Test',
      start_url: '/blog/',
      scope: '/blog/',
      display: 'standalone',
      theme_color: '#123456',
    });
  });

  test('includes local favicon links as manifest icons', () => {
    const manifest = buildWebManifest(makeConfig(), [
      { rel: 'icon', href: '/favicon-192x192.png', type: 'image/png', sizes: '192x192' },
      { rel: 'icon', href: 'https://cdn.example.com/icon.png', type: 'image/png' },
    ]) as { icons?: Array<Record<string, string>> };

    expect(manifest.icons).toEqual([
      {
        src: '/blog/favicon-192x192.png',
        type: 'image/png',
        sizes: '192x192',
      },
    ]);
  });

  test('writes a generated manifest unless the theme ships one', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-web-manifest-'));

    await expect(
      emitWebManifest({ outputDir, config: makeConfig(), favicons: emptyFavicons }),
    ).resolves.toBe(true);
    const body = JSON.parse(
      await readFile(join(outputDir, GENERATED_WEB_MANIFEST_PATH), 'utf8'),
    ) as { name: string };
    expect(body.name).toBe('Nectar Test');
  });

  test('does not overwrite a theme-provided manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-web-manifest-skip-'));

    await expect(
      emitWebManifest({
        outputDir,
        config: makeConfig(),
        favicons: { links: [{ rel: 'manifest', href: '/manifest.webmanifest' }], copies: [] },
      }),
    ).resolves.toBe(false);
  });
});
