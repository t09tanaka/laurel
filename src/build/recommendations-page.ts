import type { NectarConfig, RecommendationItem } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { joinPath } from '~/theme/assets.ts';
import { nonceAttr } from '~/util/csp.ts';
import { writeHtml } from './emit.ts';
import { EMPTY_FAVICON_SET, type FaviconSet } from './favicons.ts';

// Renders the standalone `/recommendations/` page Nectar auto-emits when the
// project configures `[[recommendations]]`. The Source theme's sidebar "See
// all" button carries `data-portal="recommendations"`; in Ghost it opens a
// modal listing every recommendation. Without a members backend Nectar
// can't render that modal, so the portal shim deep-links to the
// `<section id="all-recommendations">` block on this page instead.
//
// Kept self-contained (no theme template) so the page renders even on themes
// that don't ship a custom recommendations layout, matching the same
// "default 404" pattern used elsewhere in the build pipeline.
export function renderRecommendationsHtml(opts: {
  config: NectarConfig;
  content: ContentGraph;
  favicons?: FaviconSet;
}): string {
  const { config, content } = opts;
  const site = content.site;
  const favicons = opts.favicons ?? EMPTY_FAVICON_SET;
  const lang = site.lang || site.locale || 'en';
  const direction = site.direction === 'rtl' ? 'rtl' : 'ltr';
  const title = `Recommendations — ${site.title}`;
  const homeHref = config.build.base_path || '/';
  const faviconTags = favicons.links.map((link) => renderFaviconTag(link, config.build.base_path));
  const items = config.recommendations.map((item) => renderRecommendationCard(item)).join('\n');
  const incoming = renderIncomingRecommendations(config.recommendations.length > 0);
  const empty =
    config.recommendations.length === 0
      ? '<p class="recommendations-empty">No recommendations yet.</p>'
      : '';
  const nonce = nonceAttr(config.build.csp_nonce);
  return [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(lang)}" dir="${direction}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...faviconTags,
    `<title>${escapeHtml(title)}</title>`,
    `<style${nonce}>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#15171a;background:#fff;line-height:1.5}header,footer{padding:1.5rem;border-bottom:1px solid #e5e7eb}footer{border:none;border-top:1px solid #e5e7eb;color:#6b7280;font-size:0.875rem}header h1{margin:0;font-size:1.25rem}main{max-width:46rem;margin:0 auto;padding:3rem 1.5rem}main h2{margin:0 0 1.5rem;font-size:2rem}.recommendation-card{margin:0 0 1.5rem;padding:1rem 1.25rem;border:1px solid #e5e7eb;border-radius:0.5rem}.recommendation-card h3{display:flex;align-items:center;gap:.5rem;margin:0 0 0.25rem;font-size:1.125rem}.recommendation-card a{color:inherit;text-decoration:none}.recommendation-card a:hover{text-decoration:underline}.recommendation-card p{margin:0.25rem 0}.recommendation-favicon{width:1.25rem;height:1.25rem;border-radius:4px}.recommendation-reason{color:#6b7280;font-size:0.875rem;font-style:italic}.recommendations-empty,.recommendations-note{color:#6b7280}</style>`,
    '</head>',
    `<body class="nectar-route-recommendations recommendations-template">`,
    `<header><h1><a href="${escapeAttr(homeHref)}">${escapeHtml(site.title)}</a></h1></header>`,
    '<main id="main">',
    `<h2>${escapeHtml('Recommendations')}</h2>`,
    '<section id="all-recommendations" data-nectar-all-recommendations>',
    items || empty,
    '</section>',
    incoming,
    '</main>',
    `<footer>&copy; ${new Date().getFullYear()} ${escapeHtml(site.title)}</footer>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export async function emitRecommendationsPage(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  favicons?: FaviconSet;
}): Promise<void> {
  const html = renderRecommendationsHtml({
    config: opts.config,
    content: opts.content,
    favicons: opts.favicons,
  });
  await writeHtml(opts.outputDir, 'recommendations/index.html', html);
}

function renderRecommendationCard(item: RecommendationItem): string {
  const href = escapeAttr(item.url);
  const title = escapeHtml(item.title);
  const description = item.description ? `<p>${escapeHtml(item.description)}</p>` : '';
  const reason = item.reason
    ? `<p class="recommendation-reason">${escapeHtml(item.reason)}</p>`
    : '';
  const cover = item.featured_image
    ? `<img class="recommendation-cover" src="${escapeAttr(item.featured_image)}" alt="" loading="lazy">`
    : '';
  const favicon = item.favicon
    ? `<img class="recommendation-favicon" src="${escapeAttr(item.favicon)}" alt="" loading="lazy">`
    : '';
  return [
    '<article class="recommendation-card">',
    cover,
    `<h3>${favicon}<a href="${href}" rel="noopener" target="_blank">${title}</a></h3>`,
    description,
    reason,
    '</article>',
  ].join('');
}

function renderIncomingRecommendations(hasOutgoing: boolean): string {
  return [
    '<section id="incoming-recommendations" data-nectar-incoming-recommendations>',
    '<h2>Incoming recommendations</h2>',
    `<p class="recommendations-note">${
      hasOutgoing
        ? 'Incoming recommendation counts are not available in a static build.'
        : 'Configure [[recommendations]] to list outgoing recommendations; incoming recommendation counts require a live Ghost or ActivityPub backend.'
    }</p>`,
    '</section>',
  ].join('');
}

function renderFaviconTag(
  link: { rel: string; href: string; type?: string; sizes?: string; color?: string },
  basePath: string,
): string {
  const href = /^[a-z][a-z0-9+.-]*:/i.test(link.href)
    ? link.href
    : joinPath(basePath, link.href.replace(/^\/+/, ''));
  const attrs = [`rel="${escapeAttr(link.rel)}"`, `href="${escapeAttr(href)}"`];
  if (link.type) attrs.push(`type="${escapeAttr(link.type)}"`);
  if (link.sizes) attrs.push(`sizes="${escapeAttr(link.sizes)}"`);
  if (link.color) attrs.push(`color="${escapeAttr(link.color)}"`);
  return `<link ${attrs.join(' ')}>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
