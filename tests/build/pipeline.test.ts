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

  test('throws a NectarError when frontmatter date is unparseable', async () => {
    const cwd = await makeMinimalSite({ dateValue: 'not-a-real-date' });
    // Unparseable dates used to surface as a warning that fell back to the
    // epoch; they now hard-fail the build so the typo can't ship silently.
    let caught: unknown;
    try {
      await build({ cwd });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const message = (caught as Error).message;
    expect(message).toMatch(/Invalid date in frontmatter/);
    expect(message).toContain('not-a-real-date');
  });

  test('emits dist/robots.txt with sitemap URL by default', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const body = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://strict.test/sitemap.xml');
  });

  test('emits dist/humans.txt with site metadata by default', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const body = readFileSync(join(summary.outputDir, 'humans.txt'), 'utf8');
    expect(body).toContain('/* SITE */');
    expect(body).toContain('Title: Strict Test');
    expect(body).toContain('URL: https://strict.test');
    expect(body).toContain('Generator: Nectar');
  });

  test('emits zero-byte dist/.nojekyll for GitHub Pages compatibility', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const nojekyll = join(summary.outputDir, '.nojekyll');
    expect(existsSync(nojekyll)).toBe(true);
    expect(readFileSync(nojekyll, 'utf8')).toBe('');
  });

  test('emits dist/.nectar/cloudfront-response-headers-policy.json from deploy headers', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '',
        '[deploy.headers.security]',
        'content_security_policy = "default-src \'self\'"',
        '',
      ].join('\n'),
      { flag: 'a' },
    );

    const summary = await build({ cwd });
    const body = JSON.parse(
      readFileSync(
        join(summary.outputDir, '.nectar', 'cloudfront-response-headers-policy.json'),
        'utf8',
      ),
    );

    expect(body.SecurityHeadersConfig.ContentSecurityPolicy).toEqual({
      ContentSecurityPolicy: "default-src 'self'",
      Override: true,
    });
  });

  test('emits dist/.nectar/asset-manifest.json for fingerprinted theme assets', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });

    const summary = await build({ cwd });
    const manifest = JSON.parse(
      readFileSync(join(summary.outputDir, '.nectar', 'asset-manifest.json'), 'utf8'),
    ) as Record<string, string>;

    expect(manifest['assets/built/screen.css']).toMatch(
      /^assets\/built\/screen\.[0-9a-f]{10}\.css$/,
    );
    expect(existsSync(join(summary.outputDir, manifest['assets/built/screen.css'] as string))).toBe(
      true,
    );
    expect(manifest['built/screen.css']).toBeUndefined();
  });

  test('emits dist/.nectar/Caddyfile when the Caddy deploy target is enabled', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '',
        '[deploy.caddy]',
        'enabled = true',
        'root = "/srv/nectar"',
        'site_address = "example.com"',
        '',
      ].join('\n'),
      { flag: 'a' },
    );
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /old', '  to: /new', '  status: 308', ''].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd });
    const body = readFileSync(join(summary.outputDir, '.nectar', 'Caddyfile'), 'utf8');
    expect(body).toContain('example.com {');
    expect(body).toContain('root * /srv/nectar');
    expect(body).toContain('redir @redirect_0 /new 308');
    expect(body).toContain('try_files {path} {path}/index.html =404');
  });

  test('emits dist/.htaccess when deploy.apache is enabled', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '[site]',
        'title = "Apache Test"',
        'url = "https://apache.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
        '[deploy.apache]',
        'enabled = true',
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
      join(cwd, 'redirects.yaml'),
      '- from: /old\n  to: /new\n  status: 301\n',
      'utf8',
    );

    const summary = await build({ cwd });
    const body = readFileSync(join(summary.outputDir, '.htaccess'), 'utf8');

    expect(body).toContain('ErrorDocument 404 /404.html');
    expect(body).toContain('RewriteRule ^old$ /new [R=301,L]');
    expect(body).toContain('RewriteRule ^(.+[^/])$ $1/index.html [L]');
    expect(body).toContain('RewriteRule ^(.+)/$ $1/index.html [L]');
  });

  test('emits dist/_routes-manifest.json when deploy.cloudflare_workers is enabled', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '',
        '[deploy.cloudflare_workers]',
        'enabled = true',
        '',
        '[deploy.headers.security]',
        'custom = { X-Test-Header = "worker" }',
        '',
      ].join('\n'),
      { flag: 'a' },
    );
    await writeFile(
      join(cwd, 'redirects.yaml'),
      '- from: /old\n  to: /new\n  status: 308\n',
      'utf8',
    );

    const summary = await build({ cwd });
    const body = JSON.parse(readFileSync(join(summary.outputDir, '_routes-manifest.json'), 'utf8'));

    expect(body.version).toBe(1);
    expect(body.redirects).toEqual(
      expect.arrayContaining([
        { source: '/old', destination: '/new', status: 308 },
        { source: '/hello', destination: '/hello/', status: 308 },
      ]),
    );
    expect(body.headers).toContainEqual(
      expect.objectContaining({
        source: '/*',
        headers: expect.arrayContaining([{ key: 'X-Test-Header', value: 'worker' }]),
      }),
    );
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

