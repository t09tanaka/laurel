import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { absolutise, resolveContentSlugPath } from '~/cli/content-paths.ts';
import { createZipArchive } from '~/cli/dashboard/zip-writer.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { formatContentSource } from '~/content/format.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { type ZipFileEntry, readZipArchive } from '~/entry-bundle/zip.ts';
import { pathContainsSymlink } from '~/util/fs.ts';

export const BUNDLE_SCHEMA = 'nectar.bundle.v1';

export type EntryKind = 'post' | 'page';
export type ConflictPolicy = 'skip' | 'overwrite' | 'rename';

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MANIFEST_PATH = 'nectar-bundle.json';
const ENTRY_PATH = 'entry.md';
const ASSETS_PREFIX = 'assets/';
// Tag definition files referenced by the entry travel under this prefix as
// `tags/<slug>.md`, so the receiving side can recreate a tag (name,
// description, feature image, …) that does not yet exist locally instead of
// falling back to a bare auto-stub. The bundle schema stays `v1`: tags/ is
// purely additive, so a tag-less bundle parses exactly as before and an
// importer that predates this field simply finds `tags: []`.
const TAGS_PREFIX = 'tags/';

export interface EntryBundleManifest {
  schema: string;
  kind: EntryKind;
  slug: string;
  path: string;
  site?: { title: string; url: string };
  generated_at?: string;
}

export interface ParsedBundleTag {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ParsedEntryBundle {
  kind: EntryKind;
  slug: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  assets: ZipFileEntry[];
  tags: ParsedBundleTag[];
  manifest: EntryBundleManifest;
}

export interface ImportEntryResult {
  written: boolean;
  skipped: boolean;
  renamed: boolean;
  kind: EntryKind;
  slug: string;
  entryPath: string;
  assetPaths: string[];
  /** Tag slugs whose definition file was created because the destination
   * lacked one. Existing tags are never overwritten, so they are absent here. */
  importedTags: string[];
  warnings: string[];
  /** Summary of the incoming entry, for an import preview before committing. */
  preview: { title: string; excerpt: string; assetCount: number; tagCount: number };
}

export function parseEntryBundleZip(zip: Uint8Array): ParsedEntryBundle {
  const entries = readZipArchive(zip);
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Bundle has too many entries: ${entries.length} > ${MAX_ENTRIES}`);
  }
  let total = 0;
  for (const entry of entries) {
    total += entry.bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Bundle exceeds maximum total size of ${MAX_TOTAL_BYTES} bytes`);
    }
  }

  const manifestEntry = entries.find((e) => e.path === MANIFEST_PATH);
  if (!manifestEntry) throw new Error(`Bundle is missing ${MANIFEST_PATH} manifest`);
  const manifest = parseManifest(safeJsonParse(new TextDecoder().decode(manifestEntry.bytes)));

  const entryEntry = entries.find((e) => e.path === ENTRY_PATH);
  if (!entryEntry) throw new Error(`Bundle is missing ${ENTRY_PATH}`);
  const parsed = parseFrontmatter(new TextDecoder().decode(entryEntry.bytes), {
    filePath: ENTRY_PATH,
  });

  const assets: ZipFileEntry[] = [];
  const tags: ParsedBundleTag[] = [];
  for (const entry of entries) {
    if (entry.path === MANIFEST_PATH || entry.path === ENTRY_PATH) continue;
    if (entry.path.startsWith(TAGS_PREFIX)) {
      tags.push(parseBundleTag(entry));
      continue;
    }
    if (!entry.path.startsWith(ASSETS_PREFIX)) {
      throw new Error(`Unexpected bundle entry outside assets/: ${entry.path}`);
    }
    const rel = entry.path.slice(ASSETS_PREFIX.length);
    if (!isSafeRelativePath(rel)) {
      throw new Error(`Unsafe asset path in bundle: ${entry.path}`);
    }
    assets.push(entry);
  }

  return {
    kind: manifest.kind,
    slug: manifest.slug,
    path: manifest.path,
    frontmatter: parsed.data,
    body: parsed.body,
    assets,
    tags,
    manifest,
  };
}

function parseBundleTag(entry: ZipFileEntry): ParsedBundleTag {
  const rel = entry.path.slice(TAGS_PREFIX.length);
  // Tags live flat as `tags/<slug>.md`. Reject nesting / traversal and any
  // non-markdown file so a crafted bundle cannot escape the tags directory or
  // smuggle an executable payload past the importer.
  if (!isSafeRelativePath(rel) || rel.includes('/') || extname(rel) !== '.md') {
    throw new Error(`Unsafe tag path in bundle: ${entry.path}`);
  }
  const slug = safeSlug(basename(rel, '.md'));
  const parsed = parseFrontmatter(new TextDecoder().decode(entry.bytes), { filePath: entry.path });
  return { slug, frontmatter: parsed.data, body: parsed.body };
}

