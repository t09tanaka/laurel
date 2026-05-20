import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_FILENAME, loadManifest, manifestPath } from '~/build/manifest.ts';
import { build } from '~/build/pipeline.ts';
import type { BuildStats } from '~/build/profile.ts';

async function makeMinimalSite(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-incremental-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });

  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Incremental Test"',
      'url = "https://incr.test"',
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
      '[components.search]',
      'enabled = false',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(dir, 'content/posts/hello.md'),
    `---
title: "Hello"
date: 2026-01-01T00:00:00Z
---

Hello body
`,
    'utf8',
  );

  await writeFile(
    join(dir, 'content/posts/world.md'),
    `---
title: "World"
date: 2026-01-02T00:00:00Z
---

World body
`,
    'utf8',
  );

  await writeFile(
    join(dir, 'content/authors/casper.md'),
    `---
name: Casper
---
`,
    'utf8',
  );

  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });

  return dir;
}

describe('incremental build', () => {
  test('first build renders every route, second build skips them all', async () => {
    const cwd = await makeMinimalSite();
    const first = await build({ cwd });
    expect(first.routeCount).toBeGreaterThan(0);
    expect(first.renderedCount).toBe(first.routeCount);
    expect(first.skippedCount).toBe(0);

    const manifest = await loadManifest(first.outputDir);
    if (!manifest) throw new Error('expected manifest to be written');
    expect(Object.keys(manifest.routes).length).toBe(first.routeCount);

    const second = await build({ cwd });
    expect(second.routeCount).toBe(first.routeCount);
    expect(second.skippedCount).toBe(first.routeCount);
    expect(second.renderedCount).toBe(0);

    await rm(cwd, { recursive: true, force: true });
  });

  test('editing one post re-renders only that post', async () => {
    const cwd = await makeMinimalSite();
    const first = await build({ cwd });
    expect(first.renderedCount).toBe(first.routeCount);

    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: "Hello"
date: 2026-01-01T00:00:00Z
---

Hello body, edited
`,
      'utf8',
    );

    const second = await build({ cwd });
    // The edited post invalidates its own route plus any route whose payload
    // embedded the post (home/index pages and tag/author archives that list
    // it). Other routes should still be skipped.
    expect(second.renderedCount).toBeGreaterThanOrEqual(1);
    expect(second.renderedCount).toBeLessThan(first.routeCount);
    expect(second.skippedCount).toBeGreaterThan(0);
    expect(second.skippedCount + second.renderedCount).toBe(second.routeCount);

    const helloHtml = readFileSync(join(second.outputDir, 'hello/index.html'), 'utf8');
    expect(helloHtml).toContain('Hello body, edited');

    await rm(cwd, { recursive: true, force: true });
  });

  test('missing output file forces re-render even when hash matches', async () => {
    const cwd = await makeMinimalSite();
    const first = await build({ cwd });

    const manifest = await loadManifest(first.outputDir);
    if (!manifest) throw new Error('expected manifest after first build');
    const entry = manifest.routes['/hello/'];
    if (!entry) throw new Error('expected /hello/ in manifest');

    await rm(join(first.outputDir, entry.outputPath), { force: true });

    const second = await build({ cwd });
    expect(second.routeCount).toBe(first.routeCount);
    expect(second.renderedCount).toBeGreaterThanOrEqual(1);
    expect(second.skippedCount).toBe(first.routeCount - second.renderedCount);
    expect(existsSync(join(second.outputDir, entry.outputPath))).toBe(true);

    await rm(cwd, { recursive: true, force: true });
  });

  test('tampered manifest hash forces a re-render of that route', async () => {
    const cwd = await makeMinimalSite();
    const first = await build({ cwd });

    const manifest = await loadManifest(first.outputDir);
    if (!manifest) throw new Error('expected manifest after first build');
    const entry = manifest.routes['/world/'];
    if (!entry) throw new Error('expected /world/ in manifest');

    await Bun.write(
      manifestPath(first.outputDir),
      JSON.stringify({
        ...manifest,
        routes: {
          ...manifest.routes,
          '/world/': { ...entry, hash: 'stale-hash' },
        },
      }),
    );

    const second = await build({ cwd });
    expect(second.renderedCount).toBeGreaterThanOrEqual(1);
    expect(second.skippedCount).toBeLessThan(first.routeCount);

    await rm(cwd, { recursive: true, force: true });
  });

  test('manifest file is emitted into the output directory', async () => {
    const cwd = await makeMinimalSite();
    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, MANIFEST_FILENAME))).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });

  test('--force re-renders every route even when nothing changed', async () => {
    const cwd = await makeMinimalSite();
    const first = await build({ cwd });
    expect(first.renderedCount).toBe(first.routeCount);

    // Sanity: a follow-up build with no changes skips every route.
    const incremental = await build({ cwd });
    expect(incremental.skippedCount).toBe(first.routeCount);
    expect(incremental.renderedCount).toBe(0);

    // Forced build ignores the manifest and rebuilds the whole tree.
    const forced = await build({ cwd, force: true });
    expect(forced.routeCount).toBe(first.routeCount);
    expect(forced.renderedCount).toBe(first.routeCount);
    expect(forced.skippedCount).toBe(0);

    // The manifest is re-emitted so the next non-force build can resume
    // incremental skipping.
    const manifest = await loadManifest(forced.outputDir);
    if (!manifest) throw new Error('expected manifest after forced build');
    expect(Object.keys(manifest.routes).length).toBe(forced.routeCount);

    const afterForce = await build({ cwd });
    expect(afterForce.skippedCount).toBe(first.routeCount);
    expect(afterForce.renderedCount).toBe(0);

    await rm(cwd, { recursive: true, force: true });
  });

  test('reuses unchanged route HTML and records route fingerprints', async () => {
    const cwd = await makeMinimalSite();
    await build({ cwd, profile: true });
    const worldHtml = join(cwd, 'dist/world/index.html');
    const before = (await stat(worldHtml)).mtimeMs;

    const summary = await build({ cwd, profile: true });
    const after = (await stat(worldHtml)).mtimeMs;
    const stats = await readBuildStats(cwd);
    const worldRoute = stats.routes.find((route) => route.url === '/world/');
    const buildManifest = await Bun.file(join(cwd, 'dist/.nectar/build-manifest.json')).json();
    const routeManifest = buildManifest.routes.find(
      (route: { url: string }) => route.url === '/world/',
    );
    const routeThemeFingerprint = routeManifest.theme_fingerprint;
    const routeContentFingerprint = routeManifest.content_fingerprint;

    expect(summary.skippedCount).toBeGreaterThan(0);
    expect(worldRoute?.reused).toBeTrue();
    expect(after).toBe(before);
    expect(routeManifest).toMatchObject({
      url: '/world/',
      output_path: 'world/index.html',
      reused: true,
      route_fingerprint: expect.any(String),
      content_fingerprint: expect.any(String),
      theme_fingerprint: expect.any(String),
    });
    expect(routeManifest.content_inputs).toContainEqual(
      expect.objectContaining({
        kind: 'post',
        id: 'post-world',
        path: 'world.md',
        mtimeMs: expect.any(Number),
      }),
    );

    const cache = await Bun.file(join(cwd, 'dist/.nectar-manifest.json')).json();
    expect(cache.themeFingerprint).toBe(routeThemeFingerprint);
    expect(cache.routes['/world/'].contentFingerprint).toBe(routeContentFingerprint);

    await rm(cwd, { recursive: true, force: true });
  });

  test('invalidates only routes whose content fingerprint changes', async () => {
    const cwd = await makeMinimalSite();
    await build({ cwd, profile: true });
    const previous = await Bun.file(join(cwd, 'dist/.nectar-manifest.json')).json();

    await Bun.sleep(20);
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: "Hello"
date: 2026-01-01T00:00:00Z
---

Hello body, edited for fingerprint invalidation
`,
      'utf8',
    );

    await build({ cwd, profile: true });
    const stats = await readBuildStats(cwd);
    const current = await Bun.file(join(cwd, 'dist/.nectar-manifest.json')).json();

    expect(stats.routes.find((route) => route.url === '/hello/')?.reused).toBeFalse();
    expect(stats.routes.find((route) => route.url === '/world/')?.reused).toBeTrue();
    expect(current.routes['/hello/'].contentFingerprint).not.toBe(
      previous.routes['/hello/'].contentFingerprint,
    );
    expect(current.routes['/world/'].contentFingerprint).toBe(
      previous.routes['/world/'].contentFingerprint,
    );

    await rm(cwd, { recursive: true, force: true });
  });
});

async function readBuildStats(cwd: string): Promise<BuildStats> {
  return JSON.parse(await readFile(join(cwd, 'dist/.nectar-build-stats.json'), 'utf8'));
}
