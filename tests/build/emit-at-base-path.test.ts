import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { build } from '~/build/pipeline.ts';

// `build.emit_at_base_path` mirrors the public URL tree on disk: when base_path
// is a subpath, the entire output is nested under the base_path segment
// (dist/blog/...) so syncing the parent output_dir to a host yields keys that
// match the `/blog/...` URLs. HTML/asset/sitemap URLs are unchanged (they
// already carry base_path); only the write target moves. These tests build the
// example site against a temp tree and assert the on-disk layout.

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function makeSite(basePath: string, emitAtBasePath?: boolean): Promise<string> {
  const exampleDir = join(process.cwd(), 'example');
  const cwd = await mkdtemp(join(tmpdir(), 'laurel-emit-base-path-'));
  await cp(exampleDir, cwd, { recursive: true });
  const original = await readFile(join(exampleDir, 'laurel.toml'), 'utf8');
  // The example config pins `base_path = "/"` inside its single [build] table.
  // TOML forbids a duplicate [build] header, so rewrite that line in place
  // (and append emit_at_base_path right after it) rather than appending a
  // second table.
  let replacement = `base_path = "${basePath}"`;
  if (emitAtBasePath !== undefined) {
    replacement += `\nemit_at_base_path = ${emitAtBasePath}`;
  }
  const toml = original.replace('base_path = "/"', replacement);
  if (!toml.includes(replacement)) {
    throw new Error('example laurel.toml no longer contains the expected base_path line');
  }
  await writeFile(join(cwd, 'laurel.toml'), toml, 'utf8');
  // The committed example tree carries a prior `example/dist` build artifact;
  // `cp` brings it along, so clear it before building to assert layout from a
  // clean slate (otherwise a stale dist/index.html masks the emit location).
  await rm(join(cwd, 'dist'), { recursive: true, force: true });
  return cwd;
}

// Find root-absolute href/src references that do NOT carry the base_path
// prefix. Excludes protocol-relative (`//host`) and the base_path itself.
// A non-empty result means an asset/link would 404 once the tree moves under
// the base_path segment on disk.
function rootAbsoluteRefsMissingBasePath(html: string, basePath: string): string[] {
  const out: string[] = [];
  const re = /(?:href|src)="(\/[^"]*)"/g;
  for (const match of html.matchAll(re)) {
    const url = match[1];
    if (url === undefined) continue;
    if (url.startsWith('//')) continue; // protocol-relative, not internal
    if (url.startsWith(basePath)) continue;
    out.push(url);
  }
  return out;
}

describe('emit_at_base_path', () => {
  test('nests output under the base_path segment while keeping /blog/ URLs', async () => {
    const cwd = await makeSite('/blog/');
    try {
      const summary = await build({ cwd });
      // summary.outputDir is the actual emit dir: dist/blog.
      expect(basename(summary.outputDir)).toBe('blog');
      expect(await exists(join(summary.outputDir, 'index.html'))).toBe(true);
      expect(await exists(join(summary.outputDir, 'assets', 'built'))).toBe(true);
      // Nothing is left at the flat dist root.
      expect(await exists(join(cwd, 'dist', 'index.html'))).toBe(false);

      // In-HTML URLs are unchanged: still /blog/-prefixed, never bare.
      const indexHtml = await readFile(join(summary.outputDir, 'index.html'), 'utf8');
      expect(indexHtml).toContain('/blog/assets/');
      expect(rootAbsoluteRefsMissingBasePath(indexHtml, '/blog/')).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('defaults: linked to base_path when emit_at_base_path is unset', async () => {
    // base_path "/" -> no nesting even though unset.
    const rootCwd = await makeSite('/');
    try {
      const summary = await build({ cwd: rootCwd });
      expect(basename(summary.outputDir)).toBe('dist');
      expect(await exists(join(summary.outputDir, 'index.html'))).toBe(true);
    } finally {
      await rm(rootCwd, { recursive: true, force: true });
    }
  });

  test('explicit emit_at_base_path = false flattens output into output_dir', async () => {
    const cwd = await makeSite('/blog/', false);
    try {
      const summary = await build({ cwd });
      expect(basename(summary.outputDir)).toBe('dist');
      expect(await exists(join(summary.outputDir, 'index.html'))).toBe(true);
      // URLs still carry /blog/ even though the disk tree is flat.
      const indexHtml = await readFile(join(summary.outputDir, 'index.html'), 'utf8');
      expect(indexHtml).toContain('/blog/assets/');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('nested base_path mirrors the full segment on disk', async () => {
    const cwd = await makeSite('/ja/blog/');
    try {
      const summary = await build({ cwd });
      expect(summary.outputDir.endsWith(join('dist', 'ja', 'blog'))).toBe(true);
      expect(await exists(join(summary.outputDir, 'index.html'))).toBe(true);
      expect(await exists(join(cwd, 'dist', 'index.html'))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('rebuilding under a different base_path removes the orphaned previous tree', async () => {
    const cwd = await makeSite('/blog/');
    try {
      await build({ cwd, basePath: '/blog/' });
      expect(await exists(join(cwd, 'dist/blog/index.html'))).toBe(true);

      await build({ cwd, basePath: '/blog2/' });
      expect(await exists(join(cwd, 'dist/blog2/index.html'))).toBe(true);
      // The previous /blog/ subtree is an orphan once base_path changed; a plain
      // `aws s3 sync dist` would otherwise re-upload it, so it must be removed.
      expect(await exists(join(cwd, 'dist/blog'))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('switching from flat to nested removes the orphaned flat tree', async () => {
    const cwd = await makeSite('/');
    try {
      await build({ cwd });
      expect(await exists(join(cwd, 'dist/index.html'))).toBe(true);

      await build({ cwd, basePath: '/blog/' });
      expect(await exists(join(cwd, 'dist/blog/index.html'))).toBe(true);
      // Flat remnants under the output root must not survive the switch.
      expect(await exists(join(cwd, 'dist/index.html'))).toBe(false);
      expect(await exists(join(cwd, 'dist/assets'))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('switching from nested to flat removes the orphaned nested tree', async () => {
    const cwd = await makeSite('/blog/');
    try {
      await build({ cwd, basePath: '/blog/' });
      expect(await exists(join(cwd, 'dist/blog/index.html'))).toBe(true);

      await build({ cwd, basePath: '/' });
      expect(await exists(join(cwd, 'dist/index.html'))).toBe(true);
      expect(await exists(join(cwd, 'dist/blog'))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('emitAtBasePath BuildOptions override forces nesting on/off (CLI flag path)', async () => {
    // Mirrors `--emit-at-base-path` / `--no-emit-at-base-path`: the override
    // wins over the config-derived linkage.
    const forcedOn = await makeSite('/blog/', false);
    try {
      const summary = await build({ cwd: forcedOn, emitAtBasePath: true });
      expect(basename(summary.outputDir)).toBe('blog');
    } finally {
      await rm(forcedOn, { recursive: true, force: true });
    }

    const forcedOff = await makeSite('/blog/');
    try {
      const summary = await build({ cwd: forcedOff, emitAtBasePath: false });
      expect(basename(summary.outputDir)).toBe('dist');
    } finally {
      await rm(forcedOff, { recursive: true, force: true });
    }
  });
});
