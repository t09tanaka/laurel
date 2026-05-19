import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { logger } from '~/util/logger.ts';

// Ghost ships a `routes.yaml` at the content root that lets theme authors
// declare three orthogonal kinds of customization:
//
//   * `routes:`       — pin a URL to a specific template (a "channel"
//                       in Ghost terminology). The simplest form maps
//                       `/featured/` to `featured.hbs`.
//   * `collections:`  — bucket posts into URL groups with permalinks,
//                       filters, ordering, and per-bucket templates.
//   * `taxonomies:`   — override the URL pattern used for tag and
//                       author archives (e.g. `/categories/{slug}/`).
//
// This module is a parser-and-validator only for the *whole* file plus a
// surface for the build pipeline to consume the `routes:` section. The
// `collections:` and `taxonomies:` sections are recognized and validated so
// authors get a real error instead of silence, but their effects on the
// route plan are not yet implemented — when either is present we emit a
// warning that names the missing feature so it is visible at build time.

const routeContentTypeSchema = z.enum(['html', 'rss', 'atom', 'plain', 'json']);

const routeEntryObjectSchema = z
  .object({
    template: z
      .string()
      .min(1)
      .describe('Template name (without `.hbs`) that should render this URL.'),
    content_type: routeContentTypeSchema
      .optional()
      .describe('Output content type. Defaults to `html`.'),
    data: z
      .string()
      .optional()
      .describe(
        'Optional `data` directive referencing a tag/author/page (e.g. `tag.featured`). Not yet applied to renders.',
      ),
  })
  .strict();

const routeEntrySchema = z.union([z.string().min(1), routeEntryObjectSchema]);

const collectionLimitSchema = z.union([z.number().int().positive(), z.literal('all')]);

const collectionSchema = z
  .object({
    permalink: z
      .string()
      .min(1)
      .describe('Permalink template applied to posts in this collection (e.g. `/{slug}/`).'),
    template: z.string().min(1).optional(),
    filter: z.string().min(1).optional(),
    order: z.string().min(1).optional(),
    limit: collectionLimitSchema.optional(),
    data: z.string().min(1).optional(),
    rss: z.boolean().optional(),
  })
  .strict();

// Taxonomy entries may be:
//   * a permalink template (`/tag/{slug}/`) — archive enabled at that path
//   * `null` — archive explicitly disabled (same effect as omitting the key)
// The path must start with `/`, end with `/` (Ghost's directory-style URLs),
// and contain `{slug}` so each tag/author gets its own URL.
const taxonomySchema = z
  .union([
    z.null(),
    z
      .string()
      .min(1)
      .refine((s) => s.startsWith('/'), { message: 'taxonomy permalink must start with `/`' })
      .refine((s) => s.endsWith('/'), { message: 'taxonomy permalink must end with `/`' })
      .refine((s) => s.includes('{slug}'), {
        message: 'taxonomy permalink must contain the `{slug}` placeholder',
      }),
  ])
  .describe('Permalink template (e.g. `/tag/{slug}/`) or `null` to disable this taxonomy.');

const TAXONOMY_KINDS = ['tag', 'author'] as const;
type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

// Authoritative defaults applied when `routes.yaml` is absent, or present but
// contains no `taxonomies:` block. Both tag and author archives are enabled at
// Ghost's conventional locations.
const DEFAULT_TAXONOMY_PATHS: Record<TaxonomyKind, string> = {
  tag: '/tag/{slug}/',
  author: '/author/{slug}/',
};

export const routesYamlSchema = z
  .object({
    routes: z.record(routeEntrySchema).default({}),
    collections: z.record(collectionSchema).default({}),
    // Optional (not `.default({})`) so we can distinguish "block omitted, use
    // defaults" from "block present but empty, disable everything".
    taxonomies: z.record(taxonomySchema).optional(),
  })
  .strict();

export type RoutesYaml = z.infer<typeof routesYamlSchema>;
export type RouteEntry = z.infer<typeof routeEntrySchema>;
export type RouteEntryObject = z.infer<typeof routeEntryObjectSchema>;
export type RouteCollection = z.infer<typeof collectionSchema>;
export type ResolvedTaxonomies = Partial<Record<TaxonomyKind, string>>;

export interface ResolvedRouteEntry {
  url: string;
  template: string;
  content_type: z.infer<typeof routeContentTypeSchema>;
  data?: string;
}

export function emptyRoutesYaml(): RoutesYaml {
  return routesYamlSchema.parse({});
}

