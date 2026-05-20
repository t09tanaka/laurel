import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyAssets, copyContentAssets, writeHtml, writeHtmlBatch } from '~/build/emit.ts';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';

function makeThemeAsset(
  overrides: Partial<ThemeAsset> & Pick<ThemeAsset, 'sourcePath'>,
): ThemeAsset {
  return {
    logicalPath: 'assets/built/screen.css',
    fingerprintedPath: 'assets/built/screen.abc123.css',
    hash: 'abc123',
    size: 0,
    ...overrides,
  };
}

function makeThemeBundle(assets: Map<string, ThemeAsset>): ThemeBundle {
  return {
    name: 'stub',
    rootDir: '',
    templates: {},
    partials: {},
    pkg: {
      name: 'stub',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    },
    locales: {},
    assets,
  };
}

describe('writeHtml', () => {
  test('writes file when path resolves under outputDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-'));
    await writeHtml(dir, 'hello/index.html', '<h1>ok</h1>');
    const body = await readFile(join(dir, 'hello/index.html'), 'utf8');
    expect(body).toContain('ok');
  });

  test('refuses to write when outputPath escapes outputDir via ..', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-'));
    await expect(writeHtml(dir, '../../../etc/cron.d/evil/index.html', 'pwned')).rejects.toThrow(
      /Refusing to write outside output directory/,
    );
  });

  test('refuses to write when outputPath escapes via .. mixed with segments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-'));
    await expect(writeHtml(dir, 'foo/../../bar/index.html', 'pwned')).rejects.toThrow(
      /Refusing to write outside output directory/,
    );
  });
});

