import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

describe('Ghost compatibility docs', () => {
  test('links the contributor checklist for adding a Ghost card', async () => {
    const compatibility = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');
    const checklist = await readFile(join(ROOT, 'docs', 'contrib', 'ADDING_A_CARD.md'), 'utf8');

    expect(compatibility).toContain('./contrib/ADDING_A_CARD.md');
    expect(checklist).toContain('## 1. Add the import/Turndown rule');
    expect(checklist).toContain('## 2. Add the Markdown shortcode or directive grammar');
    expect(checklist).toContain('## 3. Add the shortcode handler');
    expect(checklist).toContain('## 4. Add shared theme CSS and optional runtime hooks');
    expect(checklist).toContain('## 5. Add the fixture');
    expect(checklist).toContain('## 6. Add snapshot or contract tests');
    expect(checklist).toContain('tests/fixtures/cards/bookmark.md');
  });

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
      '| Header | Yes | Yes | Ghost v1 `kg-header-card` HTML converts to a `{% header %}` shortcode',
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

  test('documents the gh-content gh-canvas Koenig card wrapper contract', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');

    expect(doc).toContain('Casper-family spacing');
    expect(doc).toContain('<section class="gh-content gh-canvas">{{content}}</section>');
    expect(doc).toContain('.gh-content.gh-canvas > .kg-card');
    expect(doc).toContain('does not wrap every card in an extra layout container');
  });

  test('documents Content API post.html serialization divergence', async () => {
    const compatibility = await readFile(join(ROOT, 'docs', 'GHOST_COMPATIBILITY.md'), 'utf8');
    const api = await readFile(join(ROOT, 'docs', 'api.md'), 'utf8');

    expect(compatibility).toContain("Nectar's Content API exposes `post.html`");
    expect(compatibility).toContain('byte-for-byte Ghost serializer');
    expect(compatibility).toContain('`kg-card` class hooks');
    expect(compatibility).toContain('Ghost editor fence comments');
    expect(compatibility).toContain('member paywall DOM');
    expect(compatibility).toContain('[components.markdown] emit_kg_classes =');

    expect(api).toContain('## `post.html` body markup');
    expect(api).toContain('byte-for-byte');
    expect(api).toContain('`<!--kg-card-begin: paywall-->`');
    expect(api).toContain('./GHOST_COMPATIBILITY.md#content-api-posthtml-serialization');
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
