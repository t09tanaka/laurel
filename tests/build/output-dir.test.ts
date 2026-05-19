import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clearDirContents, resolveOutputDir } from '~/build/output-dir.ts';

describe('resolveOutputDir', () => {
  test('accepts a normal relative subdirectory', () => {
    const cwd = '/tmp/site';
    expect(resolveOutputDir(cwd, 'dist')).toBe(resolve(cwd, 'dist'));
  });

  test('accepts a nested relative path', () => {
    const cwd = '/tmp/site';
    expect(resolveOutputDir(cwd, 'build/out')).toBe(resolve(cwd, 'build/out'));
  });

  test('refuses absolute paths', () => {
    expect(() => resolveOutputDir('/tmp/site', '/Users/runner')).toThrow(/absolute path/);
  });

  test('refuses empty strings', () => {
    expect(() => resolveOutputDir('/tmp/site', '')).toThrow(/must not be empty/);
  });

  test('refuses whitespace-only strings', () => {
    expect(() => resolveOutputDir('/tmp/site', '   ')).toThrow(/must not be empty/);
  });

  test('refuses "."', () => {
    expect(() => resolveOutputDir('/tmp/site', '.')).toThrow(/must not point at the project root/);
  });

  test('refuses "./" pointing back at cwd', () => {
    expect(() => resolveOutputDir('/tmp/site', './')).toThrow(/must not point at the project root/);
  });

  test('refuses paths that traverse outside cwd', () => {
    expect(() => resolveOutputDir('/tmp/site', '..')).toThrow(/must resolve inside the project/);
  });

  test('refuses nested traversal outside cwd', () => {
    expect(() => resolveOutputDir('/tmp/site', '../../etc')).toThrow(
      /must resolve inside the project/,
    );
  });

  test('refuses paths that traverse out then back in', () => {
    expect(() => resolveOutputDir('/tmp/site', '../site-sibling')).toThrow(
      /must resolve inside the project/,
    );
  });
});

describe('clearDirContents', () => {
  test('creates the directory when missing', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nectar-clear-'));
    const target = join(base, 'dist');
    expect(existsSync(target)).toBe(false);
    await clearDirContents(target);
    expect(existsSync(target)).toBe(true);
  });

  test('removes children but preserves the directory itself', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nectar-clear-'));
    await writeFile(join(target, 'a.txt'), 'a', 'utf8');
    await mkdir(join(target, 'sub'), { recursive: true });
    await writeFile(join(target, 'sub/b.txt'), 'b', 'utf8');

    await clearDirContents(target);

    expect(existsSync(target)).toBe(true);
    expect(await readdir(target)).toEqual([]);
  });
});
