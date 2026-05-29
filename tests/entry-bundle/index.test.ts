import { describe, expect, test } from 'bun:test';
import { createZipArchive } from '~/cli/dashboard/zip-writer';
import { BUNDLE_SCHEMA, parseEntryBundleZip } from '~/entry-bundle/index';

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
