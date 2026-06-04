import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import { joinPath } from '~/theme/assets.ts';
import type { FaviconLink, FaviconSet } from './favicons.ts';

export const GENERATED_WEB_MANIFEST_PATH = 'site.webmanifest';

export async function emitWebManifest(opts: {
  outputDir: string;
  config: LaurelConfig;
  favicons: FaviconSet;
}): Promise<boolean> {
  if (hasManifestLink(opts.favicons.links)) return false;
  const manifest = buildWebManifest(opts.config, opts.favicons.links);
  await Bun.write(
    join(opts.outputDir, GENERATED_WEB_MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return true;
}

export function buildWebManifest(
  config: LaurelConfig,
  faviconLinks: readonly FaviconLink[] = [],
): Record<string, unknown> {
  const basePath = config.build.base_path;
  const icons = faviconLinks
    .filter((link) =>
      link.rel.split(/\s+/).some((rel) => rel === 'icon' || rel === 'apple-touch-icon'),
    )
    .filter((link) => !/^(?:https?:)?\/\//i.test(link.href))
    .map((link) => {
      const icon: Record<string, string> = {
        src: joinPath(basePath, link.href.replace(/^\/+/, '')),
      };
      if (link.type) icon.type = link.type;
      if (link.sizes) icon.sizes = link.sizes;
      return icon;
    });

  return {
    name: config.site.title,
    short_name: config.site.title,
    description: config.site.description,
    start_url: basePath,
    scope: basePath,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: config.site.accent_color,
    ...(icons.length > 0 ? { icons } : {}),
  };
}

export function hasManifestLink(links: readonly FaviconLink[]): boolean {
  return links.some((link) => link.rel.split(/\s+/).includes('manifest'));
}
