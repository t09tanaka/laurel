import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Browsers fall back to /favicon.ico when no <link rel="icon"> is present and
// log a network error on miss. We close that gap by (a) emitting <link> tags
// in <head> via ghost_head and (b) copying the source files into the dist
// root at the well-known paths browsers actually look for. The favicon files
// are intentionally NOT fingerprinted: bookmarks, browser caches, and the
// /favicon.ico fallback all expect stable URLs.

export interface FaviconLink {
  rel: string;
  href: string; // dist-root-relative path beginning with '/', or absolute URL
  type?: string;
  sizes?: string;
  color?: string;
}

export interface FaviconCopy {
  sourcePath: string;
  outputPath: string; // relative to output dir, e.g. 'favicon.ico'
}

export interface FaviconSet {
  links: FaviconLink[];
  copies: FaviconCopy[];
}

export const EMPTY_FAVICON_SET: FaviconSet = { links: [], copies: [] };

// Well-known favicon filenames Nectar recognises in a theme's assets/ dir.
// Discovery is filename-based to avoid having themes opt in via package.json.
// The role assigned here determines the emitted <link> tag.
interface ThemeFaviconRecipe {
  filename: string; // logical key under theme.assets (with 'assets/' prefix)
  rel: string;
  type?: string;
  sizes?: string;
  withColor?: boolean; // mask-icon uses accent_color
}

const THEME_FAVICON_RECIPES: ThemeFaviconRecipe[] = [
  { filename: 'favicon.ico', rel: 'icon', type: 'image/x-icon' },
  { filename: 'favicon.svg', rel: 'icon', type: 'image/svg+xml' },
  { filename: 'favicon.png', rel: 'icon', type: 'image/png' },
  { filename: 'favicon-16x16.png', rel: 'icon', type: 'image/png', sizes: '16x16' },
  { filename: 'favicon-32x32.png', rel: 'icon', type: 'image/png', sizes: '32x32' },
  { filename: 'favicon-96x96.png', rel: 'icon', type: 'image/png', sizes: '96x96' },
  { filename: 'favicon-192x192.png', rel: 'icon', type: 'image/png', sizes: '192x192' },
  { filename: 'apple-touch-icon.png', rel: 'apple-touch-icon', sizes: '180x180' },
  { filename: 'apple-touch-icon-precomposed.png', rel: 'apple-touch-icon-precomposed' },
  { filename: 'apple-touch-icon-152x152.png', rel: 'apple-touch-icon', sizes: '152x152' },
  { filename: 'apple-touch-icon-167x167.png', rel: 'apple-touch-icon', sizes: '167x167' },
  { filename: 'apple-touch-icon-180x180.png', rel: 'apple-touch-icon', sizes: '180x180' },
  { filename: 'safari-pinned-tab.svg', rel: 'mask-icon', withColor: true },
  { filename: 'site.webmanifest', rel: 'manifest' },
  { filename: 'manifest.webmanifest', rel: 'manifest' },
];

