import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
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

describe('cli import-hugo/import-jekyll', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-static-cli-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('import-hugo maps categories to tags and aliases to redirects', async () => {
    const oldSite = join(dir, 'old-hugo');
    await mkdir(join(oldSite, 'content/posts'), { recursive: true });
    await Bun.write(
      join(oldSite, 'content/posts/hello.md'),
      [
        '---',
        'title: Hello',
        'slug: hello',
        'categories: [News, "Release Notes"]',
        'tags: [Existing]',
        'aliases:',
        '  - /old/hello/',
        '  - legacy/hello',
        '---',
        'Body',
        '',
      ].join('\n'),
    );
    await Bun.write(
      join(oldSite, 'content/posts/toml.md'),
      [
        '+++',
        'title = "TOML Post"',
        'slug = "toml-post"',
        'categories = ["Hugo TOML"]',
        '+++',
        'TOML body',
        '',
      ].join('\n'),
    );

    const { exitCode, stderr } = await runCli(['import-hugo', oldSite], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const md = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
    expect(md).toContain('slug: hello');
    expect(md).toContain('tags:');
    expect(md).toContain('- existing');
    expect(md).toContain('- news');
    expect(md).toContain('- release-notes');
    expect(md).not.toContain('categories:');
    expect(md).not.toContain('aliases:');

    const redirects = await readFile(join(dir, 'redirects.yaml'), 'utf8');
    expect(redirects).toContain('from: /old/hello/');
    expect(redirects).toContain('from: /legacy/hello/');
    expect(redirects).toContain('to: /hello/');
    expect(redirects).toContain('status: 301');

    const tomlMd = await readFile(join(dir, 'content/posts/toml-post.md'), 'utf8');
    expect(tomlMd).toContain('- hugo-toml');
    expect(tomlMd).toContain('TOML body');
  });

  test('import-jekyll derives slugs and dates from _posts filenames', async () => {
    const oldSite = join(dir, 'old-jekyll');
    await mkdir(join(oldSite, '_posts'), { recursive: true });
    await Bun.write(
      join(oldSite, '_posts/2026-05-20-launch-post.md'),
      ['---', 'title: Launch Post', 'categories: updates', '---', 'Body', ''].join('\n'),
    );

    const { exitCode } = await runCli(['import-jekyll', oldSite], dir);
    expect(exitCode).toBe(0);

    const md = await readFile(join(dir, 'content/posts/launch-post.md'), 'utf8');
    expect(md).toContain('slug: launch-post');
    expect(md).toContain("date: '2026-05-20'");
    expect(md).toContain('- updates');
  });

  test('--dry-run reports redirects without writing files', async () => {
    const oldSite = join(dir, 'old-hugo');
    await mkdir(join(oldSite, 'content/post'), { recursive: true });
    await Bun.write(
      join(oldSite, 'content/post/example.md'),
      ['---', 'title: Example', 'aliases: [/old-example/]', '---', 'Body', ''].join('\n'),
    );

    const { stdout, exitCode } = await runCli(['import-hugo', oldSite, '--dry-run'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run (hugo): no files written.');
    expect(stdout).toContain('Redirects from aliases');
    await expect(readFile(join(dir, 'content/posts/example.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(dir, 'redirects.yaml'), 'utf8')).rejects.toThrow();
  });

  test('migrate hugo uses the same remapping importer', async () => {
    const oldSite = join(dir, 'old-hugo');
    await mkdir(join(oldSite, 'content/posts'), { recursive: true });
    await Bun.write(
      join(oldSite, 'content/posts/from-migrate.md'),
      ['---', 'title: From Migrate', 'categories: [Docs]', '---', 'Body', ''].join('\n'),
    );

    const { exitCode } = await runCli(['migrate', 'hugo', oldSite], dir);
    expect(exitCode).toBe(0);

    const md = await readFile(join(dir, 'content/posts/from-migrate.md'), 'utf8');
    expect(md).toContain('- docs');
    expect(md).not.toContain('categories:');
  });
});
