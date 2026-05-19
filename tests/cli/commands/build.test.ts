import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDryRunRouteTable } from '~/cli/commands/build.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: env ? { ...process.env, ...env } : undefined,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-')));
  for (const [path, body] of Object.entries(files)) {
    await Bun.write(join(dir, path), body);
  }
  return dir;
}

describe('nectar build exit codes', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns 2 on usage error (unknown flag)', async () => {
    const dir = await makeFixture({ 'nectar.toml': '[site]\ntitle = "x"\n' });
    cleanups.push(dir);
    const result = await runCli(['build', '--no-such-flag'], dir);
    expect(result.exitCode).toBe(2);
  });

  test('returns 3 on config error (invalid TOML)', async () => {
    const dir = await makeFixture({ 'nectar.toml': 'this is = not = valid TOML\n' });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(3);
  });

  test('returns 5 on theme error (missing theme directory)', async () => {
    const dir = await makeFixture({
      'nectar.toml': '[site]\ntitle = "x"\n\n[theme]\nname = "does-not-exist"\ndir = "themes"\n',
    });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(5);
  });
});

async function makeDryRunFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-dryrun-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await Bun.write(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Dry Run Test"',
      'url = "https://dryrun.test"',
      '',
      '[theme]',
      'dir = "themes"',
      'name = "source"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
  );
  await Bun.write(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
  );
  await Bun.write(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n');
  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
  return dir;
}

describe('nectar build --dry-run (#252)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('--dry-run exits 0 and never writes dist/', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Dry run: would build');
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });

  test('--dry-run without --verbose suppresses the per-route table', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Routes:');
    expect(result.stderr).not.toContain('TEMPLATE');
  });

  test('--dry-run --verbose prints the per-route table', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['--verbose', 'build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Routes:');
    expect(result.stderr).toContain('TEMPLATE');
    expect(result.stderr).toContain('URL');
    expect(result.stderr).toContain('/hello/');
  });
});

describe('formatDryRunRouteTable', () => {
  test('renders aligned columns including a header row', () => {
    const out = formatDryRunRouteTable([
      {
        url: '/',
        outputPath: 'index.html',
        template: 'home.hbs',
        kind: 'home',
        bytes: 1234,
        reused: false,
      },
      {
        url: '/post-with-a-long-slug/',
        outputPath: 'post-with-a-long-slug/index.html',
        template: 'post.hbs',
        kind: 'post',
        bytes: 56789,
        reused: false,
      },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Routes:');
    expect(lines[1]).toContain('KIND');
    expect(lines[1]).toContain('URL');
    expect(lines[1]).toContain('TEMPLATE');
    expect(lines[1]).toContain('BYTES');
    expect(lines[1]).toContain('OUTPUT');
    expect(lines[2]).toContain('home');
    expect(lines[2]).toContain('1234');
    expect(lines[3]).toContain('/post-with-a-long-slug/');
    expect(lines[3]).toContain('56789');
  });

  test('handles an empty route list', () => {
    expect(formatDryRunRouteTable([])).toBe('Routes: (none)');
  });
});

describe('nectar build --include-drafts (#253)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeSiteWithDraft(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-drafts-')));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });
    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Drafts"',
        'url = "https://drafts.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
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
      join(dir, 'content/posts/wip.md'),
      `---
title: WIP
status: draft
date: 2026-02-01T00:00:00Z
---

Not ready.
`,
      'utf8',
    );
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  test('--include-drafts flag emits the "Building with drafts" warning', async () => {
    const dir = await makeSiteWithDraft();
    cleanups.push(dir);
    const result = await runCli(['build', '--include-drafts'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Building with drafts');
  });

  test('NECTAR_DRAFTS=1 env alias also opts in', async () => {
    const dir = await makeSiteWithDraft();
    cleanups.push(dir);
    const result = await runCli(['build'], dir, { NECTAR_DRAFTS: '1' });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Building with drafts');
  });

  test('without the flag, drafts are silently excluded (no warning)', async () => {
    const dir = await makeSiteWithDraft();
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Building with drafts');
  });
});
