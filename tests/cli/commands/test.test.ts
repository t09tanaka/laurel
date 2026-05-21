import { describe, expect, test } from 'bun:test';
import { runTest } from '~/cli/commands/test.ts';

describe('cli test', () => {
  test('forwards args to bun test and warns that it is a passthrough', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const calls: string[][] = [];

    const exitCode = await runTest(['tests/cli/parse.test.ts', '--bail'], {
      stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
      run: async (command) => {
        calls.push(command);
        return 7;
      },
    });

    expect(exitCode).toBe(7);
    expect(calls).toEqual([['bun', 'test', 'tests/cli/parse.test.ts', '--bail']]);
    expect(stderrChunks.join('')).toContain('passthrough');
    expect(stdoutChunks.join('')).toBe('');
  });
});
