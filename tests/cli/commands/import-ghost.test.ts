import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function exportPayload(): string {
  return JSON.stringify({
    db: [
      {
        data: {
          posts: [
            {
              id: 'p1',
              title: 'Hello',
              slug: 'hello',
              html: '<p>Hello</p>',
              status: 'published',
              type: 'post',
            },
          ],
        },
      },
    ],
  });
}

describe('cli import-ghost — --on-conflict', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-')));
    exportFile = join(dir, 'export.json');
    await writeFile(exportFile, exportPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises the --on-conflict option', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--on-conflict');
    expect(stdout).toContain('skip|overwrite|rename');
  });

  test('rejects an unknown --on-conflict value with exit 2', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--on-conflict', 'bogus'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --on-conflict value: bogus');
  });

  test('default policy is skip and reports the conflict on stderr', async () => {
    const dest = join(dir, 'content/posts/hello.md');
    await Bun.write(dest, 'EXISTING');
    const { stderr, exitCode } = await runCli(['import-ghost', exportFile], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toContain(`Skipped (already exists): ${dest}`);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
  });

  test('--on-conflict overwrite replaces the existing file', async () => {
    const dest = join(dir, 'content/posts/hello.md');
    await Bun.write(dest, 'EXISTING');
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain(`Overwrote: ${dest}`);
    const after = await readFile(dest, 'utf8');
    expect(after).not.toBe('EXISTING');
    expect(after).toContain('slug: "hello"');
  });

  test('--on-conflict rename writes a numbered sibling', async () => {
    const dest = join(dir, 'content/posts/hello.md');
    await Bun.write(dest, 'EXISTING');
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--on-conflict', 'rename'],
      dir,
    );
    expect(exitCode).toBe(0);
    const renamed = join(dir, 'content/posts/hello-2.md');
    expect(stderr).toContain(`Renamed (conflict with ${dest}): ${renamed}`);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
    expect(await readFile(renamed, 'utf8')).toContain('slug: "hello"');
  });
});

describe('cli import-ghost — folder input + --assets (#73)', () => {
  let dir: string;
  let exportFolder: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-')));
    exportFolder = join(dir, 'ghost-export');
    await Bun.write(join(exportFolder, 'my-blog.ghost.2024-01-01.json'), exportPayload());
    await Bun.write(join(exportFolder, 'content/images/2024/cover.jpg'), 'COVER');
    await Bun.write(join(exportFolder, 'content/files/handout.pdf'), 'PDF');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises the file/folder/zip positional and --assets', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--assets');
    expect(stdout).toContain('unzipped folder');
    expect(stdout).toContain('.zip archive');
  });

  test('passing a folder ingests JSON and copies image/file assets', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFolder, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain('Copied 2 asset files');
    expect(await readFile(join(dir, 'content/posts/hello.md'), 'utf8')).toContain('slug: "hello"');
    expect(await readFile(join(dir, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    expect(await readFile(join(dir, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
  });

  test('--assets pointing to an external content/ dir copies from there', async () => {
    const jsonOnly = join(dir, 'export.json');
    await Bun.write(jsonOnly, exportPayload());
    const externalAssets = join(dir, 'external-assets');
    await Bun.write(join(externalAssets, 'images/cover.jpg'), 'EXTERNAL');

    const { exitCode } = await runCli(
      ['import-ghost', jsonOnly, '--assets', externalAssets, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(await readFile(join(dir, 'content/images/cover.jpg'), 'utf8')).toBe('EXTERNAL');
  });

  test('passing a corrupt .zip exits non-zero with a clear error', async () => {
    const fakeZip = join(dir, 'export.zip');
    await Bun.write(fakeZip, 'not really a zip');
    const { stderr, exitCode } = await runCli(['import-ghost', fakeZip], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Failed to extract');
  });

  test('passing a real .zip extracts and imports posts + assets', async () => {
    const zipPath = join(dir, 'ghost-export.zip');
    const proc = Bun.spawn(['zip', '-rq', zipPath, 'ghost-export'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const { exitCode, stderr } = await runCli(
      ['import-ghost', zipPath, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain('Copied 2 asset files');
    expect(await readFile(join(dir, 'content/posts/hello.md'), 'utf8')).toContain('slug: "hello"');
    expect(await readFile(join(dir, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    expect(await readFile(join(dir, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
  });
});
