import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZipArchive } from '~/cli/dashboard/zip-writer';
import {
  COMPONENTS_BUNDLE_SCHEMA,
  exportComponentsBundle,
  importComponentsBundle,
  parseComponentsBundleZip,
} from '~/components-bundle/index';
import { loadConfig } from '~/config/loader';
import { readZipArchive } from '~/entry-bundle/zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function componentMd(slug: string, description = 'A snippet'): string {
  return [
    '---',
    `slug: ${slug}`,
    `description: ${description}`,
    '---',
    '',
    '```css',
    `.${slug} { color: red; }`,
    '```',
    '',
    '```html',
    `<div class="${slug}">{${slug}}</div>`,
    '```',
    '',
  ].join('\n');
}

async function makeFixture(slugs: string[] = ['alpha', 'beta']): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-components-bundle-')));
  await mkdir(join(dir, 'content/components'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Bundle Site"', 'url = "https://bundle.test"', ''].join('\n'),
    'utf8',
  );
  for (const slug of slugs) {
    await writeFile(join(dir, `content/components/${slug}.md`), componentMd(slug), 'utf8');
  }
  return dir;
}

function manifestBytes(overrides: Record<string, unknown> = {}): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      schema: COMPONENTS_BUNDLE_SCHEMA,
      components: [{ slug: 'alpha', path: 'content/components/alpha.md' }],
      ...overrides,
    }),
  );
}

