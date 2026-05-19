import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ThemeAsset } from './types.ts';

export async function loadThemeAssets(rootDir: string): Promise<Map<string, ThemeAsset>> {
  const out = new Map<string, ThemeAsset>();
  const assetsDir = join(rootDir, 'assets');
  if (!existsSync(assetsDir)) return out;
  const glob = new Bun.Glob('**/*');
  for await (const rel of glob.scan({ cwd: assetsDir, onlyFiles: true })) {
    const file = join(assetsDir, rel);
    const stat = statSync(file);
    const buf = await readFile(file);
    const hash = await sha1Short(buf);
    const logical = `assets/${rel.replaceAll('\\', '/')}`;
    const ext = extname(rel);
    const base = logical.slice(0, logical.length - ext.length);
    const fingerprinted = shouldFingerprint(ext) ? `${base}.${hash}${ext}` : logical;
    out.set(logical, {
      logicalPath: logical,
      fingerprintedPath: fingerprinted,
      sourcePath: file,
      hash,
      size: stat.size,
    });
    // Also let bare references (e.g. "built/screen.css") resolve without the assets/ prefix.
    out.set(rel.replaceAll('\\', '/'), out.get(logical)!);
  }
  return out;
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
