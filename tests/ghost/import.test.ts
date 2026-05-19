import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

describe('importGhostExport — slug sanitization (#160)', () => {
  let cwd: string;
  let outside: string;
  let exportFile: string;

  beforeEach(async () => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-sec-')));
    cwd = join(tmp, 'project');
    outside = join(tmp, 'outside');
    await ensureDir(cwd);
    await ensureDir(outside);
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test('post slug `../../escape` is re-slugified and stays under content/posts', async () => {
    const escapeTarget = join(outside, 'escape.md');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Bad',
                  slug: '../../outside/escape',
                  html: '<p>Bad</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    await expect(access(escapeTarget)).rejects.toThrow();
    const postsDir = join(cwd, 'content/posts');
    const entries = await readdir(postsDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/\.md$/);
    expect(entries[0]).not.toContain('..');
    expect(entries[0]).not.toContain('/');
  });

  test('post with absolute-path slug stays under content/posts', async () => {
    const absTarget = join(outside, 'pwned.md');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Title-Fallback',
                  slug: '/etc/pwned',
                  html: '<p>x</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    await expect(access(absTarget)).rejects.toThrow();
    const entries = await readdir(join(cwd, 'content/posts'));
    expect(entries.length).toBe(1);
    expect(entries[0]).not.toContain('/');
  });

  test('tag slug `../tagjacked` is re-slugified and stays under content/tags', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              tags: [
                {
                  id: 't1',
                  slug: '../../outside/tagjacked',
                  name: 'Bad Tag',
                  description: 'has description so it gets written',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.tags).toBe(1);
    await expect(access(join(outside, 'tagjacked.md'))).rejects.toThrow();
    const entries = await readdir(join(cwd, 'content/tags'));
    expect(entries.length).toBe(1);
    expect(entries[0]).not.toContain('..');
    expect(entries[0]).not.toContain('/');
  });

  test('author slug `../authorjacked` is re-slugified and stays under content/authors', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              users: [
                {
                  id: 'u1',
                  slug: '../../outside/authorjacked',
                  name: 'Bad Author',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.authors).toBe(1);
    await expect(access(join(outside, 'authorjacked.md'))).rejects.toThrow();
    const entries = await readdir(join(cwd, 'content/authors'));
    expect(entries.length).toBe(1);
    expect(entries[0]).not.toContain('..');
    expect(entries[0]).not.toContain('/');
  });

  test('post slug that becomes empty after sanitization falls back to title', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Recoverable Title',
                  slug: '../..',
                  html: '<p>Body</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    const entries = await readdir(join(cwd, 'content/posts'));
    expect(entries).toEqual(['recoverable-title.md']);
  });

  test('post with no recoverable slug or title is skipped', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: '../..',
                  slug: '...',
                  html: '<p>Body</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(0);
    await expect(access(join(cwd, 'content/posts'))).rejects.toThrow();
  });
});

