import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pathContainsSymlink } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import type { ThemeAsset } from './types.ts';

export interface LoadThemeAssetsOptions {
  // Directory (typically `<cwd>/.nectar-cache`) where the asset fingerprint
  // cache lives. When unset, caching is disabled and every asset is re-hashed
  // (useful for tests that work in throwaway temp dirs).
  cacheDir?: string;
}

interface AssetCacheEntry {
  mtimeMs: number;
  size: number;
  hash: string;
}

interface AssetCacheFile {
  version: 1;
  entries: Record<string, AssetCacheEntry>;
}

const CACHE_VERSION = 1;
const CACHE_FILENAME = 'asset-cache.json';

export async function loadThemeAssets(
  rootDir: string,
  options: LoadThemeAssetsOptions = {},
): Promise<Map<string, ThemeAsset>> {
  const out = new Map<string, ThemeAsset>();
  const assetsDir = join(rootDir, 'assets');
  if (!existsSync(assetsDir)) return out;

  const cacheFile = options.cacheDir ? join(options.cacheDir, CACHE_FILENAME) : null;
  const cache = cacheFile ? await readCache(cacheFile) : {};
  const next: Record<string, AssetCacheEntry> = {};

  const glob = new Bun.Glob('**/*');
  for await (const rel of glob.scan({ cwd: assetsDir, onlyFiles: true })) {
    if (pathContainsSymlink(assetsDir, rel)) {
      logger.warn(`Skipping symlinked theme asset: ${join(assetsDir, rel)}`);
      continue;
    }
    const file = join(assetsDir, rel);
    const stat = statSync(file);
    const mtimeMs = stat.mtimeMs;
    const size = stat.size;
    const cached = cache[file];
    let hash: string;
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      hash = cached.hash;
    } else {
      const buf = await readFile(file);
      hash = await sha1Short(buf);
    }
    next[file] = { mtimeMs, size, hash };
    const logical = `assets/${rel.replaceAll('\\', '/')}`;
    const ext = extname(rel);
    const base = logical.slice(0, logical.length - ext.length);
    const fingerprinted = shouldFingerprint(ext) ? `${base}.${hash}${ext}` : logical;
    const entry = {
      logicalPath: logical,
      fingerprintedPath: fingerprinted,
      sourcePath: file,
      hash,
      size,
    };
    out.set(logical, entry);
    // Also let bare references (e.g. "built/screen.css") resolve without the assets/ prefix.
    out.set(rel.replaceAll('\\', '/'), entry);
  }

  if (cacheFile) await writeCache(cacheFile, next);
  return out;
}

async function readCache(cacheFile: string): Promise<Record<string, AssetCacheEntry>> {
  if (!existsSync(cacheFile)) return {};
  let raw: string;
  try {
    raw = await readFile(cacheFile, 'utf8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== CACHE_VERSION
  ) {
    return {};
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
    return {};
  }
  const out: Record<string, AssetCacheEntry> = {};
  for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof (v as AssetCacheEntry).mtimeMs === 'number' &&
      typeof (v as AssetCacheEntry).size === 'number' &&
      typeof (v as AssetCacheEntry).hash === 'string'
    ) {
      out[k] = v as AssetCacheEntry;
    }
  }
  return out;
}

async function writeCache(
  cacheFile: string,
  entries: Record<string, AssetCacheEntry>,
): Promise<void> {
  try {
    await mkdir(dirname(cacheFile), { recursive: true });
    const payload: AssetCacheFile = { version: CACHE_VERSION, entries };
    await writeFile(cacheFile, JSON.stringify(payload));
  } catch (err) {
    // Cache is a pure speed optimisation. If we can't persist (read-only fs,
    // permission error, etc.) we still produced a correct build, so we log
    // and move on rather than failing the build.
    logger.warn(`Could not write theme asset cache to ${cacheFile}: ${(err as Error).message}`);
  }
}

function shouldFingerprint(ext: string): boolean {
  const dotted = ext.toLowerCase();
  return ['.css', '.js', '.mjs'].includes(dotted);
}

async function sha1Short(buf: Buffer): Promise<string> {
  const hash = new Bun.CryptoHasher('sha1');
  hash.update(buf);
  const digest = hash.digest('hex');
  return digest.slice(0, 10);
}

export function assetPublicUrl(asset: ThemeAsset, basePath: string): string {
  const path = asset.fingerprintedPath;
  return joinPath(basePath, path);
}

export function joinPath(base: string, path: string): string {
  if (!base || base === '/') return `/${path}`;
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${cleanBase}/${cleanPath}`;
}
