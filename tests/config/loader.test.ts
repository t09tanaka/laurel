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
});
