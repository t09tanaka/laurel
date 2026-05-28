import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-cache-cli-')));
  await mkdir(join(dir, '.nectar/cache/images'), { recursive: true });
  await writeFile(join(dir, '.nectar/cache/images/a.json'), '{"ok":true}\n');
  await writeFile(join(dir, '.nectar/cache/images/b.json'), '{"ok":false}\n');
  return dir;
}

describe('cli cache', () => {
  test('stats reports the cache size as JSON', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(['cache', 'stats', '--json'], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as { exists: boolean; files: number; bytes: number };
      expect(parsed.exists).toBe(true);
      expect(parsed.files).toBe(2);
      expect(parsed.bytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('clean --dry-run leaves files in place', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['cache', 'clean', '--dry-run'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Would remove ${join('.nectar', 'cache')}`);
      // Sanity: the path separator matches the running platform (forward slash
      // on POSIX, backslash on Windows), exercising the same Node `relative()`
      // output the CLI prints.
      expect(join('.nectar', 'cache')).toContain(sep);
      const body = await readFile(join(dir, '.nectar/cache/images/a.json'), 'utf8');
      expect(body).toContain('"ok"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('clean removes .nectar/cache', async () => {
    const dir = await makeFixture();
    try {
      const { existsSync } = await import('node:fs');
      const { exitCode } = await runCli(['cache', 'clean'], dir);
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, '.nectar/cache'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
