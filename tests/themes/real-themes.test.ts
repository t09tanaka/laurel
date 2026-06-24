import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '~/build/pipeline.ts';
import { runSmoke } from '../fixtures/theme-smoke/run.ts';

// Contract test for real-shaped Ghost themes (issue #176). Every theme under
// `tests/fixtures/themes/` is built end-to-end against the smoke fixture site
// and the emitted HTML is asserted to have no `{{` leaks and no parse errors.
// `casper-mini` ships checked-in and runs in every CI; heavier real-release
// tarballs (Casper, Headline, Edition, Wave, Solo) can be dropped into the
// same directory and they auto-discover here without changing this file.
//
// See `tests/fixtures/themes/README.md` for the policy and vendoring story.
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'themes');

async function discoverThemes(): Promise<string[]> {
  if (!existsSync(FIXTURE_DIR)) return [];
  const entries = await readdir(FIXTURE_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(FIXTURE_DIR, name, 'package.json')))
    .sort();
}

const themes = await discoverThemes();

describe('real Ghost theme contract', () => {
  // Pin the contract: at least the checked-in `casper-mini` fixture must be
  // discoverable. If somebody removes the fixture by accident the contract
  // surface goes silent without a test, so guard against that explicitly.
  test('discovers at least one vendored theme', () => {
    expect(themes.length).toBeGreaterThan(0);
    expect(themes).toContain('casper-mini');
  });

  for (const themeName of themes) {
    test(`${themeName} builds end-to-end with no Handlebars leaks`, async () => {
      const themePath = join(FIXTURE_DIR, themeName);
      const result = await runSmoke({
        themeName,
        themePath,
        keepWorkDir: true,
        log: () => {},
      });
      try {
        expect(result.routeCount).toBeGreaterThan(0);

        const distRoot = join(result.workDir, 'dist');
        const indexHtml = readFileSync(join(distRoot, 'index.html'), 'utf8');
        const postHtml = readFileSync(join(distRoot, 'welcome', 'index.html'), 'utf8');

        // No surviving Handlebars markers. The regex tolerates `&#123;&#123;`
        // (HTML-escaped braces inside `<pre><code>` blocks) since marked emits
        // entities for raw `{{` in code fences, which is correct output.
        expect(
          indexHtml,
          `${themeName}: index.html must not contain raw {{...}} markers`,
        ).not.toMatch(/\{\{[^}]*\}\}/);

        // Asset fingerprinting through `{{asset}}` must land an actual URL in
        // the rendered HTML.
        expect(
          indexHtml,
          `${themeName}: index.html must include fingerprinted built/screen.css URL`,
        ).toMatch(/assets\/built\/screen\.[A-Za-z0-9]+\.css/);

        // Skip-link contract (a11y baseline shared with example-build.test.ts).
        expect(indexHtml).toContain('Skip to content');

        if (themeName === 'casper-mini') {
          expect(
            postHtml,
            `${themeName}: post reading-time helper must not render an empty label`,
          ).toContain('<p class="reading-time">1 min read</p>');
        }
      } finally {
        // Best-effort cleanup; failures inside the assertion block already
        // surface the workdir via the smoke log so we drop it here.
        await Bun.write(join(result.workDir, '.cleanup.marker'), '1').catch(() => undefined);
      }
    });
  }

  test('headline-mini renders secondary sections with tags.[3] array-index syntax', async () => {
    const siteFixture = join(FIXTURE_DIR, '..', 'theme-smoke', 'site');
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-headline-array-index-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'headline-mini'), join(workDir, 'themes', 'headline-mini'), {
      recursive: true,
    });

    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Headline Array Index"',
        'description = "Smoke fixture for Headline tags.[3]"',
        'url = "https://smoke.example.com"',
        'locale = "en"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        '',
        '[theme]',
        'name = "headline-mini"',
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
        '',
      ].join('\n'),
      'utf8',
    );

    const extraTags = [
      ['alpha', 'Alpha'],
      ['bravo', 'Bravo'],
      ['charlie', 'Charlie'],
      ['delta', 'Delta'],
    ] as const;
    for (const [slug, name] of extraTags) {
      await writeFile(
        join(workDir, 'content', 'tags', `${slug}.md`),
        ['---', `slug: ${slug}`, `name: ${name}`, '---', ''].join('\n'),
        'utf8',
      );
    }

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);
    const indexHtml = readFileSync(join(workDir, 'dist', 'index.html'), 'utf8');
    expect(indexHtml).toContain('data-headline-secondary');
    expect(indexHtml).toContain('data-topic="delta"');
  });

  test('solo-mini preserves gh-prefixed no-image post classes through minified smoke build', async () => {
    const siteFixture = join(FIXTURE_DIR, '..', 'theme-smoke', 'site');
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-solo-gh-content-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'solo-mini'), join(workDir, 'themes', 'solo-mini'), {
      recursive: true,
    });

    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Solo GH Content"',
        'description = "Smoke fixture for Solo no-image post layout"',
        'url = "https://smoke.example.com"',
        'locale = "en"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        '',
        '[theme]',
        'name = "solo-mini"',
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
        'minify_html = true',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);

    const postHtml = readFileSync(join(workDir, 'dist', 'second-take', 'index.html'), 'utf8');
    expect(postHtml).toContain('class="gh-content gh-canvas solo-fallback-header"');
    expect(postHtml).toContain('class="gh-content gh-canvas"');
    expect(postHtml).not.toContain('class="content canvas solo-fallback-header"');

    const cssHref = postHtml.match(/href="([^"]*assets\/built\/screen\.[A-Za-z0-9]+\.css)"/)?.[1];
    expect(cssHref).toBeString();
    const cssPath = join(workDir, 'dist', cssHref?.replace(/^\//, '') ?? '');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('.gh-canvas');
    expect(css).toContain('.gh-content');
    expect(css).not.toContain('.canvas');
    expect(css).not.toContain('.content');
  });

  test('solo-mini exposes primary_tag.accent_color to post.hbs', async () => {
    const siteFixture = join(FIXTURE_DIR, '..', 'theme-smoke', 'site');
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-solo-tag-accent-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    const themeDir = join(workDir, 'themes', 'solo-mini');
    await cp(join(FIXTURE_DIR, 'solo-mini'), themeDir, { recursive: true });

    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Solo Tag Accent"',
        'description = "Smoke fixture for Solo primary_tag.accent_color"',
        'url = "https://smoke.example.com"',
        'locale = "en"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        '',
        '[theme]',
        'name = "solo-mini"',
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
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(workDir, 'content', 'tags', 'general.md'),
      [
        '---',
        'slug: general',
        'name: General',
        'description: "Default tag for the smoke fixture."',
        'feature_image: "/content/images/cover.svg"',
        'accent_color: "#ff5a7a"',
        '---',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(themeDir, 'post.hbs'),
      [
        '{{!< default}}',
        '<article class="solo-post {{post_class}}" style="--tag-accent: {{primary_tag.accent_color}}">',
        '  <h1>{{title}}</h1>',
        '  <section class="gh-content gh-canvas">',
        '    {{content}}',
        '  </section>',
        '</article>',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);

    const postHtml = readFileSync(join(workDir, 'dist', 'welcome', 'index.html'), 'utf8');
    expect(postHtml).toContain('style="--tag-accent: #ff5a7a"');
  });

  test('casper-mini keeps Koenig cards as direct gh-content gh-canvas children', async () => {
    const siteFixture = join(FIXTURE_DIR, '..', 'theme-smoke', 'site');
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-casper-gh-content-card-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'casper-mini'), join(workDir, 'themes', 'casper-mini'), {
      recursive: true,
    });

    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Casper Card Wrapper"',
        'description = "Smoke fixture for Casper Koenig card grid wrappers"',
        'url = "https://smoke.example.com"',
        'locale = "en"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        '',
        '[theme]',
        'name = "casper-mini"',
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
        '',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(workDir, 'content', 'posts', 'card-wrapper-contract.md'),
      [
        '---',
        'title: "Card wrapper contract"',
        'slug: card-wrapper-contract',
        'date: 2026-01-20T09:00:00Z',
        'authors: [laurel-bot]',
        'tags: [general]',
        '---',
        '',
        '{{< bookmark url="https://example.com/wrapper" title="Wrapper contract" />}}',
        '',
        'The card above must stay on the Casper-family content grid.',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);

    const postHtml = readFileSync(
      join(workDir, 'dist', 'card-wrapper-contract', 'index.html'),
      'utf8',
    );
    expect(postHtml).toContain('class="gh-content gh-canvas"');
    expect(postHtml).toMatch(
      /<div class="gh-content gh-canvas">\s*<figure class="kg-card kg-bookmark-card kg-width-regular">/,
    );
    expect(postHtml).not.toContain('<div class="kg-card-wrapper"><figure class="kg-card');
  });

  test('casper-style cross-theme helpers cover legacy members, custom assets, and pagination gaps', async () => {
    const siteFixture = join(FIXTURE_DIR, '..', 'theme-smoke', 'site');
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-cross-theme-helpers-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    const themeDir = join(workDir, 'themes', 'casper-mini');
    await cp(join(FIXTURE_DIR, 'casper-mini'), themeDir, { recursive: true });
    await mkdir(join(themeDir, 'assets', 'images'), { recursive: true });

    await writeFile(join(themeDir, 'assets', 'images', 'white-logo.png'), 'png', 'utf8');
    await writeFile(
      join(themeDir, 'assets', 'built', 'screen.min.css'),
      'body{color:#111}',
      'utf8',
    );
    await writeFile(join(workDir, 'content', 'images', 'photo.jpg'), 'jpg', 'utf8');
    await writeFile(
      join(themeDir, 'package.json'),
      JSON.stringify(
        {
          name: 'casper-mini',
          version: '0.0.0',
          config: {
            posts_per_page: 2,
            image_sizes: { m: { width: 720 } },
            custom: {
              white_logo_for_dark_mode: {
                type: 'image',
                default: 'assets/images/white-logo.png',
              },
              background_color: { type: 'color', default: '#fafafa' },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      join(themeDir, 'default.hbs'),
      [
        '<!DOCTYPE html>',
        '<html lang="{{@site.locale}}">',
        '<head>',
        '  <meta charset="utf-8">',
        '  <title>{{meta_title}}</title>',
        '  <link data-min-screen href="{{asset "built/screen.css" hasMinFile="true"}}">',
        '  {{ghost_head}}',
        '</head>',
        '<body style="--custom-bg: {{@custom.background_color}}">',
        '  <a class="laurel-skip-link" href="#main">Skip to content</a>',
        '  <img data-custom-logo src="{{img_url @custom.white_logo_for_dark_mode}}" alt="">',
        '  {{#if @labs.subscribers}}<span data-labs-subscribers></span>{{/if}}',
        '  {{#if @labs.members}}<span data-labs-members></span>{{/if}}',
        '  {{#has tag="general"}}<span data-unexpected-home-tag></span>{{else}}<span data-no-post-has></span>{{/has}}',
        '  <main id="main">{{{body}}}</main>',
        '  <footer data-current-year="{{date format="YYYY"}}"></footer>',
        '  {{ghost_foot}}',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(themeDir, 'home.hbs'),
      [
        '{{!< default}}',
        '<section class="gh-feed">',
        '  {{#foreach posts}}{{> "card" width="wide"}}{{/foreach}}',
        '</section>',
        '<p data-page-copy>{{t "Page {page} of {pages}" page=pagination.page pages=pagination.pages}}</p>',
        '{{#get "posts" filter="published_at:<\'2025-01-01\'" limit="10" include="tags" as |older|}}',
        '  <section data-older-posts>{{#foreach older}}<article data-old-post="{{slug}}">{{title}}</article>{{/foreach}}</section>',
        '{{/get}}',
        '{{#pagination}}',
        '  {{#if next}}<a data-pagination-next href="{{next_url}}">next</a>{{/if}}',
        '  {{#if prev}}<a data-pagination-prev href="{{prev_url}}">prev</a>{{/if}}',
        '{{/pagination}}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(join(themeDir, 'index.hbs'), '{{> "__template__/home"}}', 'utf8');
    await writeFile(
      join(themeDir, 'post.hbs'),
      [
        '{{!< default}}',
        '<article class="gh-article {{post_class}}">',
        '  <h1>{{title}}</h1>',
        '  <p data-lang="{{lang}}"></p>',
        '  <img data-format-image src="{{img_url feature_image size="m" format="webp"}}" alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}">',
        '  {{#has visibility="public"}}<span data-public-post></span>{{else}}<span data-non-public-post></span>{{/has}}',
        '  {{^has visibility="public"}}<span data-negated-non-public></span>{{/has}}',
        '  <form data-legacy-members action="{{action}}" method="post">{{hidden label="Daily"}}{{input_email autofocus=true placeholder=(t "Email")}}{{script}}</form>',
        '  {{subscribe_form placeholder="Your inbox"}}',
        '</article>',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(workDir, 'content', 'posts', 'cross-theme-compat.md'),
      [
        '---',
        'title: "Cross theme compat"',
        'slug: cross-theme-compat',
        'date: 2024-01-01T00:00:00Z',
        'locale: ja',
        'visibility: members',
        'feature_image: "/content/images/photo.jpg"',
        'authors: [laurel-bot]',
        'tags: [general]',
        '---',
        '',
        'Members-only compatibility body.',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Cross Theme Helpers"',
        'description = "Cross-theme helper fixture"',
        'url = "https://smoke.example.com"',
        'locale = "en"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        'members_enabled = true',
        '',
        '[theme]',
        'name = "casper-mini"',
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
        'posts_per_page = 2',
        'copy_content_assets = true',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);

    const indexHtml = readFileSync(join(workDir, 'dist', 'en', 'index.html'), 'utf8');
    expect(indexHtml).toContain('data-labs-subscribers');
    expect(indexHtml).toContain('data-labs-members');
    expect(indexHtml).toContain('data-no-post-has');
    expect(indexHtml).not.toContain('data-unexpected-home-tag');
    expect(indexHtml).toMatch(
      /data-min-screen href="\/assets\/built\/screen\.min\.[A-Za-z0-9]+\.css"/,
    );
    expect(indexHtml).toMatch(
      /data-custom-logo src="\/assets\/images\/white-logo\.[A-Za-z0-9]+\.png"/,
    );
    expect(indexHtml).toContain('style="--custom-bg: #fafafa"');
    expect(indexHtml).toContain('data-page-copy>Page 1 of 2</p>');
    expect(indexHtml).toContain('data-old-post="cross-theme-compat"');
    expect(indexHtml).toContain('data-pagination-next');
    expect(indexHtml).toContain(`data-current-year="${new Date().getFullYear()}"`);
    expect(indexHtml).toContain('kg-width-wide');
    expect(indexHtml).toContain('alt="Placeholder cover"');

    const postHtml = readFileSync(
      join(workDir, 'dist', 'ja', 'cross-theme-compat', 'index.html'),
      'utf8',
    );
    expect(postHtml).toContain('data-lang="ja"');
    expect(postHtml).toContain(
      'src="/content/images/size/w720/format/webp/photo.jpg.webp" alt="Cross theme compat"',
    );
    expect(postHtml).toContain('data-non-public-post');
    expect(postHtml).toContain('data-negated-non-public');
    expect(postHtml).toContain('action="#"');
    expect(postHtml).toContain('data-members-label type="hidden" value="Daily"');
    expect(postHtml).toMatch(
      /<input\b(?=[^>]*\bdata-members-email\b)(?=[^>]*\btype="email")(?=[^>]*\bname="email")(?=[^>]*\brequired\b)(?=[^>]*\bplaceholder="Email")(?=[^>]*\bautofocus\b)[^>]*>/,
    );
    expect(postHtml).toContain('placeholder="Your inbox"');
    expect(postHtml).not.toContain('{{script}}');
  });
});

describe('casper-mini i18n contract (issue #1707)', () => {
  test('locale=en preserves empty-string locale entries instead of falling back to keys', async () => {
    const result = await runSmoke({
      themeName: 'casper-mini',
      themePath: join(FIXTURE_DIR, 'casper-mini'),
      keepWorkDir: true,
      log: () => {},
    });
    const indexHtml = readFileSync(join(result.workDir, 'dist', 'index.html'), 'utf8');
    // The smoke fixture sets locale=en and casper-mini/en.json intentionally
    // contains empty strings. Ghost treats those as authoritative values, so
    // Laurel must not fall through to the English keys.
    expect(indexHtml).toContain('<button class="gh-signin" data-portal="signin"></button>');
    expect(indexHtml).toContain('<footer></footer>');
    expect(indexHtml).not.toContain('Sign in');
    expect(indexHtml).not.toContain('Powered by Casper-Mini');
  });

  test('Casper-mini de.json placeholders are applied when site.locale=de', async () => {
    // This branch rebuilds the smoke site by hand with locale=de in
    // laurel.toml. We sidestep the smoke harness's en-only renderer by
    // patching the toml file the harness wrote into place.
    const { mkdtemp, cp, mkdir, writeFile, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { build } = await import('~/build/pipeline.ts');

    const siteFixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'fixtures',
      'theme-smoke',
      'site',
    );
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-casper-i18n-de-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'casper-mini'), join(workDir, 'themes', 'casper-mini'), {
      recursive: true,
    });

    const toml = await readFile(join(siteFixture, '..', 'run.ts'), 'utf8');
    // Reuse the harness's toml emitter rather than reimplementing it.
    // runSmoke is async and writes the toml itself, so we ship a hand-written
    // de toml directly.
    void toml;
    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Casper Mini DE"',
        'description = "i18n smoke"',
        'url = "https://smoke.example.com"',
        'locale = "de"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        '',
        '[theme]',
        'name = "casper-mini"',
        'dir = "themes"',
        '',
        '[build]',
        'output_dir = "dist"',
        'base_path = "/"',
        'posts_per_page = 5',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);
    const indexHtml = readFileSync(join(workDir, 'dist', 'index.html'), 'utf8');
    expect(indexHtml).toContain('Anmelden');
    expect(indexHtml).toContain('Betrieben durch Casper-Mini');
    expect(indexHtml).not.toContain('Sign in');
    expect(indexHtml).not.toContain('Powered by Casper-Mini');

    // <html lang="de"> reflects the active locale.
    expect(indexHtml).toMatch(/<html lang="de"/);
  });

  test('Casper-mini de.json translates portal and member-facing t helper strings', async () => {
    const { mkdtemp, cp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { build } = await import('~/build/pipeline.ts');

    const siteFixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'fixtures',
      'theme-smoke',
      'site',
    );
    const workDir = await mkdtemp(join(tmpdir(), 'laurel-casper-portal-i18n-de-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    const themeDir = join(workDir, 'themes', 'casper-mini');
    await cp(join(FIXTURE_DIR, 'casper-mini'), themeDir, { recursive: true });

    await writeFile(
      join(themeDir, 'default.hbs'),
      [
        '<!DOCTYPE html>',
        '<html lang="{{@site.locale}}">',
        '<head>',
        '  <meta charset="utf-8">',
        '  <title>{{meta_title}}</title>',
        '  {{ghost_head}}',
        '</head>',
        '<body>',
        '  <main>{{{body}}}</main>',
        '  <section data-portal-i18n-contract>',
        '    <button data-portal="signup">{{t "Subscribe"}}</button>',
        '    <button data-portal="signin">{{t "Sign in"}}</button>',
        '    <button data-portal="account">{{t "Account"}}</button>',
        '    <button data-portal="upgrade">{{t "Upgrade"}}</button>',
        '    <p data-email-sent>{{t "Email sent"}}</p>',
        '    <input aria-label="{{t "Search this site"}}" placeholder="{{t "jamie@example.com"}}">',
        '    <h2>{{t "Recommendations"}}</h2>',
        '    <a href="/recommendations/">{{t "See all"}}</a>',
        '    <label>{{t "Search posts, tags and authors"}}</label>',
        '    <p data-members-only>{{t "This post is for members only"}}</p>',
        '  </section>',
        '  {{ghost_foot}}',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(workDir, 'laurel.toml'),
      [
        '[site]',
        'title = "Casper Portal I18n DE"',
        'description = "i18n smoke"',
        'url = "https://smoke.example.com"',
        'locale = "de"',
        'timezone = "UTC"',
        'accent_color = "#222222"',
        '',
        '[theme]',
        'name = "casper-mini"',
        'dir = "themes"',
        '',
        '[build]',
        'output_dir = "dist"',
        'base_path = "/"',
        'posts_per_page = 5',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd: workDir });
    expect(summary.routeCount).toBeGreaterThan(0);

    const indexHtml = readFileSync(join(workDir, 'dist', 'index.html'), 'utf8');
    expect(indexHtml).toContain('Abonnieren');
    expect(indexHtml).toContain('Anmelden');
    expect(indexHtml).toContain('Konto');
    expect(indexHtml).toContain('E-Mail gesendet');
    expect(indexHtml).toContain('jamie@example.de');
    expect(indexHtml).toContain('Empfehlungen');
    expect(indexHtml).toContain('Alle anzeigen');
    expect(indexHtml).toContain('Upgraden');
    expect(indexHtml).toContain('Diese Website durchsuchen');
    expect(indexHtml).toContain('Beitraege, Tags und Autoren durchsuchen');
    expect(indexHtml).toContain('Dieser Beitrag ist nur fuer Mitglieder');

    expect(indexHtml).not.toContain('Search this site');
    expect(indexHtml).not.toContain('Search posts, tags and authors');
    expect(indexHtml).not.toContain('This post is for members only');
  });
});
