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

async function runCli(args: string[], cwd?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-page-')));
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Import Page Site"',
      'description = "Imports page bundles"',
      'url = "https://import-page.test"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/pages/about.md'),
    ['---', 'title: Existing About', 'slug: about', '---', '', 'Existing body.', ''].join('\n'),
    'utf8',
  );
  const bundle = {
    nectar: { schema: 'nectar.page.v1', generated_at: '2026-05-22T00:00:00.000Z' },
    site: { title: 'Partner Site', url: 'https://partner.test' },
    page: {
      slug: 'about',
      path: 'content/pages/about.md',
      frontmatter: { title: 'Partner About', slug: 'about' },
      body: 'Partner body.\n',
    },
    assets: [{ path: 'content/images/partner.txt', encoding: 'utf8', content: 'asset\n' }],
  };
  await writeFile(join(dir, 'about.page.json'), JSON.stringify(bundle), 'utf8');
  return dir;
}

describe('cli import', () => {
  test('import page --dry-run reports planned rename without writing files', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['import', 'page', 'about.page.json', '--dry-run', '--on-conflict', 'rename'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        dryRun: boolean;
        result: { pagePath: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.result.pagePath).toBe('content/pages/about-2.md');
      await expect(readFile(join(dir, 'content/pages/about-2.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('import page applies rename conflict policy and restores assets', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['import', 'page', 'about.page.json', '--on-conflict', 'rename'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as { ok: boolean; result: { pagePath: string } };
      expect(parsed.ok).toBe(true);
      expect(parsed.result.pagePath).toBe('content/pages/about-2.md');
      expect(await readFile(join(dir, 'content/pages/about-2.md'), 'utf8')).toContain(
        'title: Partner About',
      );
      expect(await readFile(join(dir, 'content/images/partner.txt'), 'utf8')).toBe('asset\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
