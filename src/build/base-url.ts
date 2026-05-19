/**
 * Normalise a user-supplied base URL so the rest of the build pipeline can
 * treat it identically to `site.url` loaded from nectar.toml. Used by the
 * `--base-url` CLI override (and its NECTAR_BUILD_BASE_URL env-var fallback)
 * to retarget canonical, OG, RSS, and sitemap absolute URLs at a preview
 * host (Netlify/Vercel/Cloudflare PR URL) without editing config.
 *
 * Distinct from `--base-path`: base_path is the path prefix on a host (e.g.
 * `/preview/`), site.url is the host itself (e.g. `https://pr-42.example.com`).
 * A preview deploy typically needs both, or just `--base-url` when the host
 * has no path prefix.
 *
 * Strips a trailing slash for byte-identity with the default `site.url`
 * shape (`http://localhost:4321` has none), so downstream code that does
 * `${site.url}/path` keeps producing the same string regardless of whether
 * the URL came from config or CLI.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string') {
    throw new Error('base_url must be a string');
  }
  const trimmed = baseUrl.trim();
  if (trimmed === '') {
    throw new Error('base_url must not be empty');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `base_url ${JSON.stringify(baseUrl)} must start with http:// or https:// (got an absolute host like https://pr-42.example.com, not a path)`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`base_url ${JSON.stringify(baseUrl)} is not a valid URL`);
  }
  if (parsed.hostname === '') {
    throw new Error(`base_url ${JSON.stringify(baseUrl)} is missing a hostname`);
  }
  return trimmed.replace(/\/+$/, '');
}
