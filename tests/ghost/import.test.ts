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

  // Regression for backlog task #99: a kg-video-card references three asset
  // types (poster image / video file / caption track) that Ghost scatters into
  // three subdirs. Confirm all three round-trip through the importer to disk
  // *and* survive in the resulting markdown shortcode.
  test('kg-video-card poster / video / caption track all get relocated and referenced (#99)', async () => {
    await writeFile(
      join(exportDir, 'export.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Demo',
                  slug: 'demo',
                  html:
                    '<figure class="kg-card kg-video-card">' +
                    '<div class="kg-video-container">' +
                    '<video poster="/content/images/2024/01/poster.jpg" width="1280" height="720">' +
                    '<source src="/content/media/2024/01/demo.mp4" type="video/mp4" />' +
                    '<track src="/content/files/2024/01/demo-en.vtt" kind="subtitles" srclang="en" label="English" default />' +
                    '</video>' +
                    '</div>' +
                    '<figcaption>Demo caption</figcaption>' +
                    '</figure>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await ensureDir(join(exportDir, 'content/images/2024/01'));
    await writeFile(join(exportDir, 'content/images/2024/01/poster.jpg'), 'POSTER');
    await ensureDir(join(exportDir, 'content/media/2024/01'));
    await writeFile(join(exportDir, 'content/media/2024/01/demo.mp4'), 'MP4');
    await ensureDir(join(exportDir, 'content/files/2024/01'));
    await writeFile(join(exportDir, 'content/files/2024/01/demo-en.vtt'), 'VTT');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(3);

      expect(await readFile(join(cwd, 'content/images/2024/01/poster.jpg'), 'utf8')).toBe('POSTER');
      expect(await readFile(join(cwd, 'content/media/2024/01/demo.mp4'), 'utf8')).toBe('MP4');
      expect(await readFile(join(cwd, 'content/files/2024/01/demo-en.vtt'), 'utf8')).toBe('VTT');

      const postMd = await readFile(join(cwd, 'content/posts/demo.md'), 'utf8');
      expect(postMd).toContain('poster="/content/images/2024/01/poster.jpg"');
      expect(postMd).toContain('src="/content/media/2024/01/demo.mp4"');
      expect(postMd).toContain('src="/content/files/2024/01/demo-en.vtt"');
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

describe('importGhostExport — --download-images (#128)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-dl-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  interface FakeFetchOptions {
    // URLs that should respond with the given body bytes + content-type.
    ok?: Record<string, { body: string; contentType?: string }>;
    // URLs that should respond with an HTTP error status.
    error?: Record<string, number>;
    // URLs that should make fetch throw (simulating a connection failure).
    throw?: string[];
  }

  function fakeFetch(opts: FakeFetchOptions): {
    fetcher: typeof fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (opts.throw?.includes(url)) {
        throw new Error(`simulated network failure for ${url}`);
      }
      if (opts.error && url in opts.error) {
        return new Response('', { status: opts.error[url] });
      }
      if (opts.ok && url in opts.ok) {
        const { body, contentType } = opts.ok[url];
        return new Response(body, {
          status: 200,
          headers: { 'content-type': contentType ?? 'image/jpeg' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetcher, calls };
  }

  test('downloads Ghost CDN URLs to content/images and preserves the path', async () => {
    const ghostUrl = 'https://my-ghost-site.com/content/images/2024/01/cover.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: `<p>See <img src="${ghostUrl}" alt="cover" /></p>`,
                  feature_image: ghostUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: { [ghostUrl]: { body: 'GHOSTBYTES', contentType: 'image/jpeg' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.imagesFailed).toBe(0);
    // Same URL appears in body + feature_image; only one fetch.
    expect(calls.length).toBe(1);

    const written = await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8');
    expect(written).toBe('GHOSTBYTES');

    const md = await readFile(join(cwd, 'content/posts/hello.md'), 'utf8');
    expect(md).not.toContain(ghostUrl);
    expect(md).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
    expect(md).toContain('/content/images/2024/01/cover.jpg');
  });

  test('downloads external Unsplash-style URLs under content/images/external/', async () => {
    const unsplashUrl = 'https://images.unsplash.com/photo-12345?w=1200';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Unsplash',
                  slug: 'unsplash',
                  html: `<p><img src="${unsplashUrl}" alt="hero" /></p>`,
                  feature_image: unsplashUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({
      ok: { [unsplashUrl]: { body: 'UNSPLASH', contentType: 'image/jpeg' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);

    const externalDir = join(cwd, 'content/images/external');
    const files = await readdir(externalDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^[a-f0-9]{16}\.jpg$/);

    const md = await readFile(join(cwd, 'content/posts/unsplash.md'), 'utf8');
    expect(md).not.toContain('images.unsplash.com');
    expect(md).toContain(`/content/images/external/${files[0]}`);
    expect(md).toContain(`feature_image: "/content/images/external/${files[0]}"`);
  });

  test('rewrites markdown ![alt](url) bodies emitted by Turndown', async () => {
    // Turndown converts <img src=... alt=...> into ![alt](url), so the
    // rewriter sees markdown image syntax in the final body. Verify that
    // path explicitly.
    const remoteUrl = 'https://images.unsplash.com/inline.png';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Md',
                  slug: 'md',
                  html: `<p>before <img src="${remoteUrl}" alt="alt text"> after</p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({
      ok: { [remoteUrl]: { body: 'PNG', contentType: 'image/png' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    const md = await readFile(join(cwd, 'content/posts/md.md'), 'utf8');
    expect(md).not.toContain(remoteUrl);
    expect(md).toMatch(/!\[alt text\]\(\/content\/images\/external\/[a-f0-9]{16}\.png\)/);
  });

  test('leaves URLs untouched and counts failures when downloads fail', async () => {
    const failUrl = 'https://images.unsplash.com/missing.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'F',
                  slug: 'f',
                  html: `<p><img src="${failUrl}" alt="x" /></p>`,
                  feature_image: failUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({ error: { [failUrl]: 404 } });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    // Failure cached: same URL in body + feature_image counts as one failure.
    expect(summary.imagesFailed).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/f.md'), 'utf8');
    expect(md).toContain(failUrl);
    expect(md).toContain(`feature_image: "${failUrl}"`);
  });

  test('also rewrites tag feature_image and author profile_image / cover_image', async () => {
    const tagImg = 'https://images.unsplash.com/tag.jpg';
    const profileImg = 'https://images.unsplash.com/profile.jpg';
    const coverImg = 'https://my-ghost-site.com/content/images/cover.jpg';

    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'news',
                  name: 'News',
                  description: 'd',
                  feature_image: tagImg,
                },
              ],
              users: [
                {
                  id: 'u1',
                  slug: 'casper',
                  name: 'Casper',
                  profile_image: profileImg,
                  cover_image: coverImg,
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({
      ok: {
        [tagImg]: { body: 'T', contentType: 'image/jpeg' },
        [profileImg]: { body: 'P', contentType: 'image/jpeg' },
        [coverImg]: { body: 'C', contentType: 'image/jpeg' },
      },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
      onConflict: 'overwrite',
    });

    expect(summary.imagesDownloaded).toBe(3);
    expect(await readFile(join(cwd, 'content/images/cover.jpg'), 'utf8')).toBe('C');

    const tagMd = await readFile(join(cwd, 'content/tags/news.md'), 'utf8');
    expect(tagMd).not.toContain('images.unsplash.com');
    expect(tagMd).toMatch(/feature_image: "\/content\/images\/external\/[a-f0-9]{16}\.jpg"/);

    const authorMd = await readFile(join(cwd, 'content/authors/casper.md'), 'utf8');
    expect(authorMd).not.toContain('images.unsplash.com');
    expect(authorMd).toMatch(/profile_image: "\/content\/images\/external\/[a-f0-9]{16}\.jpg"/);
    expect(authorMd).toContain('cover_image: "/content/images/cover.jpg"');
  });

  test('leaves relative / data: URLs alone and does not fetch them', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Skip',
                  slug: 'skip',
                  html: '<p><img src="/content/images/already-local.jpg" alt="a" /><img src="data:image/png;base64,AAAA" alt="b" /></p>',
                  feature_image: '/content/images/local.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({});

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(calls.length).toBe(0);

    const md = await readFile(join(cwd, 'content/posts/skip.md'), 'utf8');
    expect(md).toContain('/content/images/already-local.jpg');
    expect(md).toContain('data:image/png;base64,AAAA');
    expect(md).toContain('feature_image: "/content/images/local.jpg"');
  });

  test('disabled by default: URLs are kept verbatim (back-compat)', async () => {
    const ghostUrl = 'https://my-ghost-site.com/content/images/2024/01/cover.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'X',
                  slug: 'x',
                  html: `<p><img src="${ghostUrl}" alt="c" /></p>`,
                  feature_image: ghostUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    const md = await readFile(join(cwd, 'content/posts/x.md'), 'utf8');
    expect(md).toContain(ghostUrl);
    expect(md).toContain(`feature_image: "${ghostUrl}"`);
  });

  test('infers extension from Content-Type when URL has none', async () => {
    const extlessUrl = 'https://cdn.example.com/random-id';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'E',
                  slug: 'e',
                  html: `<p><img src="${extlessUrl}" alt="e" /></p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({
      ok: { [extlessUrl]: { body: 'WEBP', contentType: 'image/webp' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    const externalDir = join(cwd, 'content/images/external');
    const files = await readdir(externalDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^[a-f0-9]{16}\.webp$/);
  });

  test('survives a thrown fetch error and continues importing', async () => {
    const throwUrl = 'https://images.unsplash.com/boom.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'B',
                  slug: 'b',
                  html: `<p><img src="${throwUrl}" alt="b" /></p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({ throw: [throwUrl] });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.posts).toBe(1);
    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/b.md'), 'utf8');
    expect(md).toContain(throwUrl);
  });
});

describe('importGhostExport — --source-url (#500)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-srcurl-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('rewrites markdown links pointing at the source host to site-relative paths', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Has link',
                  slug: 'has-link',
                  html: '<p>See <a href="https://oldblog.com/old-slug">prior post</a> for context.</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/has-link.md'), 'utf8');
    expect(md).toContain('[prior post](/old-slug)');
    expect(md).not.toContain('oldblog.com');
  });

  test('leaves links to other hosts untouched', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'External link',
                  slug: 'ext',
                  html: '<p><a href="https://example.com/external">external</a> and <a href="https://oldblog.com/internal">internal</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/ext.md'), 'utf8');
    expect(md).toContain('https://example.com/external');
    expect(md).toContain('](/internal)');
    expect(md).not.toContain('https://oldblog.com');
  });

  test('matches http and https variants of the source host', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Mixed schemes',
                  slug: 'mixed',
                  html: '<p><a href="http://oldblog.com/a">a</a> and <a href="https://oldblog.com/b">b</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/mixed.md'), 'utf8');
    expect(md).toContain('[a](/a)');
    expect(md).toContain('[b](/b)');
    expect(md).not.toContain('oldblog.com');
  });

  test('preserves query strings and fragments when rewriting', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Query',
                  slug: 'query',
                  html: '<p><a href="https://oldblog.com/post?ref=feed#top">link</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/query.md'), 'utf8');
    expect(md).toContain('[link](/post?ref=feed#top)');
  });

  test('leaves image markdown alone (image-downloader owns that syntax)', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Image only',
                  slug: 'img',
                  html: '<p><img src="https://oldblog.com/content/images/foo.jpg" alt="x" /></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/img.md'), 'utf8');
    // The link rewriter must NOT touch `![alt](url)` — that's the image
    // downloader's domain. Without --download-images, the URL stays as-is.
    expect(md).toContain('https://oldblog.com/content/images/foo.jpg');
  });

  test('composes with --download-images: images downloaded, links rewritten', async () => {
    const imageUrl = 'https://oldblog.com/content/images/2024/01/cover.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Both',
                  slug: 'both',
                  html: `<p><img src="${imageUrl}" alt="c"/> Read <a href="https://oldblog.com/older">older</a></p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === imageUrl) {
        return new Response('BYTES', {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: 'https://oldblog.com',
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    const md = await readFile(join(cwd, 'content/posts/both.md'), 'utf8');
    expect(md).toContain('/content/images/2024/01/cover.jpg');
    expect(md).toContain('[older](/older)');
    expect(md).not.toContain('https://oldblog.com');
  });

  test('throws when sourceUrl is not a valid http(s) URL', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [{ data: { posts: [] } }] }));

    await expect(
      importGhostExport({ cwd, file: exportFile, sourceUrl: 'not a url' }),
    ).rejects.toThrow(/Invalid --source-url/);

    await expect(
      importGhostExport({ cwd, file: exportFile, sourceUrl: 'ftp://oldblog.com' }),
    ).rejects.toThrow(/Only http\(s\)/);
  });

  test('matches hostname case-insensitively', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Case',
                  slug: 'case',
                  html: '<p><a href="https://OldBlog.com/CasePath">x</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/case.md'), 'utf8');
    expect(md).toContain('[x](/CasePath)');
    expect(md).not.toContain('OldBlog.com');
  });
});

describe('importGhostExport — multi-db export merging (#126)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-ghost-multidb-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('merges posts, tags, users, and join rows split across multiple db[i] blocks', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Post One',
                  slug: 'post-one',
                  html: '<p>one</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [{ id: 't1', slug: 'tag-one', name: 'Tag One', description: 'd1' }],
              users: [{ id: 'u1', slug: 'alice', name: 'Alice', bio: 'b1' }],
              posts_tags: [{ post_id: 'p1', tag_id: 't1' }],
              posts_authors: [{ post_id: 'p1', user_id: 'u1' }],
            },
          },
          {
            data: {
              posts: [
                {
                  id: 'p2',
                  title: 'Post Two',
                  slug: 'post-two',
                  html: '<p>two</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [{ id: 't2', slug: 'tag-two', name: 'Tag Two', description: 'd2' }],
              users: [{ id: 'u2', slug: 'bob', name: 'Bob', bio: 'b2' }],
              posts_tags: [{ post_id: 'p2', tag_id: 't2' }],
              posts_authors: [{ post_id: 'p2', user_id: 'u2' }],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(2);
    expect(summary.tags).toBe(2);
    expect(summary.authors).toBe(2);

    const postOne = await readFile(join(cwd, 'content/posts/post-one.md'), 'utf8');
    const postTwo = await readFile(join(cwd, 'content/posts/post-two.md'), 'utf8');
    expect(postOne).toContain('tags: ["tag-one"]');
    expect(postOne).toContain('authors: ["alice"]');
    expect(postTwo).toContain('tags: ["tag-two"]');
    expect(postTwo).toContain('authors: ["bob"]');
    await readFile(join(cwd, 'content/tags/tag-one.md'), 'utf8');
    await readFile(join(cwd, 'content/tags/tag-two.md'), 'utf8');
    await readFile(join(cwd, 'content/authors/alice.md'), 'utf8');
    await readFile(join(cwd, 'content/authors/bob.md'), 'utf8');
  });

  test('handles a db[i] block with no data field (e.g. members-only split block)', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Solo',
                  slug: 'solo',
                  html: '<p>solo</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
          { meta: { exported_on: 0 } },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);
  });

  test('throws when db array is missing', async () => {
    await writeFile(exportFile, JSON.stringify({ meta: { exported_on: 0 } }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db array missing or empty/,
    );
  });

  test('throws when db array is present but empty', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db array missing or empty/,
    );
  });

  test('throws when every db[i] entry is missing its data field', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [{ meta: 1 }, { meta: 2 }] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /no db\[i\]\.data block present/,
    );
  });
});

describe('importGhostExport — Lexical/Mobiledoc body rendering (#127)', () => {
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

  test('renders a Ghost 5.x post body from the `lexical` field', async () => {
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              { type: 'extended-text', text: 'Hello ', format: 0, version: 1 },
              { type: 'extended-text', text: 'world', format: 1, version: 1 },
            ],
          },
          {
            type: 'heading',
            tag: 'h2',
            version: 1,
            children: [{ type: 'extended-text', text: 'Section', format: 0, version: 1 }],
          },
        ],
      },
    });
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'L',
                  slug: 'lexical',
                  html: null,
                  lexical,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    const body = await readFile(join(cwd, 'content/posts/lexical.md'), 'utf8');
    expect(body).toContain('Hello **world**');
    expect(body).toContain('## Section');
  });

  test('renders an older Ghost post body from the `mobiledoc` field', async () => {
    const mobiledoc = JSON.stringify({
      version: '0.3.1',
      atoms: [],
      cards: [['image', { src: '/content/images/legacy.jpg', alt: 'L' }]],
      markups: [['strong']],
      sections: [
        [1, 'p', [[0, [0], 1, 'bold start']]],
        [10, 0],
      ],
    });
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'M',
                  slug: 'mobiledoc',
                  html: null,
                  mobiledoc,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    const body = await readFile(join(cwd, 'content/posts/mobiledoc.md'), 'utf8');
    expect(body).toContain('**bold start**');
    expect(body).toContain('/content/images/legacy.jpg');
  });

  test('prefers `html` when both html and lexical are present', async () => {
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'extended-text', text: 'from-lexical', format: 0, version: 1 }],
          },
        ],
      },
    });
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Pref',
                  slug: 'prefer-html',
                  html: '<p>from-html</p>',
                  lexical,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({ cwd, file: exportFile });
    const body = await readFile(join(cwd, 'content/posts/prefer-html.md'), 'utf8');
    expect(body).toContain('from-html');
    expect(body).not.toContain('from-lexical');
  });

  test('warns and writes an empty body when lexical JSON is unrenderable', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Broken',
                  slug: 'broken',
                  html: null,
                  lexical: 'not json',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(captured.data).toContain('Lexical body is not valid JSON');
    const body = await readFile(join(cwd, 'content/posts/broken.md'), 'utf8');
    // The frontmatter is still written; the body section is empty.
    expect(body).toContain('slug: "broken"');
    expect(body.trim().endsWith('---')).toBe(true);
  });
});

