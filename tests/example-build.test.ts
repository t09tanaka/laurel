import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
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

    const articleImage = postHtml.match(/<figure class="gh-article-image">[\s\S]*?<\/figure>/);
    expect(articleImage).not.toBeNull();
    expect(articleImage?.[0]).toContain('fetchpriority="high"');
    expect(articleImage?.[0]).toContain('decoding="async"');

    const firstCard = indexHtml.match(/<figure class="gh-card-image">[\s\S]*?<\/figure>/g)?.[0];
    expect(firstCard).toBeDefined();
    expect(firstCard).toContain('fetchpriority="high"');
    expect(firstCard).toContain('decoding="async"');
    expect(firstCard).not.toContain('loading="lazy"');

    const lazyCards =
      indexHtml.match(/<figure class="gh-card-image">[\s\S]*?<\/figure>/g)?.slice(1) ?? [];
    for (const card of lazyCards) {
      expect(card).toContain('loading="lazy"');
      expect(card).toContain('decoding="async"');
      expect(card).not.toContain('fetchpriority="high"');
    }

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
