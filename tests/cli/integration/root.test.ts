import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

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
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('cli integration — root usage', () => {
  test('no args exits 2 and prints top-level usage on stderr', async () => {
    const { stdout, stderr, exitCode } = await runCli([]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage:');
    expect(stderr).toContain('nectar <command>');
  });

  test.each([['--help'], ['-h'], ['help']])('%s exits 0 and prints top-level help', async (arg) => {
    const { stdout, stderr, exitCode } = await runCli([arg]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('nectar <command>');
  });
});
