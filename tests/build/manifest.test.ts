import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_VERSION,
  computeGeneratorSourceFingerprint,
  computeGlobalHash,
  computeManifestEntryIntegrity,
  computeRouteHash,
  createGeneratorSourceFingerprintCache,
  loadManifest,
  manifestPath,
  reusePreviousRouteHash,
  saveManifest,
  stableStringify,
} from '~/build/manifest.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';

describe('build manifest serialization', () => {
  test('stableStringify sorts object keys recursively', () => {
    const out = stableStringify({ z: 1, a: { y: 2, b: 3 } });
    expect(out).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  test('computeGeneratorSourceFingerprint reuses cached hashes until source stats change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-generator-fp-'));
    try {
      await mkdir(join(dir, 'build'), { recursive: true });
      await mkdir(join(dir, 'content'), { recursive: true });
      await writeFile(join(dir, 'build', 'a.ts'), 'export const a = 1;\n', 'utf8');
      await writeFile(join(dir, 'content', 'b.ts'), 'export const b = 1;\n', 'utf8');
      const cache = createGeneratorSourceFingerprintCache();

      const first = await computeGeneratorSourceFingerprint(dir, cache);
      const second = await computeGeneratorSourceFingerprint(dir, cache);
      expect(second).toBe(first);
      expect(cache.stats()).toEqual({ hits: 1, misses: 1, sets: 1 });

      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeFile(join(dir, 'content', 'b.ts'), 'export const b = 2;\n', 'utf8');
      const edited = await computeGeneratorSourceFingerprint(dir, cache);
      expect(edited).not.toBe(first);

      await mkdir(join(dir, 'render'), { recursive: true });
      await writeFile(join(dir, 'render', 'c.ts'), 'export const c = 1;\n', 'utf8');
      const added = await computeGeneratorSourceFingerprint(dir, cache);
      expect(added).not.toBe(edited);

      await rm(join(dir, 'build', 'a.ts'));
      const removed = await computeGeneratorSourceFingerprint(dir, cache);
      expect(removed).not.toBe(added);
      expect(cache.stats()).toEqual({ hits: 1, misses: 4, sets: 4 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('computeGeneratorSourceFingerprint keeps source-unavailable fallback outside the cache', async () => {
    const cache = createGeneratorSourceFingerprintCache();
    const missing = join(tmpdir(), `nectar-missing-src-${Date.now()}`);

    expect(await computeGeneratorSourceFingerprint(missing, cache)).toBe('source-unavailable');
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, sets: 0 });
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

  test('computeRouteHash includes parent-directory layout sources', () => {
    const route: RouteContext = {
      kind: 'home',
      url: '/account/',
      outputPath: 'account/index.html',
      template: 'members/account',
      data: {},
      meta: { title: '', description: '', canonical: '', image: undefined },
    };
    const theme = {
      templates: {
        'members/account': '{{!< ../default-wide}}\n<main>Account</main>',
        'default-wide': '<body data-layout="wide">{{{body}}}</body>',
      },
      partials: {},
      assets: new Map(),
      pkg: { name: 'fixture', version: '0.0.0', customDefaults: {} },
    } as unknown as ThemeBundle;

    const baseHash = computeRouteHash({ globalHash: 'g', route, theme });
    const changedHash = computeRouteHash({
      globalHash: 'g',
      route,
      theme: {
        ...theme,
        templates: {
          ...theme.templates,
          'default-wide': '<body data-layout="wide-v2">{{{body}}}</body>',
        },
      },
    });

    expect(changedHash).not.toBe(baseHash);
  });

  test('computeGlobalHash changes when the generator fingerprint changes', () => {
    const config = { site: { title: 'Fixture' } } as never;
    const site = { title: 'Fixture', url: 'https://example.com' } as never;
    const theme = {
      name: 'fixture',
      rootDir: '/tmp/theme',
      templates: { index: '<main>{{title}}</main>' },
      partials: {},
      locales: {},
      assets: new Map(),
      pkg: {
        name: 'fixture',
        version: '0.0.0',
        customDefaults: {},
        posts_per_page: 5,
        image_sizes: {},
      },
    } as unknown as ThemeBundle;

    const before = computeGlobalHash({ config, site, theme, generatorFingerprint: 'helpers-v1' });
    const after = computeGlobalHash({ config, site, theme, generatorFingerprint: 'helpers-v2' });

    expect(after).not.toBe(before);
  });

  test('reusePreviousRouteHash only trusts fully verified non-plugin manifest entries', () => {
    const route: RouteContext = {
      kind: 'post',
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'post',
      lastmod: '2026-01-01T00:00:00.000Z',
      data: {},
      meta: { title: 'Hello', description: '', canonical: '', image: undefined },
    };
    const previousWithoutIntegrity = {
      hash: 'previous-route-hash',
      outputPath: 'hello/index.html',
      contentFingerprint: 'content-v1',
      themeFingerprint: 'theme-v1',
      kind: 'post',
      template: 'post',
      lastmod: '2026-01-01T00:00:00.000Z',
    } as const;
    const previous = {
      ...previousWithoutIntegrity,
      integrity: computeManifestEntryIntegrity(previousWithoutIntegrity),
    };

    expect(
      reusePreviousRouteHash({
        previous,
        previousGlobalHash: 'global-v1',
        currentGlobalHash: 'global-v1',
        route,
        contentFingerprint: 'content-v1',
        themeFingerprint: 'theme-v1',
        pluginsEnabled: false,
      }),
    ).toBe('previous-route-hash');

    expect(
      reusePreviousRouteHash({
        previous: { ...previous, template: undefined },
        previousGlobalHash: 'global-v1',
        currentGlobalHash: 'global-v1',
        route,
        contentFingerprint: 'content-v1',
        themeFingerprint: 'theme-v1',
        pluginsEnabled: false,
      }),
    ).toBeUndefined();

    expect(
      reusePreviousRouteHash({
        previous,
        previousGlobalHash: 'global-v1',
        currentGlobalHash: 'global-v1',
        route,
        contentFingerprint: 'content-v1',
        themeFingerprint: 'theme-v1',
        pluginsEnabled: true,
      }),
    ).toBeUndefined();

    expect(
      reusePreviousRouteHash({
        previous: { ...previous, hash: 'tampered-hash' },
        previousGlobalHash: 'global-v1',
        currentGlobalHash: 'global-v1',
        route,
        contentFingerprint: 'content-v1',
        themeFingerprint: 'theme-v1',
        pluginsEnabled: false,
      }),
    ).toBeUndefined();
  });
});
