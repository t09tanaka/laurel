import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDiagnosticValue, redactEnv } from '~/cli/commands/diagnostics.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-diagnostics-')));
  await Bun.write(
    join(dir, 'laurel.toml'),
    ['[site]', 'title = "Diagnostics"', '', '[theme]', 'name = "minimal"', 'dir = "themes"'].join(
      '\n',
    ),
  );
  await Bun.write(
    join(dir, 'themes/minimal/package.json'),
    JSON.stringify({ name: 'minimal', version: '1.2.3' }),
  );
  await Bun.write(join(dir, 'themes/minimal/index.hbs'), '<!doctype html>{{@site.title}}');
  await Bun.write(
    join(dir, 'content/posts/secret-post.md'),
    ['---', 'title: Secret Post', 'date: 2024-01-01', '---', '', 'PRIVATE BODY TOKEN'].join('\n'),
  );
  await Bun.write(join(dir, 'dist/.laurel/manifest.json'), '{"schema_version":2}\n');
  await Bun.write(join(dir, 'dist/.laurel-manifest.json'), '{"version":1}\n');
  await Bun.write(join(dir, 'laurel.log'), 'first line\ntoken=log-secret\nlast line\n');
  return dir;
}

async function extractArchive(archive: string, dest: string): Promise<void> {
  const proc = Bun.spawn(['tar', '-xzf', archive, '-C', dest], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
}

describe('cli diagnostics bundle', () => {
  let dir: string | undefined;
  let extractDir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (extractDir) await rm(extractDir, { recursive: true, force: true });
    dir = undefined;
    extractDir = undefined;
  });

  test('--help describes bundle options', async () => {
    dir = await makeFixture();
    const { stdout, stderr, exitCode } = await runCli(['diagnostics', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Create support-safe diagnostics bundles');
    expect(stdout).toContain('bundle');
    expect(stdout).toContain('--output');
    expect(stdout).toContain('--dry-run');
  });

  test('dry-run lists planned archive entries without writing a tarball', async () => {
    dir = await makeFixture();
    const output = join(dir, 'support.tar.gz');
    const { stdout, stderr, exitCode } = await runCli(
      ['diagnostics', 'bundle', '--dry-run', '--output', output],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Diagnostics bundle dry run');
    expect(stdout).toContain('diagnostics/config/resolved-config.json');
    expect(existsSync(output)).toBe(false);
  });

  test('writes a redacted tar.gz without content bodies', async () => {
    dir = await makeFixture();
    extractDir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-diagnostics-extract-')));
    const output = join(dir, 'support.tar.gz');

    const { stdout, stderr, exitCode } = await runCli(
      ['diagnostics', 'bundle', '--output', output, '--log-lines', '2'],
      dir,
      {
        GHOST_CONTENT_API_KEY: 'abc123',
        PUBLIC_VALUE: 'visible',
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Wrote diagnostics bundle');
    expect(existsSync(output)).toBe(true);

    await extractArchive(output, extractDir);
    const root = join(extractDir, 'diagnostics');
    const content = await Bun.file(join(root, 'content/files.json')).json();
    expect(content.files).toContainEqual(
      expect.objectContaining({ kind: 'posts', path: 'content/posts/secret-post.md' }),
    );

    const env = (await Bun.file(join(root, 'env/redacted-env.json')).json()) as Record<
      string,
      string
    >;
    expect(env.GHOST_CONTENT_API_KEY).toBe('[REDACTED]');
    expect(env.PUBLIC_VALUE).toBe('visible');

    const logs = await Bun.file(join(root, 'logs/last-lines.json')).text();
    expect(logs).toContain('token=[REDACTED]');
    expect(logs).not.toContain('log-secret');

    const allJson = await Promise.all(
      [
        'index.json',
        'metadata.json',
        'config/resolved-config.json',
        'content/files.json',
        'theme/manifest.json',
        'build/manifests.json',
        'logs/last-lines.json',
        'env/redacted-env.json',
      ].map((name) => Bun.file(join(root, name)).text()),
    );
    const combined = allJson.join('\n');
    expect(combined).not.toContain('PRIVATE BODY TOKEN');
  });
});

describe('diagnostics redaction', () => {
  test('redacts sensitive keys recursively', () => {
    expect(
      redactDiagnosticValue({
        nested: {
          apiKey: 'plain-secret',
          password: 'hunter2',
          public: 'hello',
        },
      }),
    ).toEqual({
      nested: {
        apiKey: '[REDACTED]',
        password: '[REDACTED]',
        public: 'hello',
      },
    });
  });

  test('redacts known token-shaped env values even with neutral keys', () => {
    expect(
      redactEnv({
        TOKEN: 'abc',
        PUBLIC: 'ok',
        NEUTRAL: 'sk-abcdefghijklmnopqrstuvwxyz123456',
      }),
    ).toEqual({
      NEUTRAL: '[REDACTED]',
      PUBLIC: 'ok',
      TOKEN: '[REDACTED]',
    });
  });
});