describe('build pipeline includeDrafts (#253)', () => {
  async function withDraft(): Promise<string> {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'content/posts/wip.md'),
      `---
title: WIP
status: draft
date: 2026-02-01T00:00:00Z
---

Not yet ready.
`,
      'utf8',
    );
    return cwd;
  }

  test('skips draft posts by default', async () => {
    const cwd = await withDraft();
    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, 'wip/index.html'))).toBe(false);
    expect(existsSync(join(summary.outputDir, 'hello/index.html'))).toBe(true);
  });

  test('renders draft posts and emits a warning when includeDrafts is true', async () => {
    const cwd = await withDraft();
    const summary = await build({ cwd, includeDrafts: true });
    expect(existsSync(join(summary.outputDir, 'wip/index.html'))).toBe(true);
    expect(existsSync(join(summary.outputDir, 'hello/index.html'))).toBe(true);
    expect(summary.warningCount).toBeGreaterThan(0);
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

describe('build pipeline trailing slash policy', () => {
  test('build.trailing_slash = never writes flat HTML and redirects slash URLs to slashless canonicals', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'nectar.toml'),
      [
        '',
        '[build]',
        'trailing_slash = "never"',
        '',
        '[deploy.netlify]',
        'enabled = true',
        '',
      ].join('\n'),
      { flag: 'a' },
    );

    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, 'hello.html'))).toBe(true);
    expect(existsSync(join(summary.outputDir, 'hello', 'index.html'))).toBe(false);
    const html = readFileSync(join(summary.outputDir, 'hello.html'), 'utf8');
    expect(html).toContain('<link rel="canonical" href="https://strict.test/hello">');
    const search = JSON.parse(
      readFileSync(join(summary.outputDir, 'content', 'search.json'), 'utf8'),
    );
    expect(search.posts[0].url).toBe('https://strict.test/hello');
    const redirects = readFileSync(join(summary.outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain('/hello/  /hello  308!');
  });
});

