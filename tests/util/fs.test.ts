import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';

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

describe('scanGlob', () => {
  test('returns every matching path as a plain array', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-scan-'));
    await mkdir(join(base, 'nested'), { recursive: true });
    await writeFile(join(base, 'a.md'), 'a');
    await writeFile(join(base, 'b.md'), 'b');
    await writeFile(join(base, 'nested', 'c.md'), 'c');
    await writeFile(join(base, 'skip.txt'), 'no');

    const rels = await scanGlob('**/*.md', { cwd: base });
    // Sort for determinism — glob ordering varies by filesystem; the caller is
    // responsible for downstream ordering if it matters.
    expect(rels.toSorted()).toEqual(['a.md', 'b.md', 'nested/c.md']);
  });

  test('returns an empty array when nothing matches', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-scan-'));
    const rels = await scanGlob('**/*.md', { cwd: base });
    expect(rels).toEqual([]);
  });

  test('respects onlyFiles to skip directory entries', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-scan-'));
    await mkdir(join(base, 'dir'), { recursive: true });
    await writeFile(join(base, 'dir', 'leaf.txt'), 'x');
    const rels = await scanGlob('**/*', { cwd: base, onlyFiles: true });
    expect(rels).toEqual(['dir/leaf.txt']);
  });
});
