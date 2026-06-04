import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-authors-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
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
  await writeFile(join(dir, 'content/authors/alice.md'), '---\nname: Alice\n---\n');
  await writeFile(join(dir, 'content/authors/bob.md'), '---\nname: Bob\n---\n');
  await writeFile(join(dir, 'content/authors/casey.md'), '---\nname: Casey\n---\n');
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\nauthors: [alice]\n---\n\nBody\n',
  );
  await writeFile(
    join(dir, 'content/posts/world.md'),
    '---\ntitle: World\ndate: 2026-01-02T00:00:00Z\nauthors: [alice, bob]\n---\n\nBody\n',
  );
  await writeFile(
    join(dir, 'content/pages/about.md'),
    '---\ntitle: About\ndate: 2026-01-03T00:00:00Z\nauthors: [casey]\n---\n\nBody\n',
  );
  return dir;
}

describe('cli authors list', () => {
  test('--help advertises --orphaned and --json', async () => {
    const { stdout, exitCode } = await runCli(['authors', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--orphaned');
    expect(stdout).toContain('--json');
  });

  test('json lists every author with post_count sorted desc', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['authors', 'list', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        count: number;
        authors: Array<{ slug: string; post_count: number }>;
      };
      expect(parsed.count).toBe(3);
      expect(parsed.authors.map((a) => [a.slug, a.post_count])).toEqual([
        ['alice', 2],
        ['bob', 1],
        ['casey', 0],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--orphaned filters to authors unreferenced by posts', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['authors', 'list', '--orphaned', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        count: number;
        authors: Array<{ slug: string; post_count: number }>;
      };
      expect(parsed.count).toBe(1);
      expect(parsed.authors[0]?.slug).toBe('casey');
      expect(parsed.authors[0]?.post_count).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('text mode prints a table with slug/name/posts', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['authors', 'list'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('slug');
      expect(stdout).toContain('name');
      expect(stdout).toContain('posts');
      expect(stdout).toContain('alice');
      expect(stdout).toContain('casey');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('unknown subcommand exits with code 2', async () => {
    const { stderr, exitCode } = await runCli(['authors', 'wat']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown subcommand');
  });
});

describe('cli authors rename', () => {
  test('rewrites author references in posts/pages and moves the author file', async () => {
    const dir = await makeFixture();
    try {
      const { existsSync } = await import('node:fs');
      const { stdout, exitCode } = await runCli(
        ['authors', 'rename', 'alice', 'ada', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout) as {
        old_slug: string;
        new_slug: string;
        changed_files: string[];
        author_file_moved: boolean;
      };
      expect(result.old_slug).toBe('alice');
      expect(result.new_slug).toBe('ada');
      expect(result.author_file_moved).toBe(true);
      expect(result.changed_files.length).toBeGreaterThanOrEqual(3);

      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toContain('authors: [ada]');
      const world = await readFile(join(dir, 'content/posts/world.md'), 'utf8');
      expect(world).toContain('authors: [ada, bob]');
      expect(existsSync(join(dir, 'content/authors/alice.md'))).toBe(false);
      expect(existsSync(join(dir, 'content/authors/ada.md'))).toBe(true);
      const authorFile = await readFile(join(dir, 'content/authors/ada.md'), 'utf8');
      expect(authorFile).toContain('slug: ada');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--dry-run reports changes without mutating files', async () => {
    const dir = await makeFixture();
    try {
      const { existsSync } = await import('node:fs');
      const { stdout, exitCode } = await runCli(
        ['authors', 'rename', 'alice', 'ada', '--dry-run', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout) as { dry_run: boolean; changed_files: string[] };
      expect(result.dry_run).toBe(true);
      expect(result.changed_files.length).toBeGreaterThan(0);
      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toContain('authors: [alice]');
      expect(existsSync(join(dir, 'content/authors/alice.md'))).toBe(true);
      expect(existsSync(join(dir, 'content/authors/ada.md'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
