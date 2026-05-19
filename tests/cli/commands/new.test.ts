import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string): Promise<RunResult> {
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

describe('cli new — slug collision handling', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-new-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('creates a new post when the destination does not exist', async () => {
    const { exitCode } = await runCli(['new', 'post', 'Hello World'], dir);
    expect(exitCode).toBe(0);
    const dest = join(dir, 'content/posts/hello-world.md');
    const body = await readFile(dest, 'utf8');
    expect(body).toContain('title: "Hello World"');
    expect(body).toContain('slug: hello-world');
  });

  test('refuses to overwrite an existing file and exits 1 with guidance', async () => {
    const dest = join(dir, 'content/posts/hello-world.md');
    await Bun.write(dest, 'EXISTING CONTENT');

    const { stderr, exitCode } = await runCli(['new', 'post', 'Hello World'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Refusing to overwrite ${dest}.`);
    expect(stderr).toContain('Pass --force to overwrite or --slug <other>.');

    const body = await readFile(dest, 'utf8');
    expect(body).toBe('EXISTING CONTENT');
  });

  test('--force overwrites an existing file', async () => {
    const dest = join(dir, 'content/posts/hello-world.md');
    await Bun.write(dest, 'EXISTING CONTENT');

    const { exitCode } = await runCli(['new', 'post', 'Hello World', '--force'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(dest, 'utf8');
    expect(body).not.toBe('EXISTING CONTENT');
    expect(body).toContain('title: "Hello World"');
  });

  test('--slug writes to the alternate slug path without touching the original', async () => {
    const original = join(dir, 'content/posts/hello-world.md');
    await Bun.write(original, 'EXISTING CONTENT');

    const { exitCode } = await runCli(
      ['new', 'post', 'Hello World', '--slug', 'hello-world-v2'],
      dir,
    );
    expect(exitCode).toBe(0);

    const alt = join(dir, 'content/posts/hello-world-v2.md');
    const altBody = await readFile(alt, 'utf8');
    expect(altBody).toContain('slug: hello-world-v2');
    expect(altBody).toContain('title: "Hello World"');

    const originalBody = await readFile(original, 'utf8');
    expect(originalBody).toBe('EXISTING CONTENT');
  });

  test('--slug also collides with an existing file and is refused', async () => {
    const alt = join(dir, 'content/posts/alt-slug.md');
    await Bun.write(alt, 'OTHER CONTENT');

    const { stderr, exitCode } = await runCli(
      ['new', 'post', 'Hello World', '--slug', 'alt-slug'],
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Refusing to overwrite ${alt}.`);

    const body = await readFile(alt, 'utf8');
    expect(body).toBe('OTHER CONTENT');
  });

  test('pages honor the same overwrite protection', async () => {
    const dest = join(dir, 'content/pages/about.md');
    await Bun.write(dest, 'EXISTING PAGE');

    const { stderr, exitCode } = await runCli(['new', 'page', 'About'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Refusing to overwrite ${dest}.`);
  });
});
