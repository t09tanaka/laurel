import { afterEach, describe, expect, test } from 'bun:test';
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

async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-')));
  for (const [path, body] of Object.entries(files)) {
    await Bun.write(join(dir, path), body);
  }
  return dir;
}

describe('nectar build exit codes', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns 2 on usage error (unknown flag)', async () => {
    const dir = await makeFixture({ 'nectar.toml': '[site]\ntitle = "x"\n' });
    cleanups.push(dir);
    const result = await runCli(['build', '--no-such-flag'], dir);
    expect(result.exitCode).toBe(2);
  });

  test('returns 3 on config error (invalid TOML)', async () => {
    const dir = await makeFixture({ 'nectar.toml': 'this is = not = valid TOML\n' });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(3);
  });

  test('returns 5 on theme error (missing theme directory)', async () => {
    const dir = await makeFixture({
      'nectar.toml': '[site]\ntitle = "x"\n\n[theme]\nname = "does-not-exist"\ndir = "themes"\n',
    });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(5);
  });
});
