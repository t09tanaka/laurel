import { describe, expect, test } from 'bun:test';
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
