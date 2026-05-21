import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { Tier } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { directionForLocale } from '~/util/locale.ts';
import { absoluteUrlWithBasePath, withBasePath } from '~/util/url.ts';

export interface EmitTierWelcomePagesOptions {
  config: NectarConfig;
  outputDir: string;
  tiers: readonly Tier[];
  reservedOutputPaths?: ReadonlySet<string>;
}

export async function emitTierWelcomePages(opts: EmitTierWelcomePagesOptions): Promise<string[]> {
  const emitted: string[] = [];
  for (const tier of opts.tiers) {
    const page = welcomePageForTier(tier);
    if (!page || opts.reservedOutputPaths?.has(page.outputPath)) continue;
    const dest = join(opts.outputDir, page.outputPath);
    await ensureDir(dirname(dest));
    await writeFile(dest, renderTierWelcomeHtml(opts.config, tier, page.urlPath), 'utf8');
    emitted.push(page.outputPath);
  }
  return emitted;
}

function welcomePageForTier(tier: Tier): { urlPath: string; outputPath: string } | undefined {
  const urlPath =
    tier.welcome_page_url !== undefined
      ? normalizeRootRelativePath(tier.welcome_page_url)
      : tier.type === 'free'
        ? `/welcome/${tier.slug}/`
        : undefined;
  if (!urlPath) return undefined;
  return { urlPath, outputPath: urlPathToOutputPath(urlPath) };
}

function normalizeRootRelativePath(value: string): string | undefined {
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  const rawPath = value.split(/[?#]/, 1)[0] ?? '';
  const rawParts = rawPath.split('/').filter(Boolean);
  if (rawParts.some((part) => part === '..' || part === '.')) return undefined;
  const parsed = new URL(value, 'https://nectar.local');
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) return undefined;
  return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
}

function urlPathToOutputPath(urlPath: string): string {
  const parts = urlPath.split('/').filter(Boolean);
  return parts.length === 0 ? 'index.html' : `${parts.join('/')}/index.html`;
}

function renderTierWelcomeHtml(config: NectarConfig, tier: Tier, urlPath: string): string {
  const site = config.site;
  const title = `${tier.name} welcome`;
  const homeHref = withBasePath(config.build.base_path, '/');
  const canonical = absoluteUrlWithBasePath(site.url, config.build.base_path, urlPath);
  const portalHref = withBasePath(config.build.base_path, '/#/portal/account');
  const description =
    tier.description || `Your ${tier.name} membership for ${site.title} is ready.`;
  return `<!doctype html>
<html lang="${escapeAttr(site.locale)}" dir="${escapeAttr(directionForLocale(site.locale))}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | ${escapeHtml(site.title)}</title>
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta name="description" content="${escapeAttr(description)}">
</head>
<body>
  <main>
    <p><a href="${escapeAttr(homeHref)}">${escapeHtml(site.title)}</a></p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p><a href="${escapeAttr(portalHref)}" data-portal="account">Continue to account</a></p>
  </main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