describe('importGhostExport — folder input + asset copy (#73)', () => {
  let exportDir: string;

  beforeEach(async () => {
    exportDir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-assets-')));
  });

  afterEach(async () => {
    await rm(exportDir, { recursive: true, force: true });
  });

  async function writeJsonNamed(name: string): Promise<string> {
    const file = join(exportDir, name);
    await writeFile(
      file,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p><img src="/content/images/2024/01/pic.jpg" alt="pic"></p>',
                  feature_image: '/content/images/2024/01/cover.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    return file;
  }

  test('folder input finds the .json and copies content/images, content/files, content/media', async () => {
    await writeJsonNamed('my-blog.ghost.2024-01-01.json');

    await ensureDir(join(exportDir, 'content/images/2024/01'));
    await writeFile(join(exportDir, 'content/images/2024/01/cover.jpg'), 'COVER');
    await writeFile(join(exportDir, 'content/images/2024/01/pic.jpg'), 'PIC');
    await ensureDir(join(exportDir, 'content/files'));
    await writeFile(join(exportDir, 'content/files/handout.pdf'), 'PDF');
    await ensureDir(join(exportDir, 'content/media/clip'));
    await writeFile(join(exportDir, 'content/media/clip/intro.mp4'), 'MP4');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(4);

      expect(await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8')).toBe('COVER');
      expect(await readFile(join(cwd, 'content/images/2024/01/pic.jpg'), 'utf8')).toBe('PIC');
      expect(await readFile(join(cwd, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
      expect(await readFile(join(cwd, 'content/media/clip/intro.mp4'), 'utf8')).toBe('MP4');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('folder input without content/ subdir but with images/ at top level still works', async () => {
    await writeJsonNamed('export.json');

    await ensureDir(join(exportDir, 'images/2024'));
    await writeFile(join(exportDir, 'images/2024/cover.jpg'), 'COVER');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(1);
      expect(await readFile(join(cwd, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('folder with no JSON throws a clear error', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      await expect(importGhostExport({ cwd, file: exportDir })).rejects.toThrow(
        /No \.json export file found in/,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('JSON file input + explicit --assets copies from the override dir', async () => {
    const jsonFile = await writeJsonNamed('export.json');

    const assetsRoot = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-ext-')));
    try {
      await ensureDir(join(assetsRoot, 'images'));
      await writeFile(join(assetsRoot, 'images/cover.jpg'), 'OVERRIDE');

      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
      try {
        const summary = await importGhostExport({
          cwd,
          file: jsonFile,
          onConflict: 'overwrite',
          assetsDir: assetsRoot,
        });
        expect(summary.posts).toBe(1);
        expect(summary.assetsCopied).toBe(1);
        expect(await readFile(join(cwd, 'content/images/cover.jpg'), 'utf8')).toBe('OVERRIDE');
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      await rm(assetsRoot, { recursive: true, force: true });
    }
  });

  test('--assets wins over folder-detected content/ subdir', async () => {
    await writeJsonNamed('export.json');
    await ensureDir(join(exportDir, 'content/images'));
    await writeFile(join(exportDir, 'content/images/auto.jpg'), 'AUTO');

    const override = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-ovr-')));
    try {
      await ensureDir(join(override, 'images'));
      await writeFile(join(override, 'images/explicit.jpg'), 'EXPLICIT');

      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
      try {
        const summary = await importGhostExport({
          cwd,
          file: exportDir,
          onConflict: 'overwrite',
          assetsDir: override,
        });
        expect(summary.assetsCopied).toBe(1);
        expect(await readFile(join(cwd, 'content/images/explicit.jpg'), 'utf8')).toBe('EXPLICIT');
        await expect(access(join(cwd, 'content/images/auto.jpg'))).rejects.toThrow();
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      await rm(override, { recursive: true, force: true });
    }
  });

  test('--assets pointing to a non-existent dir rejects with a clear error', async () => {
    const jsonFile = await writeJsonNamed('export.json');
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      await expect(
        importGhostExport({
          cwd,
          file: jsonFile,
          assetsDir: join(exportDir, 'does-not-exist'),
        }),
      ).rejects.toThrow(/--assets directory does not exist/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('does not overwrite existing destination asset files', async () => {
    await writeJsonNamed('export.json');
    await ensureDir(join(exportDir, 'content/images'));
    await writeFile(join(exportDir, 'content/images/cover.jpg'), 'FROM-EXPORT');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      await ensureDir(join(cwd, 'content/images'));
      await writeFile(join(cwd, 'content/images/cover.jpg'), 'KEEP-ME');

      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.assetsCopied).toBe(0);
      expect(await readFile(join(cwd, 'content/images/cover.jpg'), 'utf8')).toBe('KEEP-ME');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('passing a missing .zip path rejects with a clear error', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      await expect(
        importGhostExport({ cwd, file: join(exportDir, 'does-not-exist.zip') }),
      ).rejects.toThrow(/Cannot read Ghost export/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('JSON file input without --assets does not copy anything (back-compat)', async () => {
    const jsonFile = await writeJsonNamed('export.json');
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: jsonFile, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(0);
      await expect(access(join(cwd, 'content/images'))).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('importGhostExport — ZIP archive input (#88)', () => {
  let stagingDir: string;

  beforeEach(async () => {
    stagingDir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-zip-')));
  });

  afterEach(async () => {
    await rm(stagingDir, { recursive: true, force: true });
  });

  async function makeGhostExportFolder(root: string): Promise<void> {
    await ensureDir(root);
    await writeFile(
      join(root, 'my-blog.ghost.2024-01-01.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Zipped Hello',
                  slug: 'zipped-hello',
                  html: '<p><a href="__GHOST_URL__/content/files/handout.pdf">PDF</a> and <img src="__GHOST_URL__/content/images/2024/01/pic.jpg" alt="pic"></p>',
                  feature_image: '__GHOST_URL__/content/images/2024/01/cover.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    await ensureDir(join(root, 'content/images/2024/01'));
    await writeFile(join(root, 'content/images/2024/01/cover.jpg'), 'COVER');
    await writeFile(join(root, 'content/images/2024/01/pic.jpg'), 'PIC');
    await ensureDir(join(root, 'content/files'));
    await writeFile(join(root, 'content/files/handout.pdf'), 'PDF');
    await ensureDir(join(root, 'content/media'));
    await writeFile(join(root, 'content/media/intro.mp4'), 'MP4');
  }

  async function makeZip(
    zipPath: string,
    sourceDir: string,
    includeWrapper: boolean,
  ): Promise<void> {
    // `zip -r out.zip <name>` (run inside the parent dir) preserves the wrapper
    // folder. To produce a flat zip, run inside `sourceDir` and pass `.`.
    const cwd = includeWrapper ? dirname(sourceDir) : sourceDir;
    const target = includeWrapper ? sourceDir.slice(cwd.length + 1) : '.';
    const proc = Bun.spawn(['zip', '-rq', zipPath, target], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const errText = await new Response(proc.stderr).text();
      throw new Error(`Failed to build test zip: ${errText}`);
    }
  }

  test('extracts a wrapper-style Ghost zip and imports posts + assets', async () => {
    const exportFolder = join(stagingDir, 'my-blog.ghost.2024-01-01');
    await makeGhostExportFolder(exportFolder);
    const zipPath = join(stagingDir, 'my-blog.ghost.2024-01-01.zip');
    await makeZip(zipPath, exportFolder, true);

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-zip-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: zipPath, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(4);

      const postMd = await readFile(join(cwd, 'content/posts/zipped-hello.md'), 'utf8');
      expect(postMd).not.toContain('__GHOST_URL__');
      expect(postMd).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
      expect(postMd).toContain('/content/files/handout.pdf');

      expect(await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8')).toBe('COVER');
      expect(await readFile(join(cwd, 'content/images/2024/01/pic.jpg'), 'utf8')).toBe('PIC');
      expect(await readFile(join(cwd, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
      expect(await readFile(join(cwd, 'content/media/intro.mp4'), 'utf8')).toBe('MP4');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('extracts a flat (no wrapper folder) Ghost zip', async () => {
    const exportFolder = join(stagingDir, 'flat');
    await makeGhostExportFolder(exportFolder);
    const zipPath = join(stagingDir, 'flat-export.zip');
    await makeZip(zipPath, exportFolder, false);

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-zip-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: zipPath, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(4);
      expect(await readFile(join(cwd, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('cleans up the temp extraction dir after a successful import', async () => {
    const exportFolder = join(stagingDir, 'my-blog');
    await makeGhostExportFolder(exportFolder);
    const zipPath = join(stagingDir, 'my-blog.zip');
    await makeZip(zipPath, exportFolder, true);

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-zip-cwd-')));
    try {
      const before = (await readdir(tmpdir())).filter((n) => n.startsWith('nectar-ghost-zip-'));
      await importGhostExport({ cwd, file: zipPath, onConflict: 'overwrite' });
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith('nectar-ghost-zip-'));
      expect(after.length).toBe(before.length);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('rejects a corrupt .zip with a clear error and cleans up the temp dir', async () => {
    const zipPath = join(stagingDir, 'corrupt.zip');
    await writeFile(zipPath, 'NOT A ZIP');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-zip-cwd-')));
    try {
      const before = (await readdir(tmpdir())).filter((n) => n.startsWith('nectar-ghost-zip-'));
      await expect(importGhostExport({ cwd, file: zipPath })).rejects.toThrow(/Failed to extract/);
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith('nectar-ghost-zip-'));
      expect(after.length).toBe(before.length);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('importGhostExport — __GHOST_URL__ placeholder (#72)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-url-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('strips __GHOST_URL__ placeholder from body, frontmatter, and metadata', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Hello',
                slug: 'hello',
                html: '<p>See <a href="__GHOST_URL__/welcome/">the welcome post</a> and this <img src="__GHOST_URL__/content/images/2024/01/pic.jpg" alt="pic"></p>',
                feature_image: '__GHOST_URL__/content/images/2024/01/cover.jpg',
                og_image: '__GHOST_URL__/content/images/2024/01/og.jpg',
                twitter_image: '__GHOST_URL__/content/images/2024/01/tw.jpg',
                canonical_url: '__GHOST_URL__/canonical/',
                codeinjection_head:
                  '<link rel="stylesheet" href="__GHOST_URL__/content/files/style.css">',
                codeinjection_foot: '<script src="__GHOST_URL__/content/files/foot.js"></script>',
                status: 'published',
                published_at: '2024-01-01T00:00:00.000Z',
              },
            ],
            tags: [
              {
                id: 't1',
                slug: 'news',
                name: 'News',
                description: 'See __GHOST_URL__/tag/news/ for more',
                feature_image: '__GHOST_URL__/content/images/tag.jpg',
                meta_title: 'News',
              },
            ],
            users: [
              {
                id: 'u1',
                slug: 'casper',
                name: 'Casper',
                profile_image: '__GHOST_URL__/content/images/avatar.jpg',
              },
            ],
            posts_tags: [{ post_id: 'p1', tag_id: 't1', sort_order: 0 }],
            posts_authors: [{ post_id: 'p1', user_id: 'u1', sort_order: 0 }],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.authors).toBe(1);

    const postMd = await readFile(join(cwd, 'content/posts/hello.md'), 'utf8');
    expect(postMd).not.toContain('__GHOST_URL__');
    expect(postMd).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
    expect(postMd).toContain('og_image: "/content/images/2024/01/og.jpg"');
    expect(postMd).toContain('twitter_image: "/content/images/2024/01/tw.jpg"');
    expect(postMd).toContain('canonical_url: "/canonical/"');
    expect(postMd).toContain('/content/images/2024/01/pic.jpg');
    expect(postMd).toContain('/welcome/');

    const tagMd = await readFile(join(cwd, 'content/tags/news.md'), 'utf8');
    expect(tagMd).not.toContain('__GHOST_URL__');
    expect(tagMd).toContain('/tag/news/');
    expect(tagMd).toContain('feature_image: "/content/images/tag.jpg"');

    const authorMd = await readFile(join(cwd, 'content/authors/casper.md'), 'utf8');
    expect(authorMd).not.toContain('__GHOST_URL__');
    expect(authorMd).toContain('profile_image: "/content/images/avatar.jpg"');
  });
});

describe('importGhostExport — Koenig card comment fences', () => {
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

  test('strips email/email-cta regions and preserves html/markdown card payloads', async () => {
    const postHtml = [
      '<p>Public intro.</p>',
      '<!--kg-card-begin: email--><p>Paid subscribers only: secret link.</p><!--kg-card-end: email-->',
      '<!--kg-card-begin: html--><div class="newsletter-signup"><span style="color:red">Sign up</span></div><!--kg-card-end: html-->',
      '<!--kg-card-begin: markdown--><h2>Heading</h2><p>Body paragraph.</p><!--kg-card-end: markdown-->',
      '<!--kg-card-begin: email-cta--><p>Members-only CTA copy.</p><!--kg-card-end: email-cta-->',
      '<p>Public outro.</p>',
    ].join('\n');

    await writeFile(exportFile, makeExport([{ slug: 'fences', title: 'Fences', html: postHtml }]));

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/fences.md'), 'utf8');
    expect(md).toContain('Public intro.');
    expect(md).toContain('Public outro.');
    // email + email-cta regions must NOT leak into the static site.
    expect(md).not.toContain('Paid subscribers only');
    expect(md).not.toContain('secret link');
    expect(md).not.toContain('Members-only CTA copy');
    // html card preserves the raw user payload verbatim.
    expect(md).toContain(
      '<div class="newsletter-signup"><span style="color:red">Sign up</span></div>',
    );
    // markdown card content rendered as markdown.
    expect(md).toContain('## Heading');
    expect(md).toContain('Body paragraph.');
  });
});
