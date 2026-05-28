import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, ContentSourceFingerprint, SiteData } from '~/content/model.ts';
import { resolveLayoutName, splitLayout } from '~/render/layouts.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { scanGlob } from '~/util/fs.ts';

// Bump when render pipeline changes in a way that requires invalidating
// previously emitted HTML even though config, content, and theme inputs are
// unchanged. The manifest is keyed on `MANIFEST_VERSION` rather than the
// nectar package version so that ordinary patch releases (e.g. asset emitter
// tweaks that do not affect HTML) keep their incremental cache.
export const MANIFEST_VERSION = 3 as const;

export const MANIFEST_FILENAME = '.nectar-manifest.json';

export interface ManifestEntry {
  hash: string;
  outputPath: string;
  contentFingerprint?: string;
  themeFingerprint?: string;
  kind?: RouteContext['kind'];
  template?: string;
  lastmod?: string | null;
  integrity?: string;
}

export interface FeedManifestEntry {
  hash: string;
  outputPath: string;
}

export interface BuildManifest {
  version: typeof MANIFEST_VERSION;
  globalHash: string;
  themeFingerprint?: string;
  routes: Record<string, ManifestEntry>;
  feeds?: Record<string, FeedManifestEntry>;
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
  themeFingerprint?: string;
  generatorFingerprint?: string;
  contentImageAssets?: Array<{ rel: string; hash: string; outputRel: string }>;
}): string {
  const { config, site, theme } = opts;
  const partials = Object.entries(theme.partials).sort(([a], [b]) => a.localeCompare(b));
  const payload = {
    sig: MANIFEST_VERSION,
    config,
    site,
    generatorFingerprint: opts.generatorFingerprint,
    themeFingerprint: opts.themeFingerprint ?? computeThemeFingerprint(theme),
    partials,
    themeName: theme.pkg.name,
    themeVersion: theme.pkg.version,
    customDefaults: theme.pkg.customDefaults,
    posts_per_page: theme.pkg.posts_per_page,
    image_sizes: theme.pkg.image_sizes,
    contentImageAssets: opts.contentImageAssets ?? [],
  };
  return sha256(stableStringify(payload));
}

export async function computeGeneratorSourceFingerprint(
  srcRoot = resolve(import.meta.dir, '..'),
): Promise<string> {
  if (!existsSync(srcRoot)) return 'source-unavailable';
  const patterns = ['build/**/*.ts', 'content/**/*.ts', 'render/**/*.ts', 'theme/**/*.ts'];
  const paths = (
    await Promise.all(
      patterns.map((pattern) => scanGlob(pattern, { cwd: srcRoot, onlyFiles: true })),
    )
  )
    .flat()
    .sort();
  if (paths.length === 0) return 'source-unavailable';
  const h = createHash('sha256');
  for (const rel of paths) {
    h.update(rel);
    h.update('\0');
    h.update(await readFile(join(srcRoot, rel)));
    h.update('\0');
  }
  return h.digest('hex');
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
  contentFingerprint?: string;
  themeFingerprint?: string;
}): string {
  const { globalHash, route, theme } = opts;
  const templateSource = theme.templates[route.template] ?? '';
  const { layout } = splitLayout(templateSource);
  const layoutName = layout ? resolveLayoutName(layout, route.template) : undefined;
  const layoutSource = layoutName ? (theme.templates[layoutName] ?? '') : '';
  const payload = {
    g: globalHash,
    kind: route.kind,
    url: route.url,
    outputPath: route.outputPath,
    template: route.template,
    templateSource,
    layoutSource,
    contentFingerprint: opts.contentFingerprint,
    themeFingerprint: opts.themeFingerprint,
    data: route.data,
    meta: route.meta,
    lastmod: route.lastmod ?? null,
  };
  return sha256(stableStringify(payload));
}

