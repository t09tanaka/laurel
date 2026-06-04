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
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-info-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      'title = "Info Test Site"',
      'url = "https://info.test"',
      'locale = "en-US"',
      '',
      '[build]',
      'base_path = "/blog/"',
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

describe('cli info', () => {
  test('--help advertises --json and --config', async () => {
    const { stdout, exitCode } = await runCli(['info', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--config');
  });

  test('json output includes laurel/runtime/os/project blocks', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['info', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        laurel: { version: string };
        runtime: { bun: string | null; node: string };
        os: { platform: string };
        project: { site_title: string | null; base_path: string | null; locale: string | null };
      };
      expect(parsed.laurel.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(parsed.runtime.node).toMatch(/^v\d+\./);
      expect(parsed.os.platform.length).toBeGreaterThan(0);
      expect(parsed.project.site_title).toBe('Info Test Site');
      expect(parsed.project.base_path).toBe('/blog/');
      expect(parsed.project.locale).toBe('en-US');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('`env` is accepted as an alias for info', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['env', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { laurel: { version: string } };
      expect(parsed.laurel.version).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('text mode renders human-friendly lines', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['info'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Laurel');
      expect(stdout).toContain('Bun');
      expect(stdout).toContain('Project');
      expect(stdout).toContain('Info Test Site');
      expect(stdout).toContain('/blog/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
