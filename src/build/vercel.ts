import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import type { HeadersConfig } from './headers.ts';
import { type RedirectRule, type RedirectStatus, collapseRedirects } from './redirects.ts';

// Vercel reads `vercel.json` at the project root (and from the build output for
// static sites) to drive routing, headers, and redirects. Unlike Netlify and
// Cloudflare Pages which use separate `_headers` and `_redirects` files,
// Vercel's surface is a single JSON document so the emitter folds both feeds
// into one structure. The source patterns Vercel accepts are path-to-regexp
// expressions; this emitter translates the glob `*` used in `_headers`-style
// patterns to `(.*)` so the same URL pattern resolves to equivalent paths
// across deploy targets.
//
// Vercel always honors redirects regardless of whether a static file exists at
// the source path (the same semantics Cloudflare Pages uses). The `force` flag
// from `redirects.yaml` is therefore informational here: every emitted rule
// fires unconditionally on Vercel and there is no per-rule fall-through marker
// to translate to.

interface VercelHeaderEntry {
  key: string;
  value: string;
}

interface VercelHeaderRule {
  source: string;
  headers: VercelHeaderEntry[];
}

interface VercelRedirectRule {
  source: string;
  destination: string;
  statusCode: RedirectStatus;
}

export type BuildTrailingSlash = 'always' | 'never';

export interface VercelConfig {
  cleanUrls?: boolean;
  trailingSlash?: boolean;
  headers?: VercelHeaderRule[];
  redirects?: VercelRedirectRule[];
}

const CATCH_ALL = '/*';

const SECURITY_HEADER_FIELDS: ReadonlyArray<{
  key: keyof Omit<HeadersConfig['security'], 'custom'>;
  name: string;
}> = [
  { key: 'content_type_options', name: 'X-Content-Type-Options' },
  { key: 'frame_options', name: 'X-Frame-Options' },
  { key: 'referrer_policy', name: 'Referrer-Policy' },
  { key: 'strict_transport_security', name: 'Strict-Transport-Security' },
  { key: 'content_security_policy', name: 'Content-Security-Policy' },
  { key: 'permissions_policy', name: 'Permissions-Policy' },
  { key: 'cross_origin_opener_policy', name: 'Cross-Origin-Opener-Policy' },
  { key: 'cross_origin_embedder_policy', name: 'Cross-Origin-Embedder-Policy' },
];

// Translate the glob-style `*` Cloudflare/Netlify use in `_headers` and
// `_redirects` patterns into Vercel's path-to-regexp `(.*)` so the same
// pattern matches the same set of paths on every deploy target. Anchoring
// rules (named segments like `:slug`) pass through unchanged.
function toVercelSource(pattern: string): string {
  return pattern.replace(/\*/g, '(.*)');
}

function collectSecurityHeaders(security: HeadersConfig['security']): VercelHeaderEntry[] {
  const entries: VercelHeaderEntry[] = [];
  for (const { key, name } of SECURITY_HEADER_FIELDS) {
    const value = security[key];
    if (typeof value === 'string' && value.length > 0) {
      entries.push({ key: name, value });
    }
  }
  for (const [name, value] of Object.entries(security.custom)) {
    if (typeof value === 'string' && value.length > 0) {
      entries.push({ key: name, value });
    }
  }
  return entries;
}

export function buildVercelHeaders(headers: HeadersConfig): VercelHeaderRule[] {
  const securityEntries = collectSecurityHeaders(headers.security);
  const seen = new Set<string>();
  const ordered: VercelHeaderRule[] = [];
  let catchAll: VercelHeaderRule | null = null;

  for (const rule of headers.cache_rules) {
    if (seen.has(rule.pattern)) continue;
    seen.add(rule.pattern);
    const entry: VercelHeaderRule = {
      source: toVercelSource(rule.pattern),
      headers: [{ key: 'Cache-Control', value: rule.cache_control }],
    };
    if (rule.pattern === CATCH_ALL) {
      catchAll = entry;
    } else {
      ordered.push(entry);
    }
  }

  if (!catchAll && securityEntries.length > 0) {
    catchAll = { source: toVercelSource(CATCH_ALL), headers: [] };
  }
  if (catchAll) {
    catchAll.headers.push(...securityEntries);
    ordered.push(catchAll);
  }

  return ordered;
}

export function buildVercelRedirects(rules: readonly RedirectRule[]): VercelRedirectRule[] {
  return collapseRedirects(rules).map((r) => ({
    source: toVercelSource(r.from),
    destination: r.to,
    statusCode: r.status,
  }));
}

export function buildVercelConfig(opts: {
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
  trailingSlash: BuildTrailingSlash;
}): VercelConfig {
  const config: VercelConfig = {
    cleanUrls: true,
    trailingSlash: opts.trailingSlash === 'always',
  };
  const headerRules = buildVercelHeaders(opts.headers);
  if (headerRules.length > 0) {
    config.headers = headerRules;
  }
  const redirectRules = buildVercelRedirects(opts.rules);
  if (redirectRules.length > 0) {
    config.redirects = redirectRules;
  }
  return config;
}

export async function emitVercelJson(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
  trailingSlash: BuildTrailingSlash;
}): Promise<void> {
  if (!opts.enabled) return;
  const config = buildVercelConfig({
    headers: opts.headers,
    rules: opts.rules,
    trailingSlash: opts.trailingSlash,
  });
  await ensureDir(opts.outputDir);
  await writeFile(join(opts.outputDir, 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`);
}
