import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '~/config/loader.ts';
import { exportEntryBundle } from '~/entry-bundle/index.ts';

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

async function makeEntryFixture(): Promise<{ srcDir: string; destDir: string; zipPath: string }> {
  const srcDir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-entry-src-')));
  const destDir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-entry-dest-')));

  const toml = [
    '[site]',
    'title = "Entry Bundle Test"',
    'description = "test"',
    'url = "https://entry.test"',
    '',
    '[components.rss]',
    'enabled = false',
    '',
    '[components.sitemap]',
    'enabled = false',
    '',
  ].join('\n');
  await writeFile(join(srcDir, 'nectar.toml'), toml, 'utf8');
  await writeFile(join(destDir, 'nectar.toml'), toml, 'utf8');

  await mkdir(join(srcDir, 'content/posts'), { recursive: true });
  await mkdir(join(srcDir, 'content/pages'), { recursive: true });
  await mkdir(join(srcDir, 'content/images'), { recursive: true });
  await mkdir(join(srcDir, 'content/tags'), { recursive: true });
  await mkdir(join(srcDir, 'content/authors'), { recursive: true });
  await writeFile(
    join(srcDir, 'content/posts/hello-entry.md'),
    [
      '---',
      'title: Hello Entry',
      'slug: hello-entry',
      'published_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      'Entry body.',
      '',
    ].join('\n'),
    'utf8',
  );

  // Generate the zip using the programmatic API so we don't depend on CLI for fixture setup
  const config = await loadConfig({ cwd: srcDir });
  const { zip } = await exportEntryBundle({
    cwd: srcDir,
    config,
    kind: 'post',
    slug: 'hello-entry',
  });
  const zipPath = join(srcDir, 'hello-entry.nectar.zip');
  await Bun.write(zipPath, zip);

  await mkdir(join(destDir, 'content/posts'), { recursive: true });
  await mkdir(join(destDir, 'content/pages'), { recursive: true });
  await mkdir(join(destDir, 'content/images'), { recursive: true });
  await mkdir(join(destDir, 'content/tags'), { recursive: true });
  await mkdir(join(destDir, 'content/authors'), { recursive: true });

  return { srcDir, destDir, zipPath };
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

  test('import entry writes the post with status needs-review', async () => {
    const { srcDir, destDir, zipPath } = await makeEntryFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(['import', 'entry', zipPath], destDir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        dryRun: boolean;
        result: { entryPath: string; kind: string; slug: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.dryRun).toBe(false);
      expect(parsed.result.kind).toBe('post');
      expect(parsed.result.slug).toBe('hello-entry');
      const written = await readFile(join(destDir, parsed.result.entryPath), 'utf8');
      expect(written).toContain('needs-review');
      expect(written).toContain('Hello Entry');
    } finally {
      await rm(srcDir, { recursive: true, force: true });
      await rm(destDir, { recursive: true, force: true });
    }
  });

  test('import entry --dry-run does not write files', async () => {
    const { srcDir, destDir, zipPath } = await makeEntryFixture();
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['import', 'entry', zipPath, '--dry-run'],
        destDir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        dryRun: boolean;
        result: { entryPath: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.dryRun).toBe(true);
      const expectedPath = join(destDir, parsed.result.entryPath);
      await expect(readFile(expectedPath, 'utf8')).rejects.toThrow();
    } finally {
      await rm(srcDir, { recursive: true, force: true });
      await rm(destDir, { recursive: true, force: true });
    }
  });

  test('import entry missing file arg prints usage error', async () => {
    const { srcDir, destDir } = await makeEntryFixture();
    try {
      const { stderr, exitCode } = await runCli(['import', 'entry'], destDir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Missing required argument');
    } finally {
      await rm(srcDir, { recursive: true, force: true });
      await rm(destDir, { recursive: true, force: true });
    }
  });
});
