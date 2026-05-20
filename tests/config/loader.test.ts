import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { findProjectRoot, loadConfig } from '~/config/loader.ts';
import { NectarError } from '~/util/errors.ts';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-test-'));
  return await fn(dir);
}

describe('loadConfig', () => {
  test('returns defaults when no config is present', async () => {
    await withTempDir(async (cwd) => {
      const config = await loadConfig({ cwd });
      expect(config.site.title).toBe('Nectar Site');
      expect(config.build.posts_per_page).toBe(12);
      expect(config.theme.name).toBe('source');
    });
  });

  test('enables WebP/AVIF image transcoder out of the box', async () => {
    // Task #481: modern formats save 30-50% bytes on jpg/png. The transcoder
    // is opt-out (set `enabled = false` in `[components.images]`), so a vanilla
    // build emits WebP variants without any configuration. The default
    // `formats` is intentionally `['webp']` only: AVIF is much slower and stays
    // opt-in.
    await withTempDir(async (cwd) => {
      const config = await loadConfig({ cwd });
      expect(config.components.images.enabled).toBe(true);
      expect(config.components.images.formats).toEqual(['webp']);
    });
  });

  test('parses nectar.toml', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]
title = "My Blog"
url = "https://example.com"

[build]
posts_per_page = 5

[[navigation]]
label = "Home"
url = "/"
`,
        'utf8',
      );
      const config = await loadConfig({ cwd });
      expect(config.site.title).toBe('My Blog');
      expect(config.site.url).toBe('https://example.com');
      expect(config.build.posts_per_page).toBe(5);
      expect(config.navigation).toEqual([{ label: 'Home', url: '/' }]);
    });
  });

  test('throws NectarError with file:line:col on malformed TOML', async () => {
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, `[site]\ntitle = "abc"\nno_equals_here\n`, 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.file).toBe(file);
        expect(ne.line).toBe(3);
        expect(ne.message).toMatch(/invalid TOML/);
      }
    });
  });

  test('throws NectarError with field path hint on schema mismatch', async () => {
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, '[site]\ntitle = 123\n', 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.file).toBe(file);
        expect(ne.message).toMatch(/site\.title/);
        expect(ne.message).toMatch(/string/);
      }
    });
  });

  test('rejects unknown top-level keys with did-you-mean hint', async () => {
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, '[sites]\ntitle = "Typo"\n', 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.file).toBe(file);
        expect(ne.message).toMatch(/unknown key/);
        expect(ne.message).toMatch(/`sites`/);
        expect(ne.hint).toBe('did you mean `site`?');
      }
    });
  });

  test('rejects unknown nested keys with dotted path and suggestion', async () => {
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, '[site]\ntitle = "Blog"\ndescriptio = "typo"\n', 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.message).toMatch(/unknown key/);
        expect(ne.message).toMatch(/`site\.descriptio`/);
        expect(ne.hint).toBe('did you mean `site.description`?');
      }
    });
  });

  test('rejects unknown keys inside navigation array entries', async () => {
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(
        file,
        `[[navigation]]
label = "Home"
url = "/"
external = true
`,
        'utf8',
      );
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.message).toMatch(/unknown key/);
        expect(ne.message).toMatch(/`navigation\.0\.external`/);
      }
    });
  });

  test('still accepts arbitrary keys under theme.custom', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]
title = "Custom"

[theme.custom]
navigation_layout = "Logo on the left"
some_brand_new_setting = "ok"
`,
        'utf8',
      );
      const config = await loadConfig({ cwd });
      expect(config.theme.custom.some_brand_new_setting).toBe('ok');
      expect(config.theme.custom.navigation_layout).toBe('Logo on the left');
    });
  });

  test('accepts a base64 build.csp_nonce so CSP-aware deploys can opt in', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[build]
csp_nonce = "rAnd0m+Nonce/=="
`,
        'utf8',
      );
      const config = await loadConfig({ cwd });
      expect(config.build.csp_nonce).toBe('rAnd0m+Nonce/==');
    });
  });

  test('leaves build.csp_nonce undefined when omitted (no nonce attribute stamped)', async () => {
    await withTempDir(async (cwd) => {
      const config = await loadConfig({ cwd });
      expect(config.build.csp_nonce).toBeUndefined();
    });
  });

  test('rejects site.url values that are not parseable URLs', async () => {
    // Task #1145: site.url is interpolated into canonical links, sitemap
    // entries, and RSS GUIDs. A bare string like `javascript:alert(1)` or
    // `"><img src=x>` would otherwise reach the output verbatim, so the schema
    // must hard-reject anything that does not parse as an absolute URL.
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, `[site]\ntitle = "Blog"\nurl = "not a url"\n`, 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.message).toMatch(/site\.url/);
        expect(ne.message).toMatch(/url/i);
      }
    });
  });

  test('accepts a valid absolute https URL for site.url', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({ cwd });
      expect(config.site.url).toBe('https://example.com');
    });
  });

  test('rejects site.accent_color values that are not hex CSS colors', async () => {
    // Task #1145: accent_color is dropped into theme CSS via @site.accent_color
    // (and some themes use it for inline style attributes). A value like
    // `red; background: url(//evil)` would inject arbitrary CSS, so the schema
    // restricts it to a literal `#RGB` / `#RRGGBB` / `#RRGGBBAA` hex triplet.
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(
        file,
        `[site]\ntitle = "Blog"\naccent_color = "red; background: url(//evil)"\n`,
        'utf8',
      );
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.message).toMatch(/accent_color/);
      }
    });
  });

  test('accepts 3, 6, and 8 digit hex colors for site.accent_color', async () => {
    for (const value of ['#abc', '#abcdef', '#abcdef80']) {
      await withTempDir(async (cwd) => {
        await writeFile(
          join(cwd, 'nectar.toml'),
          `[site]\ntitle = "Blog"\naccent_color = "${value}"\n`,
          'utf8',
        );
        const config = await loadConfig({ cwd });
        expect(config.site.accent_color).toBe(value);
      });
    }
  });

  test('rejects site.locale values that are not BCP 47 language tags', async () => {
    // Task #1145: locale is rendered into `<html lang="…">` without escaping,
    // so a value containing `"` or `>` would break out of the attribute. The
    // schema restricts it to a BCP 47-shaped tag.
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, `[site]\ntitle = "Blog"\nlocale = "en_US"\n`, 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.message).toMatch(/site\.locale/);
      }
    });
  });

  test('accepts common BCP 47 locale shapes', async () => {
    for (const locale of ['en', 'en-US', 'zh-Hant-TW', 'ar-EG', 'pt-BR']) {
      await withTempDir(async (cwd) => {
        await writeFile(
          join(cwd, 'nectar.toml'),
          `[site]\ntitle = "Blog"\nlocale = "${locale}"\n`,
          'utf8',
        );
        const config = await loadConfig({ cwd });
        expect(config.site.locale).toBe(locale);
      });
    }
  });

  test('rejects build.csp_nonce with characters outside the base64 alphabet', async () => {
    // The renderer injects the nonce into HTML attributes without escaping (the
    // schema is the trust boundary). A value like `"><script>...` must be
    // rejected at config-load time, not emitted into <script nonce="...">.
    await withTempDir(async (cwd) => {
      const file = join(cwd, 'nectar.toml');
      await writeFile(file, `[build]\ncsp_nonce = "\\"><script>"\n`, 'utf8');
      try {
        await loadConfig({ cwd });
        throw new Error('expected loadConfig to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NectarError);
        const ne = err as NectarError;
        expect(ne.message).toMatch(/csp_nonce|base64/);
      }
    });
  });

  // #854: doubled trailing slashes break URL joins downstream. Strip on load
  // so `https://example.com/` and `https://example.com//` both normalise to
  // `https://example.com`.
  test('strips trailing slashes from site.url', async () => {
    for (const [input, expected] of [
      ['https://example.com/', 'https://example.com'],
      ['https://example.com//', 'https://example.com'],
      ['https://example.com/blog/', 'https://example.com/blog'],
    ] as const) {
      await withTempDir(async (cwd) => {
        await writeFile(
          join(cwd, 'nectar.toml'),
          `[site]\ntitle = "Blog"\nurl = "${input}"\n`,
          'utf8',
        );
        const config = await loadConfig({ cwd });
        expect(config.site.url).toBe(expected);
      });
    }
  });

  // #852: NECTAR_<SECTION>_<KEY> overrides any scalar config key. Useful for
  // staging vs prod builds where the same nectar.toml ships everywhere but
  // a deploy hook flips `[site].url` per environment.
  test('applies NECTAR_* env overrides on top of parsed TOML', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "From TOML"\nurl = "https://from-toml.example"\n[build]\nposts_per_page = 5\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          NECTAR_SITE_URL: 'https://from-env.example',
          NECTAR_SITE_TITLE: 'From Env',
          NECTAR_BUILD_POSTS_PER_PAGE: '20',
        },
      });
      expect(config.site.url).toBe('https://from-env.example');
      expect(config.site.title).toBe('From Env');
      expect(config.build.posts_per_page).toBe(20);
    });
  });

  test('uses Netlify DEPLOY_PRIME_URL for preview deploy site.url', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          NETLIFY: 'true',
          CONTEXT: 'deploy-preview',
          DEPLOY_PRIME_URL: 'https://deploy-preview-42--site.netlify.app/',
          DEPLOY_URL: 'https://fallback-deploy.netlify.app',
          URL: 'https://fallback-site.netlify.app',
        },
      });
      expect(config.site.url).toBe('https://deploy-preview-42--site.netlify.app');
    });
  });

  test('falls back to Netlify DEPLOY_URL and URL for branch deploy site.url', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const deployConfig = await loadConfig({
        cwd,
        env: {
          NETLIFY: 'true',
          CONTEXT: 'branch-deploy',
          DEPLOY_URL: 'https://branch-deploy.netlify.app',
          URL: 'https://fallback-site.netlify.app',
        },
      });
      expect(deployConfig.site.url).toBe('https://branch-deploy.netlify.app');

      const urlConfig = await loadConfig({
        cwd,
        env: {
          NETLIFY: 'true',
          CONTEXT: 'branch-deploy',
          URL: 'https://branch-url.netlify.app',
        },
      });
      expect(urlConfig.site.url).toBe('https://branch-url.netlify.app');
    });
  });

  test('keeps explicit NECTAR_SITE_URL ahead of the Netlify deploy URL fallback', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          NETLIFY: 'true',
          CONTEXT: 'deploy-preview',
          DEPLOY_PRIME_URL: 'https://deploy-preview-42--site.netlify.app',
          NECTAR_SITE_URL: 'https://explicit-env.example',
        },
      });
      expect(config.site.url).toBe('https://explicit-env.example');
    });
  });

  test('uses Cloudflare Pages deployment URL and metadata when present', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          CF_PAGES: '1',
          CF_PAGES_URL: 'https://feature-docs.example.pages.dev/',
          CF_PAGES_BRANCH: 'feature/docs',
          CF_PAGES_COMMIT_SHA: 'abc123def456',
        },
      });
      expect(config.site.url).toBe('https://feature-docs.example.pages.dev');
      expect(config.build.metadata).toEqual({
        provider: 'cloudflare_pages',
        branch: 'feature/docs',
        commit_sha: 'abc123def456',
      });
    });
  });

  test('keeps explicit NECTAR_SITE_URL ahead of the Cloudflare Pages URL fallback', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          CF_PAGES: '1',
          CF_PAGES_URL: 'https://feature-docs.example.pages.dev',
          NECTAR_SITE_URL: 'https://explicit-env.example',
        },
      });
      expect(config.site.url).toBe('https://explicit-env.example');
    });
  });

  test('ignores Cloudflare Pages URL when not running on Pages', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          CF_PAGES_URL: 'https://feature-docs.example.pages.dev',
        },
      });
      expect(config.site.url).toBe('https://prod.example.com');
      expect(config.build.metadata).toEqual({});
    });
  });

  test('does not apply Netlify deploy URLs outside preview or branch deploy context', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, 'nectar.toml'),
        `[site]\ntitle = "Blog"\nurl = "https://prod.example.com"\n`,
        'utf8',
      );
      const config = await loadConfig({
        cwd,
        env: {
          NETLIFY: 'true',
          CONTEXT: 'production',
          DEPLOY_PRIME_URL: 'https://production-deploy.netlify.app',
        },
      });
      expect(config.site.url).toBe('https://prod.example.com');
    });
  });

  test('env overrides coerce boolean strings (true/false/0/1)', async () => {
    await withTempDir(async (cwd) => {
      const config = await loadConfig({
        cwd,
        env: {
          NECTAR_BUILD_MINIFY_HTML: 'true',
          NECTAR_BUILD_COPY_CONTENT_ASSETS: '0',
        },
      });
      expect(config.build.minify_html).toBe(true);
      expect(config.build.copy_content_assets).toBe(false);
    });
  });

  test('env overrides reject non-numeric values for number keys', async () => {
    await withTempDir(async (cwd) => {
      // Garbled number string falls back to the schema default rather than
      // crashing the build — the warn output is the operator's signal.
      const config = await loadConfig({
        cwd,
        env: { NECTAR_BUILD_POSTS_PER_PAGE: 'nope' },
      });
      expect(config.build.posts_per_page).toBe(12);
    });
  });

  test('unknown NECTAR_* env vars are ignored without breaking the load', async () => {
    await withTempDir(async (cwd) => {
      const config = await loadConfig({
        cwd,
        env: {
          NECTAR_NOT_A_REAL_KEY: 'whatever',
          NECTAR_LOG_LEVEL: 'debug',
          NECTAR_DRAFTS: '1',
        },
      });
      expect(config.site.title).toBe('Nectar Site');
    });
  });

  // #853: when --config points at a file in a different directory, relative
  // paths inside it should anchor to that file's directory, not the shell's
  // cwd. `findProjectRoot` exposes the same logic for callers that need to
  // resolve other files relative to the project root.
  test('resolves relative paths against the config file directory when configPath is elsewhere', async () => {
    await withTempDir(async (cwd) => {
      const projectRoot = join(cwd, 'project');
      await mkdir(projectRoot, { recursive: true });
      await writeFile(
        join(projectRoot, 'nectar.toml'),
        `[site]\ntitle = "Cross"\n[content]\nposts_dir = "content/posts"\n[theme]\ndir = "themes"\nname = "src"\n`,
        'utf8',
      );
      const elsewhere = join(cwd, 'elsewhere');
      await mkdir(elsewhere, { recursive: true });
      const config = await loadConfig({
        cwd: elsewhere,
        configPath: join(projectRoot, 'nectar.toml'),
      });
      expect(isAbsolute(config.content.posts_dir)).toBe(true);
      expect(config.content.posts_dir).toBe(resolve(projectRoot, 'content/posts'));
      expect(config.theme.dir).toBe(resolve(projectRoot, 'themes'));
    });
  });

  test('keeps relative paths intact when configDir equals cwd (default flow)', async () => {
    await withTempDir(async (cwd) => {
      await writeFile(join(cwd, 'nectar.toml'), `[content]\nposts_dir = "content/posts"\n`, 'utf8');
      const config = await loadConfig({ cwd });
      // Default flow stays back-compat with consumers that pre-date #853:
      // bare relative dirs in -> bare relative dirs out.
      expect(config.content.posts_dir).toBe('content/posts');
    });
  });

  test('findProjectRoot returns the config file directory when one is discoverable', async () => {
    await withTempDir(async (cwd) => {
      const projectRoot = join(cwd, 'p');
      await mkdir(projectRoot, { recursive: true });
      await writeFile(join(projectRoot, 'nectar.toml'), '', 'utf8');
      const result = await findProjectRoot({
        cwd: join(cwd, 'other'),
        configPath: join(projectRoot, 'nectar.toml'),
      });
      expect(resolve(result)).toBe(resolve(projectRoot));
    });
  });

  test('findProjectRoot falls back to cwd when no nectar.toml is present', async () => {
    await withTempDir(async (cwd) => {
      const result = await findProjectRoot({ cwd });
      expect(resolve(result)).toBe(resolve(cwd));
    });
  });
});
