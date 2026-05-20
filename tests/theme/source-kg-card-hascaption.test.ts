import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Regression for backlog task #392: Source uses `kg-card-hascaption` to keep
// consecutive full-width cards spaced when the first card has a figcaption.

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — kg-card-hascaption spacing contract (#392)', () => {
  test('source screen.css keeps the full-width caption spacing selector', async () => {
    const css = await read('assets/css/screen.css');
    expect(css).toContain(
      '.gh-content > .kg-width-full + .kg-width-full:not(.kg-width-full.kg-card-hascaption + .kg-width-full)',
    );
  });

  test('built screen.css carries the same full-width caption spacing selector', async () => {
    const css = await read('assets/built/screen.css');
    expect(css).toContain(
      '.gh-content>.kg-width-full+.kg-width-full:not(.kg-width-full.kg-card-hascaption+.kg-width-full)',
    );
  });
});
