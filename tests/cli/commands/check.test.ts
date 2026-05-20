import { afterEach, describe, expect, test } from 'bun:test';
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-check-')));
  await Bun.write(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "Check Test"', '', '[theme]', 'name = "minimal"', 'dir = "themes"'].join(
      '\n',
    ),
  );
  await Bun.write(join(dir, 'themes/minimal/index.hbs'), '<!doctype html>{{@site.title}}');
  await Bun.write(join(dir, 'content/pages/.keep'), '');
  await Bun.write(join(dir, 'content/tags/.keep'), '');
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

  test('--help advertises the --check-links / --check-external flags', async () => {
    const { stdout, exitCode } = await runCli(['check', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--check-links');
    expect(stdout).toContain('--check-external');
  });

  test('--check-links flags a dead cross-link with --strict', async () => {
    dir = await makeFixture();
    await Bun.write(
      join(dir, 'content/posts/a.md'),
      ['---', 'title: A', 'date: 2026-01-01', '---', '[gone](./missing.md)'].join('\n'),
    );
    const { stderr, exitCode } = await runCli(['check', '--check-links', '--strict'], dir);
    expect(stderr).toContain('missing.md');
    expect(exitCode).toBe(1);
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

  test('keeps check JSON shape for config validation errors', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-check-invalid-config-')));
    await writeFile(join(dir, 'nectar.toml'), '[site]\ntitle = 123\n');

    const { stdout, stderr, exitCode } = await runCli(['check', '--json'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toBe('');
    const report = JSON.parse(stdout) as {
      ok: boolean;
      errors: Array<{ code: string; message: string }>;
      warnings: unknown[];
      summary: null;
    };
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.code).toBe('fatal');
    expect(report.errors[0]?.message).toContain('site.title');
    expect(report.warnings).toEqual([]);
    expect(report.summary).toBeNull();
  });

  test('reports missing local feature_image assets in the check report', async () => {
    dir = await makeFixture();
    await Bun.write(
      join(dir, 'content/posts/missing-image.md'),
      [
        '---',
        'title: Missing Image',
        'date: 2026-01-01',
        'feature_image: /content/images/missing.jpg',
        '---',
        '',
        'body',
      ].join('\n'),
    );

    const { stdout, exitCode } = await runCli(['check', '--json'], dir);
    const report = JSON.parse(stdout) as { warnings: Array<{ code: string; message: string }> };

    expect(exitCode).toBe(0);
    expect(report.warnings.some((w) => w.code === 'missing-asset')).toBe(true);
    expect(report.warnings.find((w) => w.code === 'missing-asset')?.message).toContain(
      'missing.jpg',
    );
  });

  test('exits non-zero on an unparseable post date even without --strict', async () => {
    dir = await makeFixture();
    await Bun.write(
      join(dir, 'content/posts/bad-date.md'),
      ['---', 'title: Bad Date', 'date: not-a-real-date', '---', '', 'body'].join('\n'),
    );
    // Unparseable dates used to be a soft warning that silently fell back to
    // 1970-01-01, sorting the post to the bottom of feeds. They are now a
    // hard content error so authors notice the typo at build time.
    const { stderr, exitCode } = await runCli(['check'], dir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Invalid date in frontmatter');
    expect(stderr).toContain('bad-date.md');
    expect(stderr).toContain('not-a-real-date');
  });

  test('exits 1 when an unparseable post date is present with --strict', async () => {
    dir = await makeFixture();
    await Bun.write(
      join(dir, 'content/posts/bad-date.md'),
      ['---', 'title: Bad Date', 'date: not-a-real-date', '---', '', 'body'].join('\n'),
    );
    const { stderr, exitCode } = await runCli(['check', '--strict'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid date in frontmatter');
    expect(stderr).toContain('bad-date.md');
    expect(stderr).toContain('not-a-real-date');
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
