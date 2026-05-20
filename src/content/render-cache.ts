import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RenderMarkdownOptions, RenderedMarkdown } from './markdown.ts';

const CACHE_VERSION = 1;

interface RenderCacheOptions {
  cwd: string;
  sourcePath: string;
  sourceStat: Stats;
  body: string;
  options: RenderMarkdownOptions;
  render: () => Promise<RenderedMarkdown>;
}

interface CacheEntry {
  version: number;
  cache_key: string;
  source_path: string;
  source_mtime_ms: number;
  source_size: number;
  content_sha256: string;
  options: {
    unsafe: boolean;
    locale: string | undefined;
  };
  result: RenderedMarkdown;
}

export async function renderMarkdownWithCache({
  cwd,
  sourcePath,
  sourceStat,
  body,
  options,
  render,
}: RenderCacheOptions): Promise<RenderedMarkdown> {
  const cacheDir = join(cwd, '.nectar/cache');
  const source = resolve(sourcePath);
  const contentSha = sha256(body);
  const cacheOptions = normalizeOptions(options);
  const cacheKey = sha256(
    JSON.stringify({
      version: CACHE_VERSION,
      source_path: source,
      source_mtime_ms: sourceStat.mtimeMs,
      source_size: sourceStat.size,
      content_sha256: contentSha,
      options: cacheOptions,
    }),
  );
  const cachePath = join(cacheDir, `${cacheKey}.json`);

  const cached = await readCacheEntry(cachePath, cacheKey);
  if (cached) return cached;

  const result = await render();
  await writeCacheEntry(cacheDir, cachePath, {
    version: CACHE_VERSION,
    cache_key: cacheKey,
    source_path: source,
    source_mtime_ms: sourceStat.mtimeMs,
    source_size: sourceStat.size,
    content_sha256: contentSha,
    options: cacheOptions,
    result,
  });
  return result;
}

function normalizeOptions(options: RenderMarkdownOptions): CacheEntry['options'] {
  return {
    unsafe: options.unsafe === true,
    locale: options.locale,
  };
}

async function readCacheEntry(
  cachePath: string,
  expectedKey: string,
): Promise<RenderedMarkdown | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
    if (!isCacheEntry(parsed)) return undefined;
    if (parsed.version !== CACHE_VERSION) return undefined;
    if (parsed.cache_key !== expectedKey) return undefined;
    return parsed.result;
  } catch {
    return undefined;
  }
}

async function writeCacheEntry(
  cacheDir: string,
  cachePath: string,
  entry: CacheEntry,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const tempPath = join(cacheDir, `${entry.cache_key}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(entry)}\n`, 'utf8');
    await rename(tempPath, cachePath);
  } catch {
    // Cache writes are an optimisation. A read-only or concurrently cleaned
    // cache directory must not make content loading fail.
  }
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CacheEntry>;
  return (
    typeof entry.version === 'number' &&
    typeof entry.cache_key === 'string' &&
    typeof entry.source_path === 'string' &&
    typeof entry.source_mtime_ms === 'number' &&
    typeof entry.source_size === 'number' &&
    typeof entry.content_sha256 === 'string' &&
    isRenderedMarkdown(entry.result)
  );
}

function isRenderedMarkdown(value: unknown): value is RenderedMarkdown {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RenderedMarkdown>;
  return (
    typeof result.html === 'string' &&
    typeof result.plaintext === 'string' &&
    typeof result.word_count === 'number' &&
    typeof result.reading_time === 'number'
  );
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
