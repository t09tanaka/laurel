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

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-check-')));
  await Bun.write(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Check Test"', '', '[theme]', 'name = "minimal"', 'dir = "themes"'].join(
      '\n',
    ),
  );
  await Bun.write(join(dir, 'themes/minimal/index.hbs'), '<!doctype html>{{@site.title}}');
  await Bun.write(join(dir, 'content/pages/.keep'), '');
  await Bun.write(join(dir, 'content/authors/.keep'), '');
  return dir;
}

describe('cli check', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('--help advertises the --strict flag', async () => {
    const { stdout, exitCode } = await runCli(['check', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--strict');
  });

  test('exits 0 on a clean project without --strict', async () => {
    dir = await makeFixture();
    const { exitCode } = await runCli(['check'], dir);
    expect(exitCode).toBe(0);
  });

  test('exits 0 on a clean project with --strict', async () => {
    dir = await makeFixture();
    const { exitCode } = await runCli(['check', '--strict'], dir);
    expect(exitCode).toBe(0);
  });

  test('exits 0 when warnings exist but --strict is not set', async () => {
    dir = await makeFixture();
    await Bun.write(
      join(dir, 'content/posts/bad-date.md'),
      ['---', 'title: Bad Date', 'date: not-a-real-date', '---', '', 'body'].join('\n'),
    );
    const { stderr, exitCode } = await runCli(['check'], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('Invalid date in frontmatter');
  });

  test('exits 1 when warnings exist and --strict is set', async () => {
    dir = await makeFixture();
    await Bun.write(
      join(dir, 'content/posts/bad-date.md'),
      ['---', 'title: Bad Date', 'date: not-a-real-date', '---', '', 'body'].join('\n'),
    );
    const { stderr, exitCode } = await runCli(['check', '--strict'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid date in frontmatter');
    expect(stderr).toContain('Strict mode');
  });

  test('exits 1 with file path and parse error when a template is malformed', async () => {
    dir = await makeFixture();
    await Bun.write(join(dir, 'themes/minimal/index.hbs'), '{{#if foo}}<h1>unterminated');
    const { stderr, exitCode } = await runCli(['check'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Theme template 'index'");
    expect(stderr).toContain(join(dir, 'themes/minimal/index.hbs'));
    expect(stderr).toContain('Parse error');
  });

  test('exits 1 with partial path when a partial is malformed', async () => {
    dir = await makeFixture();
    await Bun.write(join(dir, 'themes/minimal/partials/header.hbs'), '{{#each posts}}');
    const { stderr, exitCode } = await runCli(['check'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Theme partial 'header'");
    expect(stderr).toContain(join(dir, 'themes/minimal/partials/header.hbs'));
    expect(stderr).toContain('Parse error');
  });
});
