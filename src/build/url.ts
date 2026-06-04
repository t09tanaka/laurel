import type { LaurelConfig } from '~/config/schema.ts';
import { withBasePath } from '~/util/url.ts';
import { type TrailingSlashPolicy, canonicalRouteUrl } from './routes-yaml.ts';

type PublicUrlConfig = Pick<LaurelConfig, 'site' | 'build'>;

interface PublicUrlParts {
  siteUrl: string | undefined;
  basePath: string | undefined;
  trailingSlash: TrailingSlashPolicy;
}

export function absoluteUrl(route: string, config: PublicUrlConfig): string {
  return absoluteUrlFromParts(route, {
    siteUrl: config.site.url,
    basePath: config.build.base_path,
    trailingSlash: config.build.trailing_slash,
  });
}

export function absoluteContentUrl(contentUrl: string, config: PublicUrlConfig): string {
  return absoluteContentUrlFromParts(contentUrl, {
    siteUrl: config.site.url,
    basePath: config.build.base_path,
    trailingSlash: config.build.trailing_slash,
  });
}

function absoluteUrlFromParts(route: string, parts: PublicUrlParts): string {
  if (/^https?:\/\//i.test(route)) return route;
  const publicPath = withBasePath(parts.basePath, canonicalRouteUrl(route, parts.trailingSlash));
  return joinSiteUrl(parts.siteUrl, publicPath);
}

function absoluteContentUrlFromParts(contentUrl: string, parts: PublicUrlParts): string {
  if (/^https?:\/\//i.test(contentUrl)) {
    return canonicalSameOriginAbsoluteUrl(parts.siteUrl, contentUrl, parts.trailingSlash);
  }
  const routeUrl = canonicalRouteUrl(contentUrl, parts.trailingSlash);
  if (hasBasePathPrefix(routeUrl, parts.basePath)) {
    return joinSiteUrl(parts.siteUrl, routeUrl);
  }
  return absoluteUrlFromParts(contentUrl, parts);
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

function joinSiteUrl(siteUrl: string | undefined, publicPath: string): string {
  if (!siteUrl) return publicPath;
  try {
    const parsed = new URL(siteUrl);
    const basePath = parsed.pathname.replace(/\/+$/, '');
    const routePath = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
    parsed.pathname = `${basePath}${routePath}`.replace(/\/{2,}/g, '/');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return `${siteUrl.replace(/\/+$/, '')}${publicPath.startsWith('/') ? publicPath : `/${publicPath}`}`;
  }
}

function hasBasePathPrefix(routeUrl: string, basePath: string | undefined): boolean {
  if (!basePath || basePath === '/') return false;
  const normalized = `/${basePath.replace(/^\/+|\/+$/g, '')}/`;
  return routeUrl === normalized.slice(0, -1) || routeUrl.startsWith(normalized);
}
