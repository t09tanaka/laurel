import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

export type HeadersConfig = NectarConfig['deploy']['headers'];

// Chrome's HSTS preload list (hstspreload.org) refuses any submission whose
// max-age is below one year (31_536_000 seconds), and silently *removes*
// already-listed sites whose header later drops below that threshold. So a
// host that ships `Strict-Transport-Security: max-age=600; preload` is not
// merely ineligible — it is actively unsafe to publish, because once an
// operator submits the apex to the list, a subsequent build that drops the
// max-age below a year triggers eviction with no recourse for users whose
// browsers already cached the entry. Validate at emit time and warn loudly.
const HSTS_PRELOAD_MIN_MAX_AGE_SECONDS = 31_536_000;

interface HstsParts {
  maxAge: number | undefined;
  includeSubDomains: boolean;
  preload: boolean;
}

function parseHstsHeader(value: string): HstsParts {
  const parts: HstsParts = {
    maxAge: undefined,
    includeSubDomains: false,
    preload: false,
  };
  for (const rawDirective of value.split(';')) {
    const directive = rawDirective.trim().toLowerCase();
    if (directive === '') continue;
    if (directive === 'includesubdomains') {
      parts.includeSubDomains = true;
      continue;
    }
    if (directive === 'preload') {
      parts.preload = true;
      continue;
    }
    if (directive.startsWith('max-age=')) {
      const raw = directive.slice('max-age='.length).replace(/"/g, '').trim();
      const num = Number.parseInt(raw, 10);
      if (Number.isFinite(num) && num >= 0) parts.maxAge = num;
    }
  }
  return parts;
}

/**
 * Validate `Strict-Transport-Security` against the Chrome preload-list rules
 * when the operator opts into `preload`. Returns the (possibly normalized)
 * header value to emit, or `null` to skip emission. Warnings surface through
 * `logger.warn` so `--strict` flags them up in CI.
 *
 * Rules (mirroring hstspreload.org):
 * - `preload` requires `max-age >= 31_536_000` (1 year).
 * - `preload` requires `includeSubDomains`.
 *
 * On violation we still emit the header (silently dropping `preload` would
 * be more surprising than warning + passing through), but the operator sees
 * a clear message naming both the directive and the missing condition.
 */
export function validateHstsForPreload(value: string): string {
  const parts = parseHstsHeader(value);
  if (!parts.preload) return value;
  if (parts.maxAge === undefined || parts.maxAge < HSTS_PRELOAD_MIN_MAX_AGE_SECONDS) {
    const reported = parts.maxAge ?? 'unset';
    logger.warn(
      `Strict-Transport-Security includes 'preload' but max-age=${reported} is below the preload-list minimum (${HSTS_PRELOAD_MIN_MAX_AGE_SECONDS} = 1 year). hstspreload.org will reject submission; raise max-age before opting into preload.`,
    );
  }
  if (!parts.includeSubDomains) {
    logger.warn(
      "Strict-Transport-Security includes 'preload' but is missing 'includeSubDomains'. " +
        'hstspreload.org requires both directives; add includeSubDomains before submitting.',
    );
  }
  return value;
}

// Cloudflare Pages and Netlify both read `_headers` at the publish-dir root
// with the same syntax (a URL pattern on its own line, then any number of
// two-space-indented `Header-Name: value` lines, rules separated by a blank
// line). Both use first-match for cache rules, so the catch-all `/*` rule
// must come last or it shadows more specific patterns and the cacheability of
// fingerprinted asset URLs is lost.
//
// Headers are sourced from `deploy.headers` (see `src/config/schema.ts`):
// `cache_rules` defines URL-pattern → Cache-Control mappings, and `security`
// defines named headers attached to the catch-all rule so site-wide policy
// lives in one place instead of being duplicated per pattern.
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

export interface HeaderEntry {
  key: string;
  value: string;
}

export interface HeaderRule {
  pattern: string;
  headers: HeaderEntry[];
}

export interface HeaderApplication {
  applyHeaders(file: string, headers: readonly HeaderEntry[]): Promise<void> | void;
}

export function buildHeadersBody(headers: HeadersConfig): string {
  return buildHeadersBodyFromRules(collectHeaderRules(headers));
}

export function buildHeadersBodyFromRules(rules: readonly HeaderRule[]): string {
  if (rules.length === 0) return '';
  return `${rules
    .map(
      ({ pattern, headers }) =>
        `${pattern}\n${headers.map(({ key, value }) => `  ${key}: ${value}`).join('\n')}`,
    )
    .join('\n\n')}\n`;
}

export function collectHeaderRules(headers: HeadersConfig): HeaderRule[] {
  const securityHeaders = collectSecurityHeaders(headers.security);
  const seen = new Set<string>();
  const ordered: HeaderRule[] = [];
  let catchAll: HeaderRule | null = null;

  for (const rule of headers.cache_rules) {
    if (seen.has(rule.pattern)) continue;
    seen.add(rule.pattern);
    const entry: HeaderRule = {
      pattern: rule.pattern,
      headers: [{ key: 'Cache-Control', value: rule.cache_control }],
    };
    if (rule.pattern === CATCH_ALL) {
      catchAll = entry;
    } else {
      ordered.push(entry);
    }
  }

  if (!catchAll && securityHeaders.length > 0) {
    catchAll = { pattern: CATCH_ALL, headers: [] };
  }
  if (catchAll) {
    catchAll.headers.push(...securityHeaders);
    ordered.push(catchAll);
  }

  return ordered;
}

export async function applyConfiguredHeaders(
  headers: HeadersConfig,
  target: HeaderApplication,
): Promise<void> {
  for (const rule of collectHeaderRules(headers)) {
    await target.applyHeaders(rule.pattern, rule.headers);
  }
}

function collectSecurityHeaders(security: HeadersConfig['security']): HeaderEntry[] {
  const lines: HeaderEntry[] = [];
  for (const { key, name } of SECURITY_HEADER_FIELDS) {
    const value = security[key];
    if (typeof value === 'string' && value.length > 0) {
      const emitted = name === 'Strict-Transport-Security' ? validateHstsForPreload(value) : value;
      lines.push({ key: name, value: emitted });
    }
  }
  for (const [name, value] of Object.entries(security.custom)) {
    if (typeof value === 'string' && value.length > 0) {
      lines.push({ key: name, value });
    }
  }
  return lines;
}

export async function writeHeadersFile(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
}): Promise<void> {
  if (!opts.enabled) return;
  await ensureDir(opts.outputDir);
  await writeFile(join(opts.outputDir, '_headers'), buildHeadersBody(opts.headers));
}

