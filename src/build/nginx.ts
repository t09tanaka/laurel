import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import type { HeadersConfig } from './headers.ts';
import { type RedirectRule, type RedirectStatus, collapseRedirects } from './redirects.ts';

// Self-hosted nginx is the most common destination after migrating off Ghost
// (which itself runs on a Ghost-CLI managed nginx). Unlike Cloudflare Pages,
// Netlify, or Vercel, nginx has no `_headers` / `_redirects` convention: every
// behavior is expressed through `add_header`, `return`, and `location` blocks
// inside a `server { ... }` config. This emitter folds the same cross-cutting
// inputs (`deploy.headers` + `redirects.yaml`) into a single server block so
// the rules stay byte-equivalent across deploy targets.
//
// The emitted file lands at `<outputDir>/.laurel/nginx.conf` rather than the
// publish root because nginx never serves `.conf` files to clients — keeping
// it under `.laurel/` makes the artifact obviously a build by-product and
// avoids any chance of leaking the configuration over HTTP. The operator
// `include`s the file from their main nginx config:
//
//   include /var/www/laurel/.laurel/nginx.conf;

const CATCH_ALL = '/*';
const NOT_FOUND_PATH = '/404.html';
const HEALTHCHECK_PATH = '/healthz';

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

interface HeaderEntry {
  name: string;
  value: string;
}

interface LocationBlock {
  // The full `location` directive head (e.g. `location ^~ /assets/` or
  // `location /`). Emitted as-is, so caller controls the matching modifier.
  head: string;
  cacheControl: string | null;
}

function collectSecurityHeaders(security: HeadersConfig['security']): HeaderEntry[] {
  const entries: HeaderEntry[] = [];
  for (const { key, name } of SECURITY_HEADER_FIELDS) {
    const value = security[key];
    if (typeof value === 'string' && value.length > 0) {
      entries.push({ name, value });
    }
  }
  for (const [name, value] of Object.entries(security.custom)) {
    if (typeof value === 'string' && value.length > 0) {
      entries.push({ name, value });
    }
  }
  return entries;
}

// Translate a glob-style URL pattern from `deploy.headers.cache_rules` into the
// nginx `location` directive head with the right matching modifier. Trailing
// `*` becomes a prefix match (`^~`) so nginx short-circuits regex matching for
// fingerprinted asset paths; an embedded `*` inside the path falls back to a
// case-insensitive regex location. The plain catch-all `/*` collapses to the
// implicit `location /` block so it acts as the default fallthrough rather
// than competing with more specific prefixes.
export function toNginxLocationHead(pattern: string): string {
  if (pattern === CATCH_ALL) return 'location /';
  if (pattern.endsWith('/*') && !pattern.slice(0, -2).includes('*')) {
    return `location ^~ ${pattern.slice(0, -1)}`;
  }
  if (!pattern.includes('*')) {
    return `location = ${pattern}`;
  }
  // Embedded wildcard: fall back to regex. `*` translates to `.*` and the
  // pattern is anchored at the start so the location only matches paths that
  // begin with the prefix the author wrote.
  const regex = `^${pattern.replace(/\*/g, '.*')}`;
  return `location ~* ${regex}`;
}

// Translate a redirect `from` pattern into a `location` directive head. Exact
// paths use `location =` so nginx serves the redirect with O(1) hash lookup;
// patterns containing `*` fall back to a regex location with `.*` substitution.
// The `to` destination is emitted verbatim by the caller — wildcard captures
// are not interpolated, which matches the behavior of the other emitters
// (`vercel.json`, Cloudflare Pages `_redirects`).
function toRedirectLocationHead(from: string): string {
  if (!from.includes('*')) return `location = ${from}`;
  const regex = `^${from.replace(/\*/g, '.*')}$`;
  return `location ~ ${regex}`;
}

function nginxStatusFlag(status: RedirectStatus): string {
  // Map RFC redirect codes to nginx `return` arguments. `return 301` and
  // `return 302` both accept a URI directly. 307 and 308 are passed through
  // identically; nginx >= 1.13 emits the right status line for either.
  return String(status);
}

interface BuildNginxOptions {
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
  // Filesystem root nginx should serve from. Operators typically point this at
  // their `dist/` path. Defaults to `/var/www/laurel` so the emitted file is
  // immediately copy-pasteable for the common deploy layout described in
  // `docs/migration/ghost.md` (rsync `dist/` to a single VPS).
  root?: string;
  // Hostname pattern bound to the server block. Defaults to `_` (the nginx
  // catch-all) so the snippet works on a fresh VPS without editing. Operators
  // serving multiple sites override this to the site's actual hostname.
  serverName?: string;
}

