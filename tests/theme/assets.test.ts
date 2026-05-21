import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetPublicUrl, loadThemeAssets } from '~/theme/assets.ts';

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
  test('fingerprints image asset filenames instead of relying on query cache busting', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-image-cache-'));
    const assetsDir = join(themeDir, 'assets', 'images');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'icon.svg'), '<svg viewBox="0 0 1 1"></svg>');

    const map = await loadThemeAssets(themeDir);
    const asset = map.get('assets/images/icon.svg');

    expect(asset?.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(asset?.fingerprintedPath).toBe(`assets/images/icon.${asset?.hash}.svg`);
    expect(asset ? assetPublicUrl(asset, '/blog') : '').toBe(
      `/blog/assets/images/icon.${asset?.hash}.svg`,
    );
  });

  test('fingerprints source maps and font assets', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-non-code-cache-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'screen.css.map'), '{"version":3}');
    await writeFile(join(assetsDir, 'screen.woff2'), 'font-bytes');

    const map = await loadThemeAssets(themeDir);
    for (const logical of ['assets/built/screen.css.map', 'assets/built/screen.woff2']) {
      const asset = map.get(logical);
      expect(asset?.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(asset?.fingerprintedPath).not.toBe(asset?.logicalPath);
      expect(asset?.fingerprintedPath).toContain(`.${asset?.hash}.`);
    }
  });

  test('stores one canonical assets-prefixed key per file', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-canonical-assets-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'screen.css'), 'body{}');

    const map = await loadThemeAssets(themeDir);
    expect(map.get('assets/built/screen.css')).toBeDefined();
    expect(map.get('built/screen.css')).toBeUndefined();
    expect(Array.from(map.keys())).toEqual(['assets/built/screen.css']);
  });

  test('computes sha384 SRI alongside the fingerprint hash', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-sri-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'screen.css'), 'body{color:red}');

    const map = await loadThemeAssets(themeDir);
    const asset = map.get('assets/built/screen.css');

    expect(asset?.integrity).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    expect(asset?.integrity).toBe(
      'sha384-8U9HYzsHbf55cFZyiWIE29+QPYQ9WO+U5uT/ViFw0TOwM2Fbbb74ZegzRV/nvwrD',
    );
  });

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
    expect(cachePayload.version).toBe(2);
    expect(cachePayload.entries[cssPath]?.hash).toBe(initialHash as string);

    // Force-set mtime back so a fresh stat returns the same mtime+size; the
    // cache lookup must hit and produce the same hash without re-reading the
    // file. We mutate the cached hash to a sentinel so we can prove we reused
    // the cached value instead of re-hashing.
    const entry = cachePayload.entries[cssPath];
    if (!entry) throw new Error('expected cache entry');
    const sentinelHash = 'deadbeef00112233';
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
    expect(map.get('assets/a.css')?.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('loadThemeAssets parallel hashing', () => {
  test('does not block parallel asset processing with statSync', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-async-stat-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'screen.css'), 'body{}');

    const statSync = spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('loadThemeAssets should use async stat for assets');
    });
    try {
      const map = await loadThemeAssets(themeDir);
      expect(map.get('assets/built/screen.css')?.hash).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      statSync.mockRestore();
    }
  });

  // Hash work fans out via Promise.all with a concurrency limit. Iteration
  // order of the returned Map must still be deterministic so downstream code
  // (cache writes, build summaries) doesn't see flaky ordering, and every
  // file must end up with a well-formed sha256 prefix regardless of how the
  // parallel scheduler interleaves them.
  test('hashes many assets in parallel without losing or reordering entries', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-parallel-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });

    const N = 40;
    const expectedRels: string[] = [];
    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const rel = `built/file-${String(i).padStart(3, '0')}.bin`;
        expectedRels.push(`assets/${rel}`);
        // Distinct contents per file so any accidental cross-talk between
        // parallel tasks (e.g. hasher reuse, swapped buffers) would surface
        // as a duplicate or mis-ordered hash.
        return writeFile(
          join(themeDir, 'assets', rel),
          Buffer.from(`payload-${i}-${'x'.repeat((i % 7) * 11)}`),
        );
      }),
    );

    const map = await loadThemeAssets(themeDir);
    const seenLogical = Array.from(map.keys()).filter((k) => k.startsWith('assets/'));
    expect(seenLogical.length).toBe(N);

    // Two runs must produce the same iteration order and the same hashes,
    // regardless of which parallel task happened to finish first.
    const map2 = await loadThemeAssets(themeDir);
    const seenLogical2 = Array.from(map2.keys()).filter((k) => k.startsWith('assets/'));
    expect(seenLogical2).toEqual(seenLogical);
    for (const k of seenLogical) {
      const a = map.get(k);
      const b = map2.get(k);
      expect(a?.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(b?.hash).toBe(a?.hash as string);
    }

    // Hashes across distinct content must be distinct (sanity: streaming
    // hash isn't accidentally hashing empty input for everyone).
    const hashes = new Set(seenLogical.map((k) => map.get(k)?.hash));
    expect(hashes.size).toBe(N);
  });

  // The hash is computed by streaming the file through CryptoHasher rather
  // than buffering the full payload first. The result must match the
  // equivalent one-shot sha256 of the same bytes, otherwise fingerprinted
  // URLs would shift across implementations and break long-lived caches.
  test('streaming sha256 matches the equivalent one-shot sha256', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-stream-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });

    // Use payloads that span multiple stream chunks so the test would catch
    // a bug where only the first chunk gets fed to the hasher.
    const big = Buffer.alloc(1024 * 256);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
    const small = Buffer.from('body{color:red}');
    await writeFile(join(assetsDir, 'big.bin'), big);
    await writeFile(join(assetsDir, 'small.css'), small);

    const map = await loadThemeAssets(themeDir);

    const oneShot = (buf: Buffer): string => {
      const h = new Bun.CryptoHasher('sha256');
      h.update(buf);
      return h.digest('hex').slice(0, 16);
    };
    expect(map.get('assets/built/big.bin')?.hash).toBe(oneShot(big));
    expect(map.get('assets/built/small.css')?.hash).toBe(oneShot(small));
  });

  test('streams asset files instead of requesting whole-file buffers', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-stream-only-'));
    const assetsDir = join(themeDir, 'assets', 'built');
    await mkdir(assetsDir, { recursive: true });

    const big = Buffer.alloc(1024 * 256);
    for (let i = 0; i < big.length; i++) big[i] = (i * 17) & 0xff;
    await writeFile(join(assetsDir, 'screen.css'), big);

    const originalFile = Bun.file;
    let streamCalls = 0;
    let wholeFileReads = 0;

    const patchedFile = ((...args: Parameters<typeof Bun.file>): ReturnType<typeof Bun.file> => {
      const file = originalFile(...args);
      return new Proxy(file, {
        get(target, prop, receiver) {
          if (prop === 'stream') {
            return () => {
              streamCalls++;
              return target.stream();
            };
          }
          if (prop === 'arrayBuffer' || prop === 'text' || prop === 'json' || prop === 'bytes') {
            return () => {
              wholeFileReads++;
              throw new Error(`loadThemeAssets should stream assets, not call ${String(prop)}()`);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }) as typeof Bun.file;

    (Bun as unknown as { file: typeof Bun.file }).file = patchedFile;
    try {
      const map = await loadThemeAssets(themeDir);
      expect(map.get('assets/built/screen.css')?.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(streamCalls).toBeGreaterThan(0);
      expect(wholeFileReads).toBe(0);
    } finally {
      (Bun as unknown as { file: typeof Bun.file }).file = originalFile;
    }
  });
});
