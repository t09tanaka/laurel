import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '~/build/pipeline.ts';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const SITE_FIXTURE = join(FIXTURE_DIR, 'theme-smoke', 'site');
const ALTO_THEME = join(FIXTURE_DIR, 'themes', 'alto');

async function buildAltoFixture(): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'nectar-alto-pswp-'));
  await cp(SITE_FIXTURE, workDir, { recursive: true });
  await cp(ALTO_THEME, join(workDir, 'themes', 'alto'), { recursive: true });

  await writeFile(
    join(workDir, 'content', 'posts', 'welcome.md'),
    [
      '---',
      'title: "Welcome to the smoke fixture"',
      'slug: welcome',
      'date: 2026-01-15T09:00:00Z',
      'authors: [nectar-bot]',
      'tags: [general]',
      '---',
      '',
      '![Post image](/content/images/cover.svg)',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workDir, 'content', 'pages', 'about.md'),
    [
      '---',
      'title: "About this fixture"',
      'slug: about',
      'date: 2026-01-01T00:00:00Z',
      'authors: [nectar-bot]',
      '---',
      '',
      '![Page image](/content/images/cover.svg)',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workDir, 'nectar.toml'),
    [
      '[site]',
      'title = "Alto PSWP Fixture"',
      'description = "Alto fixture"',
      'url = "https://alto.example.com"',
      'locale = "en"',
      'timezone = "UTC"',
      '',
      '[theme]',
      'name = "alto"',
      'dir = "themes"',
      '',
      '[content]',
      'posts_dir = "content/posts"',
      'pages_dir = "content/pages"',
      'authors_dir = "content/authors"',
      'tags_dir = "content/tags"',
      'assets_dir = "content/images"',
      '',
      '[build]',
      'output_dir = "dist"',
      'base_path = "/"',
      'posts_per_page = 5',
      'copy_content_assets = true',
      '',
    ].join('\n'),
    'utf8',
  );

  const summary = await build({ cwd: workDir });
  expect(summary.routeCount).toBeGreaterThan(0);
  return join(workDir, 'dist');
}

describe('Alto pswp route guard', () => {
  test('renders the pswp partial only on post and page routes', async () => {
    const distRoot = await buildAltoFixture();
    const pages = {
      home: await readFile(join(distRoot, 'index.html'), 'utf8'),
      post: await readFile(join(distRoot, 'welcome', 'index.html'), 'utf8'),
      page: await readFile(join(distRoot, 'about', 'index.html'), 'utf8'),
      tag: await readFile(join(distRoot, 'tag', 'general', 'index.html'), 'utf8'),
      author: await readFile(join(distRoot, 'author', 'nectar-bot', 'index.html'), 'utf8'),
    };

    expect(pages.post).toContain('<div class="pswp"');
    expect(pages.page).toContain('<div class="pswp"');
    expect(pages.home).not.toContain('<div class="pswp"');
    expect(pages.tag).not.toContain('<div class="pswp"');
    expect(pages.author).not.toContain('<div class="pswp"');
  });
});