export function reusePreviousRouteHash(opts: {
  previous: ManifestEntry | undefined;
  previousGlobalHash: string | undefined;
  currentGlobalHash: string;
  route: RouteContext;
  contentFingerprint: string;
  themeFingerprint: string;
  pluginsEnabled: boolean;
}): string | undefined {
  const {
    previous,
    previousGlobalHash,
    currentGlobalHash,
    route,
    contentFingerprint,
    themeFingerprint,
    pluginsEnabled,
  } = opts;
  if (!previous) return undefined;
  if (pluginsEnabled) return undefined;
  if (previousGlobalHash !== currentGlobalHash) return undefined;
  if (previous.integrity !== computeManifestEntryIntegrity(previous)) return undefined;
  if (previous.outputPath !== route.outputPath) return undefined;
  if (previous.contentFingerprint !== contentFingerprint) return undefined;
  if (previous.themeFingerprint !== themeFingerprint) return undefined;
  if (previous.kind === undefined || previous.kind !== route.kind) return undefined;
  if (previous.template === undefined || previous.template !== route.template) return undefined;
  if ((previous.lastmod ?? null) !== (route.lastmod ?? null)) return undefined;
  return previous.hash;
}

export function computeManifestEntryIntegrity(
  entry: Omit<ManifestEntry, 'integrity'> | ManifestEntry,
): string {
  return sha256(
    stableStringify({
      hash: entry.hash,
      outputPath: entry.outputPath,
      contentFingerprint: entry.contentFingerprint,
      themeFingerprint: entry.themeFingerprint,
      kind: entry.kind,
      template: entry.template,
      lastmod: entry.lastmod ?? null,
    }),
  );
}

export function computeThemeFingerprint(theme: ThemeBundle): string {
  const assets = [...theme.assets.values()]
    .map((asset) => ({
      logicalPath: asset.logicalPath,
      fingerprintedPath: asset.fingerprintedPath,
      hash: asset.hash,
      integrity: asset.integrity,
      size: asset.size,
    }))
    .sort((a, b) => (a.logicalPath < b.logicalPath ? -1 : a.logicalPath > b.logicalPath ? 1 : 0));
  return sha256(
    stableStringify({
      name: theme.name,
      rootDir: theme.rootDir,
      pkg: theme.pkg,
      templates: theme.templates,
      partials: theme.partials,
      locales: theme.locales,
      assets,
    }),
  );
}

export interface RouteContentInput {
  kind: 'post' | 'page' | 'tag' | 'author';
  id: string;
  path: string;
  mtimeMs: number;
  size: number;
}

export function collectRouteContentInputs(
  route: RouteContext,
  content: ContentGraph,
): RouteContentInput[] {
  const inputs = new Map<string, RouteContentInput>();
  const add = (
    kind: RouteContentInput['kind'],
    id: string | undefined,
    source: ContentSourceFingerprint | undefined,
  ) => {
    if (!id || !source) return;
    inputs.set(`${kind}:${id}`, { kind, id, ...source });
  };

  add(
    'post',
    route.data.post?.id,
    route.data.post && content.sources?.posts.get(route.data.post.id),
  );
  add(
    'page',
    route.data.page?.id,
    route.data.page && content.sources?.pages.get(route.data.page.id),
  );
  add('tag', route.data.tag?.id, route.data.tag && content.sources?.tags.get(route.data.tag.id));
  add(
    'author',
    route.data.author?.id,
    route.data.author && content.sources?.authors.get(route.data.author.id),
  );
  for (const post of route.data.posts ?? []) {
    add('post', post.id, content.sources?.posts.get(post.id));
  }

  return [...inputs.values()].sort((a, b) => {
    const ak = `${a.kind}:${a.id}`;
    const bk = `${b.kind}:${b.id}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

export function computeRouteContentFingerprint(route: RouteContext, content: ContentGraph): string {
  return computeRouteContentInputsFingerprint(collectRouteContentInputs(route, content));
}

export function computeRouteContentInputsFingerprint(inputs: readonly RouteContentInput[]): string {
  return sha256(stableStringify(inputs));
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
