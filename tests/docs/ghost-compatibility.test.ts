import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

describe('Ghost compatibility docs', () => {
  test('documents the Ghost card support status matrix', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain('| Card | Migrates | Renders | Notes |');
    expect(doc).toContain(
      '| Gallery | Yes | Yes | Preserves the `kg-gallery-container` / row / image shape',
    );
    expect(doc).toContain(
      '| Embed | Yes | Partial | Converts to `{{< embed />}}` and preserves width modifier classes. YouTube, Vimeo, and Spotify render static iframes',
    );
    expect(doc).toContain(
      '| Audio | Yes | Yes | Renders native `<audio controls>` plus `kg-audio-*` metadata hooks',
    );
    expect(doc).toContain(
      '| Header | Partial | Partial | Raw `kg-header-card` HTML scaffolds survive sanitisation',
    );
    expect(doc).toContain(
      '| Email / email CTA | No | No | Members/newsletter-only email cards are stripped',
    );
  });

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

  test('documents the static audio card fallback', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain("Ghost's Koenig audio card uses `kg-audio-*` markup");
    expect(doc).toContain('<audio src="/content/audio/episode.mp3" preload="metadata" controls>');
    expect(doc).toContain('CSS alone cannot make an inert custom play button');
  });

  test('documents Wave jquery CDN as a theme limitation', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain("Wave's `default.hbs`");
    expect(doc).toContain('jQuery');
    expect(doc).toContain('3.3.1 CDN dependency');
    expect(doc).toMatch(/theme limitation,\s+leave untouched/);
    expect(doc).toMatch(/must preserve explicit `src` and\s+`integrity` attributes/);
  });

  test('documents Ghost Admin integrations as static build scope', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain("Ghost Admin's integrations directory");
    expect(doc).toContain('/ghost/api/integrations');
    expect(doc).toContain('Zapier');
    expect(doc).toContain('Slack');
    expect(doc).toMatch(
      /External automation should live in build hooks, CI, or the\s+deploy provider/,
    );
  });
});
