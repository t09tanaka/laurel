import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { TrailingSlashPolicy } from '~/build/routes-yaml.ts';
import type { RouteContext } from '~/render/types.ts';
import { logger } from '~/util/logger.ts';
import { withBasePath } from '~/util/url.ts';

// Cross-cutting `redirects.yaml` schema. Ghost exports persist custom redirects
// as a JSON list with `{from, to, permanent}`; Laurel consumes the same idea as
// a YAML file at the project root and re-exposes it to every deploy target
// emitter (Cloudflare Pages `_redirects`, Netlify `_redirects`, Vercel
// `vercel.json`, Apache `.htaccess`, nginx `try_files`, S3 routing rules). The
// pipeline loads this file **once** and hands the parsed rules to each
// emitter so there is exactly one source of truth and the rules stay
// byte-identical across platforms.
const redirectStatusSchema = z.union([
  z.literal(301),
  z.literal(302),
  z.literal(307),
  z.literal(308),
]);

const redirectRuleSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    status: redirectStatusSchema.default(301),
    // Netlify `_redirects` distinguishes "force" rules (`301!`) which fire even
    // when a static file exists at `from`, from default rules which fall
    // through to the file. Cloudflare Pages always treats redirects as forced
    // so the flag is a no-op there. Store it on the canonical rule so
    // platform-specific emitters can translate it without re-parsing the file.
    force: z.boolean().default(false),
  })
  .strict();

const redirectsFileSchema = z.array(redirectRuleSchema);

export type RedirectStatus = z.infer<typeof redirectStatusSchema>;
export type RedirectRule = z.infer<typeof redirectRuleSchema>;

export async function loadRedirects(cwd: string): Promise<RedirectRule[]> {
  for (const name of ['redirects.yaml', 'redirects.yml']) {
    const path = join(cwd, name);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // An empty file or a file with only comments parses to `null`. Treat that
    // as "no rules" rather than a schema error so authoring an empty file is
    // not load-bearing.
    if (parsed == null) return [];
    const result = redirectsFileSchema.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.errors
        .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
        .join('; ');
      throw new Error(`Invalid ${name}: ${detail}`);
    }
    return result.data;
  }
  return [];
}

// Drop later rules that repeat an earlier `from`. Every target we emit to
// (Cloudflare Pages, Netlify, Vercel) resolves rules with first-match
// semantics, so a second entry sharing the same source path can never fire and
// is almost always a copy/paste bug. Keeping the first occurrence preserves
// the author's intended priority order.
export function collapseRedirects(rules: readonly RedirectRule[]): RedirectRule[] {
  const seen = new Set<string>();
  const out: RedirectRule[] = [];
  for (const r of rules) {
    if (seen.has(r.from)) continue;
    seen.add(r.from);
    out.push(r);
  }
  return out;
}

export function buildTrailingSlashRedirects(opts: {
  routes: readonly RouteContext[];
  policy: TrailingSlashPolicy;
  basePath: string;
}): RedirectRule[] {
  if (opts.policy === 'preserve') return [];
  const out: RedirectRule[] = [];
  const seen = new Set<string>();
  for (const route of opts.routes) {
    const from = alternateTrailingSlashUrl(route.url, opts.policy);
    if (from === undefined) continue;
    const fromWithBasePath = withBasePath(opts.basePath, from);
    if (seen.has(fromWithBasePath)) continue;
    seen.add(fromWithBasePath);
    out.push({
      from: fromWithBasePath,
      to: withBasePath(opts.basePath, route.url),
      status: 308,
      force: true,
    });
  }
  return out;
}

function alternateTrailingSlashUrl(url: string, policy: TrailingSlashPolicy): string | undefined {
  if (url === '/') return undefined;
  const trimmed = url.endsWith('/') ? url.slice(0, -1) : url;
  const lastSegment = trimmed.split('/').pop() ?? '';
  if (lastSegment.includes('.')) return undefined;
  if (policy === 'always') return url.endsWith('/') ? trimmed : undefined;
  return url.endsWith('/') ? undefined : `${url}/`;
}

