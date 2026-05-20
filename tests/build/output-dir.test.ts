import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readlink, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  cleanupStaleOutput,
  clearDirContents,
  commitStagingDir,
  prepareStagingDir,
  resolveOutputDir,
} from '~/build/output-dir.ts';

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

describe('cleanupStaleOutput', () => {
  test('removes only files outside the current build keep set', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nectar-stale-'));
    await writeFile(join(target, 'index.html'), '<new/>', 'utf8');
    await mkdir(join(target, 'old-post'), { recursive: true });
    await writeFile(join(target, 'old-post/index.html'), '<old/>', 'utf8');
    await mkdir(join(target, 'assets'), { recursive: true });
    await writeFile(join(target, 'assets/app.css'), 'body{}', 'utf8');
    await writeFile(join(target, 'assets/old.css'), 'old', 'utf8');

    const result = await cleanupStaleOutput({
      outputDir: target,
      keepRelPaths: ['index.html', 'assets/app.css'],
    });

    expect(result.removed).toEqual(['assets/old.css', 'old-post/index.html']);
    expect(existsSync(join(target, 'index.html'))).toBe(true);
    expect(existsSync(join(target, 'assets/app.css'))).toBe(true);
    expect(existsSync(join(target, 'assets/old.css'))).toBe(false);
    expect(existsSync(join(target, 'old-post'))).toBe(false);
  });

  test('honours .nectarignore-style preserve patterns', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nectar-stale-preserve-'));
    await writeFile(join(target, 'index.html'), '<new/>', 'utf8');
    await writeFile(join(target, 'CNAME'), 'blog.example.com', 'utf8');
    await mkdir(join(target, '.well-known'), { recursive: true });
    await writeFile(join(target, '.well-known/security.txt'), 'Contact: x', 'utf8');

    await cleanupStaleOutput({
      outputDir: target,
      keepRelPaths: ['index.html'],
      preservePatterns: ['CNAME', '.well-known'],
    });

    expect(readFileSync(join(target, 'CNAME'), 'utf8')).toBe('blog.example.com');
    expect(readFileSync(join(target, '.well-known/security.txt'), 'utf8')).toBe('Contact: x');
  });

  test('unlinks stale symlinks without following their targets', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nectar-stale-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'nectar-stale-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'SECRET', 'utf8');
    await symlink(join(outside, 'secret.txt'), join(target, 'leak.txt'));
    await writeFile(join(target, 'index.html'), '<new/>', 'utf8');

    await cleanupStaleOutput({
      outputDir: target,
      keepRelPaths: ['index.html'],
    });

    expect(existsSync(join(target, 'leak.txt'))).toBe(false);
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('SECRET');
  });

  test('preserves kept symlinks as links', async () => {
    const target = await mkdtemp(join(tmpdir(), 'nectar-stale-kept-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'nectar-stale-outside-'));
    const source = join(outside, 'asset.txt');
    await writeFile(source, 'ASSET', 'utf8');
    await symlink(source, join(target, 'asset.txt'));

    await cleanupStaleOutput({
      outputDir: target,
      keepRelPaths: ['asset.txt'],
    });

    expect(await readlink(join(target, 'asset.txt'))).toBe(source);
  });
});

describe('prepareStagingDir', () => {
  test('creates a sibling temp directory next to finalDir', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nectar-stage-'));
    const finalDir = join(parent, 'dist');
    const staging = await prepareStagingDir(finalDir);
    expect(existsSync(staging)).toBe(true);
    expect(dirname(staging)).toBe(parent);
    expect(basename(staging).startsWith('.dist.tmp-')).toBe(true);
  });

  test('creates the parent directory when missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nectar-stage-'));
    const finalDir = join(root, 'nested/build/dist');
    const staging = await prepareStagingDir(finalDir);
    expect(existsSync(staging)).toBe(true);
    expect(dirname(staging)).toBe(join(root, 'nested/build'));
  });

  test('returns unique paths on repeated calls', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nectar-stage-'));
    const finalDir = join(parent, 'dist');
    const a = await prepareStagingDir(finalDir);
    const b = await prepareStagingDir(finalDir);
    expect(a).not.toBe(b);
  });
});

describe('commitStagingDir', () => {
  test('moves staging into place when finalDir does not exist', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nectar-commit-'));
    const finalDir = join(parent, 'dist');
    const staging = await prepareStagingDir(finalDir);
    await writeFile(join(staging, 'index.html'), '<new/>', 'utf8');

    await commitStagingDir(staging, finalDir);

    expect(existsSync(staging)).toBe(false);
    expect(existsSync(finalDir)).toBe(true);
    expect(readFileSync(join(finalDir, 'index.html'), 'utf8')).toBe('<new/>');
  });

  test('replaces an existing finalDir without leaving the old tree behind', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nectar-commit-'));
    const finalDir = join(parent, 'dist');
    await mkdir(finalDir, { recursive: true });
    await writeFile(join(finalDir, 'index.html'), '<old/>', 'utf8');
    await writeFile(join(finalDir, 'leftover.txt'), 'gone', 'utf8');

    const staging = await prepareStagingDir(finalDir);
    await writeFile(join(staging, 'index.html'), '<new/>', 'utf8');

    await commitStagingDir(staging, finalDir);

    expect(readFileSync(join(finalDir, 'index.html'), 'utf8')).toBe('<new/>');
    expect(existsSync(join(finalDir, 'leftover.txt'))).toBe(false);
    const siblings = await readdir(parent);
    expect(siblings.filter((s) => s.startsWith('dist.old-'))).toEqual([]);
    expect(siblings.filter((s) => s.startsWith('.dist.tmp-'))).toEqual([]);
  });
});
