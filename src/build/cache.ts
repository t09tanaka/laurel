import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_ROOT = '.nectar-cache/cache';

export const EMBED_CACHE_NAMESPACE = 'embeds';

export interface BuildJsonCacheOptions {
  cwd: string;
  namespace: string;
  cacheDir?: string;
  now?: () => Date;
}

export interface BuildJsonCacheWriteOptions {
  ttlMs?: number;
  metadata?: Record<string, unknown>;
  now?: () => Date;
}

export interface BuildJsonCacheReadOptions<T> {
  ttlMs?: number;
  allowStale?: boolean;
  now?: () => Date;
  validate?: (value: unknown) => value is T;
}

export interface BuildJsonCacheReadThroughOptions<T> extends BuildJsonCacheReadOptions<T> {
  offline?: boolean;
  fetchValue: () => Promise<T>;
}

export interface BuildJsonCacheHit<T> {
  key: string;
  cacheKey: string;
  path: string;
  value: T;
  fetchedAt: Date;
  ageMs: number;
  stale: boolean;
  metadata: Record<string, unknown>;
}

export type BuildJsonCacheReadThroughResult<T> =
  | { status: 'hit' | 'stale' | 'refreshed'; hit: BuildJsonCacheHit<T> }
  | { status: 'offline-miss'; key: string; cacheKey: string; path: string };

interface CacheEntry<T = unknown> {
  schema: number;
  namespace: string;
  key: string;
  cache_key: string;
  fetched_at: string;
  ttl_ms?: number;
  metadata: Record<string, unknown>;
  value: T;
}

export interface BuildJsonCache {
  namespace: string;
  rootDir: string;
  pathFor: (key: unknown) => { key: string; cacheKey: string; path: string };
  read: <T>(
    key: unknown,
    options?: BuildJsonCacheReadOptions<T>,
  ) => Promise<BuildJsonCacheHit<T> | undefined>;
  write: <T>(
    key: unknown,
    value: T,
    options?: BuildJsonCacheWriteOptions,
  ) => Promise<BuildJsonCacheHit<T>>;
  readThrough: <T>(
    key: unknown,
    options: BuildJsonCacheReadThroughOptions<T>,
  ) => Promise<BuildJsonCacheReadThroughResult<T>>;
}

export function defaultBuildCacheRoot(cwd: string): string {
  return resolve(cwd, DEFAULT_CACHE_ROOT);
}

export function createEmbedMetadataCache(
  options: Omit<BuildJsonCacheOptions, 'namespace'>,
): BuildJsonCache {
  return createBuildJsonCache({ ...options, namespace: EMBED_CACHE_NAMESPACE });
}

export function createBuildJsonCache(options: BuildJsonCacheOptions): BuildJsonCache {
  const namespace = normalizeNamespace(options.namespace);
  const rootDir = options.cacheDir
    ? resolve(options.cwd, options.cacheDir)
    : defaultBuildCacheRoot(options.cwd);
  const now = options.now ?? (() => new Date());

  const pathFor = (keyInput: unknown) => {
    const key = normalizeBuildCacheKey(keyInput);
    const cacheKey = buildCacheKey(namespace, key);
    return {
      key,
      cacheKey,
      path: join(rootDir, namespace, `${cacheKey}.json`),
    };
  };

  async function read<T>(
    keyInput: unknown,
    readOptions: BuildJsonCacheReadOptions<T> = {},
  ): Promise<BuildJsonCacheHit<T> | undefined> {
    const location = pathFor(keyInput);
    const entry = await readEntry(
      location.path,
      namespace,
      location.cacheKey,
      readOptions.validate,
    );
    if (!entry) return undefined;
    const hit = entryToHit(location.path, entry, readOptions.now?.() ?? now(), readOptions.ttlMs);
    if (hit.stale && readOptions.allowStale !== true) return undefined;
    return hit;
  }

  async function write<T>(
    keyInput: unknown,
    value: T,
    writeOptions: BuildJsonCacheWriteOptions = {},
  ): Promise<BuildJsonCacheHit<T>> {
    const location = pathFor(keyInput);
    const fetchedAt = writeOptions.now?.() ?? now();
    const entry: CacheEntry<T> = {
      schema: CACHE_SCHEMA_VERSION,
      namespace,
      key: location.key,
      cache_key: location.cacheKey,
      fetched_at: fetchedAt.toISOString(),
      metadata: writeOptions.metadata ?? {},
      value,
    };
    const ttlMs = normalizeTtlMs(writeOptions.ttlMs);
    if (ttlMs !== undefined) entry.ttl_ms = ttlMs;
    await writeEntry(location.path, entry);
    return entryToHit(location.path, entry, fetchedAt, writeOptions.ttlMs);
  }

  async function readThrough<T>(
    keyInput: unknown,
    readOptions: BuildJsonCacheReadThroughOptions<T>,
  ): Promise<BuildJsonCacheReadThroughResult<T>> {
    const location = pathFor(keyInput);
    const cached = await read<T>(keyInput, { ...readOptions, allowStale: true });
    if (cached && !cached.stale) return { status: 'hit', hit: cached };
    if (readOptions.offline === true) {
      if (cached) return { status: 'stale', hit: cached };
      return { status: 'offline-miss', ...location };
    }
    const value = await readOptions.fetchValue();
    const refreshed = await write(keyInput, value, {
      ttlMs: readOptions.ttlMs,
      now: readOptions.now,
    });
    return { status: 'refreshed', hit: refreshed };
  }

  return { namespace, rootDir, pathFor, read, write, readThrough };
}

