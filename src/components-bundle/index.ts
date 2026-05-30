import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { absolutise } from '~/cli/content-paths.ts';
import { createZipArchive } from '~/cli/dashboard/zip-writer.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { COMPONENT_SLUG_PATTERN, loadComponents } from '~/content/components.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import {
  type ConflictPolicy,
  assertWritablePathHasNoSymlink,
  assetRelFromReference,
  collectReferencedAssetBytes,
  isInsidePath,
  isRecord,
  isSafeRelativePath,
  parseBundleManifestJson,
  readBundleEntries,
  relativePath,
  resolveImportTarget,
  serializeMarkdownSource,
} from '~/entry-bundle/shared.ts';
import type { ZipFileEntry } from '~/entry-bundle/zip.ts';

// A components bundle is a portable zip used to hand a *set* of reusable
// component snippets between editors — the bulk analogue of the single-entry
// zip handoff (`~/entry-bundle`). It is deliberately its own schema rather
// than reusing the entry bundle: a component file is a `{slug}.md` with CSS +
// HTML fenced blocks (no post/page kind), so a one-entry-per-zip shape would
// not fit. A component's HTML/CSS may still reference image assets (`<img src>`,
// CSS `url(...)`); those are pulled in under `assets/` so the snippet renders on
// the receiving side instead of pointing at a missing image. Components carry no
// workflow `status`, so — unlike entry import — nothing is stamped on the way in.
export const COMPONENTS_BUNDLE_SCHEMA = 'nectar.components.v1';

export type { ConflictPolicy } from '~/entry-bundle/shared.ts';

const MAX_ENTRIES = 4000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MANIFEST_PATH = 'nectar-components.json';
const COMPONENTS_PREFIX = 'components/';
// Image assets a component's HTML/CSS references travel here as `assets/<rel>`,
// where `<rel>` is relative to the configured assets dir (e.g. content/images).
// Additive to the `v1` schema: an asset-less bundle and an importer predating
// this field both see `assets: []`.
const ASSETS_PREFIX = 'assets/';

export interface ComponentsBundleManifestEntry {
  slug: string;
  path: string;
}

export interface ComponentsBundleManifest {
  schema: string;
  components: ComponentsBundleManifestEntry[];
  site?: { title: string; url: string };
  generated_at?: string;
}

export interface ParsedBundleComponent {
  slug: string;
  description: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ParsedComponentsBundle {
  components: ParsedBundleComponent[];
  assets: ZipFileEntry[];
  manifest: ComponentsBundleManifest;
}

export interface ImportComponentResult {
  written: boolean;
  skipped: boolean;
  renamed: boolean;
  slug: string;
  /** Final slug on disk (differs from `slug` only when renamed on conflict). */
  finalSlug: string;
  path: string;
}

export interface ImportComponentsBundleResult {
  components: ImportComponentResult[];
  written: number;
  skipped: number;
  renamed: number;
  /** Asset paths (relative to cwd) created because the destination lacked them.
   * Existing assets are never overwritten, so they are absent here. Only assets
   * referenced by an imported (non-skipped) component are pulled in. */
  importedAssets: string[];
}

export function parseComponentsBundleZip(zip: Uint8Array): ParsedComponentsBundle {
  const entries = readBundleEntries(zip, {
    maxEntries: MAX_ENTRIES,
    maxTotalBytes: MAX_TOTAL_BYTES,
  });

  const manifestEntry = entries.find((e) => e.path === MANIFEST_PATH);
  if (!manifestEntry) throw new Error(`Bundle is missing ${MANIFEST_PATH} manifest`);
  const manifest = parseManifest(
    parseBundleManifestJson(new TextDecoder().decode(manifestEntry.bytes)),
  );

  const decoder = new TextDecoder();
  const components: ParsedBundleComponent[] = [];
  const assets: ZipFileEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.path === MANIFEST_PATH) continue;
    if (entry.path.startsWith(ASSETS_PREFIX)) {
      const rel = entry.path.slice(ASSETS_PREFIX.length);
      if (!isSafeRelativePath(rel)) {
        throw new Error(`Unsafe asset path in bundle: ${entry.path}`);
      }
      assets.push(entry);
      continue;
    }
    if (!entry.path.startsWith(COMPONENTS_PREFIX)) {
      throw new Error(`Unexpected bundle entry outside components/: ${entry.path}`);
    }
    const rel = entry.path.slice(COMPONENTS_PREFIX.length);
    if (!isSafeComponentFile(rel)) {
      throw new Error(`Unsafe component path in bundle: ${entry.path}`);
    }
    const parsed = parseFrontmatter(decoder.decode(entry.bytes), { filePath: entry.path });
    const slug = String(parsed.data.slug ?? rel.slice(0, -'.md'.length)).trim();
    if (!COMPONENT_SLUG_PATTERN.test(slug)) {
      throw new Error(`Invalid component slug in bundle: ${slug}`);
    }
    if (seen.has(slug)) {
      throw new Error(`Duplicate component slug in bundle: ${slug}`);
    }
    seen.add(slug);
    components.push({
      slug,
      description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
      frontmatter: parsed.data,
      body: parsed.body,
    });
  }

  if (components.length === 0) {
    throw new Error('Bundle contains no components');
  }

  return { components, assets, manifest };
}

