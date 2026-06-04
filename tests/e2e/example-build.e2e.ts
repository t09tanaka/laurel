import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

describe('example build', () => {
  test('builds the example site against the official Casper theme', async () => {
    const cwd = join(process.cwd(), 'example');
    const summary = await build({ cwd });

    expect(summary.routeCount).toBeGreaterThan(10);
    expect(summary.assetCount).toBeGreaterThan(0);
    expect(summary.outputBytes).toBeGreaterThan(0);

    const distRoot = join(cwd, 'dist');
    const indexHtml = readFileSync(join(distRoot, 'index.html'), 'utf8');
    expect(indexHtml).toContain(
      '<title>Laurel Example — A demo blog built with Laurel against the Ghost Casper theme</title>',
    );
    expect(indexHtml).toContain('class="viewport"');
    expect(indexHtml).toContain('/assets/built/screen.');
    expect(indexHtml).toContain('/assets/built/casper.');
    expect(indexHtml).not.toMatch(/\{\{[a-zA-Z][^}]*\}\}/);

    const postHtml = readFileSync(join(distRoot, 'hello-laurel/index.html'), 'utf8');
    expect(postHtml).toContain('Hello, Laurel');
    expect(postHtml).toContain('Casper');
    expect(postHtml).toContain('class="article');
    expect(postHtml).toContain('byline-reading-time');
    expect(postHtml).toContain('1 min read');

    const firstCard = indexHtml.match(/<img\b[^>]*\bclass="post-card-image"[^>]*>/g)?.[0];
    expect(firstCard).toBeDefined();
    expect(firstCard).toContain('loading="lazy"');
    expect(firstCard).toContain('width="1200"');
    expect(firstCard).toContain('height="600"');

    const lazyCards = indexHtml.match(/<img\b[^>]*\bclass="post-card-image"[^>]*>/g) ?? [];
    for (const card of lazyCards) {
      expect(card).toContain('loading="lazy"');
      expect(card).toContain('width="1200"');
      expect(card).toContain('height="600"');
    }

    const tagHtml = readFileSync(join(distRoot, 'tag/news/index.html'), 'utf8');
    expect(tagHtml).toContain('News');
    expect(tagHtml).toContain('Hello, Laurel');
    expect(tagHtml).toContain('<title>News</title>');
    expect(tagHtml).toContain(
      '<meta name="description" content="Announcements and project updates from the Laurel team.">',
    );
    expect(tagHtml).toContain('<meta property="og:title" content="News | Laurel Example">');
    expect(tagHtml).toContain(
      '<meta property="og:description" content="Announcements and project updates from the Laurel team.">',
    );

    const authorHtml = readFileSync(join(distRoot, 'author/casper/index.html'), 'utf8');
    expect(authorHtml).toContain('Casper');
    expect(authorHtml).toContain('<title>Casper</title>');
    expect(authorHtml).toContain(
      '<meta name="description" content="Friendly mascot of the open publishing platform Ghost — and the canonical Laurel test author.">',
    );
    expect(authorHtml).toContain('<meta property="og:title" content="Casper | Laurel Example">');

    for (const [label, html] of [
      ['home', indexHtml],
      ['post', postHtml],
      ['tag', tagHtml],
      ['author', authorHtml],
    ] as const) {
      const matches = html.match(/<main\b/g) ?? [];
      expect(matches.length, `${label} page should have exactly one <main> landmark`).toBe(1);
      const mainId = html.match(/<main[^>]*\bid="([^"]+)"/)?.[1];
      expect(mainId, `${label} page <main> should carry an id for skip-link targeting`).toBe(
        'site-main',
      );
      expect(html, `${label} page search button must have non-empty aria-label`).not.toMatch(
        /<button[^>]*\bgh-search\b[^>]*\baria-label=""/,
      );
      expect(html, `${label} page search button should use Casper search class`).toContain(
        'gh-search gh-icon-btn',
      );
      expect(html, `${label} page burger button must have non-empty aria-label`).not.toMatch(
        /<button[^>]*\bgh-burger\b[^>]*\baria-label=""/,
      );
      expect(html, `${label} page must emit a skip-to-content link targeting the main id`).toMatch(
        /<a [^>]*class="laurel-skip-link[^"]*"[^>]*href="#site-main"[^>]*>\s*Skip to content\s*<\/a>/,
      );
      const bodyOpenMatch = html.match(/<body\b[^>]*>/i);
      expect(bodyOpenMatch, `${label} page must have a <body> tag`).not.toBeNull();
      const bodyOpenEnd = (bodyOpenMatch?.index ?? 0) + (bodyOpenMatch?.[0]?.length ?? 0);
      const skipAnchorPos = html.indexOf('<a class="laurel-skip-link');
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

    // a11y (issue #204): wrapper headings such as gh-featured-title and
    // gh-container-title must not render as empty <h2> elements when their
    // label string is blank. Empty headings break screen-reader heading
    // navigation and fail axe rule 'empty-heading'.
    for (const [label, html] of [
      ['home', indexHtml],
      ['post', postHtml],
      ['tag', tagHtml],
      ['author', authorHtml],
    ] as const) {
      const emptyHeadingMatch = html.match(/<h([1-6])\b[^>]*>\s*<\/h\1>/i);
      expect(
        emptyHeadingMatch?.[0],
        `${label} page must not emit empty heading elements`,
      ).toBeUndefined();
    }

    // Card images must declare intrinsic width/height so browsers
    // can reserve layout space (avoids Cumulative Layout Shift).
    const cardImgPattern =
      /<img\b[^>]*\bclass="post-card-image"[^>]*\bwidth="\d+"[^>]*\bheight="\d+"/;
    expect(indexHtml, 'index card images must declare width/height').toMatch(cardImgPattern);

    expect(existsSync(join(distRoot, 'rss.xml'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap.xml'))).toBeTrue();
    // Ghost-style split: sitemap.xml is the index, individual URLs live in
    // sitemap-posts.xml / sitemap-pages.xml / sitemap-tags.xml / sitemap-authors.xml.
    expect(existsSync(join(distRoot, 'sitemap-posts.xml'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap-pages.xml'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap-tags.xml'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap-authors.xml'))).toBeTrue();
    // gzip companions land next to every sitemap so hosts can serve
    // pre-compressed payloads without a runtime gzip step.
    expect(existsSync(join(distRoot, 'sitemap.xml.gz'))).toBeTrue();
    expect(existsSync(join(distRoot, 'sitemap-posts.xml.gz'))).toBeTrue();

    const sitemapIndex = readFileSync(join(distRoot, 'sitemap.xml'), 'utf8');
    expect(sitemapIndex).toContain('<sitemapindex');
    expect(sitemapIndex).toContain('<loc>https://laurel.example.com/sitemap-posts.xml</loc>');

    const sitemapPosts = readFileSync(join(distRoot, 'sitemap-posts.xml'), 'utf8');
    expect(sitemapPosts).toContain('<loc>https://laurel.example.com/hello-laurel/</loc>');

    // a11y/perf (issue #199): the contrast class must be emitted on <html>
    // at build time so there is no FOUC, and the inline script that reads
    // --background-color via getComputedStyle must be gone.
    for (const [label, html] of [
      ['home', indexHtml],
      ['post', postHtml],
      ['tag', tagHtml],
      ['author', authorHtml],
    ] as const) {
      expect(html, `${label} page <body> must carry a precomputed text color class`).toMatch(
        /<body[^>]*\bclass="(?:[^"]*\s)?[^"]*has-(?:dark|light)-text(?:\s[^"]*)?"/,
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
