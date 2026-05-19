import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { SiteData } from '~/content/model.ts';
import { splitLayout } from '~/render/layouts.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';

// Bump when render pipeline changes in a way that requires invalidating
// previously emitted HTML even though config, content, and theme inputs are
// unchanged. The manifest is keyed on `MANIFEST_VERSION` rather than the
// nectar package version so that ordinary patch releases (e.g. asset emitter
// tweaks that do not affect HTML) keep their incremental cache.
export const MANIFEST_VERSION = 1 as const;

export const MANIFEST_FILENAME = '.nectar-manifest.json';

export interface ManifestEntry {
  hash: string;
  outputPath: string;
}

export interface BuildManifest {
  version: typeof MANIFEST_VERSION;
  globalHash: string;
  routes: Record<string, ManifestEntry>;
}

export function manifestPath(outputDir: string): string {
  return join(outputDir, MANIFEST_FILENAME);
}

export async function loadManifest(outputDir: string): Promise<BuildManifest | undefined> {
  const file = Bun.file(manifestPath(outputDir));
  if (!(await file.exists())) return undefined;
  try {
    const parsed = (await file.json()) as Partial<BuildManifest>;
    if (parsed.version !== MANIFEST_VERSION) return undefined;
    if (!parsed.routes || typeof parsed.routes !== 'object') return undefined;
    if (typeof parsed.globalHash !== 'string') return undefined;
    return parsed as BuildManifest;
  } catch {
    return undefined;
  }
}

export async function saveManifest(outputDir: string, manifest: BuildManifest): Promise<void> {
  await Bun.write(manifestPath(outputDir), JSON.stringify(manifest));
}

// Inputs that affect every route: the full config (which includes csp_nonce,
// base_path, minify, subscribe/portal settings, etc.), site metadata, the
// theme's partial sources, and the theme package fields (custom defaults,
// posts_per_page, image_sizes) that propagate into render or routing.
export function computeGlobalHash(opts: {
  config: NectarConfig;
  site: SiteData;
  theme: ThemeBundle;
}): string {
  const { config, site, theme } = opts;
  const partials = Object.entries(theme.partials).sort(([a], [b]) => a.localeCompare(b));
  const payload = {
    sig: MANIFEST_VERSION,
    config,
    site,
    partials,
    themeName: theme.pkg.name,
    themeVersion: theme.pkg.version,
    customDefaults: theme.pkg.customDefaults,
    posts_per_page: theme.pkg.posts_per_page,
    image_sizes: theme.pkg.image_sizes,
  };
  return sha256(stableStringify(payload));
}

// Per-route hash combines the global hash with the route's template and
// layout sources plus the rendered route data (post/page/tag/author + posts
// + pagination + meta + lastmod). The template source is included separately
// from the global partial map so that touching a single template invalidates
// only routes using it; layout source is captured the same way.
export function computeRouteHash(opts: {
  globalHash: string;
  route: RouteContext;
  theme: ThemeBundle;
}): string {
  const { globalHash, route, theme } = opts;
  const templateSource = theme.templates[route.template] ?? '';
  const { layout } = splitLayout(templateSource);
  const layoutSource = layout ? (theme.templates[layout] ?? '') : '';
  const payload = {
    g: globalHash,
    kind: route.kind,
    url: route.url,
    outputPath: route.outputPath,
    template: route.template,
    templateSource,
    layoutSource,
    data: route.data,
    meta: route.meta,
    lastmod: route.lastmod ?? null,
  };
  return sha256(stableStringify(payload));
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Deterministic JSON serializer used for content-addressable hashing. Sorts
// object keys recursively and drops the `prev`/`next` post references which
// would otherwise form cycles (Post.prev -> Post -> Post.prev ...) and bloat
// each route's hash input with the entire post graph.
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (key, val) => {
    if (key === 'prev' || key === 'next') return undefined;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const source = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(source).sort()) {
        sorted[k] = source[k];
      }
      return sorted;
    }
    return val;
  });
}
