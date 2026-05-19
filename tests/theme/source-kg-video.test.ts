import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Regression for backlog task #101: the Source theme had zero `kg-video-*`
// CSS, so the Koenig video card rendered with a zero-height container and no
// aspect-ratio binding. The fix vendors the static slice of `kg-video.css`
// (no overlay rules — Nectar emits no overlay DOM) and most importantly the
// `aspect-ratio: var(--aspect-ratio)` rule that the renderer relies on.

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — kg-video card CSS (#101)', () => {
  test('source screen.css declares aspect-ratio on kg-video-container', async () => {
    const css = await read('assets/css/screen.css');
    expect(css).toContain('.kg-video-container');
    expect(css).toMatch(/aspect-ratio:\s*var\(--aspect-ratio\)/);
  });

  test('built screen.css carries the same kg-video selectors', async () => {
    const css = await read('assets/built/screen.css');
    expect(css).toContain('.kg-video-container');
    expect(css).toMatch(/aspect-ratio:var\(--aspect-ratio\)/);
    expect(css).toContain('.kg-video-card figcaption');
  });
});