describe('build pipeline baseUrl override (#250)', () => {
  async function makeSiteWithFeeds(opts: { dateValue: string }): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pipeline-baseurl-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/pages'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });

    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Preview Test"',
        'url = "https://prod.example.com"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(dir, 'content/posts/hello.md'),
      `---\ntitle: "Hello"\ndate: ${opts.dateValue}\n---\n\nBody\n`,
      'utf8',
    );
    await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  test('retargets canonical and OG URLs at the override host', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, baseUrl: 'https://pr-42.example.com' });
    const html = readFileSync(join(summary.outputDir, 'hello/index.html'), 'utf8');
    expect(html).toContain('https://pr-42.example.com/hello/');
    expect(html).not.toContain('https://prod.example.com');
  });

  test('retargets robots.txt sitemap URL at the override host', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, baseUrl: 'https://pr-42.example.com' });
    const body = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('Sitemap: https://pr-42.example.com/sitemap.xml');
    expect(body).not.toContain('prod.example.com');
  });

  test('retargets RSS feed link/guid at the override host', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, baseUrl: 'https://pr-42.example.com' });
    const rss = readFileSync(join(summary.outputDir, 'rss.xml'), 'utf8');
    expect(rss).toContain('https://pr-42.example.com/');
    expect(rss).not.toContain('prod.example.com');
  });

  test('retargets sitemap entries at the override host', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, baseUrl: 'https://pr-42.example.com' });
    const index = readFileSync(join(summary.outputDir, 'sitemap.xml'), 'utf8');
    // sitemap.xml is the <sitemapindex>; sub-sitemap URLs must use the override host.
    expect(index).toContain('https://pr-42.example.com/sitemap-posts.xml');
    expect(index).not.toContain('prod.example.com');
    // The post URL itself lives in sitemap-posts.xml after the Ghost-style split.
    const posts = readFileSync(join(summary.outputDir, 'sitemap-posts.xml'), 'utf8');
    expect(posts).toContain('https://pr-42.example.com/hello/');
    expect(posts).not.toContain('prod.example.com');
  });

  test('strips a trailing slash on the override so URL joins do not double-up', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, baseUrl: 'https://pr-42.example.com/' });
    const body = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('Sitemap: https://pr-42.example.com/sitemap.xml');
    expect(body).not.toContain('pr-42.example.com//');
  });

  test('composes with --base-path so a preview deploy can override both', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({
      cwd,
      baseUrl: 'https://pr-42.example.com',
      basePath: '/preview/',
    });
    const html = readFileSync(join(summary.outputDir, 'index.html'), 'utf8');
    expect(html).toContain('/preview/assets/');
    const robots = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(robots).toContain('https://pr-42.example.com');
  });

  test('rejects a path-only override (catches the easy "/preview" mistake)', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    expect(build({ cwd, baseUrl: '/preview' })).rejects.toThrow(/http:\/\/ or https:\/\//);
  });

  test('rejects an empty override', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    expect(build({ cwd, baseUrl: '' })).rejects.toThrow(/must not be empty/);
  });

  test('without override, canonical URLs still come from site.url', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const html = readFileSync(join(summary.outputDir, 'hello/index.html'), 'utf8');
    expect(html).toContain('https://prod.example.com');
    expect(html).not.toContain('pr-42.example.com');
  });
});

