import { beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

// Golden-master test for the example site (#172). Re-renders the example
// against the vendored Source theme and diffs each captured page against a
// committed snapshot. Catches regressions in any helper that affects emitted
// HTML — including ones that have no dedicated unit test. To accept a change
// after an intentional template/helper update, rerun with UPDATE_GOLDEN=1.
const EXAMPLE_CWD = join(import.meta.dir, '..', '..', 'example');
const DIST_DIR = join(EXAMPLE_CWD, 'dist');
const GOLDEN_DIR = join(import.meta.dir, '..', 'fixtures', 'golden');

const GOLDEN_FILES = [
  'index.html',
  'hello-nectar/index.html',
  'tag/news/index.html',
  'author/casper/index.html',
  'about/index.html',
  '404.html',
  'sitemap.xml',
  'rss.xml',
] as const;

// Strip moving parts so unrelated edits don't churn the snapshot:
//   - fingerprinted asset hashes (change whenever screen.css / source.js change)
//   - the year stamped into the default 404 footer (advances yearly)
// Regressions in template structure / helper output still show up.
function normalize(html: string): string {
  return html
    .replace(
      /\/assets\/built\/([A-Za-z0-9_-]+)\.[a-f0-9]{8,}\.(css|js|map)/g,
      '/assets/built/$1.<HASH>.$2',
    )
    .replace(/(&copy;|©)\s+\d{4}\b/g, '$1 <YEAR>');
}

describe('example build — golden HTML (#172)', () => {
  beforeAll(async () => {
    await build({ cwd: EXAMPLE_CWD });
  });

  for (const file of GOLDEN_FILES) {
    test(file, async () => {
      const actual = normalize(await readFile(join(DIST_DIR, file), 'utf8'));
      const goldenPath = join(GOLDEN_DIR, file);

      if (process.env.UPDATE_GOLDEN === '1') {
        await writeFile(goldenPath, actual, 'utf8');
        return;
      }

      const expected = await readFile(goldenPath, 'utf8');
      expect(actual).toBe(expected);
    });
  }
});
