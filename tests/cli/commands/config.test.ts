import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import TOML from '@iarna/toml';
import { lookupDotted, parseConfigValue } from '~/cli/commands/config.ts';

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

describe('parseConfigValue', () => {
  test('coerces booleans and numbers while leaving strings intact', () => {
    expect(parseConfigValue('true')).toBe(true);
    expect(parseConfigValue('false')).toBe(false);
    expect(parseConfigValue('12')).toBe(12);
    expect(parseConfigValue('3.5')).toBe(3.5);
    expect(parseConfigValue('003')).toBe('003');
    expect(parseConfigValue('Config Test')).toBe('Config Test');
    expect(parseConfigValue('"false"')).toBe('false');
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

  test('config print dumps the resolved config as TOML by default', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(['config', 'print'], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = TOML.parse(stdout) as {
        site: { title: string; url: string };
        content: { posts_dir: string };
        build: { output_dir: string; base_path: string };
      };
      expect(parsed.site.title).toBe('Config Test');
      expect(parsed.site.url).toBe('https://config.test');
      expect(parsed.content.posts_dir).toBe('content/posts');
      expect(parsed.build.output_dir).toBe('dist');
      expect(parsed.build.base_path).toBe('/blog/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config print --format json dumps merged config layers plus defaults', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'prod.toml'),
        ['[site]', 'title = "Layered Config"', ''].join('\n'),
      );
      const { stdout, stderr, exitCode } = await runCli(
        ['config', 'print', '--config', 'nectar.toml', '--config', 'prod.toml', '--format', 'json'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        site: { title: string; url: string };
        content: { posts_dir: string };
        components: { rss: { enabled: boolean }; search: { enabled: boolean } };
      };
      expect(parsed.site.title).toBe('Layered Config');
      expect(parsed.site.url).toBe('https://config.test');
      expect(parsed.content.posts_dir).toBe('content/posts');
      expect(parsed.components.rss.enabled).toBe(false);
      expect(parsed.components.search.enabled).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config print --json aliases JSON format', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['config', 'print', '--json'], dir);
      expect(exitCode).toBe(0);
      expect((JSON.parse(stdout) as { site: { title: string } }).site.title).toBe('Config Test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config validate exits 0 for a valid config', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(['config', 'validate'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Config OK: Config Test');
      expect(stderr).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config validate pretty-prints config errors', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-invalid-')));
    try {
      await writeFile(join(dir, 'nectar.toml'), '[site]\ntitle = 123\n');
      const { stdout, stderr, exitCode } = await runCli(['config', 'validate'], dir);
      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('nectar.toml');
      expect(stderr).toContain('site.title');
      expect(stderr).toContain('string');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config validate --json emits a machine-readable result', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-invalid-json-')));
    try {
      await writeFile(join(dir, 'nectar.toml'), '[site]\ntitle = 123\n');
      const { stdout, stderr, exitCode } = await runCli(['config', 'validate', '--json'], dir);
      expect(exitCode).toBe(1);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        errors: Array<{ code: string; file?: string; message: string }>;
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.errors[0]?.code).toBe('config');
      expect(parsed.errors[0]?.file).toBe('nectar.toml');
      expect(parsed.errors[0]?.message).toContain('site.title');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config validate --json reports ok for a valid config', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(['config', 'validate', '--json'], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        errors: unknown[];
        site: { title: string; url: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.errors).toEqual([]);
      expect(parsed.site.title).toBe('Config Test');
      expect(parsed.site.url).toBe('https://config.test');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config print rejects unknown formats', async () => {
    const { stderr, exitCode } = await runCli(['config', 'print', '--format', 'yaml']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid config print format');
  });

  test('config set updates a TOML string value and preserves trailing comments', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-set-toml-')));
    try {
      await writeFile(
        join(dir, 'nectar.toml'),
        [
          '# Site settings',
          '[site]',
          'title = "Before" # keep this comment',
          'url = "https://config.test"',
          '',
        ].join('\n'),
      );
      const result = await runCli(['config', 'set', 'site.title', 'After'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set site.title');
      const body = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(body).toContain('# Site settings');
      expect(body).toContain('title = "After" # keep this comment');
      const get = await runCli(['config', 'get', 'site.title'], dir);
      expect(get.exitCode).toBe(0);
      expect(get.stdout.trim()).toBe('After');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config set writes numbers and booleans at dotted paths', async () => {
    const dir = await makeFixture();
    try {
      const count = await runCli(['config', 'set', 'build.posts_per_page', '12'], dir);
      expect(count.exitCode).toBe(0);
      const rss = await runCli(['config', 'set', 'components.rss.enabled', 'true'], dir);
      expect(rss.exitCode).toBe(0);
      const countGet = await runCli(['config', 'get', 'build.posts_per_page', '--json'], dir);
      expect(JSON.parse(countGet.stdout)).toBe(12);
      const rssGet = await runCli(['config', 'get', 'components.rss.enabled', '--json'], dir);
      expect(JSON.parse(rssGet.stdout)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config set updates JSON config files', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-set-json-')));
    try {
      await writeFile(
        join(dir, 'nectar.config.json'),
        `${JSON.stringify({ site: { title: 'Before', url: 'https://config.test' } }, null, 2)}\n`,
      );
      const result = await runCli(['config', 'set', 'site.title', 'From JSON'], dir);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(await readFile(join(dir, 'nectar.config.json'), 'utf8')) as {
        site: { title: string };
      };
      expect(body.site.title).toBe('From JSON');
      const get = await runCli(['config', 'get', 'site.title'], dir);
      expect(get.stdout.trim()).toBe('From JSON');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('config set writes a local TOML override next to TS configs', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-config-set-ts-')));
    try {
      await writeFile(join(dir, 'nectar.config.ts'), 'export default {};\n');
      const result = await runCli(['config', 'set', 'site.title', 'Local Override'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('local TOML override');
      const body = await readFile(join(dir, '.nectar.local.toml'), 'utf8');
      expect(body).toContain('[site]');
      expect(body).toContain('title = "Local Override"');
      const get = await runCli(['config', 'get', 'site.title'], dir);
      expect(get.stdout.trim()).toBe('Local Override');
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