describe('build pipeline base_path applied to content URLs (#432)', () => {
  // Pipeline-level fixture mirroring the `baseUrl` suite above so we can
  // exercise canonical, RSS, sitemap, and robots together against a single
  // build that has feeds + sitemap turned on (the minimal fixture disables
  // them for unrelated reasons).
  async function makeSiteWithFeeds(opts: { dateValue: string }): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pipeline-basepath-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/pages'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });
    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Subpath Site"',
        'url = "https://example.com"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(dir, 'content/posts/hello.md'),
      `---\ntitle: "Hello"\ndate: ${opts.dateValue}\ntags: [news]\nauthors: [casper]\n---\n\nBody\n`,
      'utf8',
    );
    await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  test('post canonical / og:url include base_path', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    const html = readFileSync(join(summary.outputDir, 'hello/index.html'), 'utf8');
    expect(html).toContain('href="https://example.com/blog/hello/"');
    expect(html).toContain('content="https://example.com/blog/hello/"');
    // The post's slug-only canonical (no base_path) must no longer leak.
    expect(html).not.toContain('href="https://example.com/hello/"');
  });

  test('home / index canonical includes base_path', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    const html = readFileSync(join(summary.outputDir, 'index.html'), 'utf8');
    expect(html).toContain('href="https://example.com/blog/"');
  });

  test('sitemap entries and the index point at the deployed subpath', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    const index = readFileSync(join(summary.outputDir, 'sitemap.xml'), 'utf8');
    expect(index).toContain('<loc>https://example.com/blog/sitemap-posts.xml</loc>');
    const posts = readFileSync(join(summary.outputDir, 'sitemap-posts.xml'), 'utf8');
    expect(posts).toContain('<loc>https://example.com/blog/hello/</loc>');
    // The host-rooted URL is the broken shape we are fixing -- guard against it.
    expect(posts).not.toContain('<loc>https://example.com/hello/</loc>');
  });

  test('RSS channel link and atom:link include base_path', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    const rss = readFileSync(join(summary.outputDir, 'rss.xml'), 'utf8');
    expect(rss).toContain('<link>https://example.com/blog</link>');
    expect(rss).toContain('href="https://example.com/blog/rss.xml"');
    // Item permalinks pick up base_path via post.url.
    expect(rss).toContain('<link>https://example.com/blog/hello/</link>');
  });

  test('robots.txt Sitemap directive includes base_path', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    const body = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('Sitemap: https://example.com/blog/sitemap.xml');
    expect(body).not.toContain('Sitemap: https://example.com/sitemap.xml');
  });

  test('a trailing-slash-less basePath behaves identically to the canonical form', async () => {
    const cwdA = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summaryA = await build({ cwd: cwdA, basePath: '/blog' });
    const cwdB = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summaryB = await build({ cwd: cwdB, basePath: '/blog/' });
    const htmlA = readFileSync(join(summaryA.outputDir, 'hello/index.html'), 'utf8');
    const htmlB = readFileSync(join(summaryB.outputDir, 'hello/index.html'), 'utf8');
    expect(htmlA).toContain('https://example.com/blog/hello/');
    expect(htmlB).toContain('https://example.com/blog/hello/');
  });

  test('default base_path = "/" keeps URLs at the host root (regression)', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const html = readFileSync(join(summary.outputDir, 'hello/index.html'), 'utf8');
    expect(html).toContain('href="https://example.com/hello/"');
    expect(html).not.toContain('href="https://example.com//hello/"');
    const robots = readFileSync(join(summary.outputDir, 'robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');
  });

  test('outputPath stays host-rooted regardless of base_path', async () => {
    const cwd = await makeSiteWithFeeds({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/blog/' });
    // dist layout must NOT nest under /blog/ -- the static host strips
    // base_path at request time, so files live at the dist root.
    expect(existsSync(join(summary.outputDir, 'hello/index.html'))).toBe(true);
    expect(existsSync(join(summary.outputDir, 'blog/hello/index.html'))).toBe(false);
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

  test('keeps Pages project-site 404.html at the artifact root', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, basePath: '/my-blog/' });
    const file = join(summary.outputDir, '404.html');

    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(summary.outputDir, 'my-blog/404.html'))).toBe(false);

    const html = readFileSync(file, 'utf8');
    expect(html).toContain('href="/my-blog/"');
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

describe('build pipeline build-manifest emission (#248)', () => {
  test('writes dist/.nectar/build-manifest.json with the deploy-facing fields', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });
    const file = join(summary.outputDir, '.nectar/build-manifest.json');
    const changedPathsFile = join(summary.outputDir, '.nectar/changed-paths.txt');
    expect(existsSync(file)).toBe(true);
    expect(existsSync(changedPathsFile)).toBe(true);
    expect(readFileSync(changedPathsFile, 'utf8')).toBe('/*\n');

    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      schema_version: number;
      generated_at: string;
      nectar: { version: string };
      theme: {
        name: string;
        version: string;
        custom_settings: Record<
          string,
          { type: string; group?: string; visibility?: string; default?: unknown }
        >;
      };
      config_hash: string;
      hash_algorithm: string;
      route_count: number;
      asset_count: number;
      files: Array<{ path: string; size: number; hash: string }>;
    };

    expect(parsed.schema_version).toBe(1);
    expect(parsed.hash_algorithm).toBe('sha256');
    expect(parsed.route_count).toBe(summary.routeCount);
    expect(parsed.asset_count).toBe(summary.assetCount);
    expect(parsed.theme.name).toBe('source');
    const headerTextSetting = parsed.theme.custom_settings.header_text;
    expect(headerTextSetting).toBeDefined();
    expect(headerTextSetting?.group).toBe('homepage');
    expect(headerTextSetting?.visibility).toBe('header_style:[Landing, Search]');
    expect(typeof parsed.nectar.version).toBe('string');
    expect(parsed.config_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(parsed.generated_at).toString()).not.toBe('Invalid Date');

    // index.html is part of every Ghost-themed build; verify it shows up in
    // the file list with a real sha256 and a positive size.
    const indexEntry = parsed.files.find((f) => f.path === 'index.html');
    expect(indexEntry).toBeDefined();
    expect(indexEntry?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(indexEntry?.size).toBeGreaterThan(0);

    // The manifest must not list itself; otherwise its contents would be
    // self-referential and change every build.
    expect(parsed.files.find((f) => f.path === '.nectar/build-manifest.json')).toBeUndefined();
    expect(parsed.files.find((f) => f.path === '.nectar/changed-paths.txt')).toBeUndefined();

    // Files must be sorted for deterministic deploy diffs.
    const paths = parsed.files.map((f) => f.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
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

describe('build pipeline --concurrency cap (#251)', () => {
  test('concurrency: 1 (serial) produces the same html as the default parallel cap', async () => {
    const cwdParallel = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const cwdSerial = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });

    const parallelSummary = await build({ cwd: cwdParallel });
    const serialSummary = await build({ cwd: cwdSerial, concurrency: 1 });

    expect(serialSummary.routeCount).toBe(parallelSummary.routeCount);
    // Same rendered bytes for the home page proves the Handlebars helpers are
    // reentrant across both concurrency settings — the task acceptance criterion.
    const parallelHome = readFileSync(join(parallelSummary.outputDir, 'index.html'), 'utf8');
    const serialHome = readFileSync(join(serialSummary.outputDir, 'index.html'), 'utf8');
    expect(serialHome).toBe(parallelHome);

    const parallelPost = readFileSync(join(parallelSummary.outputDir, 'hello/index.html'), 'utf8');
    const serialPost = readFileSync(join(serialSummary.outputDir, 'hello/index.html'), 'utf8');
    expect(serialPost).toBe(parallelPost);
  });

  test('concurrency: 4 builds an identical site to concurrency: 1', async () => {
    const cwdOne = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const cwdFour = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });

    const oneSummary = await build({ cwd: cwdOne, concurrency: 1 });
    const fourSummary = await build({ cwd: cwdFour, concurrency: 4 });

    expect(fourSummary.routeCount).toBe(oneSummary.routeCount);
    const oneHome = readFileSync(join(oneSummary.outputDir, 'index.html'), 'utf8');
    const fourHome = readFileSync(join(fourSummary.outputDir, 'index.html'), 'utf8');
    expect(fourHome).toBe(oneHome);
  });
});

