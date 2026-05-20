// Ghost exports use this literal sentinel for the source site's origin.
// Rewriting it to the empty string leaves a root-relative path that resolves
// against the migrated static site.
const GHOST_URL_PLACEHOLDER = /__GHOST_URL__/g;

export function stripGhostUrlPlaceholder<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(GHOST_URL_PLACEHOLDER, '') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripGhostUrlPlaceholder(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripGhostUrlPlaceholder(v);
    }
    return out as T;
  }
  return value;
}
