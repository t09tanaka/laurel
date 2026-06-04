import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// Cross-cutting integration tests for `laurel check` (#663 / #692).
// Per-flag behaviour is covered in tests/cli/commands/check.test.ts; here we
// only spot-check help output, exit-code semantics, and that the documented
// link-checking flags are reachable from the real argv path.
const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

describe('cli integration — check (#663/#692)', () => {
  test('check --help exits 0 and advertises the link-checking flags', async () => {
    const { stdout, exitCode } = await runCli(['check', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('laurel check');
    expect(stdout).toContain('--config');
    expect(stdout).toContain('--strict');
    expect(stdout).toContain('--check-links');
    expect(stdout).toContain('--check-external');
  });

  test('check rejects an unknown flag with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['check', '--not-a-real-flag']);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain('unknown');
  });

  test('check without a project (no laurel.toml) exits 1', async () => {
    const { exitCode } = await runCli(['check'], '/');
    expect(exitCode).toBe(1);
  });
});
