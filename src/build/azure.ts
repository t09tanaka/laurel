import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';

// Azure Static Web Apps reads `staticwebapp.config.json` at the publish root
// to drive routes, SPA fallback, response headers, and MIME overrides. The
// file is azure-specific — every other host ignores it — so emitting it
// unconditionally is safe: it adds < 1 KiB to dist/ and lets a single laurel
// build target Azure without operator intervention.
//
// We intentionally keep the emitted payload minimal: a `navigationFallback`
// that points 404s at `/404.html` (matching laurel's `emitDefault404`) and a
// `routes` entry that maps `/api/*` to anonymous so a future Functions
// integration just works. Anything more opinionated (auth, custom headers)
// belongs in a user-authored `staticwebapp.config.json` dropped into the
// static-passthrough dir, which wins thanks to the post-emit passthrough
// step in the build pipeline.

interface AzureStaticWebAppConfig {
  navigationFallback: {
    rewrite: string;
    exclude: string[];
  };
  routes: Array<{
    route: string;
    allowedRoles?: string[];
  }>;
  responseOverrides?: Record<string, { statusCode: number; rewrite?: string }>;
  mimeTypes?: Record<string, string>;
}

export function buildStaticWebAppConfig(): AzureStaticWebAppConfig {
  return {
    navigationFallback: {
      // Static sites have no client-side router; missing paths must serve the
      // 404 page rather than rewriting to `/index.html`. `laurel build` emits
      // `404.html` (via `emitDefault404` or a theme-provided `error.hbs`).
      rewrite: '/404.html',
      // Excluding fingerprinted asset paths and content images keeps the SPA
      // fallback from masking genuine 404s for missing static files.
      exclude: ['/assets/*', '/content/images/*', '/pagefind/*', '/*.{xml,json,txt,br,gz}'],
    },
    routes: [
      {
        route: '/api/*',
        allowedRoles: ['anonymous'],
      },
    ],
  };
}

export async function emitAzureStaticWebAppConfig(opts: { outputDir: string }): Promise<void> {
  await ensureDir(opts.outputDir);
  const body = `${JSON.stringify(buildStaticWebAppConfig(), null, 2)}\n`;
  await writeFile(join(opts.outputDir, 'staticwebapp.config.json'), body);
}
