import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
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
});
