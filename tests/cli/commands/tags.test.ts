import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd?: string,
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-tags-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
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
  await writeFile(join(dir, 'content/tags/news.md'), '---\nname: News\n---\n');
  await writeFile(join(dir, 'content/tags/dormant.md'), '---\nname: Dormant\n---\n');
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\ntags: [news]\n---\n\nBody\n',
  );
  await writeFile(
    join(dir, 'content/posts/world.md'),
    '---\ntitle: World\ndate: 2026-01-02T00:00:00Z\ntags: [news]\n---\n\nBody\n',
  );
  return dir;
}

describe('cli tags list', () => {
  test('--help advertises --orphaned/--unused and --json', async () => {
    const { stdout, exitCode } = await runCli(['tags', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--orphaned');
    expect(stdout).toContain('--unused');
    expect(stdout).toContain('--json');
  });

  test('json lists every tag with post_count sorted desc', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['tags', 'list', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        count: number;
        tags: Array<{ slug: string; post_count: number }>;
      };
      expect(parsed.count).toBe(2);
      expect(parsed.tags[0]?.slug).toBe('news');
      expect(parsed.tags[0]?.post_count).toBe(2);
      expect(parsed.tags[1]?.slug).toBe('dormant');
      expect(parsed.tags[1]?.post_count).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--orphaned filters to zero-post tags only', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['tags', 'list', '--orphaned', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        count: number;
        tags: Array<{ slug: string; post_count: number }>;
      };
      expect(parsed.count).toBe(1);
      expect(parsed.tags[0]?.slug).toBe('dormant');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('text mode prints a table with slug/name/posts', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['tags', 'list'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('slug');
      expect(stdout).toContain('news');
      expect(stdout).toContain('dormant');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('unknown subcommand exits with code 2', async () => {
    const { stderr, exitCode } = await runCli(['tags', 'wat']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown subcommand');
  });
});
