import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

  test('emits zero-byte dist/.nojekyll for GitHub Pages compatibility', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const nojekyll = join(summary.outputDir, '.nojekyll');
    expect(existsSync(nojekyll)).toBe(true);
    expect(readFileSync(nojekyll, 'utf8')).toBe('');
  });

  test('emits dist/content/search.json with the post in the flat index', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const indexPath = join(summary.outputDir, 'content', 'search.json');
    expect(existsSync(indexPath)).toBe(true);
    const body = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.posts.find((p: { slug: string }) => p.slug === 'hello')).toBeDefined();
    expect(body.meta.site_url).toBe('https://strict.test');
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

describe('build pipeline 404 emission', () => {
  test('emits a fallback 404.html when the theme lacks an error-404 template', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const file = join(summary.outputDir, '404.html');
    expect(existsSync(file)).toBe(true);
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('<title>Page not found — Strict Test</title>');
    expect(html).toContain('href="/"');
    expect(html).toContain('content="noindex"');
  });
});

describe('build pipeline --profile', () => {
  test('does not write profile.json by default', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, '.nectar/profile.json'))).toBe(false);
  });

  test('writes dist/.nectar/profile.json with phase + render-route entries when profile: true', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, profile: true });
    const file = join(summary.outputDir, '.nectar/profile.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<{
      phase: string;
      duration_ms: number;
      route?: string;
      bytes_emitted?: number;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const entry of parsed) {
      expect(typeof entry.phase).toBe('string');
      expect(typeof entry.duration_ms).toBe('number');
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
    }
    const phases = parsed.map((e) => e.phase);
    expect(phases).toContain('config');
    expect(phases).toContain('load_content_and_theme');
    expect(phases).toContain('write_html');
    expect(phases).toContain('copy_assets');
    const renderEntries = parsed.filter((e) => e.phase === 'render');
    expect(renderEntries.length).toBeGreaterThan(0);
    for (const r of renderEntries) {
      expect(typeof r.route).toBe('string');
      expect(typeof r.bytes_emitted).toBe('number');
      expect(r.bytes_emitted ?? 0).toBeGreaterThan(0);
    }
    const writeHtml = parsed.find((e) => e.phase === 'write_html');
    expect(writeHtml?.bytes_emitted ?? 0).toBeGreaterThan(0);
  });
});

describe('build pipeline content assets emission (#109)', () => {
  test('copies content/images/** into dist/content/images/** so Ghost-style feature_image URLs resolve', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await mkdir(join(cwd, 'content/images/2024/01'), { recursive: true });
    await writeFile(join(cwd, 'content/images/2024/01/foo.jpg'), 'FOO');
    await writeFile(join(cwd, 'content/images/welcome-cover.svg'), '<svg/>');

    const summary = await build({ cwd });

    expect(existsSync(join(summary.outputDir, 'content/images/2024/01/foo.jpg'))).toBe(true);
    expect(readFileSync(join(summary.outputDir, 'content/images/2024/01/foo.jpg'), 'utf8')).toBe(
      'FOO',
    );
    expect(existsSync(join(summary.outputDir, 'content/images/welcome-cover.svg'))).toBe(true);
  });

  test('honours content.assets_dir override when copying to dist/content/images/', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await mkdir(join(cwd, 'media/blog'), { recursive: true });
    await writeFile(join(cwd, 'media/blog/hero.png'), 'HERO');

    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '[site]',
        'title = "Strict Test"',
        'url = "https://strict.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
        '[content]',
        'assets_dir = "media/blog"',
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

    const summary = await build({ cwd });

    expect(existsSync(join(summary.outputDir, 'content/images/hero.png'))).toBe(true);
    expect(readFileSync(join(summary.outputDir, 'content/images/hero.png'), 'utf8')).toBe('HERO');
  });

  test('skips content asset copy entirely when build.copy_content_assets is false', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/skipme.png'), 'SKIP');

    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '[site]',
        'title = "Strict Test"',
        'url = "https://strict.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
        '[build]',
        'copy_content_assets = false',
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

    const summary = await build({ cwd });

    expect(existsSync(join(summary.outputDir, 'content/images/skipme.png'))).toBe(false);
  });
});

