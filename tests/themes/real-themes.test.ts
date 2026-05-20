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
      } finally {
        // Best-effort cleanup; failures inside the assertion block already
        // surface the workdir via the smoke log so we drop it here.
        await Bun.write(join(result.workDir, '.cleanup.marker'), '1').catch(() => undefined);
      }
    });
  }

  test('headline-mini renders secondary sections with tags.[3] array-index syntax', async () => {
    const siteFixture = join(FIXTURE_DIR, '..', 'theme-smoke', 'site');
    const workDir = await mkdtemp(join(tmpdir(), 'nectar-headline-array-index-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'headline-mini'), join(workDir, 'themes', 'headline-mini'), {
      recursive: true,
    });

    await writeFile(
      join(workDir, 'nectar.toml'),
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
    const workDir = await mkdtemp(join(tmpdir(), 'nectar-solo-gh-content-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'solo-mini'), join(workDir, 'themes', 'solo-mini'), {
      recursive: true,
    });

    await writeFile(
      join(workDir, 'nectar.toml'),
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
    const workDir = await mkdtemp(join(tmpdir(), 'nectar-solo-tag-accent-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    const themeDir = join(workDir, 'themes', 'solo-mini');
    await cp(join(FIXTURE_DIR, 'solo-mini'), themeDir, { recursive: true });

    await writeFile(
      join(workDir, 'nectar.toml'),
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
    const workDir = await mkdtemp(join(tmpdir(), 'nectar-casper-gh-content-card-'));
    await cp(siteFixture, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(join(FIXTURE_DIR, 'casper-mini'), join(workDir, 'themes', 'casper-mini'), {
      recursive: true,
    });

    await writeFile(
      join(workDir, 'nectar.toml'),
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
        'authors: [nectar-bot]',
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
    // Nectar must not fall through to the English keys.
    expect(indexHtml).toContain('<button class="gh-signin" data-portal="signin"></button>');
    expect(indexHtml).toContain('<footer></footer>');
    expect(indexHtml).not.toContain('Sign in');
    expect(indexHtml).not.toContain('Powered by Casper-Mini');
  });

  test('Casper-mini de.json placeholders are applied when site.locale=de', async () => {
    // This branch rebuilds the smoke site by hand with locale=de in
    // nectar.toml. We sidestep the smoke harness's en-only renderer by
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
    const workDir = await mkdtemp(join(tmpdir(), 'nectar-casper-i18n-de-'));
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
      join(workDir, 'nectar.toml'),
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
});
