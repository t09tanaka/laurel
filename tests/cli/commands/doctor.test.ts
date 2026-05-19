import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfiesMinVersion } from '~/cli/commands/doctor.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(toml: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-doctor-')));
  await Bun.write(join(dir, 'nectar.toml'), toml);
  return dir;
}

describe('satisfiesMinVersion', () => {
  test('1.3.0 satisfies >=1.3.0', () => {
    expect(satisfiesMinVersion('1.3.0', '>=1.3.0')).toBe(true);
  });
  test('1.2.9 does not satisfy >=1.3.0', () => {
    expect(satisfiesMinVersion('1.2.9', '>=1.3.0')).toBe(false);
  });
  test('2.0.0 satisfies >=1.3.0', () => {
    expect(satisfiesMinVersion('2.0.0', '>=1.3.0')).toBe(true);
  });
  test('handles patch numbers', () => {
    expect(satisfiesMinVersion('1.3.5', '>=1.3.4')).toBe(true);
    expect(satisfiesMinVersion('1.3.3', '>=1.3.4')).toBe(false);
  });
});

describe('cli doctor', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('--help describes the command and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['doctor', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Run health checks');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--no-network');
  });

  test('reports PASS for valid project (text output)', async () => {
    dir = await makeFixture(
      ['[site]', 'title = "Doctor Test"', '', '[theme]', 'name = "minimal"', 'dir = "themes"'].join(
        '\n',
      ),
    );
    await Bun.write(
      join(dir, 'themes/minimal/index.hbs'),
      '<!doctype html><body>{{@site.title}}</body>',
    );
    await Bun.write(join(dir, 'content/posts/.keep'), '');
    await Bun.write(join(dir, 'content/pages/.keep'), '');
    await Bun.write(join(dir, 'content/authors/.keep'), '');

    const { stdout, exitCode } = await runCli(['doctor', '--no-network'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('check');
    expect(stdout).toContain('status');
    expect(stdout).toContain('bun-version');
    expect(stdout).toContain('config-valid');
    expect(stdout).toContain('theme-present');
    expect(stdout).toContain('PASS');
  });

  test('--json emits machine-readable structured output', async () => {
    dir = await makeFixture(
      ['[site]', 'title = "Doctor JSON"', '', '[theme]', 'name = "minimal"', 'dir = "themes"'].join(
        '\n',
      ),
    );
    await Bun.write(join(dir, 'themes/minimal/index.hbs'), '<!doctype html>ok');

    const { stdout, exitCode } = await runCli(['doctor', '--no-network', '--json'], dir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { results: Array<{ name: string; status: string }> };
    expect(Array.isArray(parsed.results)).toBe(true);
    const names = parsed.results.map((r) => r.name);
    expect(names).toContain('bun-version');
    expect(names).toContain('config-valid');
    expect(names).toContain('theme-present');
    expect(names).toContain('network');
    const network = parsed.results.find((r) => r.name === 'network');
    expect(network?.status).toBe('PASS');
  });

  test('FAIL when theme is missing → exit code 1 and how-to-fix shown', async () => {
    dir = await makeFixture(
      [
        '[site]',
        'title = "No Theme"',
        '',
        '[theme]',
        'name = "ghost-theme-that-does-not-exist"',
        'dir = "themes"',
      ].join('\n'),
    );

    const { stdout, exitCode } = await runCli(['doctor', '--no-network'], dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('FAIL');
    expect(stdout).toContain('theme-present');
    expect(stdout).toContain('how to fix');
  });

  test('WARN for missing content dirs but does not fail the run', async () => {
    dir = await makeFixture(
      [
        '[site]',
        'title = "Missing Content"',
        '',
        '[theme]',
        'name = "minimal"',
        'dir = "themes"',
      ].join('\n'),
    );
    await Bun.write(join(dir, 'themes/minimal/index.hbs'), 'ok');

    const { stdout, exitCode } = await runCli(['doctor', '--no-network', '--json'], dir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { results: Array<{ name: string; status: string }> };
    const contentDirs = parsed.results.find((r) => r.name === 'content-dirs');
    expect(contentDirs?.status).toBe('WARN');
  });

  test('flags stale draft posts as orphaned', async () => {
    dir = await makeFixture(
      ['[site]', 'title = "Drafts"', '', '[theme]', 'name = "minimal"', 'dir = "themes"'].join(
        '\n',
      ),
    );
    await Bun.write(join(dir, 'themes/minimal/index.hbs'), 'ok');
    await Bun.write(
      join(dir, 'content/posts/stale.md'),
      ['---', 'title: Old draft', 'status: draft', 'date: 2020-01-01', '---', '', 'body'].join(
        '\n',
      ),
    );

    const { stdout, exitCode } = await runCli(['doctor', '--no-network', '--json'], dir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      results: Array<{ name: string; status: string; message: string }>;
    };
    const drafts = parsed.results.find((r) => r.name === 'orphaned-drafts');
    expect(drafts?.status).toBe('WARN');
    expect(drafts?.message).toContain('stale.md');
  });
});
