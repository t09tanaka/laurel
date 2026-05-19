import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST_FILENAME, loadManifest, manifestPath } from '~/build/manifest.ts';
import { build } from '~/build/pipeline.ts';

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
});