// Cache-Control TTLs (seconds) for the `/content/*` Content-API dump shards.
// Posts churn most often (a new post or a typo fix invalidates the listing),
// so they ship with a short 5-minute TTL. Tags/authors are append-only in
// practice — a new tag/author appears alongside a post commit, but the
// existing entries are stable — so they ship with a longer 1-hour TTL. The
// `/content/*` catch-all stays on the short TTL so anything not explicitly
// classified (settings, search, future shards) gets the safe default.
//
// These values are hardcoded rather than exposed as config knobs because the
// `/content/*` tree is a Nectar-specific build artifact and operators who
// want bespoke cache policy can override via `[deploy.headers].cache_rules`,
// which is appended into the same `_headers` file by the platform emitter.
export const CONTENT_API_CACHE_TTL = {
  posts: 300,
  tags: 3600,
  authors: 3600,
  catchAll: 300,
} as const;

const CORS_DIRECTIVE_LINES = [
  'Access-Control-Allow-Origin: *',
  'Access-Control-Allow-Methods: GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers: Content-Type, Authorization',
] as const;

interface ContentApiCorsRule {
  pattern: string;
  maxAge: number;
}

export function collectContentApiHeaderRules(): HeaderRule[] {
  const rules: ContentApiCorsRule[] = [
    { pattern: '/content/posts/*', maxAge: CONTENT_API_CACHE_TTL.posts },
    { pattern: '/content/tags/*', maxAge: CONTENT_API_CACHE_TTL.tags },
    { pattern: '/content/authors/*', maxAge: CONTENT_API_CACHE_TTL.authors },
    { pattern: '/content/*', maxAge: CONTENT_API_CACHE_TTL.catchAll },
  ];
  return rules.map(({ pattern, maxAge }) => ({
    pattern,
    headers: [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
      { key: 'Cache-Control', value: `public, max-age=${maxAge}` },
    ],
  }));
}

