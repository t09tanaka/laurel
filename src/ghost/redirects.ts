import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Ghost's custom-redirects feature persists rules to
// `<export>/content/data/redirects.json`. The shipped format is a flat array of
// rules; some Ghost versions group rules by status code (`{ "301": [...] }`)
// when written by older admin tooling. Both shapes carry the same
// `{from, to, permanent}` triple, so we normalize at the boundary and keep the
// rest of the emit pipeline format-agnostic.
interface GhostRedirectRule {
  from: string;
  to: string;
  permanent: boolean;
}

interface RawArrayEntry {
  from?: unknown;
  to?: unknown;
  permanent?: unknown;
}

// Read `<assetsRoot>/data/redirects.json` if present. Returns an empty array
// when the file is missing — redirects are optional in Ghost exports and most
// blogs don't define any custom redirects.
export async function loadRedirectsJson(assetsRoot: string): Promise<GhostRedirectRule[]> {
  const path = join(assetsRoot, 'data', 'redirects.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `Failed to parse redirects.json at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  return normalizeRedirects(parsed);
}

export function normalizeRedirects(parsed: unknown): GhostRedirectRule[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((r) => toRule(r, undefined));
  }
  if (parsed && typeof parsed === 'object') {
    const out: GhostRedirectRule[] = [];
    for (const [code, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      const permanentDefault = code === '301' ? true : code === '302' ? false : undefined;
      for (const entry of entries) {
        out.push(...toRule(entry, permanentDefault));
      }
    }
    return out;
  }
  return [];
}

function toRule(entry: unknown, permanentDefault: boolean | undefined): GhostRedirectRule[] {
  if (!entry || typeof entry !== 'object') return [];
  const e = entry as RawArrayEntry;
  if (typeof e.from !== 'string' || typeof e.to !== 'string') return [];
  if (e.from.length === 0 || e.to.length === 0) return [];
  const permanent =
    typeof e.permanent === 'boolean'
      ? e.permanent
      : permanentDefault !== undefined
        ? permanentDefault
        : true;
  return [{ from: e.from, to: e.to, permanent }];
}

// Strip `^...$` anchor markers Ghost uses in its regex-style `from` patterns.
// Static hosts like Netlify and Vercel want literal paths, not regex; trimming
// the anchors recovers a usable path for the common case where the rule was
// just a literal match all along. Patterns with remaining regex syntax (`*`,
// `?`, `+`, character classes, capture groups) are returned as-is — the
// downstream emitter logs a warning and lets the user adapt those by hand.
export function simplifyFromPattern(from: string): string {
  let s = from;
  if (s.startsWith('^')) s = s.slice(1);
  if (s.endsWith('$')) s = s.slice(0, -1);
  // Ghost stores escaped forward slashes (`\/`) when the rule originated from
  // the admin UI's regex builder; un-escape them so the path renders cleanly.
  s = s.replace(/\\\//g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

function looksLikeRegex(s: string): boolean {
  return /[(){}\[\]*+?|\\]/.test(s);
}

export function emitNetlifyRedirects(rules: GhostRedirectRule[]): string {
  if (rules.length === 0) return '';
  const lines = ['# Migrated from Ghost custom redirects (content/data/redirects.json)'];
  for (const r of rules) {
    const from = simplifyFromPattern(r.from);
    const status = r.permanent ? 301 : 302;
    if (looksLikeRegex(from)) {
      lines.push(`# WARN: regex pattern, adapt manually: ${r.from} -> ${r.to}`);
      continue;
    }
    lines.push(`${from}  ${r.to}  ${status}`);
  }
  return `${lines.join('\n')}\n`;
}

export function emitVercelRedirects(rules: GhostRedirectRule[]): string {
  const redirects: Array<{ source: string; destination: string; permanent: boolean }> = [];
  const warnings: string[] = [];
  for (const r of rules) {
    const source = simplifyFromPattern(r.from);
    if (looksLikeRegex(source)) {
      warnings.push(`${r.from} -> ${r.to}`);
      continue;
    }
    redirects.push({ source, destination: r.to, permanent: r.permanent });
  }
  const body: Record<string, unknown> = { redirects };
  if (warnings.length > 0) {
    body._comment = `Skipped ${warnings.length} regex pattern(s); adapt manually: ${warnings.join('; ')}`;
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function emitNginxRedirects(rules: GhostRedirectRule[]): string {
  if (rules.length === 0) return '';
  const lines = ['# Migrated from Ghost custom redirects (content/data/redirects.json)'];
  for (const r of rules) {
    const flag = r.permanent ? 'permanent' : 'redirect';
    // nginx's `rewrite` accepts a regex on the left side. Pass Ghost's `from`
    // through as-is — Ghost already stored regex syntax, and nginx is happy to
    // consume it. The `to` is escaped to keep stray spaces out.
    const to = r.to.replace(/\s+/g, '%20');
    lines.push(`rewrite ${r.from} ${to} ${flag};`);
  }
  return `${lines.join('\n')}\n`;
}

export interface SlugChange {
  oldSlug: string;
  newSlug: string;
  kind: 'post' | 'page' | 'tag' | 'author';
}

// Derive redirect rules for posts/pages/tags/authors whose Ghost slug had to be
// rewritten by `safeSlug()` (e.g. uppercase chars stripped, traversal removed).
// Without these, links to the old Ghost URLs would 404 after migration.
export function slugChangesToRules(changes: SlugChange[]): GhostRedirectRule[] {
  const rules: GhostRedirectRule[] = [];
  for (const c of changes) {
    if (c.oldSlug === c.newSlug) continue;
    const { fromPath, toPath } = slugPaths(c.kind, c.oldSlug, c.newSlug);
    rules.push({ from: fromPath, to: toPath, permanent: true });
  }
  return rules;
}

function slugPaths(
  kind: SlugChange['kind'],
  oldSlug: string,
  newSlug: string,
): { fromPath: string; toPath: string } {
  switch (kind) {
    case 'post':
    case 'page':
      return { fromPath: `/${oldSlug}/`, toPath: `/${newSlug}/` };
    case 'tag':
      return { fromPath: `/tag/${oldSlug}/`, toPath: `/tag/${newSlug}/` };
    case 'author':
      return { fromPath: `/author/${oldSlug}/`, toPath: `/author/${newSlug}/` };
  }
}

interface WriteRedirectMapsOptions {
  cwd: string;
  outDir?: string;
  customRedirects: GhostRedirectRule[];
  slugChanges: SlugChange[];
  dryRun: boolean;
}

interface RedirectMapsResult {
  customCount: number;
  slugCount: number;
  // Absolute paths the import either wrote or would have written. Empty when
  // there were no rules to emit (the import shouldn't drop empty files just to
  // signal "no redirects found").
  written: string[];
}

export async function writeRedirectMaps(
  opts: WriteRedirectMapsOptions,
): Promise<RedirectMapsResult> {
  const slugRules = slugChangesToRules(opts.slugChanges);
  const allRules = [...opts.customRedirects, ...slugRules];
  if (allRules.length === 0) {
    return { customCount: 0, slugCount: slugRules.length, written: [] };
  }
  const outDir = opts.outDir ?? join(opts.cwd, 'migration', 'redirects');
  const netlify = join(outDir, '_redirects');
  const vercel = join(outDir, 'vercel.json');
  const nginx = join(outDir, 'nginx.conf');
  const written = [netlify, vercel, nginx];
  if (!opts.dryRun) {
    await ensureDir(dirname(netlify));
    await Promise.all([
      Bun.write(netlify, emitNetlifyRedirects(allRules)),
      Bun.write(vercel, emitVercelRedirects(allRules)),
      Bun.write(nginx, emitNginxRedirects(allRules)),
    ]);
  }
  return {
    customCount: opts.customRedirects.length,
    slugCount: slugRules.length,
    written,
  };
}