function parseManifest(input: unknown): EntryBundleManifest {
  if (!isRecord(input)) throw new Error('Invalid bundle manifest: expected an object');
  if (input.schema !== BUNDLE_SCHEMA) {
    throw new Error(`Unsupported bundle schema: expected ${BUNDLE_SCHEMA}, got ${input.schema}`);
  }
  if (input.kind !== 'post' && input.kind !== 'page') {
    throw new Error(`Invalid bundle manifest: kind must be 'post' or 'page', got ${input.kind}`);
  }
  if (typeof input.slug !== 'string' || typeof input.path !== 'string') {
    throw new Error('Invalid bundle manifest: slug and path must be strings');
  }
  // site and generated_at are provenance fields for the zip copy only; they are
  // intentionally not surfaced on ParsedEntryBundle so the round-trip looks
  // lossy by design, not by accident.
  return { schema: input.schema, kind: input.kind, slug: input.slug, path: input.path };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid bundle manifest: not valid JSON');
  }
}

export async function exportEntryBundle({
  cwd,
  config,
  kind,
  slug,
}: {
  cwd: string;
  config: NectarConfig;
  kind: EntryKind;
  slug: string;
}): Promise<{ zip: Uint8Array; omittedAssets: string[]; bundledTags: string[] }> {
  const root = rootForKind(cwd, config, kind);
  const resolved = await resolveContentSlugPath(slug, [kind === 'post' ? 'posts' : 'pages'], {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: absolutise(cwd, config.content.pages_dir),
  });
  if (!resolved) throw new Error(`${kind} not found: ${slug}`);
  // resolveContentSlugPath already confirmed the file exists, so a sync
  // containment check suffices here; it still guards against a resolver-fallback
  // escape where an adversarial slug could traverse outside the content root.
  if (!isInsidePath(resolve(root), resolve(resolved.path))) {
    throw new Error(`${kind} is outside its configured directory: ${slug}`);
  }

  const raw = await readFile(resolved.path, 'utf8');
  const parsed = parseFrontmatter(raw, { filePath: resolved.path });
  // Neutral transport: the bundle carries the entry's status as-is. The
  // sender sets the workflow status (needs-review / approved / draft / …) in
  // the editor before exporting, and import preserves it — so the same zip
  // works writer→reviewer and reviewer→writer.
  const frontmatter = parsed.data;

  // Pull in the definition files for tags the entry references so the tag's
  // name / description / feature image survive the handoff. Without this the
  // receiver's loader would auto-stub the tag from its slug alone, silently
  // dropping every other field.
  const tagDefs = await collectReferencedTagDefinitions({ cwd, config, frontmatter });

  const { assets, omitted } = await collectBundleAssets({
    cwd,
    config,
    frontmatter,
    body: parsed.body,
    // Tag feature images live under the same assets dir; bundle them too so a
    // freshly-created tag is not left pointing at a missing image.
    extraFrontmatters: tagDefs.map((t) => t.frontmatter),
  });

  const manifest: EntryBundleManifest = {
    schema: BUNDLE_SCHEMA,
    kind,
    slug,
    path: relativePath(cwd, resolved.path),
    site: { title: config.site.title, url: config.site.url },
    generated_at: new Date().toISOString(),
  };

  const inputs = [
    {
      path: MANIFEST_PATH,
      bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    },
    {
      path: ENTRY_PATH,
      bytes: new TextEncoder().encode(serializeEntryMarkdown(frontmatter, parsed.body, ENTRY_PATH)),
    },
    ...tagDefs.map((tag) => ({
      path: `${TAGS_PREFIX}${tag.slug}.md`,
      bytes: new TextEncoder().encode(
        serializeEntryMarkdown(tag.frontmatter, tag.body, `${TAGS_PREFIX}${tag.slug}.md`),
      ),
    })),
    ...assets.map((asset) => ({ path: `${ASSETS_PREFIX}${asset.rel}`, bytes: asset.bytes })),
  ];

  return {
    zip: createZipArchive(inputs),
    omittedAssets: omitted,
    bundledTags: tagDefs.map((t) => t.slug),
  };
}

