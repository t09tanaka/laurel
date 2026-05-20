import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — header card CSS (#91)', () => {
  test('source screen.css styles the full header-card contract', async () => {
    const css = await read('assets/css/screen.css');

    expect(css).toContain('.kg-header-card {');
    expect(css).toMatch(/background-size:\s*cover/);
    expect(css).toContain('.kg-header-card.kg-style-dark');
    expect(css).toContain('.kg-header-card.kg-style-light');
    expect(css).toContain('.kg-header-card.kg-style-accent');
    expect(css).toContain('.kg-header-card-button');
    expect(css).toContain('.kg-header-card-heading');
    expect(css).toContain('.kg-header-card-subheading');
  });

  test('built screen.css carries header-card background, style, and button selectors', async () => {
    const css = await read('assets/built/screen.css');

    expect(css).toContain('.kg-header-card{');
    expect(css).toContain('background-size:cover');
    expect(css).toContain('.kg-header-card.kg-style-dark');
    expect(css).toContain('.kg-header-card.kg-style-light');
    expect(css).toContain('.kg-header-card.kg-style-accent');
    expect(css).toContain('.kg-header-card-button');
    expect(css).toContain('.kg-header-card-heading');
    expect(css).toContain('.kg-header-card-subheading');
  });
});
