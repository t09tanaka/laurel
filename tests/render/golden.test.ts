import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  // Additional post bodies catch regressions in markdown rendering, code
  // blocks, embeds, and `post.html` ↔ `feed_html` divergence (#175).
  'hello-nectar/index.html',
  'markdown-meets-git/index.html',
  'ghost-theme-compatibility/index.html',
  // Tag archives (canonical + a second tag) ensure tag layout, post-card
  // partial, and tag-meta helpers stay stable.
  'tag/news/index.html',
  'tag/getting-started/index.html',
  // Author archives (primary + secondary) ensure author bio block and
  // related-posts ordering stay stable.
  'author/casper/index.html',
  'author/honeybee/index.html',
  // Static page exercises the `page.hbs` template + `meta_title` fallback.
  'about/index.html',
  // Error page renders through the theme's error-404.hbs; check the layout
  // and the year-stamped footer (normalized below).
  '404.html',
  // Ghost-style sitemap split (#105/#519/#537): index references four sub-sitemaps
  // for posts/pages/tags/authors, each capped at 50k URLs before -2.xml overflow.
  // Also exercises the #781 indexable filter — pagination tails and 404 are
  // excluded from sub-sitemaps even when the files exist on disk.
  'sitemap.xml',
  'sitemap-posts.xml',
  'sitemap-pages.xml',
  'sitemap-tags.xml',
  'sitemap-authors.xml',
  'rss.xml',
  // robots.txt locks down the sitemap URL + crawl policy emitted by the
  // build pipeline so config drift surfaces in diff review.
  'robots.txt',
  // humans.txt captures the default site metadata disclosure.
  'humans.txt',
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

  test('Source theme defers its external script without touching JSON-LD', async () => {
    const actual = normalize(await readFile(join(DIST_DIR, 'index.html'), 'utf8'));

    expect(actual).toMatch(
      /<script src="\/assets\/built\/source\.<HASH>\.js" defer\b[^>]*><\/script>/,
    );
    expect(actual).toContain('<script type="application/ld+json">');
    expect(actual).not.toMatch(/<script type="application\/ld\+json"[^>]*\bdefer\b/);
  });

  for (const file of GOLDEN_FILES) {
    test(file, async () => {
      const actual = normalize(await readFile(join(DIST_DIR, file), 'utf8'));
      const goldenPath = join(GOLDEN_DIR, file);

      if (process.env.UPDATE_GOLDEN === '1') {
        // Materialize the parent directory for first-time captures of nested
        // routes (e.g. `tag/getting-started/index.html`). Existing dirs
        // resolve as a no-op.
        await mkdir(dirname(goldenPath), { recursive: true });
        await writeFile(goldenPath, actual, 'utf8');
        return;
      }

      const expected = await readFile(goldenPath, 'utf8');
      expect(actual).toBe(expected);
    });
  }
});