// Ghost-compat loader. Ghost persists custom redirects under
// `<export>/content/data/redirects.{yaml,yml,json}`. Two on-disk shapes ship
// in the wild:
//
//   1. Modern (Ghost 3+): a flat array of `{from, to, permanent?}` entries.
//      `permanent: true` -> 301, otherwise 302.
//
//   2. Status-grouped (older admin tooling, also documented in Ghost's
//      migration guide):
//        301:
//          - from: /old-url
//            to: /new-url
//        302:
//          - from: /old-2
//            to: /new-2
//
// Either shape is normalized to the same canonical `RedirectRule[]` the rest
// of the build pipeline consumes. Invalid entries (missing `from`/`to`, bogus
// status keys, non-array values) are warned and skipped instead of failing the
// build — a single typo in a migrated export shouldn't break the whole site.
const GHOST_REDIRECT_FILENAMES = ['redirects.yaml', 'redirects.yml', 'redirects.json'] as const;

export async function loadGhostStyleRedirects(cwd: string): Promise<RedirectRule[]> {
  for (const name of GHOST_REDIRECT_FILENAMES) {
    const path = join(cwd, 'content', 'data', name);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = name.endsWith('.json') ? JSON.parse(raw) : Bun.YAML.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse ${join('content', 'data', name)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (parsed == null) return [];
    return normalizeGhostRedirects(parsed, join('content', 'data', name));
  }
  return [];
}

interface RawGhostEntry {
  from?: unknown;
  to?: unknown;
  permanent?: unknown;
  status?: unknown;
  force?: unknown;
}

export function normalizeGhostRedirects(parsed: unknown, source = 'redirects'): RedirectRule[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry, i) => toCanonicalRule(entry, undefined, `${source}[${i}]`));
  }
  if (parsed && typeof parsed === 'object') {
    const out: RedirectRule[] = [];
    for (const [key, entries] of Object.entries(parsed as Record<string, unknown>)) {
      const status = coerceStatus(key);
      if (status == null) {
        logger.warn(`Skipping unknown status key "${key}" in ${source}`);
        continue;
      }
      if (!Array.isArray(entries)) {
        logger.warn(`Skipping non-array value under "${key}" in ${source}`);
        continue;
      }
      entries.forEach((entry, i) => {
        out.push(...toCanonicalRule(entry, status, `${source}.${key}[${i}]`));
      });
    }
    return out;
  }
  logger.warn(`Skipping ${source}: expected an array or status-keyed object`);
  return [];
}

function coerceStatus(key: string): RedirectStatus | null {
  const n = Number(key);
  if (n === 301 || n === 302 || n === 307 || n === 308) return n;
  return null;
}

function toCanonicalRule(
  entry: unknown,
  defaultStatus: RedirectStatus | undefined,
  origin: string,
): RedirectRule[] {
  if (!entry || typeof entry !== 'object') {
    logger.warn(`Skipping non-object entry at ${origin}`);
    return [];
  }
  const e = entry as RawGhostEntry;
  if (typeof e.from !== 'string' || e.from.length === 0) {
    logger.warn(`Skipping entry at ${origin}: missing or empty "from"`);
    return [];
  }
  if (typeof e.to !== 'string' || e.to.length === 0) {
    logger.warn(`Skipping entry at ${origin}: missing or empty "to"`);
    return [];
  }
  // `status` on the entry wins over the parent status key (e.g. the nested form
  // explicitly opted out for one rule). Falls back to `permanent: bool` (Ghost
  // legacy: true => 301, false => 302), then the parent status key, then 302
  // (Ghost's default when neither is present).
  let status: RedirectStatus;
  if (e.status != null) {
    const explicit = coerceStatus(String(e.status));
    if (explicit == null) {
      logger.warn(`Skipping entry at ${origin}: unsupported status ${String(e.status)}`);
      return [];
    }
    status = explicit;
  } else if (typeof e.permanent === 'boolean') {
    status = e.permanent ? 301 : 302;
  } else if (defaultStatus !== undefined) {
    status = defaultStatus;
  } else {
    status = 302;
  }
  const force = typeof e.force === 'boolean' ? e.force : false;
  return [{ from: e.from, to: e.to, status, force }];
}

// Aggregate loader: pull rules from both the canonical project-root file and
// the Ghost-style `content/data/` location. Project-root rules win on `from`
// collisions because `collapseRedirects` keeps the first occurrence; rules
// authored by hand should override migrated ones from a Ghost export.
export async function loadAllRedirects(cwd: string): Promise<RedirectRule[]> {
  const [root, ghost] = await Promise.all([loadRedirects(cwd), loadGhostStyleRedirects(cwd)]);
  return [...root, ...ghost];
}
