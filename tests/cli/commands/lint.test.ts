import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickFrontmatterCheck } from '~/cli/commands/lint.ts';

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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-lint-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      'title = "Lint Test"',
      'url = "https://lint.test"',
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

describe('quickFrontmatterCheck', () => {
  test('detects missing frontmatter fence', () => {
    expect(quickFrontmatterCheck('hello world')).toBe('missing');
  });
  test('detects unclosed frontmatter', () => {
    expect(quickFrontmatterCheck('---\ntitle: a\nbody')).toBe('unclosed');
  });
  test('passes well-formed frontmatter', () => {
    expect(quickFrontmatterCheck('---\ntitle: a\n---\nbody')).toBe('ok');
  });
});

describe('cli lint', () => {
  test('--help advertises --json and --strict', async () => {
    const { stdout, exitCode } = await runCli(['lint', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--strict');
  });

  test('clean corpus reports no findings (exit 0)', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        '---\ntitle: Hello\ndate: 2025-01-01T00:00:00Z\n---\n\n# Hello\n\nBody.\n',
      );
      const { stdout, exitCode } = await runCli(['lint', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { count: number; findings: unknown[] };
      expect(parsed.count).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('flags duplicate slugs as errors and exits 1', async () => {
    const dir = await makeFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/a.md'),
        '---\ntitle: A\nslug: same\ndate: 2025-01-01T00:00:00Z\n---\nbody\n',
      );
      await writeFile(
        join(dir, 'content/posts/b.md'),
        '---\ntitle: B\nslug: same\ndate: 2025-01-02T00:00:00Z\n---\nbody\n',
      );
      const { stdout, exitCode } = await runCli(['lint', '--json'], dir);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout) as {
        errors: number;
        findings: Array<{ rule: string }>;
      };
      expect(parsed.errors).toBeGreaterThan(0);
      expect(parsed.findings.some((f) => f.rule === 'duplicate-slug')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--strict turns title-too-long warnings into exit 1', async () => {
    const dir = await makeFixture();
    try {
      const longTitle = 'x'.repeat(80);
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        `---\ntitle: ${longTitle}\ndate: 2025-01-01T00:00:00Z\n---\nbody\n`,
      );
      const lax = await runCli(['lint', '--json'], dir);
      expect(lax.exitCode).toBe(0);
      const strict = await runCli(['lint', '--strict', '--json'], dir);
      expect(strict.exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
