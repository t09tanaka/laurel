import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type RedirectRule, collapseRedirects } from './redirects.ts';

// Component-level redirects emit. Unlike the platform-specific emitters
// (Cloudflare Pages, Netlify, Vercel, nginx) which only fire when their deploy
// target is enabled, this one emits an unconditional `_redirects` (Netlify /
// Cloudflare Pages format: `<from>  <to>  <status>`) whenever rules exist and
// the `[components.redirects]` toggle is on. That covers the common Ghost
// migration case where the user wants `content/data/redirects.yaml` preserved
// in the output regardless of which host they end up on.
//
// `emit_html: true` is the opt-in fallback for hosts that don't honor a
// `_redirects` file (GitHub Pages, S3 static-website without redirection
// rules, plain Apache without mod_rewrite). One static HTML file per rule is
// written to `<output>/<from>/index.html` with a `<meta http-equiv="refresh">`
// header and an anchor fallback. Browsers honor the meta refresh; HTTP-level
// status codes are not preserved (every redirect becomes a 200 + client-side
// jump) which is the standard trade-off for static HTML redirects.

export interface EmitRedirectsComponentOptions {
  outputDir: string;
  rules: readonly RedirectRule[];
  enabled: boolean;
  emitHtml: boolean;
}

const HEADER = '# Custom redirects (from content/data/redirects.yaml or redirects.yaml)';

export function formatRedirectsFile(rules: readonly RedirectRule[]): string {
  const lines = [HEADER];
  for (const r of rules) {
    // Netlify and Cloudflare Pages both accept `<from>  <to>  <status>`; the
    // Netlify-specific `!` force suffix is emitted by the dedicated Netlify
    // emitter, not here, because this file is the lowest-common-denominator
    // shared with Cloudflare Pages.
    lines.push(`${r.from}  ${r.to}  ${r.status}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function emitRedirectsComponent(opts: EmitRedirectsComponentOptions): Promise<void> {
  if (!opts.enabled) return;
  const rules = collapseRedirects(opts.rules);
  if (rules.length === 0) return;
  await ensureDir(opts.outputDir);
  await writeRedirectsFile(opts.outputDir, rules);
  if (opts.emitHtml) {
    await writeHtmlRedirects(opts.outputDir, rules);
  }
}

async function writeRedirectsFile(outputDir: string, rules: RedirectRule[]): Promise<void> {
  const path = join(outputDir, '_redirects');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    // pristine output — nothing to merge with
  }
  // Drop a prior header block we wrote on an earlier build so re-running
  // doesn't accrete duplicate `# Custom redirects ...` banners.
  const cleaned = stripPriorBlock(existing);
  const body = formatRedirectsFile(rules);
  const merged = cleaned.length > 0 ? `${body}\n${cleaned.replace(/^\n+/, '')}` : body;
  await writeFile(path, merged);
}

function stripPriorBlock(content: string): string {
  if (!content.includes(HEADER)) return content;
  const lines = content.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line === HEADER) {
      skipping = true;
      continue;
    }
    if (skipping) {
      // A blank line or a `#`-prefixed line that isn't ours ends the prior
      // block. Rules emitted by this component never start with `#`, so the
      // first such line is treated as the boundary.
      if (line.length === 0 || (line.startsWith('#') && line !== HEADER)) {
        skipping = false;
        out.push(line);
        continue;
      }
      // Still inside the prior block (a previously emitted rule line) — skip.
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/^\n+/, '');
}

async function writeHtmlRedirects(outputDir: string, rules: RedirectRule[]): Promise<void> {
  for (const r of rules) {
    const relative = stripLeadingSlash(r.from);
    // Path-traversal / absolute-destination guard. A `from` like `..` or
    // `/etc/passwd` would let an attacker write an HTML file outside the
    // publish root. Skip with a warn rather than throwing so one bad rule
    // doesn't block the whole build.
    if (relative.length === 0 || relative.includes('..') || relative.includes('\\')) {
      continue;
    }
    const filePath = relative.endsWith('/')
      ? join(outputDir, relative, 'index.html')
      : join(outputDir, relative, 'index.html');
    await ensureDir(dirname(filePath));
    await writeFile(filePath, htmlRedirectBody(r));
  }
}

function stripLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s;
}

function htmlRedirectBody(rule: RedirectRule): string {
  const to = escapeHtml(rule.to);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>Redirecting to ${to}</title>`,
    `<meta http-equiv="refresh" content="0; url=${to}">`,
    `<link rel="canonical" href="${to}">`,
    '<meta name="robots" content="noindex">',
    '</head>',
    '<body>',
    `<p>Redirecting to <a href="${to}">${to}</a>.</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