export function computeFavicons(opts: {
  config: NectarConfig;
  theme: ThemeBundle;
  cwd: string;
}): FaviconSet {
  const links: FaviconLink[] = [];
  const copies: FaviconCopy[] = [];
  const occupiedOutputs = new Set<string>();
  // Track rel-only (sizes ignored) so site.icon doesn't add a duplicate
  // <link rel="icon"> next to a theme's sized variant, or a duplicate
  // apple-touch-icon next to a theme-shipped one.
  const occupiedRels = new Set<string>();

  // Theme-shipped favicons take precedence: a theme that bundles a curated
  // favicon set knows its design intent better than a generic site icon.
  for (const recipe of THEME_FAVICON_RECIPES) {
    const asset = opts.theme.assets.get(`assets/${recipe.filename}`);
    if (!asset) continue;
    const outputPath = recipe.filename;
    if (occupiedOutputs.has(outputPath)) continue;
    occupiedOutputs.add(outputPath);
    occupiedRels.add(recipe.rel);
    copies.push({ sourcePath: asset.sourcePath, outputPath });
    links.push({
      rel: recipe.rel,
      href: `/${outputPath}`,
      type: recipe.type,
      sizes: recipe.sizes,
      color: recipe.withColor ? opts.config.site.accent_color : undefined,
    });
  }

  // Fall back to site.icon for the primary <link rel="icon"> when the theme
  // didn't ship one. site.icon mirrors Ghost's convention: a single source
  // image (.svg/.png/.ico/.jpg) used as the site's identity glyph.
  const siteIconResult = resolveSiteIcon(opts.config.site.icon, opts.cwd);
  if (siteIconResult && !occupiedRels.has('icon')) {
    const { sourcePath, outputName, type, isRemote, href } = siteIconResult;
    if (isRemote) {
      links.push({ rel: 'icon', href, type });
    } else if (sourcePath && outputName) {
      if (!occupiedOutputs.has(outputName)) {
        occupiedOutputs.add(outputName);
        copies.push({ sourcePath, outputPath: outputName });
      }
      links.push({ rel: 'icon', href: `/${outputName}`, type });
      // Apple devices won't render SVG favicons; emit apple-touch-icon only
      // for raster sources, and only if the theme didn't already ship one
      // (in any size).
      if (
        !occupiedRels.has('apple-touch-icon') &&
        (type === 'image/png' || type === 'image/jpeg')
      ) {
        links.push({ rel: 'apple-touch-icon', href: `/${outputName}` });
      }
    }
  }

  return { links, copies };
}

interface ResolvedSiteIcon {
  sourcePath: string | undefined;
  outputName: string | undefined;
  type: string | undefined;
  isRemote: boolean;
  href: string;
}

function resolveSiteIcon(icon: string | undefined, cwd: string): ResolvedSiteIcon | undefined {
  if (!icon) return undefined;
  if (/^(https?:)?\/\//i.test(icon)) {
    return {
      sourcePath: undefined,
      outputName: undefined,
      type: mimeFor(icon),
      isRemote: true,
      href: icon,
    };
  }
  const cleaned = icon.replace(/^\/+/, '');
  if (!cleaned) return undefined;
  // Guard against path traversal in user-controlled config before touching the
  // filesystem. Refuse anything containing '..' segments outright.
  if (cleaned.split('/').some((seg) => seg === '..')) {
    logger.warn(`site.icon contains parent traversal segment; ignoring: ${icon}`);
    return undefined;
  }
  const candidate = isAbsolute(cleaned) ? cleaned : join(cwd, cleaned);
  const resolvedCwd = resolve(cwd);
  const resolvedCandidate = resolve(candidate);
  if (!resolvedCandidate.startsWith(resolvedCwd + sep) && resolvedCandidate !== resolvedCwd) {
    logger.warn(`site.icon resolved outside the project root; ignoring: ${icon}`);
    return undefined;
  }
  if (!existsSync(resolvedCandidate)) {
    logger.warn(`site.icon points at a missing file; favicon will not be emitted: ${icon}`);
    return undefined;
  }
  const ext = extname(resolvedCandidate).toLowerCase();
  const outputName = `favicon${ext}`;
  return {
    sourcePath: resolvedCandidate,
    outputName,
    type: mimeFor(resolvedCandidate),
    isRemote: false,
    href: `/${outputName}`,
  };
}

function mimeFor(path: string): string | undefined {
  const ext = extname(path.split('?')[0]?.split('#')[0] ?? '').toLowerCase();
  switch (ext) {
    case '.ico':
      return 'image/x-icon';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

export async function copyFavicons(set: FaviconSet, outputDir: string): Promise<number> {
  let count = 0;
  for (const copy of set.copies) {
    const dest = join(outputDir, copy.outputPath);
    await ensureDir(dirname(dest));
    await copyFile(copy.sourcePath, dest);
    count += 1;
  }
  return count;
}
