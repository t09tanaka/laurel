import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Regression for project-backlog #82: the Source theme had no `kg-audio-*`
// CSS. Nectar renders audio cards as static HTML, so the theme must at least
// style Ghost's Koenig hooks and the native <audio controls> fallback.

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — kg-audio card CSS (#82)', () => {
  test('source screen.css declares the Koenig audio card hooks', async () => {
    const css = await read('assets/css/screen.css');

    for (const selector of [
      '.kg-audio-card.kg-card',
      '.kg-audio-card .kg-audio-thumbnail',
      '.kg-audio-card .kg-audio-player-container',
      '.kg-audio-card audio',
      '.kg-audio-card .kg-audio-title',
      '.kg-audio-card .kg-audio-player',
      '.kg-audio-card .kg-audio-duration',
      '.kg-audio-card .kg-audio-current-time',
      '.kg-audio-card .kg-audio-seek-slider',
      '.kg-audio-card .kg-audio-play-icon',
    ]) {
      expect(css).toContain(selector);
    }
  });

  test('built screen.css carries the same kg-audio hooks', async () => {
    const css = await read('assets/built/screen.css');

    for (const selector of [
      '.kg-audio-card.kg-card',
      '.kg-audio-card .kg-audio-thumbnail',
      '.kg-audio-card .kg-audio-player-container',
      '.kg-audio-card audio',
      '.kg-audio-card .kg-audio-title',
      '.kg-audio-card .kg-audio-player',
      '.kg-audio-card .kg-audio-duration',
      '.kg-audio-card .kg-audio-current-time',
      '.kg-audio-card .kg-audio-seek-slider',
      '.kg-audio-card .kg-audio-play-icon',
    ]) {
      expect(css).toContain(selector);
    }

    expect(css).toMatch(/\.kg-audio-card\.kg-card\{[^}]*display:flex/);
    expect(css).toMatch(/\.kg-audio-card audio\{[^}]*width:100%/);
  });
});
