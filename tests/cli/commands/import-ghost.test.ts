import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSizeSpec } from '~/cli/commands/import-ghost.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string, stdinInput?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdin: stdinInput !== undefined ? new Blob([stdinInput]) : 'ignore',
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

function exportPayloadWithPosts(count: number): string {
  return JSON.stringify({
    db: [
      {
        data: {
          posts: Array.from({ length: count }, (_, i) => {
            const n = i + 1;
            return {
              id: `p${n}`,
              title: `Post ${n}`,
              slug: `post-${n}`,
              html: `<p>Post ${n}</p>`,
              status: 'published',
              type: 'post',
            };
          }),
        },
      },
    ],
  });
}

function filteredExportPayload(): string {
  return JSON.stringify({
    db: [
      {
        data: {
          posts: [
            {
              id: 'p-old-news',
              title: 'Old News',
              slug: 'old-news',
              html: '<p>old</p>',
              status: 'published',
              type: 'post',
              published_at: '2023-12-31T12:00:00.000Z',
            },
            {
              id: 'p-new-news',
              title: 'New News',
              slug: 'new-news',
              html: '<p>new</p>',
              status: 'published',
              type: 'post',
              published_at: '2024-02-01T12:00:00.000Z',
            },
            {
              id: 'p-blog-draft',
              title: 'Blog Draft',
              slug: 'blog-draft',
              html: '<p>draft</p>',
              status: 'draft',
              type: 'post',
              created_at: '2024-03-01T12:00:00.000Z',
            },
            {
              id: 'p-other',
              title: 'Other',
              slug: 'other',
              html: '<p>other</p>',
              status: 'published',
              type: 'post',
              published_at: '2024-04-01T12:00:00.000Z',
            },
            {
              id: 'page-about',
              title: 'About',
              slug: 'about',
              html: '<p>about</p>',
              status: 'published',
              type: 'page',
              published_at: '2024-05-01T12:00:00.000Z',
            },
          ],
          tags: [
            { id: 't-news', slug: 'news', name: 'News', description: 'News posts' },
            { id: 't-blog', slug: 'blog', name: 'Blog', description: 'Blog posts' },
            { id: 't-misc', slug: 'misc', name: 'Misc', description: 'Misc posts' },
          ],
          users: [{ id: 'u-jane', slug: 'jane', name: 'Jane' }],
          posts_tags: [
            { post_id: 'p-old-news', tag_id: 't-news' },
            { post_id: 'p-new-news', tag_id: 't-news' },
            { post_id: 'p-blog-draft', tag_id: 't-blog' },
            { post_id: 'p-other', tag_id: 't-misc' },
          ],
          posts_authors: [
            { post_id: 'p-new-news', user_id: 'u-jane' },
            { post_id: 'p-blog-draft', user_id: 'u-jane' },
            { post_id: 'page-about', user_id: 'u-jane' },
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

  test('dash path reads a Ghost JSON export from stdin', async () => {
    const { exitCode } = await runCli(
      ['import-ghost', '-', '--on-conflict', 'overwrite'],
      dir,
      exportPayload(),
    );

    expect(exitCode).toBe(0);
    const body = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
    expect(body).toContain('title: "Hello"');
    expect(body).toContain('slug: "hello"');
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
    const { stdout, stderr, exitCode } = await runCli(
      ['import-ghost', exportFolder, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(`${stdout}${stderr}`).toContain('Copied 2 asset files');
    expect(await readFile(join(dir, 'content/posts/hello.md'), 'utf8')).toContain('slug: "hello"');
    expect(await readFile(join(dir, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    expect(await readFile(join(dir, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
  });

  test('passing the JSON file directly copies sibling content/images assets', async () => {
    const exportJson = join(exportFolder, 'my-blog.ghost.2024-01-01.json');
    const { stdout, stderr, exitCode } = await runCli(
      ['import-ghost', exportJson, '--on-conflict', 'overwrite'],
      dir,
    );

    expect(exitCode).toBe(0);
    expect(`${stdout}${stderr}`).toContain('Copied 2 asset files');
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

    const { exitCode, stdout, stderr } = await runCli(
      ['import-ghost', zipPath, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(`${stdout}${stderr}`).toContain('Copied 2 asset files');
    expect(await readFile(join(dir, 'content/posts/hello.md'), 'utf8')).toContain('slug: "hello"');
    expect(await readFile(join(dir, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    expect(await readFile(join(dir, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
  });
});

describe('cli import-ghost — input validation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-validate-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('missing export path exits 1 with a clear file-not-found error', async () => {
    const missing = join(dir, 'missing.json');
    const { stderr, exitCode } = await runCli(['import-ghost', missing], dir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Ghost export file does not exist: ${missing}`);
  });

  test('directory without an export JSON exits 1 with a clear error', async () => {
    const emptyExportDir = join(dir, 'empty-export');
    await Bun.write(join(emptyExportDir, 'content/images/cover.jpg'), 'COVER');

    const { stderr, exitCode } = await runCli(['import-ghost', emptyExportDir], dir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      `Ghost export directory does not contain a .json export file: ${emptyExportDir}`,
    );
  });

  test('invalid JSON export exits 1 with a clear parse error', async () => {
    const invalidJson = join(dir, 'invalid.json');
    await writeFile(invalidJson, '{ not valid json');

    const { stderr, exitCode } = await runCli(['import-ghost', invalidJson], dir);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Invalid JSON in Ghost export: ${invalidJson}`);
  });
});

describe('cli import-ghost — --dry-run (#502)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises --dry-run', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--dry-run');
  });

  test('prints a summary table and writes nothing to content/', async () => {
    const exportFile = join(dir, 'export.json');
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
                {
                  id: 'p2',
                  title: 'Draft',
                  slug: 'draft-one',
                  html: '<p>x</p>',
                  status: 'draft',
                  type: 'post',
                },
                {
                  id: 'p3',
                  title: 'Skip',
                  slug: 'skip-one',
                  html: '<p>x</p>',
                  status: 'sent',
                  type: 'post',
                },
                {
                  id: 'p4',
                  title: 'About',
                  slug: 'about',
                  html: '<p>about</p>',
                  status: 'published',
                  type: 'page',
                },
              ],
            },
          },
        ],
      }),
    );

    const { stdout, exitCode } = await runCli(['import-ghost', exportFile, '--dry-run'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run: no files written.');
    expect(stdout).toContain('Posts to import');
    expect(stdout).toContain('Drafts');
    expect(stdout).toContain('Status-filtered');
    expect(stdout).toContain('Empty bodies');
    expect(stdout).toContain('Planned paths');
    expect(stdout).toContain('content/posts/hello.md');
    expect(stdout).toContain('content/pages/about.md');

    await expect(readFile(join(dir, 'content/posts/hello.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(dir, 'content/pages/about.md'), 'utf8')).rejects.toThrow();
  });
});

describe('cli import-ghost — partial filters (#809)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-filters-')));
    exportFile = join(dir, 'export.json');
    await writeFile(exportFile, filteredExportPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises tag/date filters and opt-in draft/page flags', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--include-drafts');
    expect(stdout).toContain('--include-pages');
    expect(stdout).toContain('--only-tags');
    expect(stdout).toContain('--since');
  });

  test('dry-run summary reflects filtered partial import without writing', async () => {
    const { stdout, exitCode } = await runCli(
      [
        'import-ghost',
        exportFile,
        '--only-tags',
        'news,blog',
        '--since',
        '2024-01-01',
        '--include-drafts',
        '--include-pages',
        '--dry-run',
      ],
      dir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Posts to import');
    expect(stdout).toContain('Pages to import');
    expect(stdout).toContain('Drafts filtered');
    expect(stdout).toContain('Tag-filtered');
    expect(stdout).toContain('Date-filtered');
    expect(stdout).toContain('content/posts/new-news.md');
    expect(stdout).toContain('content/posts/blog-draft.md');
    expect(stdout).toContain('content/pages/about.md');
    expect(stdout).not.toContain('content/posts/old-news.md');
    expect(stdout).not.toContain('content/posts/other.md');

    await expect(access(join(dir, 'content/posts/new-news.md'))).rejects.toThrow();
    await expect(access(join(dir, 'content/posts/blog-draft.md'))).rejects.toThrow();
    await expect(access(join(dir, 'content/pages/about.md'))).rejects.toThrow();
  });

  test('real import writes only filtered posts/pages and reports filtered counts', async () => {
    const { stdout, stderr, exitCode } = await runCli(
      [
        'import-ghost',
        exportFile,
        '--only-tags',
        'news,blog',
        '--since',
        '2024-01-01',
        '--include-drafts',
        '--include-pages',
      ],
      dir,
    );

    expect(exitCode).toBe(0);
    const output = `${stdout}${stderr}`;
    expect(output).toContain('Imported 2 posts, 1 pages, 2 tags, 1 authors');
    expect(output).toContain('Filtered out 2 items');
    expect(output).toContain('1 tag mismatches');
    expect(output).toContain('1 before --since');
    expect(await readFile(join(dir, 'content/posts/new-news.md'), 'utf8')).toContain(
      'slug: "new-news"',
    );
    expect(await readFile(join(dir, 'content/posts/blog-draft.md'), 'utf8')).toContain(
      'status: "draft"',
    );
    expect(await readFile(join(dir, 'content/pages/about.md'), 'utf8')).toContain('slug: "about"');
    expect(await readFile(join(dir, 'content/tags/news.md'), 'utf8')).toContain('name: "News"');
    expect(await readFile(join(dir, 'content/tags/blog.md'), 'utf8')).toContain('name: "Blog"');
    expect(await readFile(join(dir, 'content/authors/jane.md'), 'utf8')).toContain('name: "Jane"');
    await expect(access(join(dir, 'content/posts/old-news.md'))).rejects.toThrow();
    await expect(access(join(dir, 'content/posts/other.md'))).rejects.toThrow();
    await expect(access(join(dir, 'content/tags/misc.md'))).rejects.toThrow();
  });
});

describe('cli import-ghost — --output (#265)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-output-')));
    exportFile = join(dir, 'export.json');
    await writeFile(exportFile, exportPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises --output', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--output');
    expect(stdout).toContain('<dir>');
  });

  test('writes imported markdown under the requested review directory', async () => {
    const { exitCode } = await runCli(
      ['import-ghost', exportFile, '--output', 'review-import', '--on-conflict', 'overwrite'],
      dir,
    );

    expect(exitCode).toBe(0);
    expect(await readFile(join(dir, 'review-import/posts/hello.md'), 'utf8')).toContain(
      'title: "Hello"',
    );
    await expect(access(join(dir, 'content/posts/hello.md'))).rejects.toThrow();
  });

  test('dry-run prints planned output paths without writing to --output', async () => {
    const { stdout, exitCode } = await runCli(
      ['import-ghost', exportFile, '--output', 'review-import', '--dry-run'],
      dir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run: no files written.');
    expect(stdout).toContain('Target output: review-import');
    expect(stdout).toContain('Planned paths');
    expect(stdout).toContain('review-import/posts/hello.md');
    await expect(access(join(dir, 'review-import/posts/hello.md'))).rejects.toThrow();
    await expect(access(join(dir, 'content/posts/hello.md'))).rejects.toThrow();
  });
});

describe('cli import-ghost — post progress (#810)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-progress-')));
    exportFile = join(dir, 'large-export.json');
    await writeFile(exportFile, exportPayloadWithPosts(120));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('prints progress every 50 processed posts for large imports', async () => {
    const { stdout, exitCode } = await runCli(
      ['import-ghost', exportFile, '--on-conflict', 'overwrite'],
      dir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Importing Ghost posts: 50/120 processed');
    expect(stdout).toContain('Importing Ghost posts: 100/120 processed');
  });

  test('suppresses progress in quiet mode', async () => {
    const { stdout, exitCode } = await runCli(['--quiet', 'import-ghost', exportFile], dir);

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('Importing Ghost posts:');
  });

  test('keeps json mode to a single machine-readable summary line', async () => {
    const { stdout, exitCode } = await runCli(['--json', 'import-ghost', exportFile], dir);

    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toBeDefined();
    if (!line) throw new Error('expected import-ghost --json to emit one line');
    expect(line).not.toContain('Importing Ghost posts:');
    expect(JSON.parse(line)).toMatchObject({
      ok: true,
      dryRun: false,
      summary: { posts: 120 },
    });
  });

  test('does not print progress during dry-run summaries', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', exportFile, '--dry-run'], dir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run: no files written.');
    expect(stdout).not.toContain('Importing Ghost posts:');
  });
});

