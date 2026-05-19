import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type RedirectRule, collapseRedirects, loadRedirects } from './redirects.ts';

// Re-export the canonical loader under the legacy name so existing callers
// (and tests) keep working while the pipeline migrates to passing pre-loaded
// rules.
export type RedirectStatus = RedirectRule['status'];
export type CustomRedirectRule = RedirectRule;
export const loadCustomRedirects = loadRedirects;
export const collapseRedirectRules = collapseRedirects;

export function formatRedirectsBody(rules: readonly RedirectRule[]): string {
  const lines = ['# Custom redirects (from redirects.yaml)'];
  for (const r of rules) {
    // Cloudflare Pages always treats redirects as forced, so `force` is
    // informational here. Other emitters (e.g. Netlify) will translate the
    // flag into their native marker.
    lines.push(`${r.from}  ${r.to}  ${r.status}`);
  }
  return `${lines.join('\n')}\n`;
}

// Emit `_redirects` from the canonical rule list, gated by Cloudflare Pages
// because `_redirects` is the file Cloudflare consumes. The Content API
// shadows may have written API-routing rules to the same file first; we
// **prepend** our custom rules so first-match precedence resolves user intent
// over internal SDK routing on overlap.
export async function emitCustomRedirects(opts: {
  outputDir: string;
  rules: readonly RedirectRule[];
  enabled: boolean;
}): Promise<void> {
  if (!opts.enabled) return;
  const rules = collapseRedirects(opts.rules);
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
