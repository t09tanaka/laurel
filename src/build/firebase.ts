import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type HeaderEntry, type HeadersConfig, collectHeaderRules } from './headers.ts';
import { type RedirectRule, type RedirectStatus, collapseRedirects } from './redirects.ts';
import type { BuildTrailingSlash } from './vercel.ts';

interface FirebaseHeaderRule {
  source: string;
  headers: HeaderEntry[];
}

interface FirebaseRedirectRule {
  source: string;
  destination: string;
  type: RedirectStatus;
}

interface FirebaseRewriteRule {
  source: string;
  destination: string;
}

interface FirebaseConfig {
  hosting: {
    public: string;
    ignore: string[];
    cleanUrls: boolean;
    trailingSlash?: boolean;
    headers: FirebaseHeaderRule[];
    redirects: FirebaseRedirectRule[];
    rewrites: FirebaseRewriteRule[];
  };
}

const FIREBASE_IGNORE = ['firebase.json', '**/.*', '**/node_modules/**'];

export function toFirebaseSource(pattern: string): string {
  if (pattern === '/*') return '**';
  return pattern.replace(/\*+/g, '**');
}

export function buildFirebaseHeaders(headers: HeadersConfig): FirebaseHeaderRule[] {
  return collectHeaderRules(headers).map((rule) => ({
    source: toFirebaseSource(rule.pattern),
    headers: rule.headers,
  }));
}

export function buildFirebaseRedirects(rules: readonly RedirectRule[]): FirebaseRedirectRule[] {
  return collapseRedirects(rules).map((rule) => ({
    source: toFirebaseSource(rule.from),
    destination: rule.to,
    type: rule.status,
  }));
}

export function buildFirebaseConfig(opts: {
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
  trailingSlash: BuildTrailingSlash;
}): FirebaseConfig {
  const config: FirebaseConfig = {
    hosting: {
      public: '.',
      ignore: FIREBASE_IGNORE,
      cleanUrls: true,
      headers: buildFirebaseHeaders(opts.headers),
      redirects: buildFirebaseRedirects(opts.rules),
      rewrites: [],
    },
  };
  if (opts.trailingSlash !== 'preserve') {
    config.hosting.trailingSlash = opts.trailingSlash === 'always';
  }
  return config;
}

export async function emitFirebaseJson(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
  trailingSlash: BuildTrailingSlash;
}): Promise<void> {
  if (!opts.enabled) return;
  const config = buildFirebaseConfig({
    headers: opts.headers,
    rules: opts.rules,
    trailingSlash: opts.trailingSlash,
  });
  await ensureDir(opts.outputDir);
  await writeFile(join(opts.outputDir, 'firebase.json'), `${JSON.stringify(config, null, 2)}\n`);
}
