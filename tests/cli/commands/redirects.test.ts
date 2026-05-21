import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('cli redirects', () => {
  test('list loads project and Ghost-style redirects', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-redirects-cli-')));
    try {
      await mkdir(join(dir, 'content/data'), { recursive: true });
      await writeFile(join(dir, 'redirects.yaml'), '- from: /old\n  to: /new\n  status: 308\n');
      await writeFile(
        join(dir, 'content/data/redirects.json'),
        JSON.stringify([{ from: '/ghost-old', to: '/ghost-new', permanent: true }]),
      );

      const { stdout, stderr, exitCode } = await runCli(['redirects', 'list', '--json'], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsed = JSON.parse(stdout) as {
        count: number;
        redirects: Array<{ from: string; to: string; status: number }>;
      };
      expect(parsed.count).toBe(2);
      expect(parsed.redirects.map((r) => [r.from, r.to, r.status])).toEqual([
        ['/old', '/new', 308],
        ['/ghost-old', '/ghost-new', 301],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('validate reports duplicate source paths after first-match collapse', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-redirects-cli-dupes-')));
    try {
      await writeFile(
        join(dir, 'redirects.yaml'),
        ['- from: /old', '  to: /first', '- from: /old', '  to: /second', ''].join('\n'),
      );

      const { stdout, exitCode } = await runCli(['redirects', 'validate'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Loaded 2 redirect rule(s)');
      expect(stdout).toContain('1 duplicate source rule(s)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
