import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZipArchive } from '~/cli/dashboard/zip-writer';
import { loadConfig } from '~/config/loader';
import {
  BUNDLE_SCHEMA,
  exportEntryBundle,
  importEntryBundle,
  parseEntryBundleZip,
} from '~/entry-bundle/index';
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
    expect(parsed.assets[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
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
  test('carries the entry status as-is and includes a manifest', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      // Neutral transport: the fixture is a draft, so the bundle stays a draft
      // (no needs-review stamping).
      expect(rawEntryMd(zip)).toMatch(/status:\s*draft/);
      expect(rawEntryMd(zip)).not.toMatch(/status:\s*needs-review/);
      expect(hasManifest(zip)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export does not stamp status, but import forces needs-review', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        ['---', 'title: Hello', 'slug: hello', 'status: published', '---', '', 'Body.', ''].join(
          '\n',
        ),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      // Export carries the source status as-is (no stamping)…
      expect(rawEntryMd(zip)).toMatch(/status:\s*published/);
      // …but importing always lands the entry as needs-review.
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'overwrite' });
      expect(result.written).toBe(true);
      const landed = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(landed).toMatch(/status:\s*needs-review/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('records missing referenced assets in omittedAssets and omits them from the zip', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/withimg.md'),
        [
          '---',
          'title: With Image',
          'slug: withimg',
          'feature_image: /content/images/missing.png',
          '---',
          '',
          'Body.',
          '',
        ].join('\n'),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip, omittedAssets } = await exportEntryBundle({
        cwd: dir,
        config,
        kind: 'post',
        slug: 'withimg',
      });
      expect(omittedAssets).toContain('missing.png');
      const paths = readZipArchive(zip).map((e) => e.path);
      expect(paths.some((p) => p.includes('missing.png'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('importEntryBundle', () => {
  test('overwrites a pre-existing post and lands needs-review', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'overwrite' });
      expect(result.written).toBe(true);
      expect(result.preview.title).toBe('Hello');
      const landed = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(landed).toMatch(/status:\s*needs-review/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dryRun writes nothing', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      const before = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      const result = await importEntryBundle({
        cwd: dir,
        config,
        zip,
        onConflict: 'overwrite',
        dryRun: true,
      });
      expect(result.written).toBe(false);
      const after = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('renames to a new slug on collision', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'rename' });
      expect(result.renamed).toBe(true);
      expect(result.written).toBe(true);
      expect(result.slug).toBe('hello-2');
      const renamed = await readFile(join(dir, 'content/posts/hello-2.md'), 'utf8');
      expect(renamed).toMatch(/status:\s*needs-review/);
      // The original is left untouched.
      const original = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(original).toMatch(/status:\s*draft/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('skips when a post already exists and onConflict is skip', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'skip' });
      expect(result.written).toBe(false);
      expect(result.skipped).toBe(true);
      const original = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(original).toMatch(/status:\s*draft/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dryRun returns a conflict diff when the slug collides', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const zip = createZipArchive([
        { path: 'nectar-bundle.json', bytes: manifestEntry() },
        {
          path: 'entry.md',
          bytes: bytes(
            '---\ntitle: Hello (edited)\nslug: hello\nstatus: approved\n---\n\nNew body text.\n',
          ),
        },
      ]);
      const result = await importEntryBundle({
        cwd: dir,
        config,
        zip,
        onConflict: 'skip',
        dryRun: true,
      });
      expect(result.conflict).toBeDefined();
      // existing reflects the on-disk draft; incoming is what overwrite would write.
      expect(result.conflict?.existing).toMatch(/title: Hello\b/);
      expect(result.conflict?.existing).toMatch(/Body text\./);
      expect(result.conflict?.incoming).toMatch(/title: Hello \(edited\)/);
      expect(result.conflict?.incoming).toMatch(/status: needs-review/);
      expect(result.conflict?.incoming).toMatch(/New body text\./);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('omits conflict when the slug does not collide', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const zip = createZipArchive([
        { path: 'nectar-bundle.json', bytes: manifestEntry({ slug: 'fresh' }) },
        { path: 'entry.md', bytes: bytes('---\ntitle: Fresh\nslug: fresh\n---\n\nBrand new.\n') },
      ]);
      const result = await importEntryBundle({
        cwd: dir,
        config,
        zip,
        onConflict: 'skip',
        dryRun: true,
      });
      expect(result.conflict).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  function mergeZip(): Uint8Array {
    return createZipArchive([
      { path: 'nectar-bundle.json', bytes: manifestEntry() },
      {
        path: 'entry.md',
        bytes: bytes('---\ntitle: Incoming\nslug: hello\n---\n\nIncoming body.\n'),
      },
    ]);
  }

  test('writes a mergedEntry instead of the bundle entry, keeping its chosen status', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const merged = '---\nslug: hello\nstatus: draft\ntitle: Merged Title\n---\n\nMerged body.\n';
      const result = await importEntryBundle({
        cwd: dir,
        config,
        zip: mergeZip(),
        onConflict: 'overwrite',
        mergedEntry: merged,
      });
      expect(result.written).toBe(true);
      const landed = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(landed).toMatch(/title: Merged Title/);
      expect(landed).toMatch(/Merged body\./);
      // The merge is authoritative for status: no forced needs-review here.
      expect(landed).toMatch(/status: draft/);
      expect(landed).not.toMatch(/Incoming body\./);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('re-pins the slug in a mergedEntry to the target filename', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      // A merge that smuggles a different slug must not desync filename/content.
      const merged = '---\nslug: somewhere-else\ntitle: Merged\n---\n\nBody.\n';
      await importEntryBundle({
        cwd: dir,
        config,
        zip: mergeZip(),
        onConflict: 'overwrite',
        mergedEntry: merged,
      });
      const landed = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(landed).toMatch(/slug: hello/);
      expect(landed).not.toMatch(/somewhere-else/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a mergedEntry when not overwriting a real collision', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const zip = createZipArchive([
        { path: 'nectar-bundle.json', bytes: manifestEntry({ slug: 'fresh' }) },
        { path: 'entry.md', bytes: bytes('---\ntitle: Fresh\nslug: fresh\n---\n\nNew.\n') },
      ]);
      await expect(
        importEntryBundle({
          cwd: dir,
          config,
          zip,
          onConflict: 'overwrite',
          mergedEntry: '---\nslug: fresh\n---\n\nInjected.\n',
        }),
      ).rejects.toThrow(/overwriting an existing entry/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a stale mergedEntry when the file changed since the diff', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const merged = '---\nslug: hello\ntitle: Merged\n---\n\nMerged body.\n';
      await expect(
        importEntryBundle({
          cwd: dir,
          config,
          zip: mergeZip(),
          onConflict: 'overwrite',
          mergedEntry: merged,
          // A base that does not match the on-disk file (the fixture is a draft).
          expectedExisting: '---\nslug: hello\ntitle: Something Else\n---\n\nDifferent.\n',
        }),
      ).rejects.toThrow(/changed since the diff was opened/);
      // The original file is left untouched.
      const original = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(original).toMatch(/title: Hello/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('applies a mergedEntry when expectedExisting matches the current file', async () => {
    const dir = await makeFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      // Probe first to get the normalized base the dashboard would diff against.
      const probe = await importEntryBundle({
        cwd: dir,
        config,
        zip: mergeZip(),
        onConflict: 'skip',
        dryRun: true,
      });
      expect(probe.conflict).toBeDefined();
      const merged = '---\nslug: hello\ntitle: Merged\n---\n\nMerged body.\n';
      const result = await importEntryBundle({
        cwd: dir,
        config,
        zip: mergeZip(),
        onConflict: 'overwrite',
        mergedEntry: merged,
        expectedExisting: probe.conflict?.existing,
      });
      expect(result.written).toBe(true);
      const landed = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(landed).toMatch(/title: Merged/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('routes a page bundle through pages_dir on export and import', async () => {
    const dir = await makeFixture();
    try {
      await mkdir(join(dir, 'content/pages'), { recursive: true });
      await writeFile(
        join(dir, 'content/pages/about.md'),
        ['---', 'title: About', 'slug: about', 'status: draft', '---', '', 'About body.', ''].join(
          '\n',
        ),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'page', slug: 'about' });
      const parsed = parseEntryBundleZip(zip);
      expect(parsed.kind).toBe('page');

      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'overwrite' });
      expect(result.kind).toBe('page');
      expect(result.written).toBe(true);
      const landed = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
      expect(landed).toMatch(/status:\s*needs-review/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Builds a fixture whose post references a `release` tag that has a rich
// definition file (name, description, feature image) plus the image asset.
async function makeTaggedFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-entry-bundle-tags-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Bundle Site"', 'url = "https://bundle.test"', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    [
      '---',
      'title: Hello',
      'slug: hello',
      'status: draft',
      'tags: [release]',
      'primary_tag: release',
      '---',
      '',
      'Body text.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/tags/release.md'),
    [
      '---',
      'slug: release',
      'name: "Release Notes"',
      'description: "What shipped."',
      'feature_image: "/content/images/release.svg"',
      '---',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'content/images/release.svg'), '<svg/>', 'utf8');
  return dir;
}

describe('entry bundle tag handoff', () => {
  test('export carries referenced tag definitions and their assets', async () => {
    const dir = await makeTaggedFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip, bundledTags } = await exportEntryBundle({
        cwd: dir,
        config,
        kind: 'post',
        slug: 'hello',
      });
      expect(bundledTags).toEqual(['release']);
      const paths = readZipArchive(zip).map((e) => e.path);
      expect(paths).toContain('tags/release.md');
      expect(paths).toContain('assets/release.svg');
      const parsed = parseEntryBundleZip(zip);
      expect(parsed.tags).toHaveLength(1);
      expect(parsed.tags[0]?.slug).toBe('release');
      expect(parsed.tags[0]?.frontmatter.name).toBe('Release Notes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('import creates a missing tag definition with metadata intact', async () => {
    const src = await makeTaggedFixture();
    const dest = await makeFixture();
    try {
      const srcConfig = await loadConfig({ cwd: src });
      const { zip } = await exportEntryBundle({
        cwd: src,
        config: srcConfig,
        kind: 'post',
        slug: 'hello',
      });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importEntryBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
      });
      expect(result.importedTags).toEqual(['release']);
      const tagFile = await readFile(join(dest, 'content/tags/release.md'), 'utf8');
      expect(tagFile).toContain('Release Notes');
      expect(tagFile).toContain('What shipped.');
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('import never overwrites an existing tag definition', async () => {
    const src = await makeTaggedFixture();
    const dest = await makeTaggedFixture();
    try {
      // Give the destination its own customised `release` tag.
      await writeFile(
        join(dest, 'content/tags/release.md'),
        ['---', 'slug: release', 'name: "Local Release"', '---', ''].join('\n'),
        'utf8',
      );
      const srcConfig = await loadConfig({ cwd: src });
      const { zip } = await exportEntryBundle({
        cwd: src,
        config: srcConfig,
        kind: 'post',
        slug: 'hello',
      });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importEntryBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
      });
      expect(result.importedTags).toEqual([]);
      const tagFile = await readFile(join(dest, 'content/tags/release.md'), 'utf8');
      expect(tagFile).toContain('Local Release');
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('dryRun reports tags that would be created without writing them', async () => {
    const src = await makeTaggedFixture();
    const dest = await makeFixture();
    try {
      const srcConfig = await loadConfig({ cwd: src });
      const { zip } = await exportEntryBundle({
        cwd: src,
        config: srcConfig,
        kind: 'post',
        slug: 'hello',
      });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importEntryBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
        dryRun: true,
      });
      expect(result.importedTags).toEqual(['release']);
      expect(result.preview.tagCount).toBe(1);
      await expect(readFile(join(dest, 'content/tags/release.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('warns when a referenced tag has no bundled definition', async () => {
    const dir = await makeFixture();
    try {
      // Post references a tag with no definition file anywhere.
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        ['---', 'title: Hello', 'slug: hello', 'tags: [ghost-tag]', '---', '', 'Body.', ''].join(
          '\n',
        ),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip, bundledTags } = await exportEntryBundle({
        cwd: dir,
        config,
        kind: 'post',
        slug: 'hello',
      });
      expect(bundledTags).toEqual([]);
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'overwrite' });
      expect(result.importedTags).toEqual([]);
      expect(result.warnings.some((w) => w.includes('ghost-tag'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('parseEntryBundleZip rejects a traversing tag path', () => {
    const zip = createZipArchive([
      { path: 'nectar-bundle.json', bytes: manifestEntry() },
      { path: 'entry.md', bytes: ENTRY_MD },
      { path: 'tags/../evil.md', bytes: bytes('---\nslug: evil\n---\n') },
    ]);
    expect(() => parseEntryBundleZip(zip)).toThrow(/tag path/i);
  });
});

// Builds a fixture whose post is authored by `casper`, who has a rich author
// definition file (name, bio, profile image) plus the image asset.
async function makeAuthoredFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-entry-bundle-authors-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Bundle Site"', 'url = "https://bundle.test"', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    [
      '---',
      'title: Hello',
      'slug: hello',
      'status: draft',
      'authors: [casper]',
      '---',
      '',
      'Body text.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/authors/casper.md'),
    [
      '---',
      'slug: casper',
      'name: "Casper"',
      'bio: "Friendly mascot."',
      'profile_image: "/content/images/casper.svg"',
      '---',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'content/images/casper.svg'), '<svg/>', 'utf8');
  return dir;
}

describe('entry bundle author handoff', () => {
  test('export carries referenced author definitions and their assets', async () => {
    const dir = await makeAuthoredFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const { zip, bundledAuthors } = await exportEntryBundle({
        cwd: dir,
        config,
        kind: 'post',
        slug: 'hello',
      });
      expect(bundledAuthors).toEqual(['casper']);
      const paths = readZipArchive(zip).map((e) => e.path);
      expect(paths).toContain('authors/casper.md');
      expect(paths).toContain('assets/casper.svg');
      const parsed = parseEntryBundleZip(zip);
      expect(parsed.authors).toHaveLength(1);
      expect(parsed.authors[0]?.slug).toBe('casper');
      expect(parsed.authors[0]?.frontmatter.name).toBe('Casper');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('import creates a missing author definition with metadata intact', async () => {
    const src = await makeAuthoredFixture();
    const dest = await makeFixture();
    try {
      const srcConfig = await loadConfig({ cwd: src });
      const { zip } = await exportEntryBundle({
        cwd: src,
        config: srcConfig,
        kind: 'post',
        slug: 'hello',
      });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importEntryBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
      });
      expect(result.importedAuthors).toEqual(['casper']);
      const authorFile = await readFile(join(dest, 'content/authors/casper.md'), 'utf8');
      expect(authorFile).toContain('Casper');
      expect(authorFile).toContain('Friendly mascot.');
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('import never overwrites an existing author definition', async () => {
    const src = await makeAuthoredFixture();
    const dest = await makeAuthoredFixture();
    try {
      // Give the destination its own customised `casper` author.
      await writeFile(
        join(dest, 'content/authors/casper.md'),
        ['---', 'slug: casper', 'name: "Local Casper"', '---', ''].join('\n'),
        'utf8',
      );
      const srcConfig = await loadConfig({ cwd: src });
      const { zip } = await exportEntryBundle({
        cwd: src,
        config: srcConfig,
        kind: 'post',
        slug: 'hello',
      });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importEntryBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
      });
      expect(result.importedAuthors).toEqual([]);
      const authorFile = await readFile(join(dest, 'content/authors/casper.md'), 'utf8');
      expect(authorFile).toContain('Local Casper');
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('dryRun reports authors that would be created without writing them', async () => {
    const src = await makeAuthoredFixture();
    const dest = await makeFixture();
    try {
      const srcConfig = await loadConfig({ cwd: src });
      const { zip } = await exportEntryBundle({
        cwd: src,
        config: srcConfig,
        kind: 'post',
        slug: 'hello',
      });
      const destConfig = await loadConfig({ cwd: dest });
      const result = await importEntryBundle({
        cwd: dest,
        config: destConfig,
        zip,
        onConflict: 'overwrite',
        dryRun: true,
      });
      expect(result.importedAuthors).toEqual(['casper']);
      expect(result.preview.authorCount).toBe(1);
      await expect(readFile(join(dest, 'content/authors/casper.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    }
  });

  test('warns when a referenced author has no bundled definition', async () => {
    const dir = await makeFixture();
    try {
      // Post references an author with no definition file anywhere.
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        ['---', 'title: Hello', 'slug: hello', 'authors: [ghost]', '---', '', 'Body.', ''].join(
          '\n',
        ),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip, bundledAuthors } = await exportEntryBundle({
        cwd: dir,
        config,
        kind: 'post',
        slug: 'hello',
      });
      expect(bundledAuthors).toEqual([]);
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'overwrite' });
      expect(result.importedAuthors).toEqual([]);
      expect(result.warnings.some((w) => w.includes('ghost'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('parseEntryBundleZip rejects a traversing author path', () => {
    const zip = createZipArchive([
      { path: 'nectar-bundle.json', bytes: manifestEntry() },
      { path: 'entry.md', bytes: ENTRY_MD },
      { path: 'authors/../evil.md', bytes: bytes('---\nslug: evil\n---\n') },
    ]);
    expect(() => parseEntryBundleZip(zip)).toThrow(/author path/i);
  });

  test('export carries an author referenced only via primary_author', async () => {
    const dir = await makeAuthoredFixture();
    try {
      // Reference casper through primary_author alone (no authors/author list).
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        [
          '---',
          'title: Hello',
          'slug: hello',
          'status: draft',
          'primary_author: casper',
          '---',
          '',
          'Body text.',
          '',
        ].join('\n'),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip, bundledAuthors } = await exportEntryBundle({
        cwd: dir,
        config,
        kind: 'post',
        slug: 'hello',
      });
      expect(bundledAuthors).toEqual(['casper']);
      expect(parseEntryBundleZip(zip).authors[0]?.slug).toBe('casper');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('warns once when a primary_author has no bundled definition', async () => {
    const dir = await makeFixture();
    try {
      // Reference the same missing author twice (authors + primary_author).
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        [
          '---',
          'title: Hello',
          'slug: hello',
          'authors: [ghost]',
          'primary_author: ghost',
          '---',
          '',
          'Body.',
          '',
        ].join('\n'),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const { zip } = await exportEntryBundle({ cwd: dir, config, kind: 'post', slug: 'hello' });
      const result = await importEntryBundle({ cwd: dir, config, zip, onConflict: 'overwrite' });
      const ghostWarnings = result.warnings.filter((w) => w.includes('ghost'));
      expect(ghostWarnings).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
