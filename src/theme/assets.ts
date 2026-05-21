import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pLimit } from '~/util/concurrency.ts';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';
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
  integrity: string;
}

interface AssetCacheFile {
  version: 1;
  entries: Record<string, AssetCacheEntry>;
}

const CACHE_VERSION = 1;
const CACHE_FILENAME = 'asset-cache.json';
// Bounded concurrency for the per-file stat + sha1 fan-out. 16 is well under
// the typical soft fd limit (1024) and large enough to saturate disk
// throughput on real themes (hundreds of small fonts/CSS/JS assets) while
// keeping memory bounded — combined with streaming sha1 below, peak heap is
// HASH_CONCURRENCY x chunk size rather than scaling with asset size or count.
const HASH_CONCURRENCY = 16;

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

  // Collect candidate relative paths up front. glob.scan is inherently
  // sequential; doing the stat + streaming hash work in a Promise.all fan-out
  // below is what unlocks the actual speedup on themes with hundreds of assets.
  const allRels = await scanGlob('**/*', { cwd: assetsDir, onlyFiles: true });
  const rels = allRels.filter((rel) => {
    if (pathContainsSymlink(assetsDir, rel)) {
      logger.warn(`Skipping symlinked theme asset: ${join(assetsDir, rel)}`);
      return false;
    }
    return true;
  });

  interface Processed {
    rel: string;
    file: string;
    mtimeMs: number;
    size: number;
    hash: string;
    integrity: string;
  }

  const limit = pLimit(HASH_CONCURRENCY);
  const processed = await Promise.all(
    rels.map((rel) =>
      limit(async (): Promise<Processed> => {
        const file = join(assetsDir, rel);
        const fileStat = await stat(file);
        const mtimeMs = fileStat.mtimeMs;
        const size = fileStat.size;
        const cached = cache[file];
        let hash: string;
        let integrity: string;
        if (cached && cached.mtimeMs === mtimeMs && cached.size === size && cached.integrity) {
          hash = cached.hash;
          integrity = cached.integrity;
        } else {
          const digests = await assetDigestsStream(file);
          hash = digests.sha1Short;
          integrity = digests.integrity;
        }
        return { rel, file, mtimeMs, size, hash, integrity };
      }),
    ),
  );

  // Apply results in glob order so the Map iteration order stays deterministic
  // across runs regardless of which task finished first.
  for (const p of processed) {
    next[p.file] = { mtimeMs: p.mtimeMs, size: p.size, hash: p.hash, integrity: p.integrity };
    const logical = `assets/${p.rel.replaceAll('\\', '/')}`;
    const ext = extname(p.rel);
    const base = logical.slice(0, logical.length - ext.length);
    const fingerprinted = shouldFingerprint(ext) ? `${base}.${p.hash}${ext}` : logical;
    const entry = {
      logicalPath: logical,
      fingerprintedPath: fingerprinted,
      sourcePath: p.file,
      hash: p.hash,
      integrity: p.integrity,
      size: p.size,
    };
    out.set(logical, entry);
    // Also let bare references (e.g. "built/screen.css") resolve without the assets/ prefix.
    out.set(p.rel.replaceAll('\\', '/'), entry);
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
      typeof (v as AssetCacheEntry).hash === 'string' &&
      typeof (v as AssetCacheEntry).integrity === 'string'
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

// Stream the file through Bun.CryptoHasher instead of buffering the whole
// payload into a Buffer first. For a 40MB asset this keeps memory at the
// stream's chunk size (tens of KB) instead of 40MB resident per file.
async function assetDigestsStream(file: string): Promise<{ sha1Short: string; integrity: string }> {
  const sha1 = new Bun.CryptoHasher('sha1');
  const sha384 = new Bun.CryptoHasher('sha384');
  const stream = Bun.file(file).stream();
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    sha1.update(chunk);
    sha384.update(chunk);
  }
  const digest = sha1.digest('hex');
  return {
    sha1Short: digest.slice(0, 10),
    integrity: `sha384-${sha384.digest('base64')}`,
  };
}

export function assetPublicUrl(asset: ThemeAsset, basePath: string): string {
  const path = asset.fingerprintedPath;
  const url = joinPath(basePath, path);
  return asset.fingerprintedPath === asset.logicalPath ? `${url}?v=${asset.hash}` : url;
}

export function joinPath(base: string, path: string): string {
  if (!base || base === '/') return `/${path}`;
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${cleanBase}/${cleanPath}`;
}