describe('build pipeline --dry-run (#252)', () => {
  test('plans routes and renders without writing dist/ or any sibling staging dir', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const distDir = resolve(cwd, 'dist');

    const summary = await build({ cwd, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.routeCount).toBeGreaterThan(0);
    expect(summary.outputDir).toBe(distDir);
    // dist/ was never created and no staging sibling was left behind.
    expect(existsSync(distDir)).toBe(false);
    const parent = dirname(distDir);
    const siblings = await readdir(parent);
    expect(siblings.filter((s) => s.startsWith('.dist.tmp-'))).toEqual([]);
    expect(siblings.filter((s) => s.startsWith('dist.old-'))).toEqual([]);
  });

  test('summary.routes lists every planned route with template/path/bytes/kind', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd, dryRun: true });

    expect(Array.isArray(summary.routes)).toBe(true);
    expect(summary.routes?.length).toBe(summary.routeCount);
    const home = summary.routes?.find((r) => r.url === '/');
    expect(home).toBeDefined();
    expect(home?.outputPath).toBe('index.html');
    expect(home?.template.length).toBeGreaterThan(0);
    expect(home?.bytes).toBeGreaterThan(0);
    expect(home?.kind).toBe('home');
    const post = summary.routes?.find((r) => r.url === '/hello/');
    expect(post).toBeDefined();
    expect(post?.kind).toBe('post');
    expect(post?.bytes).toBeGreaterThan(0);
  });

  test('does not overwrite an existing dist/ from a prior real build', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await build({ cwd });
    const distDir = resolve(cwd, 'dist');
    const indexPath = join(distDir, 'index.html');
    const indexBefore = readFileSync(indexPath, 'utf8');
    const sentinel = join(distDir, 'sentinel.txt');
    await writeFile(sentinel, 'untouched', 'utf8');

    const summary = await build({ cwd, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(readFileSync(indexPath, 'utf8')).toBe(indexBefore);
    expect(readFileSync(sentinel, 'utf8')).toBe('untouched');
  });

  test('skipping site emitters: no sitemap/rss/robots/humans/manifest written under dry-run', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const distDir = resolve(cwd, 'dist');

    await build({ cwd, dryRun: true });

    expect(existsSync(join(distDir, 'sitemap.xml'))).toBe(false);
    expect(existsSync(join(distDir, 'robots.txt'))).toBe(false);
    expect(existsSync(join(distDir, 'humans.txt'))).toBe(false);
    expect(existsSync(join(distDir, '.nojekyll'))).toBe(false);
    expect(existsSync(join(distDir, '.nectar', 'build-manifest.json'))).toBe(false);
  });
});

