import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Cross-cutting integration tests for `nectar serve` (#663 / #692).
// Per-feature serve behaviour (host binding, watch mode, auto-build) lives in
// tests/cli/commands/serve.test.ts; here we only verify help/version output and
// a short-lived spawn that is terminated by SIGINT (smoke regression for the
// signal-handling path).
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-serve-int-')));
  await Bun.write(join(dir, 'nectar.toml'), '[site]\ntitle = "x"\n');
  await Bun.write(join(dir, 'dist/index.html'), '<!doctype html><title>ok</title>');
  return dir;
}

describe('cli integration — serve (#663/#692)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serve --help exits 0 and lists port / host / watch flags', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--port');
    expect(stdout).toContain('--host');
    expect(stdout).toContain('--no-watch');
  });

  test('serve --port with a non-integer exits 2', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--port', 'not-a-number', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--port');
  });

  test('serve --port out of 1..65535 exits 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '0', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--port');
  });

  // Smoke test for the signal-handling path: spawn `serve` in watch mode (the
  // long-lived default), wait until it reports it is listening, then send
  // SIGINT and assert the process exits without being force-killed. This is
  // a regression net for #692's CLI integration coverage — it is intentionally
  // not a full HTTP smoke (the underlying serve behaviour is covered in
  // tests/cli/commands/serve.test.ts).
  test('serve handles SIGINT and exits cleanly', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'serve', '--port', '52301'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes('Watch mode enabled') || stderr.includes('Serving')) break;
      }
      reader.releaseLock();
      // Server should still be running when we send SIGINT.
      expect(proc.killed).toBe(false);
      proc.kill('SIGINT');
      const code = await proc.exited;
      // SIGINT default behaviour: the process exits. Bun.spawn surfaces the
      // exit code (either 0 if the handler ran cleanly, or 130 if it was
      // killed by the signal). Either is acceptable evidence that we did not
      // hang on SIGINT.
      expect([0, 130]).toContain(code);
    } finally {
      if (!proc.killed) proc.kill('SIGKILL');
      await proc.exited.catch(() => undefined);
    }
  }, 15_000);
});
