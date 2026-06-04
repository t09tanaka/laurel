import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureContentDirs } from '~/cli/ensure-content-dirs.ts';
import type { LaurelConfig } from '~/config/schema.ts';

function fakeConfig(): LaurelConfig {
  return {
    content: {
      posts_dir: 'content/posts',
      pages_dir: 'content/pages',
      authors_dir: 'content/authors',
      tags_dir: 'content/tags',
    },
  } as unknown as LaurelConfig;
}

describe('ensureContentDirs', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('creates missing directories under cwd', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-ecd-')));
    const created = await ensureContentDirs(dir, fakeConfig());
    expect(created.length).toBe(4);
    expect(existsSync(join(dir, 'content/posts'))).toBe(true);
    expect(existsSync(join(dir, 'content/pages'))).toBe(true);
    expect(existsSync(join(dir, 'content/authors'))).toBe(true);
    expect(existsSync(join(dir, 'content/tags'))).toBe(true);
  });

  test('returns empty list when all dirs already exist', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-ecd-')));
    await ensureContentDirs(dir, fakeConfig());
    const created2 = await ensureContentDirs(dir, fakeConfig());
    expect(created2).toEqual([]);
  });

  test('handles a subset of missing dirs', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-ecd-')));
    await Bun.write(join(dir, 'content/posts/.keep'), '');
    const created = await ensureContentDirs(dir, fakeConfig());
    expect(created.length).toBe(3);
  });
});
