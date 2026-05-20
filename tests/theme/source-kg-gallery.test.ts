import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Regression for backlog task #90: Source only marked `.kg-gallery-image` as
// clickable, but the Ghost-compatible Koenig gallery DOM also needs static
// container and row layout CSS to render rows as a gallery.

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('Source theme — kg-gallery card CSS (#90)', () => {
  test('source screen.css declares Koenig gallery layout hooks', async () => {
    const css = await read('assets/css/screen.css');
    const container = ruleBody(css, '.kg-gallery-container');
    const row = ruleBody(css, '.kg-gallery-row');
    const image = ruleBody(css, '.kg-gallery-image');
    const img = ruleBody(css, '.kg-gallery-image img');

    expect(container).toMatch(/display:\s*flex/);
    expect(container).toMatch(/flex-direction:\s*column/);
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/flex-direction:\s*row/);
    expect(image).toMatch(/flex:\s*1\s+1\s+0/);
    expect(img).toMatch(/width:\s*100%/);
    expect(img).toMatch(/height:\s*100%/);
    expect(img).toMatch(/object-fit:\s*cover/);
  });

  test('built screen.css carries the same Koenig gallery layout hooks', async () => {
    const css = await read('assets/built/screen.css');
    const container = ruleBody(css, '.kg-gallery-container');
    const row = ruleBody(css, '.kg-gallery-row');
    const image = ruleBody(css, '.kg-gallery-image');
    const img = ruleBody(css, '.kg-gallery-image img');

    expect(container).toMatch(/display:flex/);
    expect(container).toMatch(/flex-direction:column/);
    expect(row).toMatch(/display:flex/);
    expect(row).toMatch(/flex-direction:row/);
    expect(image).toMatch(/flex:1 1 0/);
    expect(img).toMatch(/width:100%/);
    expect(img).toMatch(/height:100%/);
    expect(img).toMatch(/object-fit:cover/);
  });
});
