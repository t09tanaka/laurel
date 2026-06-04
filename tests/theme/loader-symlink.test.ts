import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from '~/config/schema.ts';
import { loadTheme } from '~/theme/loader.ts';

async function makeMinimalThemePkg(themeDir: string): Promise<void> {
  await writeFile(
    join(themeDir, 'package.json'),
    JSON.stringify({
      name: 'symlink-test',
      version: '0.0.1',
      author: { email: 't@example.com' },
      config: { posts_per_page: 5 },
    }),
  );
}

describe('loadTheme symlink protection', () => {
  test('skips symlinked .hbs templates and partials, and symlinked locale files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'laurel-load-'));
    const themeDir = join(cwd, 'themes', 'sym');
    await mkdir(join(themeDir, 'partials'), { recursive: true });
    await mkdir(join(themeDir, 'locales'), { recursive: true });
    await makeMinimalThemePkg(themeDir);

    await writeFile(join(themeDir, 'default.hbs'), '<html>{{{body}}}</html>');
    await writeFile(join(themeDir, 'index.hbs'), '<h1>index</h1>');
    await writeFile(join(themeDir, 'partials', 'real.hbs'), '<span>real</span>');
    await writeFile(join(themeDir, 'locales', 'en.json'), '{"hello":"hi"}');

    const outside = await mkdtemp(join(tmpdir(), 'laurel-outside-'));
    const secretTemplate = join(outside, 'secret.hbs');
    const secretPartial = join(outside, 'secret-partial.hbs');
    const secretLocale = join(outside, 'secret.json');
    await writeFile(secretTemplate, 'SECRET_TEMPLATE');
    await writeFile(secretPartial, 'SECRET_PARTIAL');
    await writeFile(secretLocale, '{"leak":"SECRET"}');
    await symlink(secretTemplate, join(themeDir, 'oops.hbs'));
    await symlink(secretPartial, join(themeDir, 'partials', 'oops.hbs'));
    await symlink(secretLocale, join(themeDir, 'locales', 'oops.json'));

    const config = configSchema.parse({
      theme: { name: 'sym', dir: 'themes' },
      site: { title: 'T', url: 'https://example.com' },
    });
    const theme = await loadTheme({ cwd, config });

    expect(theme.templates.index).toBeDefined();
    expect(theme.templates.default).toBeDefined();
    expect(theme.partials.real).toBeDefined();
    expect(theme.locales.en).toBeDefined();

    expect(theme.templates.oops).toBeUndefined();
    expect(theme.partials.oops).toBeUndefined();
    expect(theme.locales.oops).toBeUndefined();

    for (const v of Object.values(theme.templates)) {
      expect(v).not.toBe('SECRET_TEMPLATE');
    }
    for (const v of Object.values(theme.partials)) {
      expect(v).not.toBe('SECRET_PARTIAL');
    }
  });
});
