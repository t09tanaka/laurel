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
    expect(indexHtml).toContain(
      '<title>Nectar Example — A demo blog built with Nectar against the Ghost Source theme</title>',
    );
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

    // a11y (issue #198): heading hierarchy must not skip levels. The post
    // page previously used <h4> for the author byline (metadata, not a
    // section heading) immediately after the <h1> title, and archive pages
    // jumped straight from the page <h1> to <h3> card titles.
    expect(postHtml, 'post author byline must not be an <h4> section heading').not.toMatch(
      /<h4[^>]*\bgh-article-author-name\b/,
    );
    // `{{authors}}` autolinks by default (Ghost-compat, #1110), so the byline
    // is `<p class="gh-article-author-name"><a ...>Casper</a></p>` — still
    // inline metadata, just wrapped in an anchor.
    expect(postHtml, 'post author byline should render as inline metadata, not a heading').toMatch(
      /<p[^>]*\bgh-article-author-name\b[^>]*>(?:<a\b[^>]*>)?Casper/,
    );
    for (const [label, html] of [
      ['tag', tagHtml],
      ['author', authorHtml],
    ] as const) {
      const headingLevels = (html.match(/<h([1-6])\b/g) ?? []).map((m) =>
        Number.parseInt(m.slice(2), 10),
      );
      const firstH1 = headingLevels.indexOf(1);
      expect(firstH1, `${label} page must include an <h1>`).toBeGreaterThanOrEqual(0);
      const afterH1 = headingLevels.slice(firstH1);
      const nextNonH1 = afterH1.find((level) => level !== 1);
      expect(nextNonH1, `${label} page must include a heading after the <h1>`).toBeDefined();
      expect(
        nextNonH1,
        `${label} page heading after <h1> must be <h2> (no level skip to <h3>)`,
      ).toBe(2);
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
    expect(sitemapIndex).toContain('<loc>https://nectar.example.com/sitemap-posts.xml</loc>');

    const sitemapPosts = readFileSync(join(distRoot, 'sitemap-posts.xml'), 'utf8');
    expect(sitemapPosts).toContain('<loc>https://nectar.example.com/hello-nectar/</loc>');

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
