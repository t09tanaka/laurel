import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitGithubPagesRedirects } from '~/build/github-pages.ts';
import { build } from '~/build/pipeline.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-github-pages-'));
}

describe('config.deploy.github_pages', () => {
  test('keeps redirect HTML stubs opt-in', () => {
    const config = configSchema.parse({ site: { title: 'x' } });
    expect(config.deploy.github_pages.redirects).toBe(false);
  });
});

describe('emitGithubPagesRedirects', () => {
  test('does not emit redirect stubs when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitGithubPagesRedirects({
      outputDir,
      enabled: false,
      basePath: '/',
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
    });

    expect(existsSync(join(outputDir, 'old', 'index.html'))).toBe(false);
  });

  test('materializes clean URL redirects as per-path index.html stubs', async () => {
    const outputDir = await makeOutputDir();

    await emitGithubPagesRedirects({
      outputDir,
      enabled: true,
      basePath: '/',
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
    });

    const html = await readFile(join(outputDir, 'old', 'index.html'), 'utf8');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/new">');
    expect(html).toContain('<link rel="canonical" href="/new">');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  test('materializes file URL redirects at the file path itself', async () => {
    const outputDir = await makeOutputDir();

    await emitGithubPagesRedirects({
      outputDir,
      enabled: true,
      basePath: '/',
      rules: [{ from: '/old.html', to: '/new.html', status: 301, force: false }],
    });

    const html = await readFile(join(outputDir, 'old.html'), 'utf8');
    expect(html).toContain('url=/new.html');
    expect(existsSync(join(outputDir, 'old.html', 'index.html'))).toBe(false);
  });

  test('strips the Pages project base path from files while preserving it in target URLs', async () => {
    const outputDir = await makeOutputDir();

    await emitGithubPagesRedirects({
      outputDir,
      enabled: true,
      basePath: '/repo/',
      rules: [
        { from: '/repo/old', to: '/new', status: 301, force: false },
        { from: '/feed', to: '/repo/rss.xml', status: 302, force: false },
        { from: '/external', to: '//cdn.example.com/new', status: 302, force: false },
      ],
    });

    const html = await readFile(join(outputDir, 'old', 'index.html'), 'utf8');
    expect(html).toContain('content="0; url=/repo/new"');
    expect(html).toContain('href="/repo/new"');
    expect(existsSync(join(outputDir, 'repo', 'old', 'index.html'))).toBe(false);

    const alreadyPrefixed = await readFile(join(outputDir, 'feed', 'index.html'), 'utf8');
    expect(alreadyPrefixed).toContain('content="0; url=/repo/rss.xml"');
    expect(alreadyPrefixed).not.toContain('/repo/repo/rss.xml');

    const protocolRelative = await readFile(join(outputDir, 'external', 'index.html'), 'utf8');
    expect(protocolRelative).toContain('content="0; url=//cdn.example.com/new"');
    expect(protocolRelative).not.toContain('/repo//cdn.example.com/new');
  });

  test('does not overwrite Pages root or 404 fallback behavior', async () => {
    const outputDir = await makeOutputDir();
    await writeFile(join(outputDir, 'index.html'), '<h1>Home</h1>');
    await writeFile(join(outputDir, '404.html'), '<h1>Missing</h1>');

    await emitGithubPagesRedirects({
      outputDir,
      enabled: true,
      basePath: '/',
      rules: [
        { from: '/', to: '/home', status: 301, force: false },
        { from: '/404.html', to: '/missing', status: 301, force: false },
      ],
    });

    expect(await readFile(join(outputDir, 'index.html'), 'utf8')).toBe('<h1>Home</h1>');
    expect(await readFile(join(outputDir, '404.html'), 'utf8')).toBe('<h1>Missing</h1>');
  });
});

describe('build pipeline GitHub Pages redirects', () => {
  test('emits Pages redirect stubs from redirects.yaml when deploy.github_pages.redirects is enabled', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'laurel-pipeline-gh-pages-'));
    await mkdir(join(cwd, 'content', 'posts'), { recursive: true });
    await mkdir(join(cwd, 'content', 'authors'), { recursive: true });
    await writeFile(
      join(cwd, 'laurel.toml'),
      [
        '[site]',
        'title = "Pages Test"',
        'url = "https://example.github.io/repo"',
        '',
        '[build]',
        'base_path = "/repo/"',
        '',
        '[deploy.github_pages]',
        'redirects = true',
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
      join(cwd, 'content', 'posts', 'hello.md'),
      '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
      'utf8',
    );
    await writeFile(
      join(cwd, 'content', 'authors', 'casper.md'),
      '---\nname: Casper\n---\n',
      'utf8',
    );
    await cp(join(process.cwd(), 'example', 'themes', 'source'), join(cwd, 'themes', 'source'), {
      recursive: true,
    });
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /old\n  to: /new\n', 'utf8');

    const summary = await build({ cwd });
    const html = await readFile(join(summary.outputDir, 'old', 'index.html'), 'utf8');

    expect(html).toContain('content="0; url=/repo/new"');
    expect(existsSync(join(summary.outputDir, 'repo', 'old', 'index.html'))).toBe(false);
    expect(existsSync(join(summary.outputDir, '404.html'))).toBe(true);
    expect(existsSync(join(summary.outputDir, 'index.html'))).toBe(true);
  });
});
