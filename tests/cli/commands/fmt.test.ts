import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-fmt-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      'title = "x"',
      'url = "https://example.com"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
  );
  return dir;
}

describe('cli fmt', () => {
  test('rewrites content frontmatter with sorted keys, lowercase tags, ISO dates, and trailing newline', async () => {
    const dir = await makeFixture();
    try {
      const file = join(dir, 'content/posts/hello.md');
      await writeFile(
        file,
        ['---', 'title: Hello', 'tags: [News, TECH]', 'date: 2026-01-01', '---', '', 'Body'].join(
          '\n',
        ),
      );

      const result = await runCli(['fmt'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Formatted 1 content file(s).');
      expect(await readFile(file, 'utf8')).toBe(
        [
          '---',
          'date: 2026-01-01T00:00:00.000Z',
          'tags:',
          '  - news',
          '  - tech',
          'title: Hello',
          '---',
          '',
          'Body',
          '',
        ].join('\n'),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--check exits 1 and leaves files untouched when formatting is needed', async () => {
    const dir = await makeFixture();
    try {
      const file = join(dir, 'content/posts/hello.md');
      const original = '---\ntitle: Hello\ndate: 2026-01-01\n---\nBody';
      await writeFile(file, original);

      const result = await runCli(['fmt', '--check'], dir);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('1 content file(s) need formatting:');
      expect(result.stderr).toContain('content/posts/hello.md');
      expect(await readFile(file, 'utf8')).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--check exits 0 for already formatted content', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        [
          '---',
          'date: 2026-01-01T00:00:00.000Z',
          'tags:',
          '  - news',
          'title: Hello',
          '---',
          '',
          'Body',
          '',
        ].join('\n'),
      );

      const result = await runCli(['fmt', '--check'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('All 1 content file(s) are formatted.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
