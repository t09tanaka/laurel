import { absoluteUrl, absoluteUrlWithBasePath } from '~/util/url.ts';
import { type TrailingSlashPolicy, canonicalRouteUrl } from './routes-yaml.ts';

export function canonicalAbsoluteRouteUrl(
  siteUrl: string | undefined,
  basePath: string | undefined,
  routeUrl: string,
  trailingSlash: TrailingSlashPolicy,
): string {
  return absoluteUrlWithBasePath(siteUrl, basePath, canonicalRouteUrl(routeUrl, trailingSlash));
}

export function canonicalAbsoluteContentUrl(
  siteUrl: string | undefined,
  contentUrl: string,
  trailingSlash: TrailingSlashPolicy,
): string {
  if (/^https?:\/\//i.test(contentUrl)) {
    return canonicalSameOriginAbsoluteUrl(siteUrl, contentUrl, trailingSlash);
  }
  return absoluteUrl(siteUrl, canonicalRouteUrl(contentUrl, trailingSlash));
}

function canonicalSameOriginAbsoluteUrl(
  siteUrl: string | undefined,
  contentUrl: string,
  trailingSlash: TrailingSlashPolicy,
): string {
  if (!siteUrl) return contentUrl;
  try {
    const site = new URL(siteUrl);
    const parsed = new URL(contentUrl);
    if (parsed.origin !== site.origin) return contentUrl;
    parsed.pathname = canonicalRouteUrl(parsed.pathname, trailingSlash);
    return parsed.toString();
  } catch {
    return contentUrl;
  }
}
