import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '~/build/pipeline.ts';
import { createThemeServeFixture, gatherThemeServeWatchPaths } from '~/cli/commands/theme-serve.ts';
import { buildZipFromEntries } from '~/cli/commands/theme.ts';

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

async function makeProject(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-theme-')));
  await mkdir(join(dir, 'themes'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Theme Test"',
      'url = "https://theme.test"',
      '',
      '[theme]',
      'name = "demo"',
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

async function writeTheme(dir: string, name: string, version?: string): Promise<void> {
  await mkdir(join(dir, 'themes', name), { recursive: true });
  if (version !== undefined) {
    await writeFile(
      join(dir, 'themes', name, 'package.json'),
      `${JSON.stringify({ name, version }, null, 2)}\n`,
    );
  }
}

describe('buildZipFromEntries', () => {
  test('writes a valid local-file-header signature at offset 0', () => {
    const buf = buildZipFromEntries(
      [{ archivePath: 'package.json', data: Buffer.from('{}\n', 'utf8') }],
      'demo',
    );
    // PK\x03\x04 — local file header signature.
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    // Last 22 bytes must start with PK\x05\x06 (end-of-central-directory).
    const eocd = buf.subarray(buf.length - 22, buf.length - 18).toString('hex');
    expect(eocd).toBe('504b0506');
  });

  test('archive paths are prefixed with the root name', () => {
    const buf = buildZipFromEntries(
      [{ archivePath: 'README.md', data: Buffer.from('hi', 'utf8') }],
      'mytheme',
    );
    expect(buf.toString('binary')).toContain('mytheme/README.md');
  });
});

describe('cli theme list', () => {
  test('lists themes with versions and marks the configured default', async () => {
    const dir = await makeProject();
    try {
      await writeTheme(dir, 'demo', '1.2.3');
      await writeTheme(dir, 'alto', '0.4.0');
      await writeTheme(dir, 'unpackaged');

      const { stdout, exitCode } = await runCli(['theme', 'list', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        count: number;
        themes: Array<{ name: string; version: string | null; path: string; default: boolean }>;
      };
      expect(parsed.count).toBe(3);
      expect(parsed.themes[0]).toEqual({
        name: 'demo',
        version: '1.2.3',
        path: 'themes/demo',
        default: true,
      });
      expect(parsed.themes.map((theme) => theme.name)).toEqual(['demo', 'alto', 'unpackaged']);
      expect(parsed.themes.find((theme) => theme.name === 'unpackaged')?.version).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('text mode prints a theme table', async () => {
    const dir = await makeProject();
    try {
      await writeTheme(dir, 'demo', '1.2.3');
      await writeTheme(dir, 'source', '2.0.0');

      const { stdout, exitCode } = await runCli(['theme', 'list'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('name');
      expect(stdout).toContain('version');
      expect(stdout).toContain('path');
      expect(stdout).toContain('default');
      expect(stdout).toContain('demo');
      expect(stdout).toContain('1.2.3');
      expect(stdout).toContain('themes/demo');
      expect(stdout).toContain('yes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('prints an empty message when theme.dir does not exist', async () => {
    const dir = await makeProject();
    try {
      await rm(join(dir, 'themes'), { recursive: true, force: true });
      const { stdout, exitCode } = await runCli(['theme', 'list'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('No themes found.\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli theme new', () => {
  test('scaffolds a minimal theme directory', async () => {
    const dir = await makeProject();
    try {
      const { exitCode } = await runCli(['theme', 'new', 'minty'], dir);
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'themes/minty/package.json'))).toBe(true);
      expect(existsSync(join(dir, 'themes/minty/default.hbs'))).toBe(true);
      expect(existsSync(join(dir, 'themes/minty/index.hbs'))).toBe(true);
      const pkg = JSON.parse(await readFile(join(dir, 'themes/minty/package.json'), 'utf8')) as {
        name: string;
        version: string;
      };
      expect(pkg.name).toBe('minty');
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid theme names with exit 2', async () => {
    const dir = await makeProject();
    try {
      const { stderr, exitCode } = await runCli(['theme', 'new', 'Bad Name'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Invalid theme name');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--from <existing> copies the source theme', async () => {
    const dir = await makeProject();
    try {
      await runCli(['theme', 'new', 'base'], dir);
      const { exitCode } = await runCli(['theme', 'new', 'copy', '--from', 'base'], dir);
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'themes/copy/default.hbs'))).toBe(true);
      // Name field is unchanged: --from copies verbatim by design.
      const pkg = JSON.parse(await readFile(join(dir, 'themes/copy/package.json'), 'utf8')) as {
        name: string;
      };
      expect(pkg.name).toBe('base');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli theme zip', () => {
  test('writes <name>-<version>.zip with a valid signature', async () => {
    const dir = await makeProject();
    try {
      // Create the active theme via `theme new` so package.json/version exist.
      await runCli(['theme', 'new', 'demo'], dir);
      const { exitCode } = await runCli(['theme', 'zip'], dir);
      expect(exitCode).toBe(0);
      const expected = join(dir, 'demo-0.1.0.zip');
      expect(existsSync(expected)).toBe(true);
      const archive = await readFile(expected);
      expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses to overwrite without --force', async () => {
    const dir = await makeProject();
    try {
      await runCli(['theme', 'new', 'demo'], dir);
      await runCli(['theme', 'zip'], dir);
      const second = await runCli(['theme', 'zip'], dir);
      expect(second.exitCode).toBe(1);
      expect(second.stderr).toContain('Refusing to overwrite');
      const third = await runCli(['theme', 'zip', '--force'], dir);
      expect(third.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli theme serve', () => {
  test('rejects invalid --port values before starting the server', async () => {
    const { stderr, exitCode } = await runCli(['theme', 'serve', '--port', '80.5']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
  });

  test('creates a small fixture site and watches only the active theme root', async () => {
    const dir = await makeProject();
    try {
      await runCli(['theme', 'new', 'demo'], dir);
      const fixture = await createThemeServeFixture({ cwd: dir });
      try {
        expect(gatherThemeServeWatchPaths(fixture)).toEqual([join(dir, 'themes', 'demo')]);
        const configText = await readFile(fixture.configPath, 'utf8');
        expect(configText).toContain('posts_dir = "content/posts"');
        expect(configText).toContain(`dir = "${join(dir, 'themes')}"`);

        const summary = await build({ cwd: fixture.workDir, configPath: fixture.configPath });
        expect(summary.routeCount).toBeGreaterThan(0);
        expect(summary.routeCount).toBeLessThan(10);
      } finally {
        await rm(fixture.workDir, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('starts, serves the fixture build, and shuts down on SIGTERM', async () => {
    const dir = await makeProject();
    try {
      await runCli(['theme', 'new', 'demo'], dir);
      const proc = Bun.spawn(['bun', CLI_ENTRY, 'theme', 'serve', '--port', '0'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let stdout = '';
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value, { stream: true });
          if (stdout.includes('Theme watch mode enabled')) break;
        }
        expect(stdout).toContain('Running initial theme build');
        expect(stdout).toContain('Initial theme build complete');
        expect(stdout).toContain('Theme server listening on');
        expect(stdout).toContain('Theme watch mode enabled: tracking 1 path(s)');
        reader.releaseLock();
      } finally {
        proc.kill('SIGTERM');
        await proc.exited;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
