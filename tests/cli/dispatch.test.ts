import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
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

describe('cli dispatch', () => {
  test('top-level --help prints usage and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('build');
    expect(stdout).toContain('serve');
    expect(stdout).toContain('import-ghost');
  });

  test('no args prints usage', async () => {
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('nectar <command>');
  });

  test('version prints the version number', async () => {
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('unknown command exits 2 and suggests the closest match', async () => {
    const { stderr, exitCode } = await runCli(['buld']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command: buld');
    expect(stderr).toContain('Did you mean `nectar build`');
  });

  test('unknown command without close match still prints usage', async () => {
    const { stderr, exitCode } = await runCli(['xyzfoo']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command: xyzfoo');
    expect(stderr).not.toContain('Did you mean');
  });

  test('build --help prints subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
    expect(stdout).toContain('--config <path>');
    expect(stdout).toContain('-o, --output <dir>');
    expect(stdout).toContain('--base-path <path>');
    expect(stdout).toContain('--strict');
  });

  test('serve --help prints subcommand help with --port flag', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--port <n>');
  });

  test('build with unknown flag exits 2 and prints subcommand help', async () => {
    const { stderr, exitCode } = await runCli(['build', '--bogus']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--bogus');
    expect(stderr).toContain('Usage:');
  });

  test('new with missing positionals exits 2', async () => {
    const { stderr, exitCode } = await runCli(['new']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing required argument');
  });

  test('import-ghost --help prints positional documentation', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('<file>');
    expect(stdout).toContain('Ghost export');
  });

  test('top-level help mentions global --quiet and --verbose options', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--quiet');
    expect(stdout).toContain('-V, --verbose');
  });

  test('--quiet is stripped before subcommand parsing', async () => {
    const { stdout, exitCode } = await runCli(['--quiet', 'build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('-VV is stripped before subcommand parsing', async () => {
    const { stdout, exitCode } = await runCli(['-VV', 'build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('global flag after the command name is also stripped', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help', '-V']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('combining --quiet and --verbose is rejected with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['--quiet', '--verbose', 'build']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--quiet and --verbose cannot be used together');
  });
});