describe('importGhostExport — --dry-run (#502)', () => {
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

  test('counts what would land without writing markdown files', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Published',
                  slug: 'published',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
                {
                  id: 'p2',
                  title: 'A Draft',
                  slug: 'a-draft',
                  html: '<p>draft body</p>',
                  status: 'draft',
                  type: 'post',
                },
                {
                  id: 'p3',
                  title: 'Scheduled',
                  slug: 'scheduled',
                  html: '<p>x</p>',
                  status: 'scheduled',
                  type: 'post',
                },
                {
                  id: 'p4',
                  title: 'Empty Body',
                  slug: 'empty-body',
                  html: null,
                  lexical: 'not json',
                  status: 'published',
                  type: 'post',
                },
                {
                  id: 'p5',
                  title: 'About',
                  slug: 'about',
                  html: '<p>about</p>',
                  status: 'published',
                  type: 'page',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'news',
                  name: 'News',
                  description: 'newsy',
                },
              ],
              users: [{ id: 'u1', slug: 'jane', name: 'Jane' }],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.posts).toBe(3);
    expect(summary.pages).toBe(1);
    expect(summary.drafts).toBe(1);
    expect(summary.statusFiltered).toBe(1);
    expect(summary.bodiesEmpty).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.authors).toBe(1);

    await expect(access(join(cwd, 'content/posts/published.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/posts/a-draft.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/pages/about.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/tags/news.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/authors/jane.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/posts'))).rejects.toThrow();
  });

  test('counts assets that would be copied without copying them', async () => {
    const exportFolder = join(cwd, 'ghost-export');
    await Bun.write(
      join(exportFolder, 'my-blog.ghost.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    await Bun.write(join(exportFolder, 'content/images/2024/cover.jpg'), 'COVER');
    await Bun.write(join(exportFolder, 'content/files/handout.pdf'), 'PDF');

    const summary = await importGhostExport({ cwd, file: exportFolder, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.posts).toBe(1);
    expect(summary.assetsCopied).toBe(2);
    await expect(access(join(cwd, 'content/posts/hello.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/images/2024/cover.jpg'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/files/handout.pdf'))).rejects.toThrow();
  });

  test('skips network entirely when --download-images is combined with --dry-run', async () => {
    let fetchCalls = 0;
    const fakeFetch: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response('IMG', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    };

    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'WithImage',
                  slug: 'with-image',
                  html: '<p><img src="https://example.com/a.jpg"></p>',
                  feature_image: 'https://example.com/cover.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      dryRun: true,
      downloadImages: true,
      fetcher: fakeFetch,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(fetchCalls).toBe(0);
    await expect(access(join(cwd, 'content/posts/with-image.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/images'))).rejects.toThrow();
  });

  test('reports would-skip conflict counts but never writes', async () => {
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      dryRun: true,
      onConflict: 'skip',
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.posts).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
  });
});