/**
 * Build the `_headers` body for the Nectar Content API `/content/*` tree.
 *
 * Emits one rule per resource so first-match platforms (Netlify, Cloudflare
 * Pages) apply the right Cache-Control TTL to each pattern. Order matters:
 * the more specific `/content/posts/*` / `/content/tags/*` /
 * `/content/authors/*` rules precede the `/content/*` catch-all so the
 * catch-all does not shadow them.
 *
 * Returned text ends in a trailing newline so callers can concatenate with
 * existing rules without dropping a blank-line separator.
 */
export function buildContentApiHeadersBody(): string {
  return `${collectContentApiHeaderRules()
    .map(({ pattern, headers }) =>
      [pattern, ...headers.map(({ key, value }) => `  ${key}: ${value}`)].join('\n'),
    )
    .join('\n\n')}\n`;
}

/**
 * Build an Apache `.htaccess` body for `dist/content/.htaccess`.
 *
 * The file lives inside the `/content/` subtree, so RewriteRule patterns are
 * relative to that directory. It mirrors the same CORS header set and TTLs as
 * `buildContentApiHeadersBody()` for self-hosted Apache deployments that do
 * not consume Netlify/Cloudflare `_headers` files.
 */
export function buildContentApiHtaccessBody(): string {
  const rules: Array<{ pattern: string; maxAge: number }> = [
    { pattern: '^posts/', maxAge: CONTENT_API_CACHE_TTL.posts },
    { pattern: '^tags/', maxAge: CONTENT_API_CACHE_TTL.tags },
    { pattern: '^authors/', maxAge: CONTENT_API_CACHE_TTL.authors },
    { pattern: '^', maxAge: CONTENT_API_CACHE_TTL.catchAll },
  ];
  const lines: string[] = [
    '# Generated by Nectar for Content API CORS.',
    '# Place this file at dist/content/.htaccess and enable AllowOverride FileInfo.',
    '<IfModule mod_rewrite.c>',
    '  RewriteEngine On',
    '  RewriteCond %{ENV:NECTAR_CONTENT_API_CACHE_MATCHED} !1',
  ];
  rules.forEach((rule, index) => {
    if (index > 0) lines.push('  RewriteCond %{ENV:NECTAR_CONTENT_API_CACHE_MATCHED} !1');
    lines.push(
      `  RewriteRule ${rule.pattern} - [E=NECTAR_CONTENT_API_CACHE_${index}:1,E=NECTAR_CONTENT_API_CACHE_MATCHED:1]`,
    );
  });
  lines.push('</IfModule>');
  lines.push('');
  lines.push('<IfModule mod_headers.c>');
  for (const line of CORS_DIRECTIVE_LINES) {
    const [name, value] = line.split(': ');
    lines.push(`  Header always set ${name} "${value}"`);
  }
  rules.forEach((rule, index) => {
    lines.push(
      `  Header set Cache-Control "public, max-age=${rule.maxAge}" env=NECTAR_CONTENT_API_CACHE_${index}`,
    );
  });
  lines.push('</IfModule>');
  return `${lines.join('\n')}\n`;
}