export function normalizeBuildCacheKey(key: unknown): string {
  if (key instanceof URL) return key.href;
  if (typeof key === 'string') return key;
  return JSON.stringify(stableJsonValue(key)) ?? String(key);
}

function buildCacheKey(namespace: string, key: string): string {
  return createHash('sha256').update(namespace).update('\0').update(key).digest('hex');
}

function normalizeNamespace(namespace: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(namespace)) {
    throw new Error(`Invalid build cache namespace: ${namespace}`);
  }
  return namespace;
}

function normalizeTtlMs(ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined) return undefined;
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error(`Invalid build cache ttlMs: ${ttlMs}`);
  }
  return Math.floor(ttlMs);
}

function stableJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof URL) return value.href;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child !== undefined) sorted[key] = stableJsonValue(child);
  }
  return sorted;
}

async function readEntry<T>(
  path: string,
  namespace: string,
  cacheKey: string,
  validate: ((value: unknown) => value is T) | undefined,
): Promise<CacheEntry<T> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isCacheEntry(parsed)) return undefined;
    if (parsed.schema !== CACHE_SCHEMA_VERSION) return undefined;
    if (parsed.namespace !== namespace) return undefined;
    if (parsed.cache_key !== cacheKey) return undefined;
    if (validate && !validate(parsed.value)) return undefined;
    return parsed as CacheEntry<T>;
  } catch {
    return undefined;
  }
}

async function writeEntry(path: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = join(dirname(path), `${entry.cache_key}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(entry)}\n`, 'utf8');
    await rename(tempPath, path);
  } catch {
    // Cache writes are best effort; a read-only cache directory should not
    // fail a successful build or remote probe.
  }
}

function entryToHit<T>(
  path: string,
  entry: CacheEntry<T>,
  now: Date,
  ttlOverrideMs: number | undefined,
): BuildJsonCacheHit<T> {
  const fetchedAt = new Date(entry.fetched_at);
  const ageMs = Math.max(0, now.getTime() - fetchedAt.getTime());
  const ttlMs = normalizeTtlMs(ttlOverrideMs ?? entry.ttl_ms);
  return {
    key: entry.key,
    cacheKey: entry.cache_key,
    path,
    value: entry.value,
    fetchedAt,
    ageMs,
    stale: ttlMs !== undefined && ageMs > ttlMs,
    metadata: entry.metadata,
  };
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CacheEntry>;
  return (
    entry.schema === CACHE_SCHEMA_VERSION &&
    typeof entry.namespace === 'string' &&
    typeof entry.key === 'string' &&
    typeof entry.cache_key === 'string' &&
    typeof entry.fetched_at === 'string' &&
    isValidDateString(entry.fetched_at) &&
    (entry.ttl_ms === undefined || (typeof entry.ttl_ms === 'number' && entry.ttl_ms >= 0)) &&
    isRecord(entry.metadata) &&
    Object.hasOwn(entry, 'value')
  );
}

function isValidDateString(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
