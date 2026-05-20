import { dirname, join } from 'node:path';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';

export const ASSET_MANIFEST_FILENAME = 'asset-manifest.json';
export const ASSET_MANIFEST_DIR = '.nectar';

export type AssetManifestJson = Record<string, string>;

export function assetManifestRelPath(): string {
  return `${ASSET_MANIFEST_DIR}/${ASSET_MANIFEST_FILENAME}`;
}

export function assetManifestAbsPath(outputDir: string): string {
  return join(outputDir, ASSET_MANIFEST_DIR, ASSET_MANIFEST_FILENAME);
}

export function buildAssetManifest(theme: ThemeBundle): AssetManifestJson {
  const entries = new Map<string, string>();
  for (const asset of theme.assets.values()) {
    entries.set(asset.logicalPath, asset.fingerprintedPath);
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
