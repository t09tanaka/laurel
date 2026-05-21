import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — search trigger classes', () => {
  test('search partial does not reuse the broad gh-search class', async () => {
    const partial = await read('partials/search-toggle.hbs');

    expect(partial).toContain('class="nectar-search-toggle gh-icon-button"');
    expect(partial).not.toContain('class="gh-search ');
  });

  test('source CSS targets the renamed search trigger class', async () => {
    const css = await read('assets/css/screen.css');
    const built = await read('assets/built/screen.css');

    expect(css).toContain('.nectar-search-toggle');
    expect(css).not.toContain('.gh-search {');
    expect(built).toContain('.nectar-search-toggle');
    expect(built).not.toContain('.gh-search{');
  });
});
