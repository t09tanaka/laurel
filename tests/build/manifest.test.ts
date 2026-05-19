import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_VERSION,
  loadManifest,
  manifestPath,
  saveManifest,
  stableStringify,
} from '~/build/manifest.ts';

describe('build manifest serialization', () => {
  test('stableStringify sorts object keys recursively', () => {
    const out = stableStringify({ z: 1, a: { y: 2, b: 3 } });
    expect(out).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  test('stableStringify drops prev/next post references to avoid cycles', () => {
    const a: Record<string, unknown> = { title: 'A' };
    const b: Record<string, unknown> = { title: 'B' };
    a.next = b;
    b.prev = a;
    expect(stableStringify({ post: a })).toBe('{"post":{"title":"A"}}');
  });

  test('loadManifest returns undefined for missing, malformed, and wrong-version files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-manifest-'));
    try {
      expect(await loadManifest(dir)).toBeUndefined();

      await Bun.write(manifestPath(dir), 'not json');
      expect(await loadManifest(dir)).toBeUndefined();

      await Bun.write(
        manifestPath(dir),
        JSON.stringify({ version: 999, globalHash: 'x', routes: {} }),
      );
      expect(await loadManifest(dir)).toBeUndefined();

      await Bun.write(manifestPath(dir), JSON.stringify({ version: MANIFEST_VERSION }));
      expect(await loadManifest(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('saveManifest round-trips through loadManifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-manifest-'));
    try {
      const manifest = {
        version: MANIFEST_VERSION,
        globalHash: 'abc',
        routes: {
          '/': { hash: 'h1', outputPath: 'index.html' },
          '/post/': { hash: 'h2', outputPath: 'post/index.html' },
        },
      } as const;
      await saveManifest(dir, manifest);
      const loaded = await loadManifest(dir);
      expect(loaded).toEqual(manifest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
