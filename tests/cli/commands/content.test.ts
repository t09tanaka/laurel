import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-content-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
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
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\ntags: [news]\n---\n\nBody\n',
  );
  await writeFile(
    join(dir, 'content/posts/draft-one.md'),
    '---\ntitle: Draft\ndate: 2026-01-02T00:00:00Z\nstatus: draft\n---\n\nWIP\n',
  );
  await writeFile(
    join(dir, 'content/pages/about.md'),
    '---\ntitle: About\ndate: 2026-01-03T00:00:00Z\n---\n\nAbout\n',
  );
  await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n');
  return dir;
}

describe('cli content list', () => {
  test('lists posts by default (excludes drafts)', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['content', 'list', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        kind: string;
        count: number;
        items: Array<{ slug: string; status: string }>;
      };
      expect(parsed.kind).toBe('posts');
      expect(parsed.count).toBe(1);
      expect(parsed.items[0]?.slug).toBe('hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--draft includes drafts', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['content', 'list', '--draft', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { count: number };
      expect(parsed.count).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--kind pages switches to pages', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['content', 'list', '--kind', 'pages', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { kind: string; count: number };
      expect(parsed.kind).toBe('pages');
      expect(parsed.count).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--tag filters by tag slug', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['content', 'list', '--tag', 'news', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { count: number };
      expect(parsed.count).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('text mode prints a table with slug, title, date, status', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['content', 'list'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('slug');
      expect(stdout).toContain('hello');
      expect(stdout).toContain('Hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects unknown subcommand with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['content', 'add']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown subcommand');
  });
});

describe('cli content rename', () => {
  test('moves the file and rewrites the slug frontmatter', async () => {
    const dir = await makeFixture();
    try {
      const { exitCode } = await runCli(['content', 'rename', 'hello', 'hi-there', '--json'], dir);
      expect(exitCode).toBe(0);
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(dir, 'content/posts/hello.md'))).toBe(false);
      expect(existsSync(join(dir, 'content/posts/hi-there.md'))).toBe(true);
      const body = await readFile(join(dir, 'content/posts/hi-there.md'), 'utf8');
      expect(body).toMatch(/^---\n[\s\S]*\bslug:\s*hi-there\b/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--redirect appends a 301 entry to redirects.yaml', async () => {
    const dir = await makeFixture();
    try {
      const { exitCode } = await runCli(['content', 'rename', 'hello', 'hi', '--redirect'], dir);
      expect(exitCode).toBe(0);
      const { readFile } = await import('node:fs/promises');
      const yaml = await readFile(join(dir, 'redirects.yaml'), 'utf8');
      expect(yaml).toContain('from: "/hello/"');
      expect(yaml).toContain('to: "/hi/"');
      expect(yaml).toContain('status: 301');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses when destination already exists', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/taken.md'),
        '---\ntitle: Taken\ndate: 2026-01-04T00:00:00Z\n---\n',
      );
      const { stderr, exitCode } = await runCli(['content', 'rename', 'hello', 'taken'], dir);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Destination already exists');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid slug with exit 2', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['content', 'rename', 'hello', 'Bad Slug'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Invalid new slug');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
