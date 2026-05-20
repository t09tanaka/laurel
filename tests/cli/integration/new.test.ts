import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Cross-cutting integration tests for `nectar new` (#663 / #692).
// Per-feature scaffolding behaviour is tested in tests/cli/commands/new.test.ts;
// this file verifies help/version, argv parsing edge cases, and the end-to-end
// file-creation happy path through the real spawned binary.
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

describe('cli integration — new (#663/#692)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-new-int-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('new --help exits 0 and documents built-in and custom kinds', async () => {
    const { stdout, exitCode } = await runCli(['new', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Built-ins are post, page, tag, and author');
    expect(stdout).toContain('config.content_kinds');
    expect(stdout).toContain('--draft');
    expect(stdout).toContain('--slug');
    expect(stdout).toContain('--tags');
    expect(stdout).toContain('--author');
  });

  test('new without a kind exits 2 with a usage error', async () => {
    const { stderr, exitCode } = await runCli(['new'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing required argument');
    expect(stderr).toContain('<kind>');
  });

  test('new with an unknown kind exits 2 and lists the valid kinds', async () => {
    const { stderr, exitCode } = await runCli(['new', 'widget', 'foo'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid kind');
    expect(stderr).toContain('post');
    expect(stderr).toContain('page');
    expect(stderr).toContain('tag');
    expect(stderr).toContain('author');
  });

  test('new post without a title exits 2', async () => {
    const { stderr, exitCode } = await runCli(['new', 'post'], dir);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain('title');
  });

  test('new post with a whitespace-only quoted title exits 2 with friendly guidance', async () => {
    const { stderr, exitCode } = await runCli(['new', 'post', '   '], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Title cannot be empty. Example: nectar new post "My First Post"');
  });

  test('new post creates a markdown file with the slugified title', async () => {
    const { exitCode } = await runCli(['new', 'post', 'Integration Test Post'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/integration-test-post.md'), 'utf8');
    expect(body).toContain('title: "Integration Test Post"');
    expect(body).toContain('slug: integration-test-post');
  });

  test('new post --draft flips status to draft', async () => {
    const { exitCode } = await runCli(['new', 'post', 'A Draft', '--draft'], dir);
    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/a-draft.md'), 'utf8');
    expect(body).toContain('status: draft');
  });

  test('new post rejects --tags on a non-post kind', async () => {
    const { stderr, exitCode } = await runCli(['new', 'page', 'About', '--tags', 'news'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--date, --tags, and --author');
  });
});
