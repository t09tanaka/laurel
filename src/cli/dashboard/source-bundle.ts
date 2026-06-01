import { type Dirent, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DashboardBundleAsset {
  contentType: string;
  body: string;
}

// Mirrors the shape of DASHBOARD_BUNDLE_ASSETS in bundled-assets.ts so the
// request handler can treat a runtime build and the embedded bundle the same.
export type RuntimeBundleAssets = Partial<Record<string, DashboardBundleAsset>>;

export interface DashboardSourceBuildContext {
  webDir: string;
  entry: string;
  styles: string;
  tailwindBin: string;
  bundledAssetsPath: string;
}

// This module lives at src/cli/dashboard/source-bundle.ts, so its own dir is
// the dashboard dir; the repo root (and node_modules) is three levels up.
const DEFAULT_BASE_DIR = dirname(fileURLToPath(import.meta.url));

export function dashboardSourceBuildContext(
  baseDir: string = DEFAULT_BASE_DIR,
): DashboardSourceBuildContext | null {
  const webDir = join(baseDir, 'web');
  const entry = join(webDir, 'entry.tsx');
  const styles = join(webDir, 'styles.css');
  const bundledAssetsPath = join(baseDir, 'bundled-assets.ts');
  const tailwindBin = join(baseDir, '..', '..', '..', 'node_modules', '.bin', 'tailwindcss');
  if (!existsSync(entry) || !existsSync(styles) || !existsSync(tailwindBin)) return null;
  return { webDir, entry, styles, tailwindBin, bundledAssetsPath };
}

export async function maxMtimeMsUnder(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let max = 0;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, await maxMtimeMsUnder(full));
    } else {
      try {
        max = Math.max(max, (await stat(full)).mtimeMs);
      } catch {
        // unreadable entry: ignore, it cannot make the bundle stale on its own
      }
    }
  }
  return max;
}

export async function bundleSourceIsNewer(ctx: DashboardSourceBuildContext): Promise<boolean> {
  const webMtime = await maxMtimeMsUnder(ctx.webDir);
  let bundleMtime = 0;
  try {
    bundleMtime = (await stat(ctx.bundledAssetsPath)).mtimeMs;
  } catch {
    bundleMtime = 0;
  }
  return webMtime > bundleMtime;
}
