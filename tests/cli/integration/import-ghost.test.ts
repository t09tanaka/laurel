import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Cross-cutting integration tests for `nectar import-ghost` (#663 / #692).
// Per-flag importer behaviour is exercised in tests/ghost/import*.test.ts and
// tests/cli/commands/import-ghost.test.ts; this file is the regression net for
// help, exit codes, and the happy path through the real spawned binary using
// the existing `tests/fixtures/ghost-exports/small.json` fixture.
const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));
const FIXTURE_SMALL = fileURLToPath(
  new URL('../../fixtures/ghost-exports/small.json', import.meta.url),
);

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

describe('cli integration — import-ghost (#663/#692)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-int-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('import-ghost --help exits 0 and lists the documented flags', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--on-conflict');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--download-images');
  });

  test('import-ghost without a file argument exits 2', async () => {
    const { stderr, exitCode } = await runCli(['import-ghost'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing required argument');
    expect(stderr).toContain('<file>');
  });

  test('import-ghost rejects an invalid --on-conflict value', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', FIXTURE_SMALL, '--on-conflict', 'asplode'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--on-conflict');
  });

  test('import-ghost --dry-run does not write any files but reports counts', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', FIXTURE_SMALL, '--dry-run'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run');
    expect(stdout).toContain('Posts to import');
    const glob = new Bun.Glob('content/**/*.md');
    const found: string[] = [];
    for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) found.push(rel);
    expect(found).toEqual([]);
  });

  test('import-ghost ingests the small fixture into content/ with cross-references', async () => {
    const { exitCode } = await runCli(
      ['import-ghost', FIXTURE_SMALL, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    // Published post + tag + author files land in their canonical locations.
    const post = await readFile(join(dir, 'content/posts/welcome.md'), 'utf8');
    expect(post).toContain('title: "Welcome to the Blog"');
    expect(post).toContain('tags:');
    expect(post).toContain('news');
    expect(post).toContain('alice');
    const page = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
    expect(page).toContain('title: "About Us"');
    const tag = await readFile(join(dir, 'content/tags/news.md'), 'utf8');
    expect(tag.toLowerCase()).toContain('news');
    const author = await readFile(join(dir, 'content/authors/alice.md'), 'utf8');
    expect(author.toLowerCase()).toContain('alice');
  });

  test('import-ghost on a missing file exits 1 with a helpful runtime error', async () => {
    const { exitCode, stderr } = await runCli(
      ['import-ghost', join(dir, 'does-not-exist.json')],
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stderr.toLowerCase()).toMatch(
      /does not exist|no such file|not found|enoent|cannot|failed/,
    );
  });
});