describe('writeHtmlBatch', () => {
  test('writes all outputs and creates nested directories (#1102)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-'));
    await writeHtmlBatch(dir, [
      { outputPath: 'index.html', html: '<h1>home</h1>' },
      { outputPath: 'a/index.html', html: '<h1>a</h1>' },
      { outputPath: 'a/b/index.html', html: '<h1>b</h1>' },
      { outputPath: 'tag/foo/index.html', html: '<h1>foo</h1>' },
    ]);
    expect(await readFile(join(dir, 'index.html'), 'utf8')).toContain('home');
    expect(await readFile(join(dir, 'a/index.html'), 'utf8')).toContain('a');
    expect(await readFile(join(dir, 'a/b/index.html'), 'utf8')).toContain('b');
    expect(await readFile(join(dir, 'tag/foo/index.html'), 'utf8')).toContain('foo');
  });

  test('refuses any output that escapes outputDir (#1102)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-'));
    await expect(
      writeHtmlBatch(dir, [
        { outputPath: 'index.html', html: 'ok' },
        { outputPath: '../escape.html', html: 'pwned' },
      ]),
    ).rejects.toThrow(/Refusing to write outside output directory/);
    expect(existsSync(join(dir, 'index.html'))).toBe(false);
  });

  test('handles empty input without touching the filesystem (#1102)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-'));
    await writeHtmlBatch(dir, []);
    // mkdtemp gives us an empty dir; should still be empty afterwards.
    expect(existsSync(join(dir, 'index.html'))).toBe(false);
  });

  test('writes many outputs concurrently without dropping any (#1102)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-'));
    const n = 200;
    const outputs = Array.from({ length: n }, (_, i) => ({
      outputPath: `post-${i}/index.html`,
      html: `<h1>${i}</h1>`,
    }));
    await writeHtmlBatch(dir, outputs);
    for (let i = 0; i < n; i++) {
      expect(await readFile(join(dir, `post-${i}/index.html`), 'utf8')).toContain(`<h1>${i}</h1>`);
    }
  });

  test('writes more outputs than the internal chunk size without dropping any (#149)', async () => {
    // Exercises the chunked write phase: with WRITE_BATCH_SIZE=512 internally,
    // an n=1300 input forces at least three chunks (512+512+276) and surfaces
    // any off-by-one in the chunk boundary or any missed entry at the tail.
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-large-'));
    const n = 1300;
    const outputs = Array.from({ length: n }, (_, i) => ({
      outputPath: `p/${i}/index.html`,
      html: `<h1>${i}</h1>`,
    }));
    await writeHtmlBatch(dir, outputs);
    // Spot-check first, last, and chunk boundaries (positions 511, 512, 1023,
    // 1024) so a regression that drops a whole chunk or shifts indices is
    // caught without paying for 1300 reads.
    for (const i of [0, 1, 511, 512, 513, 1023, 1024, 1299]) {
      expect(await readFile(join(dir, `p/${i}/index.html`), 'utf8')).toBe(`<h1>${i}</h1>`);
    }
  });

  test('deduplicates mkdir across the entire batch (#535)', async () => {
    // Many routes sharing the same parent directory must not pay one
    // ensureDir per route or even per chunk. The dedupe is internal to
    // writeHtmlBatch; this test exercises the observable surface: 100
    // siblings in one directory complete in one shot, with the directory
    // existing exactly once and every file landing under it.
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-mkdir-'));
    const n = 100;
    // All entries share `flat/` so the dedupe target is exactly one parent
    // directory regardless of how chunked iteration would otherwise group
    // them.
    const outputs = Array.from({ length: n }, (_, i) => ({
      outputPath: `flat/p-${i}.html`,
      html: `<h1>${i}</h1>`,
    }));
    await writeHtmlBatch(dir, outputs);
    const s = await stat(join(dir, 'flat'));
    expect(s.isDirectory()).toBe(true);
    for (const i of [0, 50, 99]) {
      expect(await readFile(join(dir, `flat/p-${i}.html`), 'utf8')).toBe(`<h1>${i}</h1>`);
    }
  });

  test('creates exactly the set of unique parent dirs across many chunks (#535)', async () => {
    // Cross-chunk dedupe: WRITE_BATCH_SIZE is 512 internally, so 1024
    // routes across 4 unique dirs should still resolve to those 4 dirs
    // total. Verifies the up-front ensureDirs pass collapses repeats both
    // within a chunk and across chunks.
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-mkdir-'));
    const dirs = ['x', 'y', 'z', 'w'];
    const outputs = Array.from({ length: 1024 }, (_, i) => {
      const bucket = dirs[i % dirs.length] as string;
      return { outputPath: `${bucket}/p-${i}.html`, html: `<h1>${i}</h1>` };
    });
    await writeHtmlBatch(dir, outputs);
    for (const bucket of dirs) {
      const s = await stat(join(dir, bucket));
      expect(s.isDirectory()).toBe(true);
    }
  });

  test('rejects before any write when one entry escapes outputDir even at a deep index (#149)', async () => {
    // Validation must happen up front: if entry N=600 escapes, nothing in the
    // first chunk should land on disk either. Confirms the two-pass design
    // (validate everything, then write chunk-by-chunk) and protects against a
    // future refactor that interleaves validation with disk I/O.
    const dir = await mkdtemp(join(tmpdir(), 'nectar-emit-batch-reject-'));
    const n = 700;
    const outputs = Array.from({ length: n }, (_, i) => ({
      outputPath: i === 600 ? '../escape.html' : `q/${i}/index.html`,
      html: `<h1>${i}</h1>`,
    }));
    await expect(writeHtmlBatch(dir, outputs)).rejects.toThrow(
      /Refusing to write outside output directory/,
    );
    // First-chunk entries must not have leaked.
    expect(existsSync(join(dir, 'q/0/index.html'))).toBe(false);
    expect(existsSync(join(dir, 'q/100/index.html'))).toBe(false);
  });
});

