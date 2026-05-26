import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

// Mirrors the fixture builder in tests/build/incremental.test.ts so this file
// can run independently: spins up a tiny site against the vendored Source theme
// with RSS / sitemap / search disabled to keep the build fast.
async function makeMinimalSite(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-reuse-state-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });

  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Reuse Test"',
      'url = "https://reuse.test"',
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

async function snapshotHtml(outputDir: string): Promise<Record<string, string>> {
  const files = ['index.html', 'hello/index.html', 'world/index.html'];
  const out: Record<string, string> = {};
  for (const f of files) {
    out[f] = await readFile(join(outputDir, f), 'utf8');
  }
  return out;
}

describe('build() reuse + captureReusable', () => {
  test('captureReusable returns the loaded config and theme', async () => {
    const cwd = await makeMinimalSite();
    try {
      const summary = await build({ cwd, captureReusable: true });
      expect(summary.reusable).toBeDefined();
      expect(summary.reusable?.config.site.title).toBe('Reuse Test');
      expect(summary.reusable?.theme.name).toBe('source');
      // Reusable should be undefined by default — the one-shot CLI path does
      // not need to retain the bundle.
      const summary2 = await build({ cwd });
      expect(summary2.reusable).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('reusing config + theme produces byte-identical HTML for unchanged inputs', async () => {
    const cwd = await makeMinimalSite();
    try {
      const fresh = await build({ cwd, captureReusable: true });
      const baseline = await snapshotHtml(fresh.outputDir);
      if (fresh.reusable === undefined) throw new Error('expected reusable from first build');

      const reused = await build({
        cwd,
        captureReusable: true,
        reuse: { config: fresh.reusable.config, theme: fresh.reusable.theme },
      });
      const reusedHtml = await snapshotHtml(reused.outputDir);

      expect(reused.routeCount).toBe(fresh.routeCount);
      expect(reused.assetCount).toBe(fresh.assetCount);
      for (const [name, html] of Object.entries(baseline)) {
        expect(reusedHtml[name]).toBe(html);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('reusing only theme still rebuilds against the on-disk content', async () => {
    const cwd = await makeMinimalSite();
    try {
      const first = await build({ cwd, captureReusable: true });
      if (first.reusable === undefined) throw new Error('expected reusable from first build');

      // Edit a post on disk between builds; the reused theme must NOT shadow
      // the new content. (Theme has no dependency on content, so this should
      // round-trip cleanly.)
      await writeFile(
        join(cwd, 'content/posts/hello.md'),
        `---
title: "Hello Edited"
date: 2026-01-01T00:00:00Z
---

Hello body, edited
`,
        'utf8',
      );

      const second = await build({
        cwd,
        reuse: { theme: first.reusable.theme },
      });
      const helloHtml = await readFile(join(second.outputDir, 'hello/index.html'), 'utf8');
      expect(helloHtml).toContain('Hello Edited');
      expect(helloHtml).toContain('Hello body, edited');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
