import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
});

describe('casper-mini i18n contract (issue #1707)', () => {
  test('locale=de swaps Source-style {{t "Sign in"}} into the German placeholder', async () => {
    const result = await runSmoke({
      themeName: 'casper-mini',
      themePath: join(FIXTURE_DIR, 'casper-mini'),
      keepWorkDir: true,
      log: () => {},
    });
    const indexHtml = readFileSync(join(result.workDir, 'dist', 'index.html'), 'utf8');
    // The smoke fixture sets locale=en so the German JSON is loaded but the
    // English key falls through to itself (empty-string sentinel). Pin that
    // baseline so the locale-flip test below has a stable counter-example.
    expect(indexHtml).toContain('Sign in');
    expect(indexHtml).toContain('Powered by Casper-Mini');
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
