import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
async function makeSite(paginationConfig: string): Promise<string> {
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
  return dir;
}

describe('pagination enhancement build integration', () => {
  test('emits pagination/enhance.js with search disabled (regression for #672)', async () => {
    const cwd = await makeSite('[components.pagination]\nmode = "infinite"');
    await build({ cwd });
    expect(existsSync(join(cwd, 'dist/pagination/enhance.js'))).toBe(true);
  });

  test('does not emit pagination/enhance.js in the default links mode', async () => {
    const cwd = await makeSite('[components.pagination]\nmode = "links"');
    await build({ cwd });
    expect(existsSync(join(cwd, 'dist/pagination/enhance.js'))).toBe(false);
  });
});
