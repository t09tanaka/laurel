import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, rename as fsRename, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import {
  BUILD_MANIFEST_VERSION,
  type BuildManifestJson,
  buildManifestRelPath,
} from '~/build/build-manifest.ts';
import { build } from '~/build/pipeline.ts';

// Recursively list every file under `root` and return relative POSIX paths.
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs).split(sep).join('/'));
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function makeSite(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-determ-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });

  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Determ"',
      'url = "https://determ.test"',
      '',
      '[theme]',
      'dir = "themes"',
      'name = "source"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
      // search.json carries its own intentional `meta.generated_at` timestamp,
      // which is a separate determinism concern from glob iteration order.
      // Disable it here so the only timestamped file in the build is
      // build-manifest.json, which the test allow-lists explicitly.
      '[components.search]',
      'enabled = false',
      '',
    ].join('\n'),
    'utf8',
  );

  // Create posts in reverse-alphabetical order so any FS that preserves
  // creation order would otherwise yield a non-sorted scanGlob result, which
  // would leak into build-manifest's file list, route iteration, and the
  // theme.assets Map insertion order. Sorting inside scanGlob masks all of
  // that out and is what this test guards.
  for (const slug of ['zeta', 'mu', 'alpha']) {
    await writeFile(
      join(dir, `content/posts/${slug}.md`),
      `---\ntitle: "${slug}"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody of ${slug}.\n`,
      'utf8',
    );
  }
  await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');

  // Copy the vendored Source theme so the build can render templates and
  // exercise the theme.assets Map (fonts/CSS/JS) which is the other Map whose
  // insertion order used to follow filesystem order.
  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });

  return dir;
}

// Files whose contents legitimately differ between two runs (manifest carries a
// timestamp, incremental cache files mirror Date.now() in their payload). We
// still assert their existence in both runs; we just don't compare bytes.
const TIMESTAMPED_RELS = new Set<string>([buildManifestRelPath()]);

describe('reproducible build output', () => {
  test('two sequential builds of the same site produce byte-identical artefacts', async () => {
    const cwd = await makeSite();
    const distA = join(cwd, 'dist');
    const distB = join(cwd, 'dist-second');

    // First build into dist/.
    await build({ cwd });
    // Move dist/ aside, then run again into a fresh dist/. We move rather than
    // copy so the second build cannot re-use anything on disk and we are
    // comparing apples to apples.
    await rename(distA, distB);
    await build({ cwd });

    const filesA = await listFiles(distB);
    const filesB = await listFiles(distA);
    expect(filesA).toEqual(filesB);

    const mismatches: string[] = [];
    for (const rel of filesA) {
      if (TIMESTAMPED_RELS.has(rel)) continue;
      const hashA = sha256File(join(distB, rel));
      const hashB = sha256File(join(distA, rel));
      if (hashA !== hashB) mismatches.push(rel);
    }
    expect(mismatches).toEqual([]);
  });

  test('build-manifest files entries appear in lexicographic order and cover the same set across runs', async () => {
    const cwd = await makeSite();
    const distA = join(cwd, 'dist');
    const distB = join(cwd, 'dist-second');

    await build({ cwd });
    await rename(distA, distB);
    await build({ cwd });

    const manifestA = readManifest(join(distB, buildManifestRelPath()));
    const manifestB = readManifest(join(distA, buildManifestRelPath()));

    expect(manifestA.schema_version).toBe(BUILD_MANIFEST_VERSION);
    expect(manifestB.schema_version).toBe(BUILD_MANIFEST_VERSION);

    // Same file set, same per-file hashes — only generated_at may differ.
    const pathsA = manifestA.files.map((f) => f.path);
    const pathsB = manifestB.files.map((f) => f.path);
    expect(pathsA).toEqual(pathsB);
    expect(pathsA).toEqual([...pathsA].sort());

    const hashesA = manifestA.files.map((f) => f.hash);
    const hashesB = manifestB.files.map((f) => f.hash);
    expect(hashesA).toEqual(hashesB);
  });
});

function readManifest(path: string): BuildManifestJson {
  return JSON.parse(readFileSync(path, 'utf8')) as BuildManifestJson;
}

async function rename(from: string, to: string): Promise<void> {
  await fsRename(from, to);
}
