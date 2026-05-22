import { joinPath } from '~/theme/assets.ts';
import { writeHtml } from './emit.ts';

export async function emitFeedAlias(opts: {
  outputDir: string;
  enabled: boolean;
  basePath: string;
}): Promise<boolean> {
  if (!opts.enabled) return false;
  await writeHtml(
    opts.outputDir,
    'feed/index.html',
    feedAliasHtml(joinPath(opts.basePath, 'rss.xml')),
  );
  return true;
}

export function feedAliasHtml(target: string): string {
  const escaped = escapeHtml(target);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="robots" content="noindex">',
    `<title>Redirecting to ${escaped}</title>`,
    `<meta http-equiv="refresh" content="0; url=${escaped}">`,
    `<link rel="canonical" href="${escaped}">`,
    '</head>',
    '<body>',
    `<p>Redirecting to <a href="${escaped}">${escaped}</a>.</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
