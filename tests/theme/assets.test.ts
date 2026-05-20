import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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
  test('keeps image asset filenames stable but cache-busts their public URL', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-image-cache-'));
    const assetsDir = join(themeDir, 'assets', 'images');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'icon.svg'), '<svg viewBox="0 0 1 1"></svg>');

    const map = await loadThemeAssets(themeDir);
    const asset = map.get('assets/images/icon.svg');

    expect(asset?.fingerprintedPath).toBe('assets/images/icon.svg');
    expect(asset?.hash).toMatch(/^[0-9a-f]{10}$/);
    expect(asset ? assetPublicUrl(asset, '/blog') : '').toBe(
      `/blog/assets/images/icon.svg?v=${asset?.hash}`,
    );
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

describe('loadThemeAssets parallel hashing', () => {
  // Hash work fans out via Promise.all with a concurrency limit. Iteration
  // order of the returned Map must still be deterministic so downstream code
  // (cache writes, build summaries) doesn't see flaky ordering, and every
  // file must end up with a well-formed sha1 prefix regardless of how the
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
      expect(a?.hash).toMatch(/^[0-9a-f]{10}$/);
      expect(b?.hash).toBe(a?.hash as string);
    }

    // Hashes across distinct content must be distinct (sanity: streaming
    // hash isn't accidentally hashing empty input for everyone).
    const hashes = new Set(seenLogical.map((k) => map.get(k)?.hash));
    expect(hashes.size).toBe(N);
  });

  // The hash is computed by streaming the file through CryptoHasher rather
  // than buffering the full payload first. The result must match the
  // equivalent one-shot sha1 of the same bytes, otherwise fingerprinted
  // URLs would shift across implementations and break long-lived caches.
  test('streaming sha1 matches the equivalent one-shot sha1', async () => {
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
      const h = new Bun.CryptoHasher('sha1');
      h.update(buf);
      return h.digest('hex').slice(0, 10);
    };
    expect(map.get('assets/built/big.bin')?.hash).toBe(oneShot(big));
    expect(map.get('assets/built/small.css')?.hash).toBe(oneShot(small));
  });
});
