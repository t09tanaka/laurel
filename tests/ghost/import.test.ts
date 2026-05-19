import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGhostExport } from '~/ghost/import.ts';
import { ensureDir } from '~/util/fs.ts';

interface CapturedStderr {
  data: string;
  restore: () => void;
}

function captureStderr(): CapturedStderr {
  const original = process.stderr.write.bind(process.stderr);
  let data = '';
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    data += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  return {
    get data() {
      return data;
    },
    restore: () => {
      process.stderr.write = original;
    },
  } as CapturedStderr;
}

function makeExport(posts: Array<{ slug: string; title: string; html?: string }>): string {
  return JSON.stringify({
    db: [
      {
        data: {
          posts: posts.map((p, i) => ({
            id: `post-${i}`,
            title: p.title,
            slug: p.slug,
            html: p.html ?? `<p>${p.title}</p>`,
            status: 'published',
            type: 'post',
          })),
        },
      },
    ],
  });
}

describe('importGhostExport — --on-conflict policy', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('defaults to skip and preserves existing post files', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.overwritten).toBe(0);
    expect(summary.renamed).toBe(0);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
    expect(captured.data).toContain(`Skipped (already exists): ${dest}`);
  });

  test('overwrite replaces existing file and reports the path', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    expect(summary.overwritten).toBe(1);
    expect(summary.skipped).toBe(0);
    const after = await readFile(dest, 'utf8');
    expect(after).not.toBe('EXISTING');
    expect(after).toContain('slug: "hello"');
    expect(captured.data).toContain(`Overwrote: ${dest}`);
  });

  test('rename writes to a numbered filename and leaves the original alone', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'rename' });

    expect(summary.posts).toBe(1);
    expect(summary.renamed).toBe(1);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
    const renamed = join(cwd, 'content/posts/hello-2.md');
    expect(await readFile(renamed, 'utf8')).toContain('slug: "hello"');
    expect(captured.data).toContain(`Renamed (conflict with ${dest}): ${renamed}`);
  });

  test('rename picks the next free numeric suffix when -2 is also taken', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    await ensureDir(join(cwd, 'content/posts'));
    const original = join(cwd, 'content/posts/hello.md');
    const blocker = join(cwd, 'content/posts/hello-2.md');
    await writeFile(original, 'A');
    await writeFile(blocker, 'B');

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'rename' });

    expect(summary.renamed).toBe(1);
    expect(await readFile(original, 'utf8')).toBe('A');
    expect(await readFile(blocker, 'utf8')).toBe('B');
    const fresh = join(cwd, 'content/posts/hello-3.md');
    expect(await readFile(fresh, 'utf8')).toContain('slug: "hello"');
  });

  test('writes new files without touching stderr when there is no conflict', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'fresh', title: 'Fresh' }]));

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'skip' });

    expect(summary.posts).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(captured.data).toBe('');
    const dest = join(cwd, 'content/posts/fresh.md');
    expect(await readFile(dest, 'utf8')).toContain('slug: "fresh"');
  });
});
