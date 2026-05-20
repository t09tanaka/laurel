import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Regression for backlog task #401: YouTube/Vimeo iframe embeds depend on
// Source theme CSS to provide a stable responsive 16:9 box.

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — kg-embed card CSS (#401)', () => {
  test('source screen.css declares responsive iframe sizing for embeds', async () => {
    const css = await read('assets/css/screen.css');

    expect(css).toContain('.kg-embed-card iframe');
    expect(css).toMatch(/\.kg-embed-card iframe\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.kg-embed-card iframe\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    expect(css).toMatch(/\.kg-embed-card iframe\s*\{[^}]*border:\s*0/);
  });

  test('built screen.css carries the same kg-embed iframe rule', async () => {
    const css = await read('assets/built/screen.css');

    expect(css).toContain('.kg-embed-card iframe');
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*width:100%/);
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*aspect-ratio:16\/9/);
    expect(css).toMatch(/\.kg-embed-card iframe\{[^}]*border:0/);
  });
});
