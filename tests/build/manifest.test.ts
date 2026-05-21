import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_VERSION,
  computeGlobalHash,
  computeRouteHash,
  loadManifest,
  manifestPath,
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
});
