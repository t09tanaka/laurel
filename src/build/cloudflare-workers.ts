import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import {
  type HeaderApplication,
  type HeaderEntry,
  type HeadersConfig,
  collectHeaderRules,
} from './headers.ts';
import { type RedirectRule, type RedirectStatus, collapseRedirects } from './redirects.ts';

export const CLOUDFLARE_WORKERS_MANIFEST_FILE = '_routes-manifest.json';

interface CloudflareWorkersHeaderRule {
  source: string;
  headers: HeaderEntry[];
}

interface CloudflareWorkersRedirectRule {
  source: string;
  destination: string;
  status: RedirectStatus;
}

interface CloudflareWorkersManifest {
  version: 1;
  redirects: CloudflareWorkersRedirectRule[];
  headers: CloudflareWorkersHeaderRule[];
}

export class CloudflareWorkersManifestBuilder implements HeaderApplication {
  readonly #headers: CloudflareWorkersHeaderRule[] = [];
  readonly #rules: readonly RedirectRule[];

  constructor(rules: readonly RedirectRule[]) {
    this.#rules = rules;
  }

  applyHeaders(file: string, headers: readonly HeaderEntry[]): void {
    this.#headers.push({
      source: file,
      headers: headers.map((header) => ({ ...header })),
    });
  }

  build(): CloudflareWorkersManifest {
    return {
      version: 1,
      redirects: collapseRedirects(this.#rules).map((rule) => ({
        source: rule.from,
        destination: rule.to,
        status: rule.status,
      })),
      headers: this.#headers.map((rule) => ({
        source: rule.source,
        headers: rule.headers.map((header) => ({ ...header })),
      })),
    };
  }
}

export function buildCloudflareWorkersManifest(opts: {
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
}): CloudflareWorkersManifest {
  const builder = new CloudflareWorkersManifestBuilder(opts.rules);
  for (const rule of collectHeaderRules(opts.headers)) {
    builder.applyHeaders(rule.pattern, rule.headers);
  }
  return builder.build();
}

export async function emitCloudflareWorkersManifest(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
}): Promise<void> {
  if (!opts.enabled) return;
  const manifest = buildCloudflareWorkersManifest({ headers: opts.headers, rules: opts.rules });
  await writeCloudflareWorkersManifest(opts.outputDir, manifest);
}

export async function writeCloudflareWorkersManifest(
  outputDir: string,
  manifest: CloudflareWorkersManifest,
): Promise<void> {
  await ensureDir(outputDir);
  await writeFile(
    join(outputDir, CLOUDFLARE_WORKERS_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
