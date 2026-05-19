import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathContainsSymlink } from '~/util/fs.ts';

describe('pathContainsSymlink', () => {
  test('returns false for plain file under baseDir', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-fs-'));
    await writeFile(join(base, 'a.md'), 'x');
    expect(pathContainsSymlink(base, 'a.md')).toBe(false);
  });

  test('returns true when the leaf is a symlink', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-fs-'));
    const outside = await mkdtemp(join(tmpdir(), 'nectar-outside-'));
    const secret = join(outside, 'secret.txt');
    await writeFile(secret, 'secret');
    await symlink(secret, join(base, 'oops.md'));
    expect(pathContainsSymlink(base, 'oops.md')).toBe(true);
  });

  test('returns true when an intermediate directory is a symlink', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-fs-'));
    const outside = await mkdtemp(join(tmpdir(), 'nectar-outside-'));
    await writeFile(join(outside, 'leaf.md'), 'leaf');
    await symlink(outside, join(base, 'linked-dir'));
    expect(pathContainsSymlink(base, 'linked-dir/leaf.md')).toBe(true);
  });

  test('returns true when the path component does not exist', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-fs-'));
    expect(pathContainsSymlink(base, 'missing.md')).toBe(true);
  });

  test('handles backslash-separated relative paths', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-fs-'));
    await mkdir(join(base, 'sub'), { recursive: true });
    await writeFile(join(base, 'sub', 'a.md'), 'x');
    expect(pathContainsSymlink(base, 'sub\\a.md')).toBe(false);
  });
});
