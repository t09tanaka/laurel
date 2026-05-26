#!/usr/bin/env bun

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants, brotliCompressSync, gzipSync } from 'node:zlib';

const DEFAULT_DIST_BUNDLE = 'example/dist/assets/built/casper.js';
const DEFAULT_DIST_BUNDLE_DIR = 'example/dist/assets/built';
const DEFAULT_SOURCE_BUNDLE = 'example/themes/casper/assets/built/casper.js';
const DEFAULT_MAX_BROTLI_BYTES = 60 * 1024;

export interface ThemeBundleSizeOptions {
  bundlePath?: string;
  maxBrotliBytes: number;
}

export interface ThemeBundleSizeResult {
  path: string;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  maxBrotliBytes: number;
  usedFallback: boolean;
}

function usage(): string {
  return [
    'Usage: bun scripts/theme-bundle-size.ts [--bundle path] [--max-brotli-bytes bytes]',
    '',
    `Default bundle: ${DEFAULT_DIST_BUNDLE} or fingerprinted casper.*.js in ${DEFAULT_DIST_BUNDLE_DIR}`,
    `Fallback bundle: ${DEFAULT_SOURCE_BUNDLE}`,
    `Default Brotli threshold: ${DEFAULT_MAX_BROTLI_BYTES} bytes`,
    '',
  ].join('\n');
}

export function parseArgs(argv: string[]): ThemeBundleSizeOptions {
  const options: ThemeBundleSizeOptions = {
    maxBrotliBytes: DEFAULT_MAX_BROTLI_BYTES,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--bundle' && argv[i + 1]) {
      options.bundlePath = argv[++i];
    } else if (arg === '--max-brotli-bytes' && argv[i + 1]) {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--max-brotli-bytes must be a positive integer.');
      }
      options.maxBrotliBytes = value;
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then((entry) => entry.isFile())
    .catch(() => false);
}

async function findDistBundle(): Promise<string | undefined> {
  const exactPath = resolve(process.cwd(), DEFAULT_DIST_BUNDLE);
  if (await exists(exactPath)) {
    return exactPath;
  }

  const builtDir = resolve(process.cwd(), DEFAULT_DIST_BUNDLE_DIR);
  const candidates = await readdir(builtDir).catch(() => []);
  const sourceBundles = candidates
    .filter((name) => /^casper(?:\.[a-f0-9]+)?\.js$/.test(name))
    .sort();
  if (sourceBundles.length === 1) {
    return resolve(builtDir, sourceBundles[0] as string);
  }
  if (sourceBundles.length > 1) {
    throw new Error(
      `Multiple theme bundles found in ${builtDir}: ${sourceBundles.join(', ')}. Pass --bundle to choose one.`,
    );
  }
  return undefined;
}

async function resolveBundlePath(
  bundlePath?: string,
): Promise<{ path: string; usedFallback: boolean }> {
  if (bundlePath) {
    const path = resolve(process.cwd(), bundlePath);
    if (await exists(path)) {
      return { path, usedFallback: false };
    }
    throw new Error(
      `Theme bundle not found at ${path}. Run "bun run build:example" first, or pass --bundle to an existing source.js.`,
    );
  }

  const distPath = await findDistBundle();
  if (distPath) {
    return { path: distPath, usedFallback: false };
  }

  const sourcePath = resolve(process.cwd(), DEFAULT_SOURCE_BUNDLE);
  if (await exists(sourcePath)) {
    return { path: sourcePath, usedFallback: true };
  }

  throw new Error(
    `Theme bundle not found. Run "bun run build:example" first to create ${DEFAULT_DIST_BUNDLE}, or pass --bundle to an existing source.js.`,
  );
}

export async function measureThemeBundleSize(
  options: ThemeBundleSizeOptions,
): Promise<ThemeBundleSizeResult> {
  const bundle = await resolveBundlePath(options.bundlePath);
  const bytes = await readFile(bundle.path);
  const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
  const brotliBytes = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength;

  return {
    path: bundle.path,
    rawBytes: bytes.byteLength,
    gzipBytes,
    brotliBytes,
    maxBrotliBytes: options.maxBrotliBytes,
    usedFallback: bundle.usedFallback,
  };
}

function formatBytes(bytes: number): string {
  return `${bytes} B`;
}

export function formatReport(result: ThemeBundleSizeResult): string {
  const lines = [
    'theme bundle size:',
    `  file:   ${result.path}`,
    `  raw:    ${formatBytes(result.rawBytes)}`,
    `  gzip:   ${formatBytes(result.gzipBytes)}`,
    `  brotli: ${formatBytes(result.brotliBytes)} / ${formatBytes(result.maxBrotliBytes)} threshold`,
  ];
  if (result.usedFallback) {
    lines.push(
      `  note:   ${DEFAULT_DIST_BUNDLE} was not found; measured ${DEFAULT_SOURCE_BUNDLE}. Run "bun run build:example" to check example/dist.`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const result = await measureThemeBundleSize(options);
  process.stdout.write(formatReport(result));

  if (result.brotliBytes > result.maxBrotliBytes) {
    process.stderr.write(
      `theme-bundle-size: Brotli size ${formatBytes(result.brotliBytes)} exceeds threshold ${formatBytes(result.maxBrotliBytes)}.\n`,
    );
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error((error as Error).message);
      process.exit(2);
    });
}