describe('exportComponentsBundle', () => {
  test('exports all components when no slugs are given', async () => {
    const dir = await makeFixture(['alpha', 'beta']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip, exportedSlugs, missing } = await exportComponentsBundle({ cwd: dir, config });
      expect(exportedSlugs.sort()).toEqual(['alpha', 'beta']);
      expect(missing).toEqual([]);
      const paths = readZipArchive(zip)
        .map((e) => e.path)
        .sort();
      expect(paths).toEqual([
        'components/alpha.md',
        'components/beta.md',
        'nectar-components.json',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('exports only the requested subset and reports missing slugs', async () => {
    const dir = await makeFixture(['alpha', 'beta']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { exportedSlugs, missing } = await exportComponentsBundle({
        cwd: dir,
        config,
        slugs: ['beta', 'ghost'],
      });
      expect(exportedSlugs).toEqual(['beta']);
      expect(missing).toEqual(['ghost']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('throws when nothing matches', async () => {
    const dir = await makeFixture(['alpha']);
    try {
      const config = await loadConfig({ cwd: dir });
      await expect(exportComponentsBundle({ cwd: dir, config, slugs: ['nope'] })).rejects.toThrow(
        /No matching components/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('preserves the raw component file verbatim', async () => {
    const dir = await makeFixture(['alpha']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportComponentsBundle({ cwd: dir, config });
      const entry = readZipArchive(zip).find((e) => e.path === 'components/alpha.md');
      expect(decoder.decode(entry?.bytes)).toBe(componentMd('alpha'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseComponentsBundleZip', () => {
  test('parses a valid bundle', () => {
    const zip = createZipArchive([
      { path: 'nectar-components.json', bytes: manifestBytes() },
      { path: 'components/alpha.md', bytes: encoder.encode(componentMd('alpha')) },
    ]);
    const parsed = parseComponentsBundleZip(zip);
    expect(parsed.components).toHaveLength(1);
    expect(parsed.components[0]?.slug).toBe('alpha');
    expect(parsed.components[0]?.body).toContain('```html');
  });

  test('rejects unknown schema', () => {
    const zip = createZipArchive([
      { path: 'nectar-components.json', bytes: manifestBytes({ schema: 'bogus' }) },
      { path: 'components/alpha.md', bytes: encoder.encode(componentMd('alpha')) },
    ]);
    expect(() => parseComponentsBundleZip(zip)).toThrow(/Unsupported bundle schema/);
  });

  test('rejects entries outside components/', () => {
    const zip = createZipArchive([
      { path: 'nectar-components.json', bytes: manifestBytes() },
      { path: 'evil.md', bytes: encoder.encode(componentMd('alpha')) },
    ]);
    expect(() => parseComponentsBundleZip(zip)).toThrow(/outside components\//);
  });

  test('rejects duplicate slugs', () => {
    const zip = createZipArchive([
      { path: 'nectar-components.json', bytes: manifestBytes() },
      { path: 'components/alpha.md', bytes: encoder.encode(componentMd('alpha')) },
      { path: 'components/copy.md', bytes: encoder.encode(componentMd('alpha')) },
    ]);
    expect(() => parseComponentsBundleZip(zip)).toThrow(/Duplicate component slug/);
  });

  test('rejects an invalid slug', () => {
    const zip = createZipArchive([
      { path: 'nectar-components.json', bytes: manifestBytes() },
      { path: 'components/bad.md', bytes: encoder.encode(componentMd('1bad')) },
    ]);
    expect(() => parseComponentsBundleZip(zip)).toThrow(/Invalid component slug/);
  });

  test('rejects a missing manifest', () => {
    const zip = createZipArchive([
      { path: 'components/alpha.md', bytes: encoder.encode(componentMd('alpha')) },
    ]);
    expect(() => parseComponentsBundleZip(zip)).toThrow(/missing nectar-components\.json/);
  });
});

describe('importComponentsBundle round trip', () => {
  test('imports new components into an empty target', async () => {
    const source = await makeFixture(['alpha', 'beta']);
    const target = await realpath(await mkdtemp(join(tmpdir(), 'nectar-components-target-')));
    try {
      await writeFile(
        join(target, 'nectar.toml'),
        ['[site]', 'title = "T"', 'url = "https://t.test"', ''].join('\n'),
        'utf8',
      );
      const srcConfig = await loadConfig({ cwd: source });
      const tgtConfig = await loadConfig({ cwd: target });
      const { zip } = await exportComponentsBundle({ cwd: source, config: srcConfig });
      const result = await importComponentsBundle({
        cwd: target,
        config: tgtConfig,
        zip,
        onConflict: 'skip',
      });
      expect(result.written).toBe(2);
      const written = await readFile(join(target, 'content/components/alpha.md'), 'utf8');
      expect(written).toContain('```html');
      expect(written).toContain('slug: alpha');
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  test('slugs allowlist imports only the selected subset', async () => {
    const source = await makeFixture(['alpha', 'beta', 'gamma']);
    const target = await realpath(await mkdtemp(join(tmpdir(), 'nectar-components-target-')));
    try {
      await writeFile(
        join(target, 'nectar.toml'),
        ['[site]', 'title = "T"', 'url = "https://t.test"', ''].join('\n'),
        'utf8',
      );
      const { zip } = await exportComponentsBundle({
        cwd: source,
        config: await loadConfig({ cwd: source }),
      });
      const result = await importComponentsBundle({
        cwd: target,
        config: await loadConfig({ cwd: target }),
        zip,
        onConflict: 'overwrite',
        slugs: ['alpha', 'gamma'],
      });
      expect(result.written).toBe(2);
      expect(result.components.map((c) => c.slug).sort()).toEqual(['alpha', 'gamma']);
      expect(existsSync(join(target, 'content/components/beta.md'))).toBe(false);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  test('skip leaves an existing component untouched', async () => {
    const dir = await makeFixture(['alpha']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportComponentsBundle({ cwd: dir, config });
      await writeFile(join(dir, 'content/components/alpha.md'), 'CUSTOM', 'utf8');
      const result = await importComponentsBundle({ cwd: dir, config, zip, onConflict: 'skip' });
      expect(result.skipped).toBe(1);
      expect(result.written).toBe(0);
      expect(await readFile(join(dir, 'content/components/alpha.md'), 'utf8')).toBe('CUSTOM');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('overwrite replaces the existing component', async () => {
    const dir = await makeFixture(['alpha']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportComponentsBundle({ cwd: dir, config });
      await writeFile(join(dir, 'content/components/alpha.md'), 'CUSTOM', 'utf8');
      const result = await importComponentsBundle({
        cwd: dir,
        config,
        zip,
        onConflict: 'overwrite',
      });
      expect(result.written).toBe(1);
      expect(await readFile(join(dir, 'content/components/alpha.md'), 'utf8')).toContain('```html');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rename writes a new slug and rewrites the in-file slug', async () => {
    const dir = await makeFixture(['alpha']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportComponentsBundle({ cwd: dir, config });
      const result = await importComponentsBundle({ cwd: dir, config, zip, onConflict: 'rename' });
      expect(result.renamed).toBe(1);
      const entry = result.components[0];
      expect(entry?.finalSlug).toBe('alpha-2');
      const written = await readFile(join(dir, 'content/components/alpha-2.md'), 'utf8');
      expect(written).toContain('slug: alpha-2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dry-run reports without writing', async () => {
    const source = await makeFixture(['alpha']);
    const target = await realpath(await mkdtemp(join(tmpdir(), 'nectar-components-dry-')));
    try {
      await writeFile(
        join(target, 'nectar.toml'),
        ['[site]', 'title = "T"', 'url = "https://t.test"', ''].join('\n'),
        'utf8',
      );
      const srcConfig = await loadConfig({ cwd: source });
      const tgtConfig = await loadConfig({ cwd: target });
      const { zip } = await exportComponentsBundle({ cwd: source, config: srcConfig });
      const result = await importComponentsBundle({
        cwd: target,
        config: tgtConfig,
        zip,
        onConflict: 'skip',
        dryRun: true,
      });
      expect(result.components[0]?.written).toBe(false);
      expect(result.components[0]?.skipped).toBe(false);
      await expect(readFile(join(target, 'content/components/alpha.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  test('refuses to write through a symlinked target', async () => {
    const dir = await makeFixture(['alpha']);
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportComponentsBundle({ cwd: dir, config });
      const outside = join(dir, 'outside.md');
      await writeFile(outside, 'PRECIOUS', 'utf8');
      await rm(join(dir, 'content/components/alpha.md'));
      await symlink(outside, join(dir, 'content/components/alpha.md'));
      await expect(
        importComponentsBundle({ cwd: dir, config, zip, onConflict: 'overwrite' }),
      ).rejects.toThrow(/symlink/);
      expect(await readFile(outside, 'utf8')).toBe('PRECIOUS');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// A component whose CSS (url()) and HTML (<img src>) reference image assets,
// with the image files present under content/images.
function assetComponentMd(slug: string): string {
  return [
    '---',
    `slug: ${slug}`,
    'description: With assets',
    '---',
    '',
    '```css',
    `.${slug} { background: url("/content/images/${slug}-bg.png"); }`,
    '```',
    '',
    '```html',
    `<img src="/content/images/${slug}-icon.svg" alt="">`,
    '```',
    '',
  ].join('\n');
}

async function makeAssetFixture(slug = 'alpha'): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-components-assets-')));
  await mkdir(join(dir, 'content/components'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Bundle Site"', 'url = "https://bundle.test"', ''].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, `content/components/${slug}.md`), assetComponentMd(slug), 'utf8');
  await writeFile(join(dir, `content/images/${slug}-bg.png`), 'PNGBYTES', 'utf8');
  await writeFile(join(dir, `content/images/${slug}-icon.svg`), '<svg/>', 'utf8');
  return dir;
}

describe('components bundle asset handoff', () => {
  test('export carries assets referenced by component CSS and HTML', async () => {
    const dir = await makeAssetFixture('alpha');
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip, omittedAssets } = await exportComponentsBundle({ cwd: dir, config });
      expect(omittedAssets).toEqual([]);
      const paths = readZipArchive(zip)
        .map((e) => e.path)
        .sort();
      expect(paths).toContain('assets/alpha-bg.png');
      expect(paths).toContain('assets/alpha-icon.svg');
      expect(parseComponentsBundleZip(zip).assets).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('import restores missing assets without overwriting existing ones', async () => {
    const source = await makeAssetFixture('alpha');
    const dest = await makeFixture([]);
    try {
      const srcConfig = await loadConfig({ cwd: source });
      const { zip } = await exportComponentsBundle({ cwd: source, config: srcConfig });
      // Pre-seed one of the two assets at the destination; it must not be clobbered.
      await mkdir(join(dest, 'content/images'), { recursive: true });
      await writeFile(join(dest, 'content/images/alpha-bg.png'), 'LOCAL', 'utf8');
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importComponentsBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
      });
      expect(result.importedAssets).toEqual(['content/images/alpha-icon.svg']);
      expect(await readFile(join(dest, 'content/images/alpha-bg.png'), 'utf8')).toBe('LOCAL');
      expect(existsSync(join(dest, 'content/images/alpha-icon.svg'))).toBe(true);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('assets are not restored for a skipped component', async () => {
    const dir = await makeAssetFixture('alpha');
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportComponentsBundle({ cwd: dir, config });
      // Remove the local assets, then import with skip (alpha already exists).
      await rm(join(dir, 'content/images/alpha-bg.png'));
      await rm(join(dir, 'content/images/alpha-icon.svg'));
      const result = await importComponentsBundle({ cwd: dir, config, zip, onConflict: 'skip' });
      expect(result.skipped).toBe(1);
      expect(result.importedAssets).toEqual([]);
      expect(existsSync(join(dir, 'content/images/alpha-icon.svg'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dry-run reports assets that would be created without writing them', async () => {
    const source = await makeAssetFixture('alpha');
    const dest = await makeFixture([]);
    try {
      const srcConfig = await loadConfig({ cwd: source });
      const { zip } = await exportComponentsBundle({ cwd: source, config: srcConfig });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importComponentsBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
        dryRun: true,
      });
      expect(result.importedAssets.sort()).toEqual([
        'content/images/alpha-bg.png',
        'content/images/alpha-icon.svg',
      ]);
      expect(existsSync(join(dest, 'content/images/alpha-bg.png'))).toBe(false);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('export reports a referenced-but-missing asset in omittedAssets', async () => {
    const dir = await makeAssetFixture('alpha');
    try {
      await rm(join(dir, 'content/images/alpha-bg.png'));
      const config = await loadConfig({ cwd: dir });
      const { omittedAssets } = await exportComponentsBundle({ cwd: dir, config });
      expect(omittedAssets).toEqual(['alpha-bg.png']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('parseComponentsBundleZip rejects a traversing asset path', () => {
    const zip = createZipArchive([
      { path: 'nectar-components.json', bytes: manifestBytes() },
      { path: 'components/alpha.md', bytes: encoder.encode(componentMd('alpha')) },
      { path: 'assets/../evil.png', bytes: encoder.encode('x') },
    ]);
    expect(() => parseComponentsBundleZip(zip)).toThrow(/asset path/i);
  });

  test('export carries assets referenced via srcset and a parenthesised url()', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-components-assets-')));
    try {
      await mkdir(join(dir, 'content/components'), { recursive: true });
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(
        join(dir, 'nectar.toml'),
        ['[site]', 'title = "Bundle Site"', 'url = "https://bundle.test"', ''].join('\n'),
        'utf8',
      );
      await writeFile(
        join(dir, 'content/components/gamma.md'),
        [
          '---',
          'slug: gamma',
          'description: srcset and url()',
          '---',
          '',
          '```css',
          '.gamma { background: url("/content/images/g(1).png"); }',
          '```',
          '',
          '```html',
          '<img srcset="/content/images/g-1x.png 1x, /content/images/g-2x.png 2x" src="/content/images/g-1x.png">',
          '```',
          '',
        ].join('\n'),
        'utf8',
      );
      for (const name of ['g(1).png', 'g-1x.png', 'g-2x.png']) {
        await writeFile(join(dir, `content/images/${name}`), 'IMG', 'utf8');
      }
      const config = await loadConfig({ cwd: dir });
      const { zip, omittedAssets } = await exportComponentsBundle({ cwd: dir, config });
      expect(omittedAssets).toEqual([]);
      const assetPaths = readZipArchive(zip)
        .map((e) => e.path)
        .filter((p) => p.startsWith('assets/'))
        .sort();
      expect(assetPaths).toEqual(['assets/g(1).png', 'assets/g-1x.png', 'assets/g-2x.png']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('import refuses to skip through a symlink at the asset destination', async () => {
    const source = await makeAssetFixture('alpha');
    const dest = await makeFixture([]);
    try {
      const srcConfig = await loadConfig({ cwd: source });
      const { zip } = await exportComponentsBundle({ cwd: source, config: srcConfig });
      // Point the would-be asset path at a symlink to a precious file outside.
      await mkdir(join(dest, 'content/images'), { recursive: true });
      const outside = join(dest, 'precious.png');
      await writeFile(outside, 'PRECIOUS', 'utf8');
      await symlink(outside, join(dest, 'content/images/alpha-icon.svg'));
      const destConfig = await loadConfig({ cwd: dest });
      await expect(
        importComponentsBundle({ cwd: dest, config: destConfig, zip, onConflict: 'overwrite' }),
      ).rejects.toThrow(/symlink/);
      // The symlink target must be left untouched.
      expect(await readFile(outside, 'utf8')).toBe('PRECIOUS');
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });
});
