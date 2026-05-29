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
      'status: published',
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
  test('import entry writes the post and forces status needs-review', async () => {
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

  test('legacy `page` import kind is rejected', async () => {
    const { srcDir, destDir, zipPath } = await makeEntryFixture();
    try {
      const { stderr, exitCode } = await runCli(['import', 'page', zipPath], destDir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('expected `entry`');
    } finally {
      await rm(srcDir, { recursive: true, force: true });
      await rm(destDir, { recursive: true, force: true });
    }
  });
});