describe('build pipeline content_api stubs (#210/#211/#212)', () => {
  test('emits content/posts.json, content/settings.json, _headers, _headers.cf by default', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    const summary = await build({ cwd });

    expect(existsSync(join(summary.outputDir, 'content', 'posts.json'))).toBe(true);
    expect(existsSync(join(summary.outputDir, 'content', 'settings.json'))).toBe(true);
    expect(existsSync(join(summary.outputDir, '_headers'))).toBe(true);
    expect(existsSync(join(summary.outputDir, '_headers.cf'))).toBe(true);

    const posts = JSON.parse(
      readFileSync(join(summary.outputDir, 'content', 'posts.json'), 'utf8'),
    );
    expect(Array.isArray(posts.posts)).toBe(true);
    expect(posts.meta.pagination.page).toBe(1);

    const settings = JSON.parse(
      readFileSync(join(summary.outputDir, 'content', 'settings.json'), 'utf8'),
    );
    expect(settings.settings.title).toBe('Strict Test');
    expect(settings.settings.url).toBe('https://strict.test');
    expect(settings.settings.members_enabled).toBe(false);

    const headers = readFileSync(join(summary.outputDir, '_headers'), 'utf8');
    expect(headers).toContain('/content/*');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
  });

  test('skips all four artifacts when components.content_api.enabled is false', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
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
        '[components.rss]',
        'enabled = false',
        '',
        '[components.sitemap]',
        'enabled = false',
        '',
        '[components.content_api]',
        'enabled = false',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd });

    expect(existsSync(join(summary.outputDir, 'content', 'posts.json'))).toBe(false);
    expect(existsSync(join(summary.outputDir, 'content', 'settings.json'))).toBe(false);
    expect(existsSync(join(summary.outputDir, '_headers'))).toBe(false);
    expect(existsSync(join(summary.outputDir, '_headers.cf'))).toBe(false);
  });
});

describe('build pipeline pagefind integration (#553/#554/#555/#556)', () => {
  // Adds a minimal members-only post to the fixture so we can assert
  // `<meta name="pagefind-skip">` only lands on non-public HTML. The
  // shim-script injection is asserted against the index page which carries
  // the theme's `[data-ghost-search]` button.
  async function withMembersPost(opts: { engine: string }): Promise<string> {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
    await writeFile(
      join(cwd, 'content/posts/members-only.md'),
      `---
title: Members only
visibility: members
date: 2026-02-01T00:00:00Z
---

For members.
`,
      'utf8',
    );
    // Overwrite nectar.toml to enable the search component with the
    // requested engine. We keep RSS/sitemap disabled to match the base
    // fixture's expectations.
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
        '[components.rss]',
        'enabled = false',
        '',
        '[components.sitemap]',
        'enabled = false',
        '',
        '[components.search]',
        'enabled = true',
        `engine = "${opts.engine}"`,
        // Force a missing binary so the test never depends on PATH and
        // never blocks on the real pagefind walker; we only care that the
        // pipeline emits the shim and the skip meta, not that the index
        // bundle exists.
        'pagefind_bin = "/nonexistent/pagefind-binary-for-tests"',
        '',
      ].join('\n'),
      'utf8',
    );
    return cwd;
  }

  test('emits the runtime shim when engine includes pagefind', async () => {
    const cwd = await withMembersPost({ engine: 'pagefind' });
    const summary = await build({ cwd });
    const shim = join(summary.outputDir, 'search', 'ghost-search.js');
    expect(existsSync(shim)).toBe(true);
    const body = readFileSync(shim, 'utf8');
    expect(body).toContain('data-ghost-search');
    expect(body).toContain('pagefind-ui.js');
  });

  test('skips shim emission when engine is json only', async () => {
    const cwd = await withMembersPost({ engine: 'json' });
    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, 'search', 'ghost-search.js'))).toBe(false);
  });

  test('skips shim emission when search is disabled', async () => {
    const cwd = await makeMinimalSite({ dateValue: '2026-01-01T00:00:00Z' });
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
    const summary = await build({ cwd });
    expect(existsSync(join(summary.outputDir, 'search', 'ghost-search.js'))).toBe(false);
    // Pagefind index dir must also be absent when the component is off.
    expect(existsSync(join(summary.outputDir, 'pagefind'))).toBe(false);
  });

  test('injects pagefind-skip meta into non-public post HTML', async () => {
    const cwd = await withMembersPost({ engine: 'pagefind' });
    const summary = await build({ cwd });
    const membersHtml = readFileSync(join(summary.outputDir, 'members-only', 'index.html'), 'utf8');
    expect(membersHtml).toContain('<meta name="pagefind-skip">');
  });

  test('does NOT inject pagefind-skip meta into public post HTML', async () => {
    const cwd = await withMembersPost({ engine: 'pagefind' });
    const summary = await build({ cwd });
    const publicHtml = readFileSync(join(summary.outputDir, 'hello', 'index.html'), 'utf8');
    expect(publicHtml).not.toContain('pagefind-skip');
  });

  test('does NOT inject the shim script tag on pages without [data-ghost-search]', async () => {
    // The minimal post page does not include the theme's search button, so
    // the shim script should be skipped for it even though the search
    // component is on.
    const cwd = await withMembersPost({ engine: 'pagefind' });
    const summary = await build({ cwd });
    const html = readFileSync(join(summary.outputDir, 'hello', 'index.html'), 'utf8');
    if (!html.includes('data-ghost-search')) {
      expect(html).not.toContain('data-nectar-search-shim');
    }
  });
});