export async function importEntryBundle({
  cwd,
  config,
  zip,
  onConflict,
  dryRun = false,
}: {
  cwd: string;
  config: NectarConfig;
  zip: Uint8Array;
  onConflict: ConflictPolicy;
  dryRun?: boolean;
}): Promise<ImportEntryResult> {
  const bundle = parseEntryBundleZip(zip);
  const root = rootForKind(cwd, config, bundle.kind);
  await mkdir(root, { recursive: true });

  const preview = {
    title: typeof bundle.frontmatter.title === 'string' ? bundle.frontmatter.title : bundle.slug,
    excerpt: excerptFromBody(bundle.body),
    assetCount: bundle.assets.length,
    tagCount: bundle.tags.length,
  };

  const requestedSlug = safeSlug(String(bundle.frontmatter.slug ?? bundle.slug));
  const target = resolveImportTarget(root, requestedSlug, onConflict);
  const entryPath = relativePath(cwd, target.path);
  if (target.skipped) {
    // The entry itself is not coming in, so neither are its tags — bringing a
    // tag in for an entry we declined would leave an orphan definition.
    return {
      written: false,
      skipped: true,
      renamed: false,
      kind: bundle.kind,
      slug: requestedSlug,
      entryPath,
      assetPaths: [],
      importedTags: [],
      warnings: [],
      preview,
    };
  }

  // Importing brings an entry in from outside, so it always lands as
  // needs-review — a reviewer approves it from there. (Export does not stamp
  // status; the directional flow lives entirely on the import side.)
  const frontmatter = { ...bundle.frontmatter, slug: target.slug, status: 'needs-review' };
  const warnings = await collectImportWarnings(cwd, config, frontmatter);

  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const writes: { dest: string; bytes: Uint8Array }[] = [];
  const assetPaths: string[] = [];
  for (const asset of bundle.assets) {
    const rel = asset.path.slice(ASSETS_PREFIX.length);
    const dest = join(assetsRoot, rel);
    await assertWritablePathHasNoSymlink(assetsRoot, dest);
    writes.push({ dest, bytes: asset.bytes });
    assetPaths.push(relativePath(cwd, dest));
  }
  await assertWritablePathHasNoSymlink(root, target.path);

  // Create any bundled tag whose definition the destination is missing. We
  // never overwrite an existing tag file: the receiver's own name / image /
  // visibility for a shared slug wins, matching the "import only when absent"
  // intent. The result is computed even on a dry run so the preview can show
  // what would be created.
  const tagsRoot = absolutise(cwd, config.content.tags_dir);
  const existingTags = await existingTagSlugs(tagsRoot);
  const tagWrites: { dest: string; bytes: Uint8Array }[] = [];
  const importedTags: string[] = [];
  for (const tag of bundle.tags) {
    if (existingTags.has(tag.slug.toLowerCase())) continue;
    const dest = join(tagsRoot, `${tag.slug}.md`);
    await assertWritablePathHasNoSymlink(tagsRoot, dest);
    tagWrites.push({
      dest,
      bytes: new TextEncoder().encode(
        serializeEntryMarkdown(tag.frontmatter, tag.body, relativePath(cwd, dest)),
      ),
    });
    importedTags.push(tag.slug);
  }

  // Flag tags the entry references that will neither pre-exist nor be created
  // (an older bundle without tags/, or a tag whose definition file was absent
  // at export time). The loader will auto-stub these from the slug, losing
  // every other field — surfacing it here lets the reviewer add the tag.
  const willExist = new Set([...existingTags, ...importedTags.map((s) => s.toLowerCase())]);
  for (const tagSlug of tagSlugsFrom(bundle.frontmatter.tags, bundle.frontmatter.primary_tag)) {
    if (!willExist.has(tagSlug.toLowerCase())) {
      warnings.push(`tag "${tagSlug}" not found in content/tags and no definition was bundled`);
    }
  }

  if (!dryRun) {
    await writeFile(
      target.path,
      serializeEntryMarkdown(frontmatter, bundle.body, entryPath),
      'utf8',
    );
    for (const write of writes) {
      await mkdir(dirname(write.dest), { recursive: true });
      await writeFile(write.dest, write.bytes);
    }
    for (const write of tagWrites) {
      await mkdir(dirname(write.dest), { recursive: true });
      await writeFile(write.dest, write.bytes);
    }
  }

  return {
    written: !dryRun,
    skipped: false,
    renamed: target.renamed,
    kind: bundle.kind,
    slug: target.slug,
    entryPath,
    assetPaths,
    importedTags,
    warnings,
    preview,
  };
}

