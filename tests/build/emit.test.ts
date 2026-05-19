import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyContentAssets, writeHtml } from '~/build/emit.ts';

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
});