function parseManifest(input: unknown): ComponentsBundleManifest {
  if (!isRecord(input)) throw new Error('Invalid bundle manifest: expected an object');
  if (input.schema !== COMPONENTS_BUNDLE_SCHEMA) {
    throw new Error(
      `Unsupported bundle schema: expected ${COMPONENTS_BUNDLE_SCHEMA}, got ${input.schema}`,
    );
  }
  if (!Array.isArray(input.components)) {
    throw new Error('Invalid bundle manifest: components must be an array');
  }
  const components: ComponentsBundleManifestEntry[] = [];
  for (const raw of input.components) {
    if (!isRecord(raw) || typeof raw.slug !== 'string' || typeof raw.path !== 'string') {
      throw new Error('Invalid bundle manifest: each component needs slug and path strings');
    }
    components.push({ slug: raw.slug, path: raw.path });
  }
  // site / generated_at are provenance for the zip copy only; intentionally
  // not surfaced on the parsed bundle.
  return { schema: input.schema, components };
}

export async function exportComponentsBundle({
  cwd,
  config,
  slugs,
}: {
  cwd: string;
  config: NectarConfig;
  /** When omitted, every component is exported. Otherwise the listed slugs. */
  slugs?: string[];
}): Promise<{
  zip: Uint8Array;
  exportedSlugs: string[];
  missing: string[];
  omittedAssets: string[];
}> {
  const available = await loadComponents(cwd, config);
  const bySlug = new Map(available.map((c) => [c.slug, c]));

  const requested = slugs && slugs.length > 0 ? slugs : available.map((c) => c.slug);
  const selected: typeof available = [];
  const missing: string[] = [];
  const picked = new Set<string>();
  for (const slug of requested) {
    if (picked.has(slug)) continue;
    const component = bySlug.get(slug);
    if (!component) {
      missing.push(slug);
      continue;
    }
    picked.add(slug);
    selected.push(component);
  }
  if (selected.length === 0) {
    throw new Error(
      missing.length > 0
        ? `No matching components to export (unknown: ${missing.join(', ')})`
        : 'No components to export',
    );
  }

  const componentsRoot = resolve(cwd, config.content.components_dir);
  const manifestEntries: ComponentsBundleManifestEntry[] = [];
  const fileInputs: { path: string; bytes: Uint8Array }[] = [];
  const assetRels = new Set<string>();
  for (const component of selected) {
    const abs = resolve(cwd, component.source.path);
    if (!isInsidePath(componentsRoot, abs)) {
      throw new Error(`Component is outside its configured directory: ${component.slug}`);
    }
    const buffer = await readFile(abs);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    fileInputs.push({ path: `${COMPONENTS_PREFIX}${component.slug}.md`, bytes });
    for (const ref of collectComponentAssetReferences(new TextDecoder().decode(bytes))) {
      const rel = assetRelFromReference(ref, config.content.assets_dir);
      if (rel) assetRels.add(rel);
    }
    manifestEntries.push({ slug: component.slug, path: relativePath(cwd, abs) });
  }

  // Pull in the image assets the selected components reference so the snippets
  // render on the receiving side. Missing / unsafe / symlinked assets are
  // dropped and reported in omittedAssets, mirroring the entry bundle.
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const { assets, omitted } = await collectReferencedAssetBytes(assetsRoot, assetRels);
  for (const asset of assets) {
    fileInputs.push({ path: `${ASSETS_PREFIX}${asset.rel}`, bytes: asset.bytes });
  }

  const manifest: ComponentsBundleManifest = {
    schema: COMPONENTS_BUNDLE_SCHEMA,
    components: manifestEntries,
    site: { title: config.site.title, url: config.site.url },
    generated_at: new Date().toISOString(),
  };

  const inputs = [
    {
      path: MANIFEST_PATH,
      bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    },
    ...fileInputs,
  ];

  return {
    zip: createZipArchive(inputs),
    exportedSlugs: selected.map((c) => c.slug),
    missing,
    omittedAssets: omitted,
  };
}

