import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-clean-')));
  await writeFile(join(dir, 'nectar.toml'), '[site]\ntitle = "x"\n');
  return dir;
}

describe('cli clean', () => {
  test('--help advertises --yes, --dry-run, --keep, --json', async () => {
    const { stdout, exitCode } = await runCli(['clean', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--keep');
    expect(stdout).toContain('--json');
  });

  test('dry-run reports what would be removed without deleting', async () => {
    const dir = await makeFixture();
    try {
      await Bun.write(join(dir, 'dist/index.html'), '<!doctype html>ok');
      await Bun.write(join(dir, '.nectar/cache/marker'), 'cache');
      const { stdout, exitCode } = await runCli(['clean', '--dry-run', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        removed: string[];
        dry_run: boolean;
        total_bytes: number;
      };
      expect(parsed.dry_run).toBe(true);
      expect(parsed.removed.sort()).toEqual(['.nectar/cache', 'dist']);
      expect(parsed.total_bytes).toBeGreaterThan(0);
      // dry-run must not actually delete
      expect(existsSync(join(dir, 'dist'))).toBe(true);
      expect(existsSync(join(dir, '.nectar/cache'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--yes deletes dist/ and .nectar/cache', async () => {
    const dir = await makeFixture();
    try {
      await Bun.write(join(dir, 'dist/index.html'), '<!doctype html>ok');
      await Bun.write(join(dir, '.nectar/cache/marker'), 'cache');
      const { exitCode } = await runCli(['clean', '--yes', '--json'], dir);
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'dist'))).toBe(false);
      expect(existsSync(join(dir, '.nectar/cache'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--keep preserves the named path inside the target', async () => {
    const dir = await makeFixture();
    try {
      await Bun.write(join(dir, 'dist/index.html'), '<!doctype html>ok');
      await Bun.write(join(dir, 'dist/.well-known/security.txt'), 'hi');
      const { exitCode } = await runCli(
        ['clean', '--yes', '--keep', 'dist/.well-known', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      // index.html got nuked, .well-known survived
      expect(existsSync(join(dir, 'dist/index.html'))).toBe(false);
      expect(existsSync(join(dir, 'dist/.well-known/security.txt'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('repeated --keep preserves each named path inside the target', async () => {
    const dir = await makeFixture();
    try {
      await Bun.write(join(dir, 'dist/index.html'), '<!doctype html>ok');
      await Bun.write(join(dir, 'dist/.well-known/security.txt'), 'hi');
      await Bun.write(join(dir, 'dist/uploads/image.txt'), 'image');
      const { exitCode } = await runCli(
        ['clean', '--yes', '--keep', 'dist/.well-known', '--keep', 'dist/uploads', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'dist/index.html'))).toBe(false);
      expect(existsSync(join(dir, 'dist/.well-known/security.txt'))).toBe(true);
      expect(existsSync(join(dir, 'dist/uploads/image.txt'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses non-interactive deletion without --yes', async () => {
    const dir = await makeFixture();
    try {
      await Bun.write(join(dir, 'dist/index.html'), '<!doctype html>ok');
      // No stdin TTY in spawned process; the confirm() helper falls through to "no".
      const { stderr, exitCode } = await runCli(['clean'], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('non-interactive');
      expect(existsSync(join(dir, 'dist/index.html'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
