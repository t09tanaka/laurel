import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadThemeAssets } from '~/theme/assets.ts';

describe('loadThemeAssets symlink protection', () => {
  test('skips symlinked theme asset files', async () => {
    const themeDir = await mkdtemp(join(tmpdir(), 'nectar-theme-'));
    const assetsDir = join(themeDir, 'assets');
    await mkdir(join(assetsDir, 'built'), { recursive: true });

    const outside = await mkdtemp(join(tmpdir(), 'nectar-outside-'));
    const secret = join(outside, 'secret.css');
    await writeFile(secret, 'SECRET');
    await symlink(secret, join(assetsDir, 'built', 'oops.css'));

    await writeFile(join(assetsDir, 'built', 'real.css'), 'body{}');

    const map = await loadThemeAssets(themeDir);
    const sources = Array.from(map.values()).map((a) => a.sourcePath);
    expect(sources.some((p) => p.endsWith('real.css'))).toBe(true);
    expect(sources.some((p) => p.endsWith('oops.css'))).toBe(false);
  });
});
