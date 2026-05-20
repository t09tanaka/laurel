import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type HeaderEntry, type HeadersConfig, collectHeaderRules } from './headers.ts';
import { type RedirectRule, type RedirectStatus, collapseRedirects } from './redirects.ts';

export const CLOUDFLARE_WORKERS_MANIFEST_FILE = '_routes-manifest.json';

export interface CloudflareWorkersHeaderRule {
  source: string;
  headers: HeaderEntry[];
}

export interface CloudflareWorkersRedirectRule {
  source: string;
  destination: string;
  status: RedirectStatus;
}

export interface CloudflareWorkersManifest {
  version: 1;
  redirects: CloudflareWorkersRedirectRule[];
  headers: CloudflareWorkersHeaderRule[];
}

export function buildCloudflareWorkersManifest(opts: {
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
}): CloudflareWorkersManifest {
  return {
    version: 1,
    redirects: collapseRedirects(opts.rules).map((rule) => ({
      source: rule.from,
      destination: rule.to,
      status: rule.status,
    })),
    headers: collectHeaderRules(opts.headers).map((rule) => ({
      source: rule.pattern,
      headers: rule.headers,
    })),
  };
}

export async function emitCloudflareWorkersManifest(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
}): Promise<void> {
  if (!opts.enabled) return;
  const manifest = buildCloudflareWorkersManifest({ headers: opts.headers, rules: opts.rules });
  await ensureDir(opts.outputDir);
  await writeFile(
    join(opts.outputDir, CLOUDFLARE_WORKERS_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
