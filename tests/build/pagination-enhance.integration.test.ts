import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

const createdRoots: string[] = [];

afterAll(async () => {
  await Promise.all(createdRoots.map((p) => rm(p, { recursive: true, force: true })));
});

// Build a minimal self-contained site. Search defaults to enabled, so the
// regression we guard against (the pagination runtime emitted only inside the
// search block) requires search to be explicitly disabled here.
//
// The Source theme ships its own infinite-scroll script, which now suppresses
// Laurel's shim (see themeHasNativeInfiniteScroll). Tests that need the shim to
// emit pass `neutralizeThemeInfiniteScroll: true` to strip that script so the
// theme no longer "owns" infinite scroll — standing in for a theme without one.
async function makeSite(
  paginationConfig: string,
  opts: { neutralizeThemeInfiniteScroll?: boolean } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-pg-int-'));
  createdRoots.push(dir);
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      'title = "PG Site"',
      'url = "https://pg.test"',
      '',
      '[theme]',
      'dir = "themes"',
      'name = "source"',
      '',
      '[components.search]',
      'enabled = false',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
      paginationConfig,
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
    'utf8',
  );
  await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
  await cp(join(process.cwd(), 'example/themes/source'), join(dir, 'themes/source'), {
    recursive: true,
  });
  if (opts.neutralizeThemeInfiniteScroll) {
    // Overwrite (rather than delete) so {{asset}} references stay valid.
    for (const rel of ['assets/built/source.js', 'assets/js/pagination.js']) {
      await writeFile(join(dir, 'themes/source', rel), 'console.log(1);', 'utf8');
    }
  }
  return dir;
}

describe('pagination enhancement build integration', () => {
  test('emits pagination/enhance.js with search disabled (regression for #672)', async () => {
    const cwd = await makeSite('[components.pagination]\nmode = "infinite"', {
      neutralizeThemeInfiniteScroll: true,
    });
    await build({ cwd });
    expect(existsSync(join(cwd, 'dist/pagination/enhance.js'))).toBe(true);
  });

  test('does not emit pagination/enhance.js in the default links mode', async () => {
    const cwd = await makeSite('[components.pagination]\nmode = "links"');
    await build({ cwd });
    expect(existsSync(join(cwd, 'dist/pagination/enhance.js'))).toBe(false);
  });

  test('skips the shim when the theme owns infinite scroll (no double-loading)', async () => {
    // Source theme as-is ships pagination.js, so Laurel must not emit its shim.
    const cwd = await makeSite('[components.pagination]\nmode = "infinite"');
    await build({ cwd });
    expect(existsSync(join(cwd, 'dist/pagination/enhance.js'))).toBe(false);
    const home = await readFile(join(cwd, 'dist/index.html'), 'utf8');
    expect(home).not.toContain('data-laurel-pagination-enhance');
  });
});
