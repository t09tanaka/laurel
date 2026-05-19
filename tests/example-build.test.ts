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
    expect(tagHtml).toContain('<title>News | Nectar Example</title>');
    expect(tagHtml).toContain(
      '<meta name="description" content="Announcements and project updates from the Nectar team.">',
    );
    expect(tagHtml).toContain('<meta property="og:title" content="News | Nectar Example">');
    expect(tagHtml).toContain(
      '<meta property="og:description" content="Announcements and project updates from the Nectar team.">',
    );

    const authorHtml = readFileSync(join(distRoot, 'author/casper/index.html'), 'utf8');
    expect(authorHtml).toContain('Casper');
    expect(authorHtml).toContain('<title>Casper | Nectar Example</title>');
    expect(authorHtml).toContain(
      '<meta name="description" content="Friendly mascot of the open publishing platform Ghost — and the canonical Nectar test author.">',
    );
    expect(authorHtml).toContain('<meta property="og:title" content="Casper | Nectar Example">');

    for (const [label, html] of [
      ['home', indexHtml],
      ['post', postHtml],
      ['tag', tagHtml],
      ['author', authorHtml],
    ] as const) {
      const matches = html.match(/<main\b/g) ?? [];
      expect(matches.length, `${label} page should have exactly one <main> landmark`).toBe(1);
      expect(html, `${label} page <main> should carry id="main" for skip-link targeting`).toMatch(
        /<main[^>]*\bid="main"/,
      );
      expect(html, `${label} page search button must have non-empty aria-label`).not.toMatch(
        /<button[^>]*\bgh-search\b[^>]*\baria-label=""/,
      );
      expect(html, `${label} page burger button must have non-empty aria-label`).not.toMatch(
        /<button[^>]*\bgh-burger\b[^>]*\baria-label=""/,
      );
      expect(html, `${label} page must emit a skip-to-content link targeting #main`).toMatch(
        /<a [^>]*class="nectar-skip-link[^"]*"[^>]*href="#main"[^>]*>\s*Skip to content\s*<\/a>/,
      );
      const bodyOpenMatch = html.match(/<body\b[^>]*>/i);
      expect(bodyOpenMatch, `${label} page must have a <body> tag`).not.toBeNull();
      const bodyOpenEnd = (bodyOpenMatch?.index ?? 0) + (bodyOpenMatch?.[0]?.length ?? 0);
      const skipAnchorPos = html.indexOf('<a class="nectar-skip-link');
      expect(
        skipAnchorPos,
        `${label} page skip link must appear inside <body>`,
      ).toBeGreaterThanOrEqual(bodyOpenEnd);
      const firstFocusableOffset = html
        .slice(bodyOpenEnd)
        .search(/<(?:a|button|input|select|textarea)\b/i);
      expect(
        bodyOpenEnd + firstFocusableOffset,
        `${label} page first focusable element must be the skip link`,
      ).toBe(skipAnchorPos);
    }

    // Feature/card images must declare intrinsic width/height so browsers
    // can reserve layout space (avoids Cumulative Layout Shift).
    const cardImgPattern =
      /<figure class="gh-card-image">[\s\S]*?<img\b[^>]*\bwidth="\d+"[^>]*\bheight="\d+"/;
    expect(indexHtml, 'index card images must declare width/height').toMatch(cardImgPattern);
    const articleImgPattern =
      /<figure class="gh-article-image">[\s\S]*?<img\b[^>]*\bwidth="\d+"[^>]*\bheight="\d+"/;
    expect(postHtml, 'article feature image must declare width/height').toMatch(articleImgPattern);

    expect(existsSync(join(distRoot, 'rss.xml'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap.xml'))).toBeTrue();

    const sitemap = readFileSync(join(distRoot, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://nectar.example.com/hello-nectar/</loc>');

    // a11y/perf (issue #199): the contrast class must be emitted on <html>
    // at build time so there is no FOUC, and the inline script that reads
    // --background-color via getComputedStyle must be gone.
    for (const [label, html] of [
      ['home', indexHtml],
      ['post', postHtml],
      ['tag', tagHtml],
      ['author', authorHtml],
    ] as const) {
      expect(html, `${label} page <html> must carry a precomputed text color class`).toMatch(
        /<html[^>]*\bclass="(?:[^"]*\s)?has-(?:dark|light)-text(?:\s[^"]*)?"/,
      );
      expect(html, `${label} page must not run the legacy inline contrast script`).not.toContain(
        "getComputedStyle(document.documentElement).getPropertyValue('--background-color')",
      );
      expect(html, `${label} page must not assign has-NaN-text via JS`).not.toContain(
        'document.documentElement.className = `has-${textColor}-text`',
      );
    }
  });
});
