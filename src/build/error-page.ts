import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { writeHtml } from './emit.ts';

export function renderDefault404Html(opts: {
  config: NectarConfig;
  content: ContentGraph;
}): string {
  const { config, content } = opts;
  const site = content.site;
  const lang = site.lang || site.locale || 'en';
  const direction = site.direction === 'rtl' ? 'rtl' : 'ltr';
  const title = `Page not found — ${site.title}`;
  const homeHref = config.build.base_path || '/';
  return [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(lang)}" dir="${direction}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#15171a;background:#fff;line-height:1.5}header,footer{padding:1.5rem;border-bottom:1px solid #e5e7eb;text-align:center}footer{border:none;border-top:1px solid #e5e7eb;color:#6b7280;font-size:0.875rem}main{max-width:38rem;margin:0 auto;padding:4rem 1.5rem;text-align:center}h1{margin:0;font-size:1.25rem}h2{margin:0 0 1rem;font-size:2.25rem}p{margin:0 0 1.5rem}a{color:inherit}.home-link{display:inline-block;margin-top:1rem;padding:0.5rem 1rem;border:1px solid #15171a;border-radius:0.25rem;text-decoration:none}</style>',
    '</head>',
    '<body>',
    `<header><h1><a href="${escapeHtml(homeHref)}">${escapeHtml(site.title)}</a></h1></header>`,
    '<main>',
    '<h2>404</h2>',
    '<p>The page you were looking for doesn&rsquo;t exist.</p>',
    `<p><a class="home-link" href="${escapeHtml(homeHref)}">Return home</a></p>`,
    '</main>',
    `<footer>&copy; ${new Date().getFullYear()} ${escapeHtml(site.title)}</footer>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export async function emitDefault404(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
}): Promise<void> {
  const html = renderDefault404Html({ config: opts.config, content: opts.content });
  await writeHtml(opts.outputDir, '404.html', html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
