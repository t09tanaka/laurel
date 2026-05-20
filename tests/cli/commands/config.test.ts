import { describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupDotted } from '~/cli/commands/config.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-')));
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Config Test"',
      'url = "https://config.test"',
      'locale = "en-US"',
      '',
      '[build]',
      'base_path = "/blog/"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
  );
  return dir;
}

describe('lookupDotted', () => {
  test('walks plain object paths', () => {
    expect(lookupDotted({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
  });
  test('walks array indices via numeric segments', () => {
    expect(lookupDotted({ xs: [{ id: 'first' }, { id: 'second' }] }, 'xs.1.id')).toBe('second');
  });
  test('returns undefined for missing keys', () => {
    expect(lookupDotted({ a: 1 }, 'a.b.c')).toBeUndefined();
  });
  test('rejects empty segments', () => {
    expect(lookupDotted({ a: 1 }, '')).toBeUndefined();
    expect(lookupDotted({ a: 1 }, 'a..b')).toBeUndefined();
  });
});

describe('cli config', () => {
  test('config path prints the absolute config path', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['config', 'path'], dir);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(join(dir, 'nectar.toml'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config path --json returns a config_path envelope', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['config', 'path', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { config_path: string | null };
      expect(parsed.config_path).toBe(join(dir, 'nectar.toml'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config path --json returns null when no config exists', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-empty-')));
    try {
      const { stdout, exitCode } = await runCli(['config', 'path', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { config_path: string | null };
      expect(parsed.config_path).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config get prints scalar values plainly', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['config', 'get', 'site.url'], dir);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('https://config.test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config get --json returns the raw JSON value', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['config', 'get', 'build.base_path', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toBe('/blog/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config get rejects unknown keys', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['config', 'get', 'no.such.key'], dir);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown config key');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('unknown subcommand exits with code 2', async () => {
    const { stderr, exitCode } = await runCli(['config', 'wat']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown subcommand');
  });
});
