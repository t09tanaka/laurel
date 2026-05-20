import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectGhostExportFormat } from '~/ghost/import.ts';

describe('detectGhostExportFormat', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('returns "zip" for files starting with PK\\x03\\x04 magic bytes', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-detect-')));
    const file = join(dir, 'archive.bin');
    // Real ZIP local file header: 50 4B 03 04 followed by version + flags
    await writeFile(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00]));
    expect(await detectGhostExportFormat(file)).toBe('zip');
  });

  test('returns "json" for files starting with {', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-detect-')));
    const file = join(dir, 'export');
    await writeFile(file, '{"db":[{"data":{}}]}');
    expect(await detectGhostExportFormat(file)).toBe('json');
  });

  test('returns "json" for files starting with [', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-detect-')));
    const file = join(dir, 'export');
    await writeFile(file, '[{}]');
    expect(await detectGhostExportFormat(file)).toBe('json');
  });

  test('skips a UTF-8 BOM before classifying', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-detect-')));
    const file = join(dir, 'export');
    await writeFile(file, '﻿{"db":[]}');
    expect(await detectGhostExportFormat(file)).toBe('json');
  });

  test('returns "wordpress-xml" for files starting with <', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-detect-')));
    const file = join(dir, 'wordpress.bin');
    await writeFile(file, '<?xml version="1.0"?><rss></rss>');
    expect(await detectGhostExportFormat(file)).toBe('wordpress-xml');
  });

  test('returns "directory" for directories', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-detect-')));
    expect(await detectGhostExportFormat(dir)).toBe('directory');
  });

  test('returns "unknown" for unreadable / missing paths', async () => {
    expect(await detectGhostExportFormat('/nonexistent/path/here.bin')).toBe('unknown');
  });
});
