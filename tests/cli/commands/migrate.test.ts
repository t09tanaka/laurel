import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptMarkdown } from '~/cli/commands/migrate.ts';

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

describe('adaptMarkdown', () => {
  test('passes through YAML hugo files untouched', () => {
    const yaml = '---\ntitle: a\n---\nbody';
    expect(adaptMarkdown('hugo', yaml)).toBe(yaml);
  });
  test('flags hugo TOML frontmatter with a TODO marker', () => {
    const result = adaptMarkdown('hugo', '+++\ntitle = "a"\n+++\nbody');
    expect(result).toContain('TODO');
    expect(result).toContain('TOML frontmatter');
  });
});

describe('cli migrate', () => {
  test('--help shows the source listing', async () => {
    const { stdout, exitCode } = await runCli(['migrate', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ghost');
    expect(stdout).toContain('wordpress');
    expect(stdout).toContain('hugo');
  });

  test('rejects unknown source with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['migrate', 'tumblr', '/tmp/x']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid source');
  });

  test('hugo source dry-run reports zero copies on empty tree', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-migrate-')));
    const src = await realpath(await mkdtemp(join(tmpdir(), 'laurel-migrate-src-')));
    try {
      await mkdir(join(src, 'content/posts'), { recursive: true });
      await writeFile(join(src, 'content/posts/hello.md'), '---\ntitle: Hello\n---\nbody\n');
      const { exitCode } = await runCli(['migrate', 'hugo', src, '--dry-run'], dir);
      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(src, { recursive: true, force: true });
    }
  });

  test('hugo source copies posts into content/posts/', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-migrate-')));
    const src = await realpath(await mkdtemp(join(tmpdir(), 'laurel-migrate-src-')));
    try {
      await mkdir(join(src, 'content/posts'), { recursive: true });
      await writeFile(join(src, 'content/posts/hello.md'), '---\ntitle: Hello\n---\nbody\n');
      const { exitCode } = await runCli(['migrate', 'hugo', src], dir);
      expect(exitCode).toBe(0);
      const copied = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
      expect(copied).toContain('title: Hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(src, { recursive: true, force: true });
    }
  });

  test('passes Ghost max-post-html-size through to import-ghost', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-migrate-ghost-')));
    const exportFile = join(dir, 'ghost.json');
    try {
      await writeFile(
        exportFile,
        JSON.stringify({
          db: [
            {
              data: {
                posts: [
                  {
                    id: 'p1',
                    title: 'Huge HTML',
                    slug: 'huge-html',
                    html: `<p>${'x'.repeat(256)}</p>`,
                    status: 'published',
                    type: 'post',
                  },
                ],
              },
            },
          ],
        }),
      );

      const { stderr, exitCode } = await runCli(
        ['migrate', 'ghost', exportFile, '--max-post-html-size', '64B'],
        dir,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toContain('exceeds the configured per-post HTML cap');
      const out = await readFile(join(dir, 'content/posts/huge-html.md'), 'utf8');
      expect(out).toContain('title: "Huge HTML"');
      expect(out).not.toContain('x'.repeat(256));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