// #781 — pagination tails and the 404 page should never appear in sitemap
// surfaces. Build a small site with enough posts to trigger /page/2/ plus an
// error template, and assert the sub-sitemaps stay clean.
describe('build pipeline — sitemap excludes non-indexable routes (#781)', () => {
  async function makeSiteWithPagination(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pipeline-781-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/pages'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });

    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Pagination Test"',
        'url = "https://pg.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
        '[build]',
        'posts_per_page = 2',
        '',
      ].join('\n'),
      'utf8',
    );

    // Five posts × 2 per page → /, /page/2/, /page/3/.
    for (let i = 0; i < 5; i++) {
      await writeFile(
        join(dir, `content/posts/post-${i}.md`),
        `---\ntitle: "Post ${i}"\ndate: 2026-01-0${i + 1}T00:00:00Z\ntags: [news]\n---\n\nBody ${i}\n`,
        'utf8',
      );
    }

    await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');

    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  test('sitemap-posts.xml omits /page/N/ pagination tails', async () => {
    const cwd = await makeSiteWithPagination();
    const summary = await build({ cwd });

    // Pagination archive files exist on disk so deep links work.
    expect(existsSync(join(summary.outputDir, 'page/2/index.html'))).toBe(true);

    // But the sitemap never references them.
    const sub = readFileSync(join(summary.outputDir, 'sitemap-pages.xml'), 'utf8');
    expect(sub).not.toContain('/page/2/');
    expect(sub).not.toContain('/page/3/');
  });

  test('sitemap-tags.xml omits /tag/<slug>/page/N/ pagination tails', async () => {
    const cwd = await makeSiteWithPagination();
    const summary = await build({ cwd });

    // Some tag taxonomy page exists for /tag/news/ (sitemap-tags.xml or sitemap-pages.xml).
    const tagsXml = readFileSync(join(summary.outputDir, 'sitemap-tags.xml'), 'utf8');
    // /tag/news/page/N/ duplicates the /tag/news/ landing; never indexed.
    expect(tagsXml).not.toMatch(/\/tag\/[^/]+\/page\/\d+\//);
  });

  test('sitemap never lists /404.html even when the theme ships error-404.hbs', async () => {
    const cwd = await makeSiteWithPagination();
    const summary = await build({ cwd });

    expect(existsSync(join(summary.outputDir, '404.html'))).toBe(true);

    // 404 must not be in any sub-sitemap.
    for (const file of ['sitemap-posts.xml', 'sitemap-pages.xml', 'sitemap-tags.xml']) {
      const xml = readFileSync(join(summary.outputDir, file), 'utf8');
      expect(xml).not.toContain('404.html');
    }
  });
});