// Scan a component file for the assets its HTML/CSS references: HTML `<img src>`,
// CSS `url(...)` (optionally quoted), and markdown images (rare in components but
// harmless to include). The caller resolves each to an assets-dir-relative path.
function collectComponentAssetReferences(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (m[1]) out.push(m[1]);
  }
  for (const m of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (m[1]) out.push(m[1]);
  }
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    if (m[2]) out.push(m[2].trim());
  }
  return out;
}

export async function importComponentsBundle({
  cwd,
  config,
  zip,
  onConflict,
  dryRun = false,
  slugs,
}: {
  cwd: string;
  config: NectarConfig;
  zip: Uint8Array;
  onConflict: ConflictPolicy;
  dryRun?: boolean;
  /** When provided, only import bundle components whose slug is in this list
   * (the editor can untick snippets in the import preview). Omit for all. */
  slugs?: string[];
}): Promise<ImportComponentsBundleResult> {
  const bundle = parseComponentsBundleZip(zip);
  const root = resolve(cwd, config.content.components_dir);
  if (!dryRun) await mkdir(root, { recursive: true });

  const allow = slugs && slugs.length > 0 ? new Set(slugs) : null;
  const targets = allow
    ? bundle.components.filter((component) => allow.has(component.slug))
    : bundle.components;

  const results: ImportComponentResult[] = [];
  // Assets are only restored for components that actually land — a skipped or
  // unticked snippet should not drag its images in. Collect the assets-dir-
  // relative paths the imported components reference as we go.
  const neededAssetRels = new Set<string>();
  for (const component of targets) {
    const target = resolveImportTarget(root, component.slug, onConflict, {
      validateSlug: (slug) => COMPONENT_SLUG_PATTERN.test(slug),
    });
    const path = relativePath(cwd, target.path);
    if (target.skipped) {
      results.push({
        written: false,
        skipped: true,
        renamed: false,
        slug: component.slug,
        finalSlug: component.slug,
        path,
      });
      continue;
    }

    // Components carry no workflow status, so import simply lands the snippet.
    // When renamed on conflict, the in-file slug must follow the filename so
    // the `{slug}` shortcode still resolves.
    const frontmatter = { ...component.frontmatter, slug: target.slug };
    const serialized = serializeMarkdownSource(frontmatter, component.body, target.path);
    for (const ref of collectComponentAssetReferences(serialized)) {
      const rel = assetRelFromReference(ref, config.content.assets_dir);
      if (rel) neededAssetRels.add(rel);
    }
    if (!dryRun) {
      await assertWritablePathHasNoSymlink(root, target.path, { label: 'components directory' });
      await writeFile(target.path, serialized, 'utf8');
    }
    results.push({
      written: !dryRun,
      skipped: false,
      renamed: target.renamed,
      slug: component.slug,
      finalSlug: target.slug,
      path,
    });
  }

  // Restore referenced assets the destination is missing. Never overwrite an
  // existing asset: the receiver's own copy of a shared path wins, matching the
  // component "import only when absent" rule. Computed even on a dry run so the
  // preview can show what would be created.
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const importedAssets: string[] = [];
  for (const asset of bundle.assets) {
    const rel = asset.path.slice(ASSETS_PREFIX.length);
    if (!neededAssetRels.has(rel)) continue;
    const dest = join(assetsRoot, rel);
    if (existsSync(dest)) continue;
    if (!dryRun) {
      await assertWritablePathHasNoSymlink(assetsRoot, dest, { label: 'assets directory' });
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, asset.bytes);
    }
    importedAssets.push(relativePath(cwd, dest));
  }

  return {
    components: results,
    written: results.filter((r) => r.written).length,
    skipped: results.filter((r) => r.skipped).length,
    renamed: results.filter((r) => r.renamed).length,
    importedAssets,
  };
}

function isSafeComponentFile(value: string): boolean {
  return (
    value.endsWith('.md') &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !isAbsolute(value) &&
    value !== '.md' &&
    value !== '..'
  );
}