function excerptFromBody(body: string): string {
  const text = body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/[#>*_`>\-]/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function serializeEntryMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string,
): string {
  const withNewline = body.endsWith('\n') ? body : `${body}\n`;
  return formatContentSource(
    `---\n${JSON.stringify(frontmatter)}\n---\n${withNewline.startsWith('\n') ? withNewline : `\n${withNewline}`}`,
    { filePath },
  );
}

async function collectBundleAssets({
  cwd,
  config,
  frontmatter,
  body,
  extraFrontmatters = [],
}: {
  cwd: string;
  config: NectarConfig;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Additional frontmatters (e.g. bundled tag definitions) whose asset
   * references should also be pulled into the bundle. */
  extraFrontmatters?: Record<string, unknown>[];
}): Promise<{ assets: { rel: string; bytes: Uint8Array }[]; omitted: string[] }> {
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const rels = new Set<string>();
  for (const fm of [frontmatter, ...extraFrontmatters]) {
    for (const value of collectStringValues(fm)) {
      const rel = assetRelFromReference(value, config.content.assets_dir);
      if (rel) rels.add(rel);
    }
  }
  for (const value of collectBodyAssetReferences(body)) {
    const rel = assetRelFromReference(value, config.content.assets_dir);
    if (rel) rels.add(rel);
  }

  const assets: { rel: string; bytes: Uint8Array }[] = [];
  const omitted: string[] = [];
  for (const rel of [...rels].sort()) {
    const abs = join(assetsRoot, rel);
    if (pathContainsSymlink(assetsRoot, rel) || !isInsidePath(resolve(assetsRoot), resolve(abs))) {
      omitted.push(rel);
      continue;
    }
    const info = await stat(abs).catch(() => undefined);
    if (!info?.isFile()) {
      omitted.push(rel);
      continue;
    }
    const buffer = await readFile(abs);
    assets.push({
      rel,
      bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    });
  }
  return { assets, omitted };
}

async function collectImportWarnings(
  cwd: string,
  config: NectarConfig,
  frontmatter: Record<string, unknown>,
): Promise<string[]> {
  const slugs = new Set<string>();
  for (const value of [frontmatter.author, frontmatter.authors]) {
    for (const slug of authorSlugsFrom(value)) slugs.add(slug);
  }
  if (slugs.size === 0) return [];

  const authorsRoot = absolutise(cwd, config.content.authors_dir);
  let known: Set<string>;
  try {
    const files = await readdir(authorsRoot);
    known = new Set(
      files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -'.md'.length).toLowerCase()),
    );
  } catch {
    return [];
  }

  const warnings: string[] = [];
  for (const slug of slugs) {
    if (!known.has(slug.toLowerCase())) {
      warnings.push(`author "${slug}" not found in content/authors`);
    }
  }
  return warnings;
}

function authorSlugsFrom(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(authorSlugsFrom);
  if (isRecord(value) && typeof value.slug === 'string') {
    return value.slug.trim() ? [value.slug.trim()] : [];
  }
  return [];
}

// Tag references in frontmatter mirror authors: a bare slug string, an array
// of them, or `{ slug }` objects. `primary_tag` is folded in so a post that
// only names its tag there still travels with the definition. Returns a
// de-duplicated list preserving first-seen order.
function tagSlugsFrom(...values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const slug = value.trim();
      if (slug && !seen.has(slug.toLowerCase())) {
        seen.add(slug.toLowerCase());
        out.push(slug);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (isRecord(value) && typeof value.slug === 'string') {
      visit(value.slug);
    }
  };
  for (const value of values) visit(value);
  return out;
}