describe('cli import-ghost — --max-size (#558)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-maxsize-')));
    exportFile = join(dir, 'export.json');
    await writeFile(exportFile, exportPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises --max-size', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--max-size');
  });

  test('refuses an oversized export with a clear error', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--max-size', '10B'],
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('exceeds the configured cap');
    await expect(readFile(join(dir, 'content/posts/hello.md'), 'utf8')).rejects.toThrow();
  });

  test('rejects a malformed --max-size value with exit 2', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--max-size', 'huge'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --max-size value');
  });

  test('--max-size 0 disables the cap and import succeeds', async () => {
    const { exitCode } = await runCli(['import-ghost', exportFile, '--max-size', '0'], dir);
    expect(exitCode).toBe(0);
    await expect(readFile(join(dir, 'content/posts/hello.md'), 'utf8')).resolves.toContain('Hello');
  });
});

describe('cli import-ghost — --max-image-size (#239)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-maximg-')));
    exportFile = join(dir, 'export.json');
    await writeFile(exportFile, exportPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises --max-image-size', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--max-image-size');
  });

  test('rejects a malformed --max-image-size value with exit 2', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--max-image-size', 'huge'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --max-image-size value');
  });

  test('--max-image-size 0 is accepted (no per-image cap)', async () => {
    // The payload has no remote images, so we only assert the flag parses
    // and the import completes successfully. The downloader-level behavior
    // is covered in tests/ghost/import.test.ts.
    const { exitCode } = await runCli(
      ['import-ghost', exportFile, '--download-images', '--max-image-size', '0'],
      dir,
    );
    expect(exitCode).toBe(0);
  });
});

