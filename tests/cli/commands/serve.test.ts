import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function makeServeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-serve-')));
  await Bun.write(join(dir, 'nectar.toml'), '[site]\ntitle = "x"\n');
  await Bun.write(join(dir, 'dist/index.html'), '<!doctype html><title>ok</title>');
  return dir;
}

describe('cli serve — host binding', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serve --help advertises --host with localhost default and 0.0.0.0 opt-in', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--host <host>');
    expect(stdout).toContain('localhost');
    expect(stdout).toContain('0.0.0.0');
  });

  test('default binding is localhost — log line reports it explicitly', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '52001'], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('bound to localhost');
    expect(stderr).not.toContain('bound to 0.0.0.0');
  });

  test('--host 0.0.0.0 opts in to LAN exposure and is reflected in the log line', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--port', '52002', '--host', '0.0.0.0'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain('bound to 0.0.0.0');
  });

  test('--host 127.0.0.1 is honored verbatim in the log line', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--port', '52003', '--host', '127.0.0.1'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain('bound to 127.0.0.1');
  });

  test('rejects empty --host with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--host', '   '], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --host');
  });
});
