import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '~/build/pipeline.ts';

async function makeMinimalSite(opts: { dateValue: string }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-pipeline-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });

  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Strict Test"',
      'url = "https://strict.test"',
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
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(dir, 'content/posts/hello.md'),
    `---
title: "Hello"
date: ${opts.dateValue}
---

Body
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

  // Copy the vendored Source theme so the build can render templates.
  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });

  return dir;
}

describe('build pipeline strict mode wiring', () => {
  test('reports zero warnings for a clean build', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    expect(summary.warningCount).toBe(0);
  });

  test('reports warningCount > 0 when frontmatter date is invalid', async () => {
    const cwd = await makeMinimalSite({ dateValue: 'not-a-real-date' });
    const summary = await build({ cwd });
    expect(summary.warningCount).toBeGreaterThan(0);
  });

  test('emits dist/robots.txt with sitemap URL by default', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const body = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://strict.test/sitemap.xml');
  });
});

describe('build pipeline outputDir override', () => {
  test('writes into outputDir override instead of config.build.output_dir', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, outputDir: 'dist-preview' });
    expect(summary.outputDir).toBe(resolve(cwd, 'dist-preview'));
    expect(existsSync(join(summary.outputDir, 'index.html'))).toBe(true);
    expect(existsSync(join(cwd, 'dist'))).toBe(false);
  });

  test('rejects an absolute outputDir override', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    expect(build({ cwd, outputDir: '/tmp/escape' })).rejects.toThrow(/absolute path/);
  });

  test('rejects an outputDir override that escapes cwd', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    expect(build({ cwd, outputDir: '../escape' })).rejects.toThrow(/inside the project/);
  });
});

describe('build pipeline basePath override', () => {
  test('applies the override to asset URLs in the rendered HTML', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/preview' });
    const html = readFileSync(join(summary.outputDir, 'index.html'), 'utf8');
    expect(html).toContain('/preview/assets/');
    expect(html).not.toContain('"/assets/');
  });

  test('writes _redirects entries prefixed with the overridden base path', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    const redirects = readFileSync(join(summary.outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain('/blog/ghost/api/content/posts/');
  });

  test('normalises a missing trailing slash', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/repo' });
    const html = readFileSync(join(summary.outputDir, 'index.html'), 'utf8');
    expect(html).toContain('/repo/assets/');
  });

  test('rejects an empty base path', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    expect(build({ cwd, basePath: '' })).rejects.toThrow(/must not be empty/);
  });
});
