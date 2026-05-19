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
