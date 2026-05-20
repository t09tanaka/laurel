import type { TrailingSlashPolicy } from './routes-yaml.ts';
import { absoluteContentUrlFromParts, absoluteUrlFromParts } from './url.ts';

export function canonicalAbsoluteRouteUrl(
  siteUrl: string | undefined,
  basePath: string | undefined,
  routeUrl: string,
  trailingSlash: TrailingSlashPolicy,
): string {
  return absoluteUrlFromParts(routeUrl, { siteUrl, basePath, trailingSlash });
}

export function canonicalAbsoluteContentUrl(
  siteUrl: string | undefined,
  contentUrl: string,
  trailingSlash: TrailingSlashPolicy,
): string {
  return absoluteContentUrlFromParts(contentUrl, {
    siteUrl,
    basePath: undefined,
    trailingSlash,
  });
}