describe('build pipeline favicon emission', () => {
  test('copies site.icon into dist root and emits a <link rel="icon"> in rendered HTML', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-pipeline-favicon-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/authors'), { recursive: true });
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/logo.svg'), '<svg/>');
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '[site]',
        'title = "Favicon Test"',
        'url = "https://favicon.test"',
        'icon = "/content/images/logo.svg"',
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
      join(cwd, 'content/posts/hello.md'),
      '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
      'utf8',
    );
    await writeFile(join(cwd, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(cwd, 'themes/source'), { recursive: true });

    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, 'favicon.svg'))).toBe(true);
    const postHtml = readFileSync(join(summary.outputDir, 'hello/index.html'), 'utf8');
    expect(postHtml).toContain('rel="icon"');
    expect(postHtml).toContain('href="/favicon.svg"');
    expect(postHtml).toContain('type="image/svg+xml"');
  });
});

describe('build pipeline HTML minification (#1109)', () => {
  async function makeSite(opts: { minify: boolean }): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-pipeline-minify-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/authors'), { recursive: true });
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '[site]',
        'title = "Minify Test"',
        'url = "https://minify.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
        '[build]',
        `minify_html = ${opts.minify}`,
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
      join(cwd, 'content/posts/hello.md'),
      '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
      'utf8',
    );
    await writeFile(join(cwd, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(cwd, 'themes/source'), { recursive: true });
    return cwd;
  }

  test('does not minify when build.minify_html is false (default)', async () => {
    const cwd = await makeSite({ minify: false });
    const summary = await build({ cwd });
    const html = readFileSync(join(summary.outputDir, 'hello/index.html'), 'utf8');
    expect(html).toMatch(/\n\s+</);
  });

  test('shrinks emitted HTML when build.minify_html is true', async () => {
    const cwdUnmin = await makeSite({ minify: false });
    const cwdMin = await makeSite({ minify: true });
    const sUnmin = await build({ cwd: cwdUnmin });
    const sMin = await build({ cwd: cwdMin });

    const htmlUnmin = readFileSync(join(sUnmin.outputDir, 'hello/index.html'), 'utf8');
    const htmlMin = readFileSync(join(sMin.outputDir, 'hello/index.html'), 'utf8');

    expect(htmlMin.length).toBeLessThan(htmlUnmin.length);
    expect(htmlMin).toContain('Hello');
    expect(htmlMin).not.toMatch(/<!--[^[]/);
  });
});

describe('build pipeline --no-atomic escape hatch (#247)', () => {
  test('default atomic build leaves no sibling .dist.tmp- or dist.old- tree behind', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const parent = dirname(summary.outputDir);
    const siblings = await readdir(parent);
    expect(siblings.filter((s) => s.startsWith('.dist.tmp-'))).toEqual([]);
    expect(siblings.filter((s) => s.startsWith('dist.old-'))).toEqual([]);
    expect(existsSync(join(summary.outputDir, 'index.html'))).toBe(true);
  });

  test('--no-atomic writes directly into output_dir without creating a staging sibling', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, noAtomic: true });
    expect(summary.outputDir).toBe(resolve(cwd, 'dist'));
    expect(existsSync(join(summary.outputDir, 'index.html'))).toBe(true);
    const parent = dirname(summary.outputDir);
    const siblings = await readdir(parent);
    expect(siblings.filter((s) => s.startsWith('.dist.tmp-'))).toEqual([]);
    expect(siblings.filter((s) => s.startsWith('dist.old-'))).toEqual([]);
  });

  test('--no-atomic clears stale files from a previous build out of output_dir', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const distDir = resolve(cwd, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'leftover.txt'), 'stale', 'utf8');

    const summary = await build({ cwd, noAtomic: true });

    expect(existsSync(join(summary.outputDir, 'leftover.txt'))).toBe(false);
    expect(existsSync(join(summary.outputDir, 'index.html'))).toBe(true);
  });

  test('--no-atomic skips .nectarignore preservation (documented tradeoff)', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const distDir = resolve(cwd, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'CNAME'), 'example.test', 'utf8');
    await writeFile(join(cwd, '.nectarignore'), 'CNAME\n', 'utf8');

    const summary = await build({ cwd, noAtomic: true });

    // Atomic mode would have copied CNAME forward; --no-atomic explicitly does not.
    expect(existsSync(join(summary.outputDir, 'CNAME'))).toBe(false);
  });

  test('default atomic mode preserves .nectarignore-listed files across rebuilds', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await build({ cwd });
    const distDir = resolve(cwd, 'dist');
    await writeFile(join(distDir, 'CNAME'), 'example.test', 'utf8');
    await writeFile(join(cwd, '.nectarignore'), 'CNAME\n', 'utf8');

    const summary = await build({ cwd });

    expect(readFileSync(join(summary.outputDir, 'CNAME'), 'utf8')).toBe('example.test');
  });
});