describe('cli import-ghost — --keep-code-injection (#561)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-ci-')));
    exportFile = join(dir, 'export.json');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Pwn',
                  slug: 'pwn',
                  html: '<p>body</p>',
                  status: 'published',
                  type: 'post',
                  codeinjection_head: '<script src="https://attacker.example/x.js"></script>',
                  codeinjection_foot: '<script>alert(1)</script>',
                },
              ],
            },
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises --keep-code-injection', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--keep-code-injection');
  });

  test('default drops codeinjection fields and prints an audit summary', async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--on-conflict', 'overwrite'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(`${stdout}${stderr}`).toContain(
      'Skipped code injection in 1 posts. Re-run with --keep-code-injection to import them.',
    );
    const md = await readFile(join(dir, 'content/posts/pwn.md'), 'utf8');
    expect(md).not.toContain('codeinjection_head');
    expect(md).not.toContain('codeinjection_foot');
    expect(md).not.toContain('attacker.example');
  });

  test('--keep-code-injection preserves the fields and suppresses the audit summary', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-ghost', exportFile, '--on-conflict', 'overwrite', '--keep-code-injection'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Skipped code injection');
    const md = await readFile(join(dir, 'content/posts/pwn.md'), 'utf8');
    expect(md).toContain('codeinjection_head');
    expect(md).toContain('attacker.example');
  });

  test('--dry-run lists the Code injection skipped row', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', exportFile, '--dry-run'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Code injection skipped');
    expect(stdout).toContain('--keep-code-injection');
  });
});

