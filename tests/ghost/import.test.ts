import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