describe('copyAssets', () => {
  test('emits only the fingerprinted file when fingerprinted differs from logical (#1106)', async () => {
    const srcDir = await mkdtemp(join(tmpdir(), 'nectar-assets-src-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-assets-out-'));
    const srcCss = join(srcDir, 'screen.css');
    await writeFile(srcCss, 'body{}');

    const asset = makeThemeAsset({
      sourcePath: srcCss,
      logicalPath: 'assets/built/screen.css',
      fingerprintedPath: 'assets/built/screen.abc123.css',
    });
    const assets = new Map<string, ThemeAsset>([
      ['assets/built/screen.css', asset],
      ['built/screen.css', asset],
    ]);

    const count = await copyAssets(makeThemeBundle(assets), outputDir);
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'assets/built/screen.abc123.css'))).toBe(true);
    expect(existsSync(join(outputDir, 'assets/built/screen.css'))).toBe(false);
  });

  test('emits non-fingerprinted assets (e.g. fonts) exactly once', async () => {
    const srcDir = await mkdtemp(join(tmpdir(), 'nectar-assets-src2-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-assets-out2-'));
    const srcFont = join(srcDir, 'Inter.woff2');
    await writeFile(srcFont, 'FONTBYTES');

    const asset = makeThemeAsset({
      sourcePath: srcFont,
      logicalPath: 'assets/fonts/Inter.woff2',
      fingerprintedPath: 'assets/fonts/Inter.woff2',
    });
    const assets = new Map<string, ThemeAsset>([['assets/fonts/Inter.woff2', asset]]);

    const count = await copyAssets(makeThemeBundle(assets), outputDir);
    expect(count).toBe(1);
    expect(await readFile(join(outputDir, 'assets/fonts/Inter.woff2'), 'utf8')).toBe('FONTBYTES');
  });
});

