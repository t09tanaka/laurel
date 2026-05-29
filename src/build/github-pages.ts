import { writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type RedirectRule, collapseRedirects } from './redirects.ts';

interface EmitGithubPagesRedirectsOptions {
  outputDir: string;
  enabled: boolean;
  basePath: string;
  rules: readonly RedirectRule[];
}

export async function emitGithubPagesRedirects(
  opts: EmitGithubPagesRedirectsOptions,
): Promise<void> {
  if (!opts.enabled) return;

  for (const rule of collapseRedirects(opts.rules)) {
    const outputPath = githubPagesRedirectOutputPath(rule.from, opts.basePath);
    if (outputPath == null) continue;

    const target = githubPagesRedirectTarget(rule.to, opts.basePath);
    const filePath = join(opts.outputDir, outputPath);
    await ensureDir(dirname(filePath));
    await writeFile(filePath, githubPagesRedirectHtml(target));
  }
}

export function githubPagesRedirectOutputPath(from: string, basePath: string): string | undefined {
  const source = normalizeGithubPagesSourcePath(from, basePath);
  if (source == null) return undefined;

  const relative = source.replace(/^\/+/, '').replace(/\/+$/, '');
  if (relative.length === 0) return undefined;

  const segments = relative.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))) {
    return undefined;
  }
  if (segments.some((segment) => segment.includes('*'))) return undefined;

  const basename = posix.basename(relative);
  if (posix.extname(basename).length > 0) {
    return relative;
  }
  return posix.join(relative, 'index.html');
}

export function githubPagesRedirectTarget(to: string, basePath: string): string {
  if (to.startsWith('//')) return to;
  if (!to.startsWith('/') || basePath === '/') return to;

  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const baseWithoutTrailingSlash = normalizedBase.replace(/\/+$/, '');
  if (to === baseWithoutTrailingSlash || to.startsWith(normalizedBase)) return to;
  if (to === '/') return normalizedBase;
  return `${baseWithoutTrailingSlash}${to}`;
}

function normalizeGithubPagesSourcePath(from: string, basePath: string): string | undefined {
  if (!from.startsWith('/')) return undefined;
  if (from.includes('?') || from.includes('#')) return undefined;

  let source = from.replace(/\/{2,}/g, '/');
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const baseWithoutTrailingSlash = normalizedBase.replace(/\/+$/, '');
  if (normalizedBase !== '/') {
    if (source === baseWithoutTrailingSlash || source === normalizedBase) {
      source = '/';
    } else if (source.startsWith(normalizedBase)) {
      source = `/${source.slice(normalizedBase.length)}`;
    }
  }

  if (source === '/' || source === '/404.html') return undefined;
  return source;
}

function githubPagesRedirectHtml(to: string): string {
  const escaped = escapeHtml(to);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>Redirecting to ${escaped}</title>`,
    `<meta http-equiv="refresh" content="0; url=${escaped}">`,
    `<link rel="canonical" href="${escaped}">`,
    '<meta name="robots" content="noindex">',
    '</head>',
    '<body>',
    `<p>Redirecting to <a href="${escaped}">${escaped}</a>.</p>`,
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
