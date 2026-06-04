import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildJsonCache, createEmbedMetadataCache } from '~/build/cache.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-build-cache-'));
  tempDirs.push(dir);
  return dir;
}

function fixedNow(iso: string): () => Date {
  return () => new Date(iso);
}

function isEmbedMetadata(value: unknown): value is { title: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { title?: unknown }).title === 'string'
  );
}

describe('build JSON cache', () => {
  test('stores embed metadata under .laurel/cache/embeds/<sha>.json', async () => {
    const cwd = await tempCwd();
    const cache = createEmbedMetadataCache({ cwd, now: fixedNow('2026-05-21T00:00:00.000Z') });
    const url = new URL('https://example.com/posts/a?utm=source');

    const hit = await cache.write(url, { title: 'Example' }, { ttlMs: 86_400_000 });

    expect(hit.path).toStartWith(join(cwd, '.laurel/cache/embeds/'));
    expect(hit.path).toEndWith('.json');
    expect(hit.path).not.toContain('example.com');
    expect(hit.cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(hit.path)).toBe(true);

    const entry = JSON.parse(await readFile(hit.path, 'utf8'));
    expect(entry).toMatchObject({
      schema: 1,
      namespace: 'embeds',
      key: 'https://example.com/posts/a?utm=source',
      cache_key: hit.cacheKey,
      ttl_ms: 86_400_000,
      value: { title: 'Example' },
    });
  });

  test('uses deterministic structured keys for shared probe callers', async () => {
    const cwd = await tempCwd();
    const cache = createBuildJsonCache({ cwd, namespace: 'image-probes' });

    const a = cache.pathFor({ url: 'https://example.com/cover.jpg', kind: 'dimensions' });
    const b = cache.pathFor({ kind: 'dimensions', url: 'https://example.com/cover.jpg' });

    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.path).toBe(b.path);
    expect(a.path).toContain('/cache/image-probes/');
  });

  test('honors TTL and only returns stale entries when requested', async () => {
    const cwd = await tempCwd();
    const cache = createEmbedMetadataCache({ cwd });
    const key = 'https://example.com/bookmark';

    await cache.write(
      key,
      { title: 'Fresh' },
      { ttlMs: 1_000, now: fixedNow('2026-05-21T00:00:00.000Z') },
    );

    const fresh = await cache.read(key, {
      now: fixedNow('2026-05-21T00:00:00.900Z'),
      validate: isEmbedMetadata,
    });
    expect(fresh?.value.title).toBe('Fresh');
    expect(fresh?.stale).toBe(false);

    const staleDefault = await cache.read(key, {
      now: fixedNow('2026-05-21T00:00:01.001Z'),
      validate: isEmbedMetadata,
    });
    expect(staleDefault).toBeUndefined();

    const staleAllowed = await cache.read(key, {
      allowStale: true,
      now: fixedNow('2026-05-21T00:00:01.001Z'),
      validate: isEmbedMetadata,
    });
    expect(staleAllowed?.value.title).toBe('Fresh');
    expect(staleAllowed?.stale).toBe(true);
  });

  test('offline read-through returns stale cache without invoking fetch', async () => {
    const cwd = await tempCwd();
    const cache = createEmbedMetadataCache({ cwd });
    const key = 'https://example.com/embed';
    let fetchCalls = 0;

    await cache.write(
      key,
      { title: 'Cached embed' },
      { ttlMs: 1_000, now: fixedNow('2026-05-21T00:00:00.000Z') },
    );

    const result = await cache.readThrough(key, {
      ttlMs: 1_000,
      offline: true,
      now: fixedNow('2026-05-21T01:00:00.000Z'),
      validate: isEmbedMetadata,
      fetchValue: async () => {
        fetchCalls += 1;
        return { title: 'Network embed' };
      },
    });

    expect(result.status).toBe('stale');
    expect(fetchCalls).toBe(0);
    if (result.status === 'stale') {
      expect(result.hit.value.title).toBe('Cached embed');
      expect(result.hit.stale).toBe(true);
    }
  });

  test('offline read-through reports a miss when no cached value exists', async () => {
    const cwd = await tempCwd();
    const cache = createEmbedMetadataCache({ cwd });
    let fetchCalls = 0;

    const result = await cache.readThrough('https://example.com/missing', {
      offline: true,
      fetchValue: async () => {
        fetchCalls += 1;
        return { title: 'Network embed' };
      },
    });

    expect(result.status).toBe('offline-miss');
    expect(fetchCalls).toBe(0);
    if (result.status === 'offline-miss') {
      expect(result.path).toContain('/cache/embeds/');
    }
  });

  test('online read-through refreshes stale entries and writes the new value', async () => {
    const cwd = await tempCwd();
    const cache = createEmbedMetadataCache({ cwd });
    const key = 'https://example.com/bookmark';

    await cache.write(
      key,
      { title: 'Old' },
      { ttlMs: 1_000, now: fixedNow('2026-05-21T00:00:00.000Z') },
    );

    const result = await cache.readThrough(key, {
      ttlMs: 1_000,
      now: fixedNow('2026-05-21T01:00:00.000Z'),
      validate: isEmbedMetadata,
      fetchValue: async () => ({ title: 'Refreshed' }),
    });

    expect(result.status).toBe('refreshed');
    if (result.status === 'refreshed') {
      expect(result.hit.value.title).toBe('Refreshed');
      expect(result.hit.stale).toBe(false);
    }

    const reread = await cache.read(key, {
      now: fixedNow('2026-05-21T01:00:00.001Z'),
      validate: isEmbedMetadata,
    });
    expect(reread?.value.title).toBe('Refreshed');
  });
});