describe('copyContentAssets', () => {
  test('skips symlinked content asset files so external secrets are not published', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-'));
    const images = join(cwd, 'content/images');
    await mkdir(images, { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), 'nectar-outside-'));
    const secret = join(outside, 'secret.txt');
    await writeFile(secret, 'SECRET_TOKEN=abc');
    await symlink(secret, join(images, 'oops.png'));
    await writeFile(join(images, 'real.png'), 'real');

    const count = await copyContentAssets(cwd, 'content/images', outputDir);
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/real.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/oops.png'))).toBe(false);
  });

  test('also copies content/files and content/media when present (#73)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-files-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-files-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/a.png'), 'A');
    await mkdir(join(cwd, 'content/files'), { recursive: true });
    await writeFile(join(cwd, 'content/files/handout.pdf'), 'PDF');
    await mkdir(join(cwd, 'content/media/clip'), { recursive: true });
    await writeFile(join(cwd, 'content/media/clip/intro.mp4'), 'MP4');

    const count = await copyContentAssets(cwd, 'content/images', outputDir);
    expect(count).toBe(3);
    expect(await readFile(join(outputDir, 'content/images/a.png'), 'utf8')).toBe('A');
    expect(await readFile(join(outputDir, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
    expect(await readFile(join(outputDir, 'content/media/clip/intro.mp4'), 'utf8')).toBe('MP4');
  });

  test('content/files and content/media are optional', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-opt-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-opt-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/a.png'), 'A');

    const count = await copyContentAssets(cwd, 'content/images', outputDir);
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/a.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/files'))).toBe(false);
    expect(existsSync(join(outputDir, 'content/media'))).toBe(false);
  });

  test('skips raster images larger than maxImageBytes and logs a warning (#138)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-cap-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-cap-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    // 5KB cap, with a 4KB image (under) and a 6KB image (over).
    await writeFile(join(cwd, 'content/images/small.jpg'), Buffer.alloc(4 * 1024, 0));
    await writeFile(join(cwd, 'content/images/huge.jpg'), Buffer.alloc(6 * 1024, 0));

    const count = await copyContentAssets(cwd, 'content/images', outputDir, {
      maxImageBytes: 5 * 1024,
    });
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/small.jpg'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/huge.jpg'))).toBe(false);
  });

  test('maxImageBytes=0 disables the cap (#138)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-cap-off-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-cap-off-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/huge.jpg'), Buffer.alloc(6 * 1024, 0));

    const count = await copyContentAssets(cwd, 'content/images', outputDir, {
      maxImageBytes: 0,
    });
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/huge.jpg'))).toBe(true);
  });

  test('maxImageBytes does not skip SVG or non-image files (#138)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-cap-other-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-cap-other-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/huge.svg'), Buffer.alloc(10 * 1024, 0));
    await mkdir(join(cwd, 'content/files'), { recursive: true });
    await writeFile(join(cwd, 'content/files/huge.pdf'), Buffer.alloc(10 * 1024, 0));
    await mkdir(join(cwd, 'content/media'), { recursive: true });
    await writeFile(join(cwd, 'content/media/huge.mp4'), Buffer.alloc(10 * 1024, 0));

    const count = await copyContentAssets(cwd, 'content/images', outputDir, {
      maxImageBytes: 1024,
    });
    expect(count).toBe(3);
    expect(existsSync(join(outputDir, 'content/images/huge.svg'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/files/huge.pdf'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/media/huge.mp4'))).toBe(true);
  });

  test('image exactly at maxImageBytes is allowed (#138)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-cap-eq-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-cap-eq-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/at-limit.png'), Buffer.alloc(2048, 0));

    const count = await copyContentAssets(cwd, 'content/images', outputDir, {
      maxImageBytes: 2048,
    });
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/at-limit.png'))).toBe(true);
  });

  test('parallel copy: many files end up in the destination tree (#520)', async () => {
    // Backlog #520: serial copyFile over 5000 images was 50s of latency.
    // The bounded fan-out keeps file count exact across runs; this test
    // exercises a count well above the concurrency limit (32) so any
    // races would surface as missing or duplicated outputs.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-parallel-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-parallel-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    const total = 200;
    for (let i = 0; i < total; i++) {
      await writeFile(join(cwd, 'content/images', `img-${i}.png`), `payload-${i}`);
    }

    const count = await copyContentAssets(cwd, 'content/images', outputDir);
    expect(count).toBe(total);
    for (let i = 0; i < total; i++) {
      const path = join(outputDir, 'content/images', `img-${i}.png`);
      expect(await readFile(path, 'utf8')).toBe(`payload-${i}`);
    }
  });

  test('skip-unchanged: a second run does not rewrite files whose mtime+size match (#520)', async () => {
    // Backlog #520: rebuild cost is dominated by re-copying unchanged
    // content. After the first copy we stamp the destination's mtime to
    // the source's mtime, so the second run hits the stat-compare fast
    // path and the destination's mtime stays exactly as it was — which is
    // the load-bearing observation: copyFile would bump it again.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-skip-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-skip-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/stable.png'), 'STABLE');

    await copyContentAssets(cwd, 'content/images', outputDir);
    const dst = join(outputDir, 'content/images/stable.png');
    const first = await stat(dst);

    // Wait long enough that a second copyFile would observe a distinct
    // mtime (filesystems vary, but 25ms is well above APFS/ext4 granularity).
    await new Promise((r) => setTimeout(r, 25));

    await copyContentAssets(cwd, 'content/images', outputDir);
    const second = await stat(dst);
    expect(second.mtimeMs).toBe(first.mtimeMs);
    expect(await readFile(dst, 'utf8')).toBe('STABLE');
  });

  test('skip-unchanged re-copies when the source size differs (#520)', async () => {
    // Source has been edited (size differs) -> the fast-path must miss
    // and the new bytes need to land in the destination.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-resize-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-resize-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    const src = join(cwd, 'content/images/edited.png');
    await writeFile(src, 'OLD');
    await copyContentAssets(cwd, 'content/images', outputDir);

    await writeFile(src, 'NEW_LARGER_CONTENT');
    await copyContentAssets(cwd, 'content/images', outputDir);

    const dst = join(outputDir, 'content/images/edited.png');
    expect(await readFile(dst, 'utf8')).toBe('NEW_LARGER_CONTENT');
  });

  test('skip-unchanged re-copies when the source mtime differs but size is identical (#520)', async () => {
    // Same byte count, different mtime: still treat as changed. mtime is
    // the cheap heuristic; users who want content-hash equivalence can
    // layer the incremental-build cache on top.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cca-touch-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-out-touch-'));
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    const src = join(cwd, 'content/images/touched.png');
    await writeFile(src, 'AAA');
    await copyContentAssets(cwd, 'content/images', outputDir);
    const dst = join(outputDir, 'content/images/touched.png');
    const firstMtime = (await stat(dst)).mtimeMs;

    // Rewrite with same byte length, bump mtime forward.
    await writeFile(src, 'BBB');
    const future = new Date(Date.now() + 60_000);
    await utimes(src, future, future);

    await copyContentAssets(cwd, 'content/images', outputDir);
    const second = await stat(dst);
    expect(await readFile(dst, 'utf8')).toBe('BBB');
    expect(second.mtimeMs).not.toBe(firstMtime);
  });
});
