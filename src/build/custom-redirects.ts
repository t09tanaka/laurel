import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ensureDir } from '~/util/fs.ts';

// Cloudflare Pages reads `_redirects` at the build-output root with the same
// line-oriented syntax as Netlify (`<from>  <to>  <status>`) and resolves rules
// with **first-match precedence**, so the order of lines matters. We surface a
// single shared `redirects.yaml` at the project root so that a future Netlify
// or Vercel emitter can read the same source of truth without re-stating the
// rules per host.
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
  })
  .strict();

const redirectsFileSchema = z.array(redirectRuleSchema);

export type RedirectStatus = z.infer<typeof redirectStatusSchema>;
export type CustomRedirectRule = z.infer<typeof redirectRuleSchema>;

export async function loadCustomRedirects(cwd: string): Promise<CustomRedirectRule[]> {
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

// Drop later rules that repeat an earlier `from`. Cloudflare Pages and Netlify
// resolve `_redirects` with first-match semantics, so a second entry sharing
// the same source path can never fire and is almost always a copy/paste bug.
// Keeping the first occurrence preserves the author's intended priority order.
export function collapseRedirectRules(rules: readonly CustomRedirectRule[]): CustomRedirectRule[] {
  const seen = new Set<string>();
  const out: CustomRedirectRule[] = [];
  for (const r of rules) {
    if (seen.has(r.from)) continue;
    seen.add(r.from);
    out.push(r);
  }
  return out;
}

export function formatRedirectsBody(rules: readonly CustomRedirectRule[]): string {
  const lines = ['# Custom redirects (from redirects.yaml)'];
  for (const r of rules) {
    lines.push(`${r.from}  ${r.to}  ${r.status}`);
  }
  return `${lines.join('\n')}\n`;
}

// Emit `_redirects` from `redirects.yaml`, gated by Cloudflare Pages because
// `_redirects` is the file Cloudflare consumes. The Content API shadows may
// have written API-routing rules to the same file first; we **prepend** our
// custom rules so first-match precedence resolves user intent over internal
// SDK routing on overlap.
export async function emitCustomRedirects(opts: {
  outputDir: string;
  cwd: string;
  enabled: boolean;
}): Promise<void> {
  if (!opts.enabled) return;
  const rules = collapseRedirectRules(await loadCustomRedirects(opts.cwd));
  if (rules.length === 0) return;
  await ensureDir(opts.outputDir);
  const path = join(opts.outputDir, '_redirects');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    // pristine output — nothing to merge with
  }
  const body = formatRedirectsBody(rules);
  const merged = existing ? `${body}\n${existing.replace(/^\n+/, '')}` : body;
  await writeFile(path, merged);
}
