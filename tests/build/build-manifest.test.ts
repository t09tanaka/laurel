import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILD_MANIFEST_VERSION,
  type BuildManifestJson,
  buildManifestAbsPath,
  buildManifestRelPath,
  emitBuildManifest,
} from '~/build/build-manifest.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { ThemeBundle } from '~/theme/types.ts';

function fakeConfig(): NectarConfig {
  return { site: { title: 'X' }, build: { output_dir: 'dist' } } as unknown as NectarConfig;
}

function fakeTheme(overrides?: Partial<ThemeBundle['pkg']>): ThemeBundle {
  return {
    name: 'source',
    rootDir: '/fake',
    templates: {},
    partials: {},
    locales: {},
    assets: new Map(),
    pkg: {
      name: 'source',
      version: '1.2.3',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
      ...overrides,
    },
  } as ThemeBundle;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

describe('build-manifest', () => {
  test('emits .nectar/build-manifest.json with the required fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-bm-'));
    try {
      await writeFile(join(dir, 'index.html'), '<html></html>', 'utf8');
      await mkdir(join(dir, 'assets'), { recursive: true });
      await writeFile(join(dir, 'assets', 'app.css'), 'body{}', 'utf8');

      const now = new Date('2026-05-20T00:00:00.000Z');
      const manifest = await emitBuildManifest({
        outputDir: dir,
        config: fakeConfig(),
        theme: fakeTheme(),
        routeCount: 1,
        assetCount: 1,
        nectarVersion: '9.9.9',
        now,
      });

      expect(manifest.schema_version).toBe(BUILD_MANIFEST_VERSION);
      expect(manifest.generated_at).toBe('2026-05-20T00:00:00.000Z');
      expect(manifest.nectar.version).toBe('9.9.9');
      expect(manifest.theme).toEqual({ name: 'source', version: '1.2.3' });
      expect(manifest.route_count).toBe(1);
      expect(manifest.asset_count).toBe(1);
      expect(manifest.hash_algorithm).toBe('sha256');
      expect(typeof manifest.config_hash).toBe('string');
      expect(manifest.config_hash).toHaveLength(64);

      // The on-disk JSON parses to the same shape we returned.
      const onDisk = (await Bun.file(buildManifestAbsPath(dir)).json()) as BuildManifestJson;
      expect(onDisk).toEqual(manifest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('files list contains every output except the manifest itself, sorted by path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-bm-'));
    try {
      const indexHtml = '<html><body>hi</body></html>';
      const css = 'body{color:red}';
      await writeFile(join(dir, 'index.html'), indexHtml, 'utf8');
      await mkdir(join(dir, 'assets', 'built'), { recursive: true });
      await writeFile(join(dir, 'assets', 'built', 'screen.css'), css, 'utf8');
      await mkdir(join(dir, 'tag', 'foo'), { recursive: true });
      await writeFile(join(dir, 'tag', 'foo', 'index.html'), 'tagpage', 'utf8');

      const manifest = await emitBuildManifest({
        outputDir: dir,
        config: fakeConfig(),
        theme: fakeTheme(),
        routeCount: 2,
        assetCount: 1,
        nectarVersion: '1.0.0',
      });

      const paths = manifest.files.map((f) => f.path);
      expect(paths).toEqual(['assets/built/screen.css', 'index.html', 'tag/foo/index.html']);
      expect(paths).not.toContain(buildManifestRelPath());

      const index = manifest.files.find((f) => f.path === 'index.html');
      expect(index?.size).toBe(Buffer.byteLength(indexHtml, 'utf8'));
      expect(index?.hash).toBe(sha256(indexHtml));

      const cssEntry = manifest.files.find((f) => f.path === 'assets/built/screen.css');
      expect(cssEntry?.size).toBe(Buffer.byteLength(css, 'utf8'));
      expect(cssEntry?.hash).toBe(sha256(css));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config_hash is stable across runs with the same config and changes when config changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-bm-'));
    try {
      await writeFile(join(dir, 'index.html'), 'x', 'utf8');
      const baseArgs = {
        outputDir: dir,
        theme: fakeTheme(),
        routeCount: 0,
        assetCount: 0,
        nectarVersion: '0.0.0',
        now: new Date('2026-01-01T00:00:00Z'),
      };

      const a = await emitBuildManifest({ ...baseArgs, config: fakeConfig() });
      const b = await emitBuildManifest({ ...baseArgs, config: fakeConfig() });
      expect(a.config_hash).toBe(b.config_hash);

      const changed = { ...fakeConfig(), site: { title: 'Y' } } as unknown as NectarConfig;
      const c = await emitBuildManifest({ ...baseArgs, config: changed });
      expect(c.config_hash).not.toBe(a.config_hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('produces an empty files array for an empty output dir (excluding self)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-bm-'));
    try {
      const manifest = await emitBuildManifest({
        outputDir: dir,
        config: fakeConfig(),
        theme: fakeTheme(),
        routeCount: 0,
        assetCount: 0,
        nectarVersion: '0.0.0',
      });
      expect(manifest.files).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
