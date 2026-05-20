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
  await mkdir(join(dir, 'content/pages'), { recursive: true });
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

describe('cli tags rename', () => {
  test('rewrites inline `tags:` references in posts and moves the tag file', async () => {
    const dir = await makeFixture();
    try {
      const { exitCode } = await runCli(['tags', 'rename', 'news', 'updates', '--json'], dir);
      expect(exitCode).toBe(0);
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toMatch(/tags:\s*\[updates\]/);
      const world = await readFile(join(dir, 'content/posts/world.md'), 'utf8');
      expect(world).toMatch(/tags:\s*\[updates\]/);
      expect(existsSync(join(dir, 'content/tags/news.md'))).toBe(false);
      expect(existsSync(join(dir, 'content/tags/updates.md'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--dry-run does not mutate files but reports the changed list', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['tags', 'rename', 'news', 'updates', '--dry-run', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout) as {
        changed_files: string[];
        tag_file_moved: boolean;
        dry_run: boolean;
      };
      expect(result.dry_run).toBe(true);
      expect(result.changed_files.length).toBeGreaterThan(0);
      const { readFile } = await import('node:fs/promises');
      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toMatch(/tags:\s*\[news\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects identical old/new slug', async () => {
    const { stderr, exitCode } = await runCli(['tags', 'rename', 'a', 'a']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('identical');
  });
});

describe('cli tags merge', () => {
  test('rewrites post and page tag references to the canonical tag with duplicates removed', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(join(dir, 'content/tags/updates.md'), '---\nname: Updates\n---\n');
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        '---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\ntags: [news, updates, dormant]\n---\n\nBody\n',
      );
      await writeFile(
        join(dir, 'content/pages/about.md'),
        '---\ntitle: About\ndate: 2026-01-03T00:00:00Z\ntags:\n  - "news"\n  - dormant\n  - updates\n---\n\nBody\n',
      );

      const { stdout, exitCode } = await runCli(
        ['tags', 'merge', 'news', 'dormant', 'updates', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout) as {
        into_slug: string;
        from_slugs: string[];
        changed_files: string[];
        tag_files_left: string[];
      };
      expect(result.into_slug).toBe('updates');
      expect(result.from_slugs).toEqual(['news', 'dormant']);
      expect(result.changed_files.length).toBe(3);
      expect(result.tag_files_left.length).toBe(2);

      const { readFile } = await import('node:fs/promises');
      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toContain('tags: [updates]');
      const about = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
      expect(about).toContain('tags:\n  - "updates"\n---');

      const second = await runCli(['tags', 'merge', 'news', 'dormant', 'updates', '--json'], dir);
      expect(second.exitCode).toBe(0);
      const secondResult = JSON.parse(second.stdout) as { changed_files: string[] };
      expect(secondResult.changed_files).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--dry-run reports tag file promotion without mutating content or tag files', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(
        ['tags', 'merge', 'news', 'canonical', '--dry-run', '--json'],
        dir,
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout) as {
        dry_run: boolean;
        tag_file_promoted: { from: string; to: string } | null;
      };
      expect(result.dry_run).toBe(true);
      expect(result.tag_file_promoted?.from).toContain('content/tags/news.md');
      expect(result.tag_file_promoted?.to).toContain('content/tags/canonical.md');

      const { existsSync } = await import('node:fs');
      const { readFile } = await import('node:fs/promises');
      expect(existsSync(join(dir, 'content/tags/news.md'))).toBe(true);
      expect(existsSync(join(dir, 'content/tags/canonical.md'))).toBe(false);
      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toContain('tags: [news]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('normalizes CJK tag slugs without dropping them', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(join(dir, 'content/tags/旧.md'), '---\nname: Old\n---\n');
      await writeFile(join(dir, 'content/tags/ニュース.md'), '---\nname: News\n---\n');
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        '---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\ntags: [旧, ニュース]\n---\n\nBody\n',
      );

      const { exitCode } = await runCli(['tags', 'merge', '旧', 'ニュース'], dir);
      expect(exitCode).toBe(0);
      const { readFile } = await import('node:fs/promises');
      const hello = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(hello).toContain('tags: [ニュース]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
