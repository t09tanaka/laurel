import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type HeadersConfig, writeHeadersFile } from './headers.ts';
import { type RedirectRule, collapseRedirects } from './redirects.ts';

export async function emitNetlifyHeaders(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
}): Promise<void> {
  await writeHeadersFile(opts);
}

// Netlify `_redirects` accepts the same `from  to  status` shape as Cloudflare
// Pages, but distinguishes "force" rules with a `!` suffix on the status code
// (`301!`). Force fires even when a static file exists at `from`; without it
// Netlify falls through to the file. Cloudflare Pages always treats redirects
// as forced and ignores the marker, so the `!` flag is meaningful only on
// Netlify and must not be dropped when emitting here.
export function formatNetlifyRedirectsBody(rules: readonly RedirectRule[]): string {
  const lines = ['# Custom redirects (from redirects.yaml)'];
  for (const r of rules) {
    const status = r.force ? `${r.status}!` : `${r.status}`;
    lines.push(`${r.from}  ${r.to}  ${status}`);
  }
  return `${lines.join('\n')}\n`;
}

// Prepend Netlify-formatted custom rules before any existing `_redirects`
// entries so first-match precedence resolves user intent over internal SDK
// routing (the Content API shadow emitter writes API rules to the same file
// when enabled). Mirrors `emitCustomRedirects` for Cloudflare Pages.
export async function emitNetlifyRedirects(opts: {
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
  const body = formatNetlifyRedirectsBody(rules);
  const merged = existing ? `${body}\n${existing.replace(/^\n+/, '')}` : body;
  await writeFile(path, merged);
}
