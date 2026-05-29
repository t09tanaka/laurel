import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZipArchive } from '~/cli/dashboard/zip-writer';
import { loadConfig } from '~/config/loader';
import { BUNDLE_SCHEMA, exportEntryBundle, parseEntryBundleZip } from '~/entry-bundle/index';
import { readZipArchive } from '~/entry-bundle/zip';

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-entry-bundle-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Bundle Site"', 'url = "https://bundle.test"', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    ['---', 'title: Hello', 'slug: hello', 'status: draft', '---', '', 'Body text.', ''].join('\n'),
    'utf8',
  );
  return dir;
}

function rawEntryMd(zip: Uint8Array): string {
  const entries = readZipArchive(zip);
  const entry = entries.find((e) => e.path === 'entry.md');
  if (!entry) throw new Error('entry.md missing from zip');
  return new TextDecoder().decode(entry.bytes);
}

function hasManifest(zip: Uint8Array): boolean {
  return readZipArchive(zip).some((e) => e.path === 'nectar-bundle.json');
}

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function manifestEntry(overrides: Record<string, unknown> = {}): Uint8Array {
  return bytes(
    JSON.stringify({
      schema: BUNDLE_SCHEMA,
      kind: 'post',
      slug: 'hello',
      path: 'content/posts/hello.md',
      ...overrides,
    }),
  );
}

const ENTRY_MD = bytes('---\ntitle: Hello\nstatus: draft\n---\n\nBody text.\n');

describe('parseEntryBundleZip', () => {
  test('parses a valid post bundle', () => {
    const zip = createZipArchive([
      { path: 'nectar-bundle.json', bytes: manifestEntry() },
      { path: 'entry.md', bytes: ENTRY_MD },
      { path: 'assets/images/a.png', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const parsed = parseEntryBundleZip(zip);
    expect(parsed.kind).toBe('post');
    expect(parsed.slug).toBe('hello');
    expect(parsed.frontmatter.status).toBe('draft');
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]?.path).toBe('assets/images/a.png');
  });

  test('throws when manifest is missing', () => {
    const zip = createZipArchive([{ path: 'entry.md', bytes: ENTRY_MD }]);
    expect(() => parseEntryBundleZip(zip)).toThrow(/manifest/i);
  });

  test('throws on a zip-slip asset path', () => {
    const zip = createZipArchive([
      { path: 'nectar-bundle.json', bytes: manifestEntry() },
      { path: 'entry.md', bytes: ENTRY_MD },
      { path: 'assets/../../etc/evil', bytes: new Uint8Array([0]) },
    ]);
    expect(() => parseEntryBundleZip(zip)).toThrow(/path/i);
  });

  test('throws on an unknown schema', () => {
    const zip = createZipArchive([
      { path: 'nectar-bundle.json', bytes: manifestEntry({ schema: 'nectar.page.v1' }) },
      { path: 'entry.md', bytes: ENTRY_MD },
    ]);
    expect(() => parseEntryBundleZip(zip)).toThrow(/schema/i);
  });
});

describe('exportEntryBundle', () => {
  test('stamps needs-review and includes a manifest', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      expect(rawEntryMd(zip)).toMatch(/status:\s*needs-review/);
      expect(hasManifest(zip)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
