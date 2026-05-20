// Resolve a route path (root-relative or absolute) against the site's
// configured base URL. Mirrors the behaviour of `new URL(path, base)` with
// two tweaks:
//  - missing `base` falls back to the path unchanged (avoids throwing during
//    early bootstrap when site.url isn't loaded yet),
//  - URL construction failures fall back silently to the input path rather
//    than escaping out to the caller, so a malformed input cannot break the
//    surrounding render.
export function absoluteUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  if (/^https?:/i.test(path)) return path;
  try {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return path;
  }
}

// Prefix a root-relative path with the configured `build.base_path` so deploys
// under a subpath (e.g. GitHub Pages at `/repo/`, a CDN edge mount at `/blog/`)
// produce URLs the browser can actually resolve. Inputs:
//  - `basePath` is the normalised value from `normalizeBasePath` -- either `'/'`
//    (root deploy, no-op) or `'/segment/.../'` with a leading and trailing slash.
//  - `path` is a root-relative path the rest of the build emits (e.g.
//    `/post-slug/`, `/tag/foo/`, `/sitemap.xml`). Absolute http(s) URLs pass
//    through unchanged so callers do not have to branch on a user-supplied
//    `canonical_url` vs the auto-built path.
//
// The trailing slash on `basePath` guarantees `withBasePath('/blog/', '/x/')`
// is `'/blog/x/'`, not `'/blog//x/'`; the leading slash on `path` is dropped
// before concatenation to avoid the double-slash regardless of caller hygiene.
// A `path` that does not start with `/` is treated as already root-relative
// (e.g. `'rss.xml'`) and the missing slash is supplied for the `/` base_path
// case so callers stay symmetric across both shapes.
export function withBasePath(basePath: string | undefined, path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  if (!basePath || basePath === '/') {
    return path.startsWith('/') ? path : `/${path}`;
  }
  // Tolerate basePaths that arrive without the canonical trailing slash so
  // the helper stays correct even when a caller skips `normalizeBasePath`.
  const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${prefix}${cleanPath}`;
}

// Compose a fully-absolute external URL by inserting `base_path` between the
// host and the route-relative `path`. Used by URL builders that need to
// produce browser-resolvable links (post.url, page.url, tag.url, author.url,
// canonical, sitemap entries, RSS channel link, etc.). Absolute http(s)
// inputs short-circuit so a user-supplied `canonical_url` stays untouched.
export function absoluteUrlWithBasePath(
  base: string | undefined,
  basePath: string | undefined,
  path: string,
): string {
  if (/^https?:/i.test(path)) return path;
  return absoluteUrl(base, withBasePath(basePath, path));
}
