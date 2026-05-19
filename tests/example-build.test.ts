import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

describe('example build', () => {
  test('builds the example site against the Source theme', async () => {
    const cwd = join(process.cwd(), 'example');
    const summary = await build({ cwd });

    expect(summary.routeCount).toBeGreaterThan(10);
    expect(summary.assetCount).toBeGreaterThan(0);

    const distRoot = join(cwd, 'dist');
    const indexHtml = readFileSync(join(distRoot, 'index.html'), 'utf8');
    expect(indexHtml).toContain('<title>Nectar Example</title>');
    expect(indexHtml).toContain('gh-viewport');
    expect(indexHtml).toContain('/assets/built/screen.');
    expect(indexHtml).not.toMatch(/\{\{[a-zA-Z][^}]*\}\}/);

    const postHtml = readFileSync(join(distRoot, 'hello-nectar/index.html'), 'utf8');
    expect(postHtml).toContain('Hello, Nectar');
    expect(postHtml).toContain('Casper');
    expect(postHtml).toContain('class="gh-article');

    const tagHtml = readFileSync(join(distRoot, 'tag/news/index.html'), 'utf8');
    expect(tagHtml).toContain('News');
    expect(tagHtml).toContain('Hello, Nectar');

    const authorHtml = readFileSync(join(distRoot, 'author/casper/index.html'), 'utf8');
    expect(authorHtml).toContain('Casper');

    expect(existsSync(join(distRoot, 'rss.xml'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap.xml'))).toBeTrue();

    const sitemap = readFileSync(join(distRoot, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://nectar.example.com/hello-nectar/</loc>');
  });
});
