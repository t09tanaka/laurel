import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadThemeAssets } from '~/theme/assets.ts';

describe('loadThemeAssets symlink protection', () => {
  test('skips symlinked theme asset files', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-'));
    const assetsDir = join(themeDir, 'assets');
    await mkdir(join(assetsDir, 'built'), { recursive: true });

    const outside = await mkdtemp(join(tmpdir(), 'nectar-outside-'));
    const secret = join(outside, 'secret.css');
    await writeFile(secret, 'SECRET');
    await symlink(secret, join(assetsDir, 'built', 'oops.css'));

    await writeFile(join(assetsDir, 'built', 'real.css'), 'body{}');

    const map = await loadThemeAssets(themeDir);
    const sources = Array.from(map.values()).map((a) => a.sourcePath);
    expect(sources.some((p) => p.endsWith('real.css'))).toBe(true);
    expect(sources.some((p) => p.endsWith('oops.css'))).toBe(false);
  });
});

describe('loadThemeAssets fingerprint cache', () => {
  test('reuses cached hash when mtime + size are unchanged and rehashes when changed', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-cache-'));
    const cacheDir = await mkdtemp(join(tmpdir(), 'nectar-cache-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });
    const cssPath = join(assetsDir, 'screen.css');
    await writeFile(cssPath, 'body{color:red}');

    const first = await loadThemeAssets(themeDir, { cacheDir });
    const initialHash = first.get('assets/built/screen.css')?.hash;
    expect(initialHash).toBeDefined();

    const cacheFile = join(cacheDir, 'asset-cache.json');
    expect(existsSync(cacheFile)).toBe(true);
    const cachePayload = JSON.parse(await readFile(cacheFile, 'utf8')) as {
      version: number;
      entries: Record<string, { hash: string; mtimeMs: number; size: number }>;
    };
    expect(cachePayload.version).toBe(1);
    expect(cachePayload.entries[cssPath]?.hash).toBe(initialHash as string);

    // Force-set mtime back so a fresh stat returns the same mtime+size; the
    // cache lookup must hit and produce the same hash without re-reading the
    // file. We mutate the cached hash to a sentinel so we can prove we reused
    // the cached value instead of re-hashing.
    const entry = cachePayload.entries[cssPath];
    if (!entry) throw new Error('expected cache entry');
    const sentinelHash = 'deadbeef00';
    cachePayload.entries[cssPath] = { ...entry, hash: sentinelHash };
    await writeFile(cacheFile, JSON.stringify(cachePayload));

    const cached = await loadThemeAssets(themeDir, { cacheDir });
    expect(cached.get('assets/built/screen.css')?.hash).toBe(sentinelHash);

    // Now actually change the file content + mtime. The cache must invalidate
    // and recompute the real hash.
    await writeFile(cssPath, 'body{color:blue;background:#fff}');
    const future = new Date(Date.now() + 5_000);
    await utimes(cssPath, future, future);

    const refreshed = await loadThemeAssets(themeDir, { cacheDir });
    const refreshedHash = refreshed.get('assets/built/screen.css')?.hash;
    expect(refreshedHash).toBeDefined();
    expect(refreshedHash).not.toBe(sentinelHash);
    expect(refreshedHash).not.toBe(initialHash);
  });

  test('treats unreadable cache file as a miss instead of throwing', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-cache-bad-'));
    const cacheDir = await mkdtemp(join(tmpdir(), 'nectar-cache-bad-'));
    await mkdir(join(themeDir, 'assets'), { recursive: true });
    await writeFile(join(themeDir, 'assets', 'a.css'), 'body{}');
    await writeFile(join(cacheDir, 'asset-cache.json'), '{ this is not json');

    const map = await loadThemeAssets(themeDir, { cacheDir });
    expect(map.get('assets/a.css')?.hash).toMatch(/^[0-9a-f]{10}$/);
  });
});
