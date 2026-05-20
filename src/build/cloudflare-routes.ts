import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';

// Cloudflare Pages Functions: when ANY `functions/` directory exists at the
// project root (even a single file), Pages will route every request that
// matches `include` through the Functions runtime before falling back to
// static assets. For a pure-static nectar build that is pointless overhead
// — every request pays a worker invocation just to hit the asset CDN — and,
// worse, the platform's default include is `/*`, so missing routes serve a
// Functions 404 instead of nectar's `404.html`.
//
// Emitting an explicit `_routes.json` with an empty `exclude` array AND an
// `include` of `/*` reserves zero paths for Functions: Pages serves every
// path as a static asset and never invokes the worker. When the user later
// adds real Functions code they should override this file via the
// static-passthrough dir (or by extending `[deploy.cloudflare_pages]`).
//
// See https://developers.cloudflare.com/pages/functions/routing/

interface CloudflareRoutesConfig {
  version: 1;
  include: string[];
  exclude: string[];
}

export function buildCloudflareRoutes(): CloudflareRoutesConfig {
  return {
    version: 1,
    include: ['/*'],
    exclude: [],
  };
}

export async function emitCloudflareRoutes(opts: {
  outputDir: string;
  enabled: boolean;
}): Promise<void> {
  if (!opts.enabled) return;
  await ensureDir(opts.outputDir);
  const body = `${JSON.stringify(buildCloudflareRoutes(), null, 2)}\n`;
  await writeFile(join(opts.outputDir, '_routes.json'), body);
}
