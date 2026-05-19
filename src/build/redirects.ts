import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

// Cross-cutting `redirects.yaml` schema. Ghost exports persist custom redirects
// as a JSON list with `{from, to, permanent}`; Nectar consumes the same idea as
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
