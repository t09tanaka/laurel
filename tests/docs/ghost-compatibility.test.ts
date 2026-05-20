import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

describe('Ghost compatibility docs', () => {
  test('documents shared-theme-assets requirements for Ease load-more controls', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain('shared-theme-assets');
    expect(doc).toContain('<button class="gh-loadmore">');
    expect(doc).toContain('infinite-scroll JavaScript');
    expect(doc).toContain('inert');
  });

  test('documents the static gallery card contract', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain(
      "Nectar does not inject the legacy Editorial theme's inline gallery bootstrap",
    );
    expect(doc).toContain('.kg-gallery-image > img[width][height]');
    expect(doc).toContain('width="1200" height="800"');
  });
});
