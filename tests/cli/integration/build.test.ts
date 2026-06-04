import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// Cross-cutting integration tests (#663 / #692): spawn the real CLI binary and
// assert exit codes, stdout/stderr, and help/version output for `build`.
// Per-feature behaviour lives in tests/cli/commands/build.test.ts; this file is
// a regression net for argv parsing, exit-code shape, and help rendering.
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

describe('cli integration — build (#663/#692)', () => {
  test('build --help exits 0 and prints usage with every documented flag', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('laurel build');
    for (const flag of [
      '--config',
      '--output',
      '--base-path',
      '--base-url',
      '--strict',
      '--profile',
      '--no-atomic',
      '--concurrency',
      '--dry-run',
      '--include-drafts',
      '--force',
      '--watch',
    ]) {
      expect(stdout).toContain(flag);
    }
  });

  test('build -h is equivalent to --help', async () => {
    const long = await runCli(['build', '--help']);
    const short = await runCli(['build', '-h']);
    expect(short.exitCode).toBe(0);
    expect(short.stdout).toBe(long.stdout);
  });

  test('build with an unknown flag exits 2 and points at --help', async () => {
    const { stderr, exitCode } = await runCli(['build', '--definitely-not-a-flag']);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain('unknown');
    expect(stderr).toContain('--help');
  });

  test('build with an invalid --concurrency exits 2 and surfaces the bad value', async () => {
    const { stderr, exitCode } = await runCli(['build', '--concurrency', 'banana']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--concurrency');
  });

  test('build without a laurel.toml at the cwd exits 1 (runtime error, not a parse error)', async () => {
    // Run from a directory that genuinely has no laurel.toml; the CLI loader
    // should report a missing-config error with a non-2 (runtime) exit code so
    // CI can distinguish "user typed a bad flag" (exit 2) from "the project is
    // misconfigured" (exit 1).
    const { exitCode } = await runCli(['build'], '/');
    expect(exitCode).toBe(1);
  });
});
