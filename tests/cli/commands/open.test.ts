import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

async function runOpenCli(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, 'open', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function setupProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'nectar.toml'),
    ['[site]', 'title = "T"', 'url = "https://example.com"', ''].join('\n'),
    'utf8',
  );
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
}

describe('cli open', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-open-')));
    await setupProject(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('exits 1 with usage when slug is missing', async () => {
    const { stderr, exitCode } = await runOpenCli([], dir, {});
    expect(exitCode).toBe(1);
    expect(stderr).toContain('A slug is required');
    expect(stderr).toContain('Usage:');
  });

  test('exits 1 when no post or page matches the slug', async () => {
    const { stderr, exitCode } = await runOpenCli(['ghost-slug'], dir, {});
    expect(exitCode).toBe(1);
    expect(stderr).toContain('No post or page found with slug "ghost-slug"');
  });

  test('resolves <posts_dir>/<slug>.md and spawns $EDITOR', async () => {
    const marker = join(dir, 'editor-was-called.txt');
    const editor = join(dir, 'fake-editor.sh');
    await writeFile(editor, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`, 'utf8');
    await Bun.spawn(['chmod', '+x', editor]).exited;

    const postPath = join(dir, 'content/posts/hello-world.md');
    await writeFile(postPath, '---\ntitle: "Hello"\n---\n\nbody\n', 'utf8');

    const { exitCode } = await runOpenCli(['hello-world'], dir, { EDITOR: editor });
    expect(exitCode).toBe(0);
    const captured = await readFile(marker, 'utf8');
    expect(captured).toBe(postPath);
  });

  test('resolves a slug via frontmatter when filename differs', async () => {
    const marker = join(dir, 'marker.txt');
    const editor = join(dir, 'fake-editor.sh');
    await writeFile(editor, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`, 'utf8');
    await Bun.spawn(['chmod', '+x', editor]).exited;

    const filePath = join(dir, 'content/posts/2026-05-20-launch.md');
    await writeFile(filePath, '---\nslug: announcement\ntitle: "L"\n---\n\nbody\n', 'utf8');

    const { exitCode } = await runOpenCli(['announcement'], dir, { EDITOR: editor });
    expect(exitCode).toBe(0);
    const captured = await readFile(marker, 'utf8');
    expect(captured).toBe(filePath);
  });

  test('falls back to "vi" when $EDITOR is unset (covered by a stub-vi in PATH)', async () => {
    // We can't safely invoke a real vi in CI, so install a fake `vi` on PATH
    // and clear EDITOR so the command falls through the default branch.
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });
    const marker = join(dir, 'vi-marker.txt');
    const fakeVi = join(binDir, 'vi');
    await writeFile(fakeVi, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`, 'utf8');
    await Bun.spawn(['chmod', '+x', fakeVi]).exited;

    const postPath = join(dir, 'content/posts/hello-vi.md');
    await writeFile(postPath, '---\ntitle: "Hello"\n---\n\nbody\n', 'utf8');

    const { exitCode } = await runOpenCli(['hello-vi'], dir, {
      EDITOR: undefined,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    });
    expect(exitCode).toBe(0);
    const captured = await readFile(marker, 'utf8');
    expect(captured).toBe(postPath);
  });

  test('--kind pages restricts the search to the pages directory', async () => {
    const marker = join(dir, 'marker-kind.txt');
    const editor = join(dir, 'fake-editor.sh');
    await writeFile(editor, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`, 'utf8');
    await Bun.spawn(['chmod', '+x', editor]).exited;

    // Both kinds use the same slug; --kind picks pages.
    const postPath = join(dir, 'content/posts/about.md');
    const pagePath = join(dir, 'content/pages/about.md');
    await writeFile(postPath, '---\ntitle: "Post About"\n---\n\n', 'utf8');
    await writeFile(pagePath, '---\ntitle: "Page About"\n---\n\n', 'utf8');

    const { exitCode } = await runOpenCli(['about', '--kind', 'pages'], dir, { EDITOR: editor });
    expect(exitCode).toBe(0);
    const captured = await readFile(marker, 'utf8');
    expect(captured).toBe(pagePath);
  });

  test('--kind validates the value and exits 2', async () => {
    const { stderr, exitCode } = await runOpenCli(['x', '--kind', 'authors'], dir, {});
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --kind value');
  });
});