// Read the tag definition files for the slugs an entry references. A tag's
// canonical slug is its frontmatter `slug` when valid, else the file basename
// (mirroring the content loader), so a file named off-slug still matches. Tags
// without a definition file are skipped — they have nothing to carry.
async function collectReferencedTagDefinitions({
  cwd,
  config,
  frontmatter,
}: {
  cwd: string;
  config: NectarConfig;
  frontmatter: Record<string, unknown>;
}): Promise<ParsedBundleTag[]> {
  const referenced = new Set(
    tagSlugsFrom(frontmatter.tags, frontmatter.primary_tag).map((s) => s.toLowerCase()),
  );
  if (referenced.size === 0) return [];

  const tagsRoot = absolutise(cwd, config.content.tags_dir);
  let files: string[];
  try {
    files = (await readdir(tagsRoot)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const defs: ParsedBundleTag[] = [];
  const taken = new Set<string>();
  for (const file of files.sort()) {
    const abs = join(tagsRoot, file);
    if (await isSymlink(abs)) continue;
    const raw = await readFile(abs, 'utf8').catch(() => undefined);
    if (raw === undefined) continue;
    const parsed = parseFrontmatter(raw, { filePath: abs });
    const slug = tagFileSlug(file, parsed.data);
    if (!slug || !referenced.has(slug) || taken.has(slug)) continue;
    taken.add(slug);
    defs.push({ slug, frontmatter: parsed.data, body: parsed.body });
  }
  return defs;
}

// Resolve the slug a tag definition file represents, lower-cased for matching.
function tagFileSlug(file: string, frontmatter: Record<string, unknown>): string | undefined {
  const fromFm = typeof frontmatter.slug === 'string' ? frontmatter.slug.trim().toLowerCase() : '';
  if (fromFm && /^[a-z0-9][a-z0-9-]*$/.test(fromFm)) return fromFm;
  const fromName = basename(file, '.md').toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(fromName) ? fromName : undefined;
}

// Lower-cased slugs already defined under the tags directory, used to decide
// whether a bundled tag is a fresh addition or would clobber a local one.
async function existingTagSlugs(tagsRoot: string): Promise<Set<string>> {
  let files: string[];
  try {
    files = (await readdir(tagsRoot)).filter((f) => f.endsWith('.md'));
  } catch {
    return new Set();
  }
  const slugs = new Set<string>();
  for (const file of files) {
    const abs = join(tagsRoot, file);
    const raw = await readFile(abs, 'utf8').catch(() => undefined);
    const slug =
      raw === undefined
        ? undefined
        : tagFileSlug(file, parseFrontmatter(raw, { filePath: abs }).data);
    if (slug) slugs.add(slug);
  }
  return slugs;
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

function rootForKind(cwd: string, config: NectarConfig, kind: EntryKind): string {
  return absolutise(cwd, kind === 'post' ? config.content.posts_dir : config.content.pages_dir);
}

async function assertWritablePathHasNoSymlink(root: string, target: string): Promise<void> {
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  if (!isInsidePath(rootAbs, targetAbs)) {
    throw new Error(`Refusing to write outside configured content directory: ${target}`);
  }
  const rel = relative(rootAbs, targetAbs);
  const parts = rel ? rel.split(sep) : [];
  let current = rootAbs;
  // A not-yet-created root (e.g. importing an asset- or tag-bearing bundle into
  // a fresh project that has no content/images or content/tags yet) is not a
  // symlink risk — the recursive mkdir at write time creates it. Tolerate
  // ENOENT here just as the per-segment walk below does.
  try {
    await assertNotSymlink(current);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
  for (const part of parts) {
    current = join(current, part);
    try {
      await assertNotSymlink(current);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
  }
}

async function assertNotSymlink(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${path}`);
}

function resolveImportTarget(
  root: string,
  requestedSlug: string,
  onConflict: ConflictPolicy,
): { path: string; slug: string; skipped: boolean; renamed: boolean } {
  const first = join(root, `${requestedSlug}.md`);
  if (!existsSync(first)) {
    return { path: first, slug: requestedSlug, skipped: false, renamed: false };
  }
  if (onConflict === 'skip') {
    return { path: first, slug: requestedSlug, skipped: true, renamed: false };
  }
  if (onConflict === 'overwrite') {
    return { path: first, slug: requestedSlug, skipped: false, renamed: false };
  }
  for (let i = 2; i < 1000; i += 1) {
    const slug = `${requestedSlug}-${i}`;
    const candidate = join(root, `${slug}.md`);
    if (!existsSync(candidate)) return { path: candidate, slug, skipped: false, renamed: true };
  }
  throw new Error(`Could not find an available filename for slug: ${requestedSlug}`);
}

function isNotFoundError(err: unknown): boolean {
  return isRecord(err) && err.code === 'ENOENT';
}

function assetRelFromReference(value: string, assetsDir: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('data:')) return undefined;
  const normalizedAssets = assetsDir.replace(/^\/+|\/+$/g, '');
  const normalized = value.replace(/^\/+/, '').split(/[?#]/, 1)[0] ?? '';
  if (!normalized.startsWith(`${normalizedAssets}/`)) return undefined;
  const rel = normalized.slice(normalizedAssets.length + 1);
  if (!isSafeRelativePath(rel)) return undefined;
  return rel;
}

function collectBodyAssetReferences(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match[1]) out.push(match[1]);
  }
  for (const match of body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (isRecord(value)) return Object.values(value).flatMap(collectStringValues);
  return [];
}

function safeSlug(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    throw new Error(`Invalid slug in bundle: ${value}`);
  }
  return trimmed;
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function relativePath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
