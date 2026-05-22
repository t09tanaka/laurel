import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import {
  type PageBundle,
  exportPageBundle,
  importPageBundle,
  parsePageBundle,
} from '~/page-bundle/index.ts';

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-page-bundle-')));
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Bundle Site"',
      'description = "Page bundles"',
      'url = "https://bundle.test"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'content/images/cover.txt'), 'cover asset\n', 'utf8');
  await writeFile(
    join(dir, 'content/pages/about.md'),
    [
      '---',
      'title: About',
      'slug: about',
      'custom_field: keep me',
      'feature_image: /content/images/cover.txt',
      '---',
      '',
      'About body with ![Cover](/content/images/cover.txt).',
      '',
    ].join('\n'),
    'utf8',
  );
  return dir;
}

describe('page bundle', () => {
  test('exports a single page with raw frontmatter, body, and local assets', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const bundle = await exportPageBundle({ cwd: dir, config, slug: 'about' });

      expect(bundle.nectar.schema).toBe('nectar.page.v1');
      expect(bundle.site.title).toBe('Bundle Site');
      expect(bundle.page.slug).toBe('about');
      expect(bundle.page.path).toBe('content/pages/about.md');
      expect(bundle.page.frontmatter.custom_field).toBe('keep me');
      expect(bundle.page.body).toContain('About body');
      expect(bundle.assets.map((asset) => asset.path)).toEqual(['content/images/cover.txt']);
      expect(bundle.assets[0]?.encoding).toBe('utf8');
      expect(bundle.assets[0]?.content).toBe('cover asset\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('imports with dry-run and rename without overwriting existing pages', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const exported = await exportPageBundle({ cwd: dir, config, slug: 'about' });
      const bundle: PageBundle = {
        ...exported,
        page: {
          ...exported.page,
          slug: 'about',
          frontmatter: { ...exported.page.frontmatter, title: 'Collaborated About' },
          body: 'Imported body.\n',
        },
      };

      const dryRun = await importPageBundle({
        cwd: dir,
        config,
        bundle,
        onConflict: 'rename',
        dryRun: true,
      });
      expect(dryRun.written).toBe(false);
      expect(dryRun.pagePath).toBe('content/pages/about-2.md');
      expect(await readFile(join(dir, 'content/pages/about.md'), 'utf8')).toContain('About body');

      const imported = await importPageBundle({
        cwd: dir,
        config,
        bundle,
        onConflict: 'rename',
        dryRun: false,
      });
      expect(imported.written).toBe(true);
      expect(imported.pagePath).toBe('content/pages/about-2.md');
      const written = await readFile(join(dir, imported.pagePath), 'utf8');
      expect(written).toContain('title: Collaborated About');
      expect(written).toContain('Imported body.');
      expect(await readFile(join(dir, 'content/images/cover.txt'), 'utf8')).toBe('cover asset\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('validates the bundle schema before import', () => {
    expect(() => parsePageBundle({ nectar: { schema: 'wrong' } })).toThrow(
      /Expected nectar.page.v1/,
    );
  });

  test('refuses to import through symlinked page or asset paths', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const bundle = await exportPageBundle({ cwd: dir, config, slug: 'about' });
      const outside = join(dir, 'outside.md');
      await writeFile(outside, 'outside\n', 'utf8');
      await rm(join(dir, 'content/pages/about.md'));
      await symlink(outside, join(dir, 'content/pages/about.md'));

      await expect(
        importPageBundle({ cwd: dir, config, bundle, onConflict: 'overwrite' }),
      ).rejects.toThrow(/symlink/i);
      expect(await readFile(outside, 'utf8')).toBe('outside\n');

      await rm(join(dir, 'content/pages/about.md'));
      const assetOutside = join(dir, 'asset-outside');
      await mkdir(assetOutside);
      await symlink(assetOutside, join(dir, 'content/images/nested'));
      await expect(
        importPageBundle({
          cwd: dir,
          config,
          bundle: {
            ...bundle,
            page: { ...bundle.page, slug: 'imported', frontmatter: { slug: 'imported' } },
            assets: [{ path: 'content/images/nested/cover.txt', encoding: 'utf8', content: 'x' }],
          },
          onConflict: 'overwrite',
        }),
      ).rejects.toThrow(/symlink/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