describe('cli import-ghost — --keep-html (#808)', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-cli-html-')));
    exportFile = join(dir, 'export.json');
    await writeFile(exportFile, exportPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('help advertises --keep-html', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--keep-html');
  });

  test('--keep-html writes a rendered HTML sibling and reports it', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', exportFile, '--keep-html'], dir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Preserved rendered HTML for 1 posts/pages');
    expect(await readFile(join(dir, 'content/posts/hello.md'), 'utf8')).toContain('slug: "hello"');
    expect(await readFile(join(dir, 'content/posts/hello.md.html'), 'utf8')).toBe('<p>Hello</p>');
  });

  test('--dry-run shows the HTML summary row and planned sibling path', async () => {
    const { stdout, exitCode } = await runCli(
      ['import-ghost', exportFile, '--keep-html', '--dry-run'],
      dir,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Rendered HTML preserved');
    expect(stdout).toContain('content/posts/hello.md.html');
    await expect(access(join(dir, 'content/posts/hello.md.html'))).rejects.toThrow();
  });
});

describe('parseSizeSpec (#558)', () => {
  test('parses raw bytes', () => {
    expect(parseSizeSpec('1024')).toBe(1024);
    expect(parseSizeSpec('0')).toBe(0);
  });

  test('parses KB/MB/GB/TB with both cases', () => {
    expect(parseSizeSpec('1KB')).toBe(1024);
    expect(parseSizeSpec('1mb')).toBe(1024 * 1024);
    expect(parseSizeSpec('256MB')).toBe(256 * 1024 * 1024);
    expect(parseSizeSpec('1GB')).toBe(1024 * 1024 * 1024);
    expect(parseSizeSpec('1tb')).toBe(1024 * 1024 * 1024 * 1024);
  });

  test('parses decimals and tolerates whitespace between number and unit', () => {
    expect(parseSizeSpec('1.5MB')).toBe(Math.floor(1.5 * 1024 * 1024));
    expect(parseSizeSpec('256 MB')).toBe(256 * 1024 * 1024);
  });

  test('rejects malformed inputs', () => {
    expect(parseSizeSpec('')).toBeNull();
    expect(parseSizeSpec('huge')).toBeNull();
    expect(parseSizeSpec('-1MB')).toBeNull();
    expect(parseSizeSpec('1XB')).toBeNull();
  });
});