// Read `routes.yaml` (or `.yml`) from the project root. Returns an empty
// config when neither file exists or the file is empty / comment-only, so
// the build pipeline can call this unconditionally.
export async function loadRoutesYaml(cwd: string): Promise<RoutesYaml> {
  for (const name of ['routes.yaml', 'routes.yml']) {
    const path = join(cwd, name);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Empty or comment-only YAML parses to `null`; treat as "no routes" so
    // authoring an empty file is not load-bearing.
    if (parsed == null) return emptyRoutesYaml();
    const result = routesYamlSchema.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.errors
        .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
        .join('; ');
      throw new Error(`Invalid ${name}: ${detail}`);
    }
    return result.data;
  }
  return emptyRoutesYaml();
}

// Normalize a route entry to a canonical shape regardless of whether the
// author used the short string form (`/featured/: featured`) or the long
// object form (`/about/: { template: about, content_type: html }`).
export function resolveRouteEntries(yaml: RoutesYaml): ResolvedRouteEntry[] {
  const out: ResolvedRouteEntry[] = [];
  for (const [url, entry] of Object.entries(yaml.routes)) {
    if (typeof entry === 'string') {
      out.push({ url, template: entry, content_type: 'html' });
      continue;
    }
    const resolved: ResolvedRouteEntry = {
      url,
      template: entry.template,
      content_type: entry.content_type ?? 'html',
    };
    if (entry.data !== undefined) resolved.data = entry.data;
    out.push(resolved);
  }
  return out;
}

// Translate a Ghost-style route URL into a filesystem path under the
// build output. Trailing-slash URLs (the Ghost default) become directory
// index files; URLs that look like a literal filename (`/sitemap.xml`)
// are written verbatim.
export function routeUrlToOutputPath(url: string): string {
  if (!url.startsWith('/')) {
    throw new Error(`routes.yaml: route URL must start with '/', got '${url}'`);
  }
  const trimmed = url.slice(1);
  if (trimmed === '') return 'index.html';
  if (trimmed.endsWith('/')) return `${trimmed}index.html`;
  // No trailing slash. If the last segment has an extension we treat it
  // as a literal file; otherwise we still produce an index.html under
  // that path so the static output matches Ghost's directory-style URLs.
  const lastSegment = trimmed.split('/').pop() ?? '';
  return lastSegment.includes('.') ? trimmed : `${trimmed}/index.html`;
}

// Surface a one-time warning per section we recognize but do not yet apply
// during the build. Keeps the parser useful as a validation step while the
// downstream wiring is implemented in follow-up tasks.
export function warnUnappliedSections(yaml: RoutesYaml): void {
  if (Object.keys(yaml.collections).length > 0) {
    logger.warn(
      'routes.yaml: `collections:` is parsed but not yet applied to the build; post URLs and per-collection templates are unchanged.',
    );
  }
}

// Resolve which tag/author archives are active and their URL templates.
// `undefined` for a kind means "no archive emitted for this taxonomy". The
// returned templates always include a `{slug}` placeholder and a trailing `/`.
//
// Semantics:
//   * `taxonomies` omitted (undefined) → Ghost defaults for both kinds
//   * `taxonomies: {}`                  → both kinds disabled
//   * key listed with string value      → kind enabled with that path
//   * key listed with null value        → kind explicitly disabled
//   * key omitted from a present block  → kind disabled (block is authoritative)
export function resolveTaxonomies(yaml: RoutesYaml): ResolvedTaxonomies {
  if (yaml.taxonomies === undefined) {
    return { ...DEFAULT_TAXONOMY_PATHS };
  }
  const out: ResolvedTaxonomies = {};
  for (const kind of TAXONOMY_KINDS) {
    const value = yaml.taxonomies[kind];
    if (typeof value === 'string') out[kind] = value;
  }
  // Any extra keys (anything outside `tag` / `author`) are silently dropped —
  // Ghost itself only honours these two and the schema accepts arbitrary keys
  // only because Ghost's docs hint at future extensibility.
  for (const key of Object.keys(yaml.taxonomies)) {
    if (!(TAXONOMY_KINDS as readonly string[]).includes(key)) {
      logger.warn(
        `routes.yaml: taxonomies.${key} is not a recognised taxonomy kind (expected one of: ${TAXONOMY_KINDS.join(', ')}); ignoring.`,
      );
    }
  }
  return out;
}

// Substitute `{slug}` in a taxonomy permalink template. Validated upstream so
// the placeholder is guaranteed present and the result starts/ends with `/`.
export function applyTaxonomyTemplate(template: string, slug: string): string {
  return template.replaceAll('{slug}', slug);
}
