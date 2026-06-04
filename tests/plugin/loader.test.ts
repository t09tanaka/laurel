import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins } from '~/plugin/loader.ts';
import type { Plugin } from '~/plugin/types.ts';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'laurel-plugin-loader-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('loadPlugins', () => {
  test('returns empty set when no specs are configured', async () => {
    const result = await loadPlugins({ cwd: tmpRoot });
    expect(result.plugins).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test('accepts a pre-instantiated plugin object', async () => {
    const plugin: Plugin = { name: 'inline-test' };
    const result = await loadPlugins({ cwd: tmpRoot, specs: [plugin] });
    expect(result.plugins).toEqual([plugin]);
  });

  test('imports a plugin from a relative file path', async () => {
    const pluginPath = join(tmpRoot, 'my-plugin.mjs');
    await writeFile(
      pluginPath,
      `export default { name: 'from-file', beforeBuild() {} };\n`,
      'utf8',
    );
    const result = await loadPlugins({ cwd: tmpRoot, specs: ['./my-plugin.mjs'] });
    expect(result.plugins.length).toBe(1);
    expect(result.plugins[0]?.name).toBe('from-file');
  });

  test('accepts a factory exported as default', async () => {
    const pluginPath = join(tmpRoot, 'factory-plugin.mjs');
    await writeFile(pluginPath, `export default () => ({ name: 'from-factory' });\n`, 'utf8');
    const result = await loadPlugins({ cwd: tmpRoot, specs: ['./factory-plugin.mjs'] });
    expect(result.plugins.length).toBe(1);
    expect(result.plugins[0]?.name).toBe('from-factory');
  });

  test('accepts a named `plugin` export', async () => {
    const pluginPath = join(tmpRoot, 'named-plugin.mjs');
    await writeFile(pluginPath, `export const plugin = { name: 'from-named' };\n`, 'utf8');
    const result = await loadPlugins({ cwd: tmpRoot, specs: ['./named-plugin.mjs'] });
    expect(result.plugins.length).toBe(1);
    expect(result.plugins[0]?.name).toBe('from-named');
  });

  test('warns and skips when a plugin file fails to load', async () => {
    const result = await loadPlugins({ cwd: tmpRoot, specs: ['./does-not-exist.mjs'] });
    expect(result.plugins).toEqual([]);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]?.spec).toBe('./does-not-exist.mjs');
  });

  test('warns and skips when a plugin is missing a name', async () => {
    const pluginPath = join(tmpRoot, 'nameless.mjs');
    await writeFile(pluginPath, 'export default { setup() {} };\n', 'utf8');
    const result = await loadPlugins({ cwd: tmpRoot, specs: ['./nameless.mjs'] });
    expect(result.plugins).toEqual([]);
  });

  test('de-duplicates plugins that share a name', async () => {
    const first: Plugin = { name: 'dup' };
    const second: Plugin = { name: 'dup' };
    const result = await loadPlugins({ cwd: tmpRoot, specs: [first, second] });
    expect(result.plugins.length).toBe(1);
  });

  test('auto-detects laurel-plugin-* packages under node_modules when enabled', async () => {
    const pkgDir = join(tmpRoot, 'node_modules', 'laurel-plugin-auto');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'laurel-plugin-auto', main: 'index.mjs', type: 'module' }),
      'utf8',
    );
    await writeFile(
      join(pkgDir, 'index.mjs'),
      `export default { name: 'auto-detected' };\n`,
      'utf8',
    );
    const result = await loadPlugins({ cwd: tmpRoot, autoDetect: true });
    expect(result.plugins.map((p) => p.name)).toContain('auto-detected');
  });

  test('does not auto-detect when the flag is off', async () => {
    const pkgDir = join(tmpRoot, 'node_modules', 'laurel-plugin-auto');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'laurel-plugin-auto', main: 'index.mjs', type: 'module' }),
      'utf8',
    );
    await writeFile(
      join(pkgDir, 'index.mjs'),
      `export default { name: 'should-not-load' };\n`,
      'utf8',
    );
    const result = await loadPlugins({ cwd: tmpRoot });
    expect(result.plugins).toEqual([]);
  });
});
