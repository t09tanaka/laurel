import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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

  test('repeated --tag filters match any accumulated tag slug', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/tech.md'),
        '---\ntitle: Tech\ndate: 2026-01-04T00:00:00Z\ntags: [tech]\n---\n\nBody\n',
      );
      const { stdout, exitCode } = await runCli(
        ['content', 'list', '--tag', 'news', '--tag', 'tech', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { count: number; items: Array<{ slug: string }> };
      expect(parsed.count).toBe(2);
      expect(parsed.items.map((item) => item.slug).sort()).toEqual(['hello', 'tech']);
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

describe('cli content show', () => {
  test('prints frontmatter and the requested number of body lines', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        [
          '---',
          'title: Hello',
          'date: 2026-01-01T00:00:00Z',
          'tags: [news]',
          '---',
          '',
          'Line one',
          'Line two',
          'Line three',
          '',
        ].join('\n'),
      );
      const { stdout, exitCode } = await runCli(['content', 'show', 'hello', '--lines', '2'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('---\ntitle: Hello');
      expect(stdout).toContain('Line one\nLine two');
      expect(stdout).not.toContain('Line three');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--frontmatter prints only the YAML frontmatter block', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['content', 'show', 'hello', '--frontmatter'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\ntags: [news]\n---\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json returns path, parsed frontmatter, and body preview', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['content', 'show', 'about', '--kind', 'pages', '--lines', '1', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        kind: string;
        path: string;
        frontmatter: { title?: string };
        body_preview: string;
      };
      expect(parsed.kind).toBe('pages');
      expect(parsed.path).toBe(join(dir, 'content/pages/about.md'));
      expect(parsed.frontmatter.title).toBe('About');
      expect(parsed.body_preview).toBe('About');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('falls back to explicit slug frontmatter when the filename differs', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/pages/custom-name.md'),
        '---\ntitle: Slugged\nslug: visible-page\n---\n\nBody\n',
      );
      const { stdout, exitCode } = await runCli(
        ['content', 'show', 'visible-page', '--kind', 'pages', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { path: string };
      expect(parsed.path).toBe(join(dir, 'content/pages/custom-name.md'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid --lines with exit 2', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['content', 'show', 'hello', '--lines', '0'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Invalid --lines value');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli content rename', () => {
  test('moves the file and rewrites the slug frontmatter', async () => {
    const dir = await makeFixture();
    try {
      const { exitCode } = await runCli(['content', 'rename', 'hello', 'hi-there', '--json'], dir);
      expect(exitCode).toBe(0);
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

describe('cli content delete', () => {
  test('moves a post to .nectar/trash and writes restore metadata', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['content', 'delete', 'hello', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        slug: string;
        kind: string;
        original_path: string;
        trash_path: string;
        metadata_path: string;
      };
      expect(parsed.slug).toBe('hello');
      expect(parsed.kind).toBe('posts');
      expect(parsed.original_path).toBe(join(dir, 'content/posts/hello.md'));
      expect(existsSync(join(dir, 'content/posts/hello.md'))).toBe(false);
      expect(existsSync(parsed.trash_path)).toBe(true);
      expect(await readFile(parsed.trash_path, 'utf8')).toContain('title: Hello');

      const metadata = JSON.parse(await readFile(parsed.metadata_path, 'utf8')) as {
        original_path: string;
        trash_path: string;
        slug: string;
      };
      expect(metadata).toMatchObject({
        slug: 'hello',
        original_path: 'content/posts/hello.md',
      });
      expect(metadata.trash_path).toMatch(/^\.nectar\/trash\/.+\/hello\.md$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('uses page kind hint when deleting a page slug', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['content', 'delete', 'about', '--kind', 'pages', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { kind: string; original_path: string };
      expect(parsed.kind).toBe('pages');
      expect(parsed.original_path).toBe(join(dir, 'content/pages/about.md'));
      expect(existsSync(join(dir, 'content/pages/about.md'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('falls back to slug frontmatter when the filename differs', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/custom-file.md'),
        '---\ntitle: Custom\nslug: custom-slug\ndate: 2026-01-04T00:00:00Z\n---\n\nBody\n',
      );
      const { stdout, exitCode } = await runCli(
        ['content', 'delete', 'custom-slug', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { original_path: string; trash_path: string };
      expect(parsed.original_path).toBe(join(dir, 'content/posts/custom-file.md'));
      expect(parsed.trash_path).toMatch(/custom-slug\.md$/);
      expect(existsSync(join(dir, 'content/posts/custom-file.md'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--purge only deletes matching aged trash entries and keeps current content', async () => {
    const dir = await makeFixture();
    try {
      const oldTrash = join(dir, '.nectar/trash/2000-01-01T00-00-00-000Z');
      const freshTrash = join(dir, '.nectar/trash/2999-01-01T00-00-00-000Z');
      await mkdir(oldTrash, { recursive: true });
      await mkdir(freshTrash, { recursive: true });
      await writeFile(join(oldTrash, 'hello.md'), 'old');
      await writeFile(
        join(oldTrash, 'hello.meta.json'),
        JSON.stringify({ slug: 'hello', original_path: 'content/posts/hello.md' }),
      );
      await writeFile(join(freshTrash, 'hello.md'), 'fresh');
      await writeFile(
        join(freshTrash, 'hello.meta.json'),
        JSON.stringify({ slug: 'hello', original_path: 'content/posts/hello.md' }),
      );

      const { stdout, exitCode } = await runCli(
        ['content', 'delete', 'hello', '--purge', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { purged: number };
      expect(parsed.purged).toBe(1);
      expect(existsSync(oldTrash)).toBe(false);
      expect(existsSync(freshTrash)).toBe(true);
      expect(existsSync(join(dir, 'content/posts/hello.md'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--purge without a slug purges all aged trash entries', async () => {
    const dir = await makeFixture();
    try {
      const oldTrash = join(dir, '.nectar/trash/2000-01-01T00-00-00-000Z');
      await mkdir(oldTrash, { recursive: true });
      await writeFile(join(oldTrash, 'about.md'), 'old');

      const { stdout, exitCode } = await runCli(['content', 'delete', '--purge', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { purged: number };
      expect(parsed.purged).toBe(1);
      expect((await readdir(join(dir, '.nectar/trash'))).length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
