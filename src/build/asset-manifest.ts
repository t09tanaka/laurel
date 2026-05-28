import { dirname, join } from 'node:path';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';

export const ASSET_MANIFEST_FILENAME = 'asset-manifest.json';
export const ASSET_MANIFEST_DIR = '.nectar';

export interface AssetManifestEntry {
  path: string;
  integrity: string;
}

export type AssetManifestJson = Record<string, AssetManifestEntry>;

export function assetManifestAbsPath(outputDir: string): string {
  return join(outputDir, ASSET_MANIFEST_DIR, ASSET_MANIFEST_FILENAME);
}

export function buildAssetManifest(theme: ThemeBundle): AssetManifestJson {
  const entries = new Map<string, AssetManifestEntry>();
  for (const asset of theme.assets.values()) {
    entries.set(asset.logicalPath, {
      path: asset.fingerprintedPath,
      integrity: asset.integrity,
    });
  }

  return Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export async function emitAssetManifest(opts: {
  outputDir: string;
  theme: ThemeBundle;
}): Promise<AssetManifestJson> {
  const manifest = buildAssetManifest(opts.theme);
  const dest = assetManifestAbsPath(opts.outputDir);
  await ensureDir(dirname(dest));
  await Bun.write(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
