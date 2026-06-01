import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDashboardBundleInMemory,
  bundleSourceIsNewer,
  dashboardSourceBuildContext,
  maxMtimeMsUnder,
  maybeAutoBuildDashboardBundle,
} from '~/cli/dashboard/source-bundle.ts';

const tmps: string[] = [];
async function makeBase(opts: { tailwind: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nectar-srcbundle-'));
  tmps.push(root);
  // baseDir is <root>/src/cli/dashboard so tailwindBin resolves to <root>/node_modules/.bin
  const base = join(root, 'src', 'cli', 'dashboard');
  await mkdir(join(base, 'web'), { recursive: true });
  await writeFile(join(base, 'web', 'entry.tsx'), 'export {};\n', 'utf8');
  await writeFile(join(base, 'web', 'styles.css'), '/* css */\n', 'utf8');
  await writeFile(join(base, 'bundled-assets.ts'), '// generated\n', 'utf8');
  if (opts.tailwind) {
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    // Executable stub that exits non-zero so buildDashboardBundleInMemory hits
    // the "CSS build failed" throw deterministically (rather than relying on an
    // EACCES spawn error from a non-executable file).
    await writeFile(join(root, 'node_modules', '.bin', 'tailwindcss'), '#!/bin/sh\nexit 1\n', {
      encoding: 'utf8',
      mode: 0o755,
    });
  }
  return base;
}

afterEach(async () => {
  for (const t of tmps.splice(0)) await rm(t, { recursive: true, force: true });
});

describe('dashboardSourceBuildContext', () => {
  test('returns a context when entry, styles, and tailwind are present', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    expect(ctx?.entry).toBe(join(base, 'web', 'entry.tsx'));
  });

  test('returns null when tailwind binary is absent', async () => {
    const base = await makeBase({ tailwind: false });
    expect(dashboardSourceBuildContext(base)).toBeNull();
  });
});

describe('mtime staleness', () => {
  test('bundleSourceIsNewer is true when a web file is newer than the embedded bundle', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    await utimes(ctx.bundledAssetsPath, new Date(1000), new Date(1000));
    await utimes(ctx.entry, new Date(5000), new Date(5000));
    expect(await bundleSourceIsNewer(ctx)).toBe(true);
  });

  test('bundleSourceIsNewer is false when the embedded bundle is newest', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    await utimes(ctx.entry, new Date(1000), new Date(1000));
    await utimes(join(ctx.webDir, 'styles.css'), new Date(1000), new Date(1000));
    await utimes(ctx.bundledAssetsPath, new Date(9000), new Date(9000));
    expect(await bundleSourceIsNewer(ctx)).toBe(false);
  });

  test('maxMtimeMsUnder returns 0 for a missing directory', async () => {
    expect(await maxMtimeMsUnder(join(tmpdir(), 'nectar-does-not-exist-xyz'))).toBe(0);
  });
});

describe('buildDashboardBundleInMemory (real repo source)', () => {
  test('builds non-empty JS and CSS from the actual dashboard source', async () => {
    const ctx = dashboardSourceBuildContext();
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    const assets = await buildDashboardBundleInMemory(ctx);
    expect(assets['/assets/dashboard.js']?.body.length ?? 0).toBeGreaterThan(0);
    expect(assets['/assets/dashboard.js']?.contentType).toContain('javascript');
    expect(assets['/assets/dashboard.css']?.body.length ?? 0).toBeGreaterThan(0);
    expect(assets['/assets/dashboard.css']?.contentType).toContain('css');
  }, 60_000);
});

describe('maybeAutoBuildDashboardBundle', () => {
  test('reports unavailable and skips building when --no-build is set', async () => {
    const result = await maybeAutoBuildDashboardBundle({ noBuild: true });
    expect(result.status).toBe('unavailable');
    expect(result.assets).toBeUndefined();
  });

  test('reports unavailable when there is no source context', async () => {
    const base = await makeBase({ tailwind: false });
    const result = await maybeAutoBuildDashboardBundle({ baseDir: base });
    expect(result.status).toBe('unavailable');
  });

  test('reports failed (not throw) when the tailwind binary is bogus', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    await utimes(ctx.bundledAssetsPath, new Date(1000), new Date(1000));
    await utimes(ctx.entry, new Date(5000), new Date(5000));
    const result = await maybeAutoBuildDashboardBundle({ baseDir: base });
    expect(result.status).toBe('failed');
    expect(result.assets).toBeUndefined();
  }, 60_000);
});
