import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { COMMAND_NAMES } from '~/cli/specs.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const SNAPSHOT_DIR = fileURLToPath(new URL('../fixtures/cli-help-snapshots/', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      NECTAR_NO_COLOR: '1',
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: normalizeHelp(stdout), stderr, exitCode };
}

function normalizeHelp(output: string): string {
  // Match both legacy `nectar 1.2.3` per-subcommand headers and the branded
  // `Nectar 1.2.3` top-level header so a version bump doesn't churn snapshots.
  return output
    .replace(/^nectar \d+\.\d+\.\d+$/m, 'nectar <version>')
    .replace(/(Nectar) \d+\.\d+\.\d+/g, '$1 <version>');
}

async function readSnapshot(name: string): Promise<string> {
  return readFile(`${SNAPSHOT_DIR}/${name}.txt`, 'utf8');
}

describe('cli help snapshots', () => {
  test('root --help matches the stable snapshot', async () => {
    const result = await runCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(await readSnapshot('root'));
  });

  test.each(COMMAND_NAMES)('%s --help matches the stable snapshot', async (command) => {
    const result = await runCli([command, '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(await readSnapshot(command));
  });

  test.each(COMMAND_NAMES)('%s -h matches the stable snapshot', async (command) => {
    const result = await runCli([command, '-h']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(await readSnapshot(command));
  });

  test.each(COMMAND_NAMES)('help %s matches the stable snapshot', async (command) => {
    const result = await runCli(['help', command]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(await readSnapshot(command));
  });

  test.each(COMMAND_NAMES)('%s help matches the stable snapshot', async (command) => {
    const result = await runCli([command, 'help']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(await readSnapshot(command));
  });
});
