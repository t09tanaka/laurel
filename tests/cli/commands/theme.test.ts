import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