export function buildNginxServerBlock(opts: BuildNginxOptions): string {
  const root = opts.root ?? '/var/www/laurel';
  const serverName = opts.serverName ?? '_';
  const securityHeaders = collectSecurityHeaders(opts.headers.security);
  const locations = collectLocationBlocks(opts.headers);
  const redirects = collapseRedirects(opts.rules);

  const lines: string[] = [];
  lines.push('# Generated by Laurel from redirects.yaml + deploy.headers.');
  lines.push('# Include this server block from the main nginx config:');
  lines.push(`#   include ${root}/.laurel/nginx.conf;`);
  lines.push('server {');
  lines.push('    listen 80;');
  lines.push('    listen [::]:80;');
  lines.push(`    server_name ${serverName};`);
  lines.push(`    root ${root};`);
  lines.push('    index index.html;');
  lines.push('');
  lines.push('    etag on;');
  lines.push('');
  // `gzip_static` / `brotli_static` let nginx serve pre-compressed `.gz` /
  // `.br` siblings without re-compressing on every request. The `always`
  // qualifier on `gzip_static` would be `always` but here the directive only
  // takes `on/off/always`; `on` is the right default — operators flip to
  // `always` when they pre-compress every asset including HTML.
  lines.push('    gzip_static on;');
  lines.push('    brotli_static on;');
  lines.push('');
  lines.push(`    error_page 404 ${NOT_FOUND_PATH};`);

  if (redirects.length > 0) {
    lines.push('');
    lines.push('    # Redirects (from redirects.yaml; first-match)');
    for (const r of redirects) {
      const head = toRedirectLocationHead(r.from);
      lines.push(`    ${head} { return ${nginxStatusFlag(r.status)} ${r.to}; }`);
    }
  }

  lines.push('');
  lines.push(`    location = ${HEALTHCHECK_PATH} {`);
  lines.push('        access_log off;');
  lines.push('        default_type text/plain;');
  lines.push('        return 200 "ok\\n";');
  lines.push('    }');

  lines.push('');
  lines.push(`    location = ${NOT_FOUND_PATH} {`);
  pushHeaders(lines, collectNotFoundCacheControl(opts.headers), securityHeaders);
  lines.push('        internal;');
  lines.push(`        try_files ${NOT_FOUND_PATH} =404;`);
  lines.push('    }');

  for (const loc of locations) {
    lines.push('');
    lines.push(`    ${loc.head} {`);
    // nginx `add_header` does NOT merge with parent blocks — once a `location`
    // declares any `add_header`, the server-level headers are dropped for that
    // location. Repeating security headers in every emitted block is the
    // simplest way to keep them attached to every response.
    pushHeaders(lines, loc.cacheControl, securityHeaders);
    // `$uri/` between the literal path and the explicit `index.html` lookup
    // is the trailing-slash variant: when the request is `/about`, nginx tries
    // `/about` (file), then `/about/` (directory — which triggers the `index`
    // directive's redirect to `/about/index.html` with a 301 to the canonical
    // trailing-slash URL), and only then `/about/index.html` directly. Without
    // `$uri/` the request would still resolve content via `$uri/index.html`
    // but skip the directory-style internal redirect, so links that depend on
    // a canonical trailing slash (relative URLs inside the served HTML) break.
    lines.push('        try_files $uri $uri/ $uri/index.html =404;');
    lines.push('    }');
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

// nginx's quoted-string syntax treats `"` and `\` specially. Most real-world
// header values (Cache-Control, Permissions-Policy, CSP) contain none of
// either, but escaping defensively means a CSP with embedded quotes can't
// silently corrupt the config.
function escapeNginxValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function pushHeaders(lines: string[], cacheControl: string | null, securityHeaders: HeaderEntry[]) {
  if (cacheControl !== null) {
    lines.push(`        add_header Cache-Control "${cacheControl}" always;`);
  }
  for (const h of securityHeaders) {
    lines.push(`        add_header ${h.name} "${escapeNginxValue(h.value)}" always;`);
  }
}

function collectNotFoundCacheControl(headers: HeadersConfig): string | null {
  const explicit = headers.cache_rules.find((rule) => rule.pattern === NOT_FOUND_PATH);
  if (explicit) return explicit.cache_control;
  const catchAll = headers.cache_rules.find((rule) => rule.pattern === CATCH_ALL);
  return catchAll?.cache_control ?? null;
}

function collectLocationBlocks(headers: HeadersConfig): LocationBlock[] {
  const seen = new Set<string>();
  const ordered: LocationBlock[] = [];
  let catchAll: LocationBlock | null = null;
  let sawCatchAllInCacheRules = false;

  for (const rule of headers.cache_rules) {
    if (rule.pattern === NOT_FOUND_PATH) continue;
    if (seen.has(rule.pattern)) continue;
    seen.add(rule.pattern);
    const block: LocationBlock = {
      head: toNginxLocationHead(rule.pattern),
      cacheControl: rule.cache_control,
    };
    if (rule.pattern === CATCH_ALL) {
      catchAll = block;
      sawCatchAllInCacheRules = true;
    } else {
      ordered.push(block);
    }
  }

  // Always emit a `location /` block even when the operator did not include a
  // catch-all cache rule, so security headers + `try_files` apply to every
  // request rather than disappearing when `cache_rules` is empty.
  if (!sawCatchAllInCacheRules) {
    catchAll = { head: 'location /', cacheControl: null };
  }
  if (catchAll) ordered.push(catchAll);

  return ordered;
}

export async function emitNginxConf(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
  rules: readonly RedirectRule[];
  root?: string;
  serverName?: string;
}): Promise<void> {
  if (!opts.enabled) return;
  const body = buildNginxServerBlock({
    headers: opts.headers,
    rules: opts.rules,
    root: opts.root,
    serverName: opts.serverName,
  });
  const targetDir = join(opts.outputDir, '.laurel');
  await ensureDir(targetDir);
  await writeFile(join(targetDir, 'nginx.conf'), body);
}
