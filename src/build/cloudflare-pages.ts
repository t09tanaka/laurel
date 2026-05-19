import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';

// Cloudflare Pages reads `_headers` at the build-output root and applies the
// rules per request, with more specific URL patterns overriding headers of the
// same name on broader patterns. Without this file all responses fall back to
// Pages' short default cache, which throws away the cacheability that
// fingerprinted asset URLs were designed to enable. The defaults here pin
// fingerprinted theme assets (`/assets/*`) and content images
// (`/content/images/*`) to a year of immutable caching while forcing HTML
// (matched by the catch-all `/*` rule) to revalidate every request so a new
// build is picked up immediately.
export async function emitCloudflarePagesHeaders(opts: {
  outputDir: string;
  enabled: boolean;
}): Promise<void> {
  if (!opts.enabled) return;
  await ensureDir(opts.outputDir);
  await writeFile(join(opts.outputDir, '_headers'), DEFAULT_HEADERS);
}

const DEFAULT_HEADERS = `/assets/*
  Cache-Control: public, max-age=31536000, immutable

/content/images/*
  Cache-Control: public, max-age=31536000, immutable

/*
  Cache-Control: public, max-age=0, must-revalidate
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`;
