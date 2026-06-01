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

const JS_ASSET_PATH = '/assets/dashboard.js';
const CSS_ASSET_PATH = '/assets/dashboard.css';

export async function buildDashboardBundleInMemory(
  ctx: DashboardSourceBuildContext,
): Promise<RuntimeBundleAssets> {
  const built = await Bun.build({
    entrypoints: [ctx.entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
  });
  if (!built.success) {
    throw new Error(`dashboard JS build failed:\n${built.logs.map(String).join('\n')}`);
  }
  const jsOutput = built.outputs.find((o) => o.path.endsWith('.js')) ?? built.outputs[0];
  if (!jsOutput) throw new Error('dashboard JS build produced no output');
  const js = await jsOutput.text();

  // Tailwind v4 CLI writes to stdout when --output is omitted (default `-`).
  const proc = Bun.spawn([ctx.tailwindBin, '--input', ctx.styles, '--minify'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [css, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) {
    const err = (await new Response(proc.stderr).text()).trim();
    throw new Error(`dashboard CSS build failed (exit ${exitCode}): ${err}`);
  }
  if (css.trim().length === 0) {
    throw new Error('dashboard CSS build produced empty output');
  }

  return {
    [JS_ASSET_PATH]: { contentType: 'application/javascript; charset=utf-8', body: js },
    [CSS_ASSET_PATH]: { contentType: 'text/css; charset=utf-8', body: css },
  };
}

export type AutoBuildStatus = 'built' | 'fresh' | 'unavailable' | 'failed';

export interface AutoBuildResult {
  status: AutoBuildStatus;
  assets?: RuntimeBundleAssets;
  detail?: string;
}

// Prod-mode entrypoint: decide whether to build the dashboard frontend from
// source and return an in-memory asset map to serve. Never throws — a failed
// build degrades to the embedded bundle so the server still starts.
export async function maybeAutoBuildDashboardBundle(opts: {
  noBuild?: boolean;
  baseDir?: string;
}): Promise<AutoBuildResult> {
  if (opts.noBuild) return { status: 'unavailable', detail: 'auto-build skipped (--no-build)' };
  const ctx = dashboardSourceBuildContext(opts.baseDir);
  if (!ctx) return { status: 'unavailable' };
  try {
    if (!(await bundleSourceIsNewer(ctx))) return { status: 'fresh' };
    const assets = await buildDashboardBundleInMemory(ctx);
    return { status: 'built', assets };
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}
