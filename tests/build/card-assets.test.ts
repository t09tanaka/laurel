import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CARD_ASSETS_CSS_PATH,
  CARD_ASSETS_JS_PATH,
  cardAssetsVersion,
  emitCardAssets,
  renderCardAssetsCss,
  renderCardAssetsJs,
} from '~/build/card-assets.ts';

function tmpDir(): string {
  return join(
    process.env.TMPDIR ?? '/tmp',
    `nectar-card-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

describe('emitCardAssets', () => {
  let outputDir = '';

  beforeEach(() => {
    outputDir = tmpDir();
  });

  afterEach(async () => {
    await Bun.$`rm -rf ${outputDir}`.quiet().nothrow();
  });

  test('writes local shared card CSS and JS when enabled', async () => {
    const wrote = await emitCardAssets({ outputDir, cardAssets: true });

    expect(wrote).toBe(true);
    expect(await readFile(join(outputDir, CARD_ASSETS_CSS_PATH), 'utf8')).toContain(
      '.kg-bookmark-card',
    );
    expect(await readFile(join(outputDir, CARD_ASSETS_CSS_PATH), 'utf8')).toContain(
      '.kg-embed-card',
    );
    expect(await readFile(join(outputDir, CARD_ASSETS_JS_PATH), 'utf8')).toContain(
      '.kg-toggle-card .kg-toggle-heading',
    );
    expect(await readFile(join(outputDir, CARD_ASSETS_JS_PATH), 'utf8')).toContain(
      '.kg-video-card video',
    );
  });

  test('skips writing files when disabled', async () => {
    const wrote = await emitCardAssets({ outputDir, cardAssets: false });

    expect(wrote).toBe(false);
    expect(existsSync(join(outputDir, CARD_ASSETS_CSS_PATH))).toBe(false);
    expect(existsSync(join(outputDir, CARD_ASSETS_JS_PATH))).toBe(false);
  });

  test('excludes per-card CSS and runtime sections', () => {
    const cardAssets = { exclude: ['bookmark', 'toggle', 'video'] };

    expect(renderCardAssetsCss(cardAssets)).not.toContain('.kg-bookmark-card');
    expect(renderCardAssetsCss(cardAssets)).toContain('.kg-gallery-card');
    expect(renderCardAssetsJs(cardAssets)).not.toContain('.kg-toggle-card .kg-toggle-heading');
    expect(renderCardAssetsJs(cardAssets)).not.toContain('.kg-video-card video');
    expect(renderCardAssetsJs(cardAssets)).toContain('.kg-audio-card audio');
  });

  test('uses a stable exclude-specific cache key', () => {
    expect(cardAssetsVersion(true)).toBe('1');
    expect(cardAssetsVersion({ exclude: [] })).toBe('1');
    expect(cardAssetsVersion({ exclude: ['gallery', 'bookmark'] })).toBe(
      cardAssetsVersion({ exclude: ['bookmark', 'gallery'] }),
    );
    expect(cardAssetsVersion({ exclude: ['bookmark'] })).not.toBe(cardAssetsVersion(true));
  });

  test('embed card CSS gives iframes a responsive 16:9 box', () => {
    const css = renderCardAssetsCss(true);

    expect(css).toContain('.kg-embed-card iframe');
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*width:100%/);
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*aspect-ratio:16\/9/);
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*border:0/);
  });
});
