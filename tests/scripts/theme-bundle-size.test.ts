import { describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type ThemeBundleSizeResult,
  formatReport,
  measureThemeBundleSize,
  parseArgs,
} from '../../scripts/theme-bundle-size';

describe('theme-bundle-size script', () => {
  test('parses the Brotli threshold override', () => {
    expect(
      parseArgs(['--bundle', 'example/dist/assets/built/casper.js', '--max-brotli-bytes', '61440']),
    ).toEqual({
      bundlePath: 'example/dist/assets/built/casper.js',
      maxBrotliBytes: 61440,
    });
  });

  test('measures raw, gzip, and Brotli sizes for an explicit bundle', async () => {
    const dir = join(
      tmpdir(),
      `laurel-theme-size-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const bundle = join(dir, 'casper.js');
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(bundle, 'const message = "hello";\n'.repeat(100));
      const result = await measureThemeBundleSize({
        bundlePath: bundle,
        maxBrotliBytes: 60 * 1024,
      });

      expect(result.rawBytes).toBe(2500);
      expect(result.gzipBytes).toBeGreaterThan(0);
      expect(result.brotliBytes).toBeGreaterThan(0);
      expect(result.brotliBytes).toBeLessThan(result.rawBytes);
      expect(result.usedFallback).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('detects a fingerprinted Casper bundle in example/dist', async () => {
    const dir = join(
      tmpdir(),
      `laurel-theme-size-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const builtDir = join(dir, 'example/dist/assets/built');
    await mkdir(builtDir, { recursive: true });
    try {
      await writeFile(join(builtDir, 'casper.a573c212aa.js'), 'console.log("fingerprinted");\n');
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const result = await measureThemeBundleSize({
          maxBrotliBytes: 60 * 1024,
        });
        expect(result.path).toEndWith('example/dist/assets/built/casper.a573c212aa.js');
        expect(result.usedFallback).toBe(false);
      } finally {
        process.chdir(cwd);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reports the active Brotli threshold', () => {
    const result: ThemeBundleSizeResult = {
      path: '/repo/example/dist/assets/built/casper.js',
      rawBytes: 52613,
      gzipBytes: 18000,
      brotliBytes: 16000,
      maxBrotliBytes: 61440,
      usedFallback: false,
    };

    expect(formatReport(result)).toContain('brotli: 16000 B / 61440 B threshold');
  });
});
