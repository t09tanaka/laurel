import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — kg-code card CSS (#942)', () => {
  test('source screen.css declares code-card wrapper, pre, caption, and line-number hooks', async () => {
    const css = await read('assets/css/screen.css');

    expect(css).toContain('figure.kg-code-card');
    expect(css).toContain('.kg-code-card');
    expect(css).toContain('.kg-code-card pre');
    expect(css).toContain('.kg-code-card pre code');
    expect(css).toContain('.kg-code-card figcaption');
    expect(css).toContain('.kg-code-card-with-line-numbers pre');
    expect(css).toMatch(/\.kg-code-card pre\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.kg-code-card pre code\s*\{[^}]*white-space:\s*pre/s);
    expect(css).toMatch(/\.kg-code-card-with-line-numbers pre\s*\{[^}]*padding-left:\s*4\.8rem/s);
  });

  test('built screen.css carries the same code-card contract', async () => {
    const css = await read('assets/built/screen.css');

    expect(css).toContain('.kg-code-card{width:100%}');
    expect(css).toMatch(/\.kg-code-card pre\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/\.kg-code-card pre code\{[^}]*white-space:pre/);
    expect(css).toMatch(/\.kg-code-card figcaption\{[^}]*margin-top:12px/);
    expect(css).toMatch(/\.kg-code-card-with-line-numbers pre\{[^}]*padding-left:4\.8rem/);
  });
});
