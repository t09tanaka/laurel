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
    expect(await readFile(join(outputDir, CARD_ASSETS_CSS_PATH), 'utf8')).toContain(
      '.kg-code-card',
    );
    expect(await readFile(join(outputDir, CARD_ASSETS_JS_PATH), 'utf8')).toContain(
      '.kg-toggle-card .kg-toggle-heading',
    );
    expect(await readFile(join(outputDir, CARD_ASSETS_JS_PATH), 'utf8')).toContain(
      '.kg-video-card video',
    );
    expect(await readFile(join(outputDir, CARD_ASSETS_JS_PATH), 'utf8')).toContain(
      '.kg-image-card img, .kg-gallery-image img',
    );
  });

  test('skips writing files when disabled', async () => {
    const wrote = await emitCardAssets({ outputDir, cardAssets: false });

    expect(wrote).toBe(false);
    expect(existsSync(join(outputDir, CARD_ASSETS_CSS_PATH))).toBe(false);
    expect(existsSync(join(outputDir, CARD_ASSETS_JS_PATH))).toBe(false);
  });

  test('excludes per-card CSS and runtime sections', () => {
    const cardAssets = { exclude: ['bookmark', 'code', 'toggle', 'video', 'lightbox'] };

    expect(renderCardAssetsCss(cardAssets)).not.toContain('.kg-bookmark-card');
    expect(renderCardAssetsCss(cardAssets)).not.toContain('.kg-code-card');
    expect(renderCardAssetsCss(cardAssets)).toContain('.kg-gallery-card');
    expect(renderCardAssetsJs(cardAssets)).not.toContain('.kg-toggle-card .kg-toggle-heading');
    expect(renderCardAssetsJs(cardAssets)).not.toContain('.kg-video-card video');
    expect(renderCardAssetsJs(cardAssets)).not.toContain('.kg-image-card img');
    expect(renderCardAssetsJs(cardAssets)).toContain('.kg-audio-card audio');
  });

  test('includes Koenig callout color modifier CSS', () => {
    const css = renderCardAssetsCss(true);

    for (const color of ['blue', 'green', 'yellow', 'red', 'pink', 'purple']) {
      expect(css).toContain(`.kg-callout-card-${color}`);
    }
  });

  test('button card CSS honors alignment modifiers', () => {
    const css = renderCardAssetsCss(true);

    expect(css).toMatch(/\.kg-button-card\{[^}]*display:flex/);
    expect(css).toMatch(/\.kg-button-card\.kg-align-left\{[^}]*justify-content:flex-start/);
    expect(css).toMatch(/\.kg-button-card\.kg-align-center\{[^}]*justify-content:center/);
  });

  test('bookmark icon resists broad theme figure image rules', () => {
    const css = renderCardAssetsCss(true);

    expect(css).toContain('.kg-bookmark-metadata .kg-bookmark-icon');
    expect(css).toMatch(
      /\.kg-bookmark-metadata \.kg-bookmark-icon\{[^}]*flex:0 0 20px[^}]*width:20px[^}]*height:20px[^}]*max-width:20px[^}]*object-fit:contain/,
    );
  });

  test('uses a stable exclude-specific cache key', () => {
    expect(cardAssetsVersion(true)).toBe('7');
    expect(cardAssetsVersion({ exclude: [] })).toBe('7');
    expect(cardAssetsVersion({ exclude: ['gallery', 'bookmark'] })).toBe(
      cardAssetsVersion({ exclude: ['bookmark', 'gallery'] }),
    );
    expect(cardAssetsVersion({ exclude: ['bookmark'] })).not.toBe(cardAssetsVersion(true));
  });

  test('signup card CSS covers image layouts, disclaimer, and form skin', () => {
    const css = renderCardAssetsCss(true);

    expect(css).toContain('.kg-signup-card-image-top');
    expect(css).toContain('.kg-signup-card-image-bottom');
    expect(css).toContain('.kg-signup-card-image-left');
    expect(css).toMatch(/\.kg-signup-card-image-left\{[^}]*flex-direction:row/);
    expect(css).toMatch(/\.kg-signup-card-image-left \.kg-signup-card-image\{[^}]*width:50%/);
    expect(css).toMatch(/\.kg-signup-card-disclaimer\{[^}]*font-size:\.85em/);
    expect(css).toMatch(/\.kg-signup-card-input\{[^}]*border:1px solid/);
    expect(css).toMatch(/\.kg-signup-card-button\{[^}]*background:var\(--ghost-accent-color/);
    expect(css).toMatch(/@media \(max-width:640px\)\{[^}]*\.kg-signup-card-image-left/);
  });

  test('embed card CSS gives iframes a responsive 16:9 box', () => {
    const css = renderCardAssetsCss(true);

    expect(css).toContain('.kg-embed-card iframe');
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*width:100%/);
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*aspect-ratio:16\/9/);
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*border:0/);
  });

  test('code card CSS styles pre blocks, captions, and line-number gutters', () => {
    const css = renderCardAssetsCss(true);

    expect(css).toContain('.kg-code-card');
    expect(css).toMatch(/\.kg-code-card pre\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/\.kg-code-card pre code\{[^}]*white-space:pre/);
    expect(css).toMatch(/\.kg-code-card figcaption\{[^}]*margin-top:\.75rem/);
    expect(css).toMatch(/\.kg-code-card-with-line-numbers pre\{[^}]*padding-left:3rem/);
  });

  test('lightbox assets are optional and scoped to image/gallery cards', () => {
    const css = renderCardAssetsCss(true);
    const js = renderCardAssetsJs(true);

    expect(css).toContain('.kg-lightbox-backdrop');
    expect(js).toContain('.kg-image-card img, .kg-gallery-image img');
    expect(js).toContain('data-kg-lightbox-open');
    expect(renderCardAssetsCss({ exclude: ['lightbox'] })).not.toContain('.kg-lightbox-backdrop');
    expect(renderCardAssetsJs({ exclude: ['lightbox'] })).not.toContain(
      '.kg-image-card img, .kg-gallery-image img',
    );
  });
});
