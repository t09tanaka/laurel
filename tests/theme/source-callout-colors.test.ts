import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');
const CALLOUT_COLORS = ['blue', 'green', 'yellow', 'red', 'pink', 'purple'] as const;

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme - callout color CSS (#398)', () => {
  test('source screen.css styles Koenig callout color modifiers', async () => {
    const css = await read('assets/css/screen.css');

    for (const color of CALLOUT_COLORS) {
      expect(css).toContain(`.kg-callout-card-${color}`);
    }
  });

  test('built screen.css carries Koenig callout color modifier selectors', async () => {
    const css = await read('assets/built/screen.css');

    for (const color of CALLOUT_COLORS) {
      expect(css).toContain(`.kg-callout-card-${color}`);
    }
  });
});
