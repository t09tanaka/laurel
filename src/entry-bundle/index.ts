import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { absolutise, resolveContentSlugPath } from '~/cli/content-paths.ts';
import { createZipArchive } from '~/cli/dashboard/zip-writer.ts';
import type { LaurelConfig } from '~/config/schema.ts';
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

export const BUNDLE_SCHEMA = 'laurel.bundle.v1';

export type EntryKind = 'post' | 'page';
export type { ConflictPolicy };

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MANIFEST_PATH = 'laurel-bundle.json';
const ENTRY_PATH = 'entry.md';
const ASSETS_PREFIX = 'assets/';
// Tag definition files referenced by the entry travel under this prefix as
// `tags/<slug>.md`, so the receiving side can recreate a tag (name,
// description, feature image, …) that does not yet exist locally instead of
// falling back to a bare auto-stub. The bundle schema stays `v1`: tags/ is
// purely additive, so a tag-less bundle parses exactly as before and an
// importer that predates this field simply finds `tags: []`.
const TAGS_PREFIX = 'tags/';
// Author definition files referenced by the entry travel under this prefix as
// `authors/<slug>.md`, mirroring `tags/`. Without it the receiver's loader
// auto-stubs the author from the slug alone, dropping name / bio / profile
// image / social links. Additive to the `v1` schema: an author-less bundle and
// a pre-existing importer both see `authors: []`.
const AUTHORS_PREFIX = 'authors/';

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

export interface ParsedBundleAuthor {
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
  authors: ParsedBundleAuthor[];
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
  /** Author slugs whose definition file was created because the destination
   * lacked one. Existing authors are never overwritten, so they are absent here. */
  importedAuthors: string[];
  warnings: string[];
  /** Summary of the incoming entry, for an import preview before committing. */
  preview: {
    title: string;
    excerpt: string;
    assetCount: number;
    tagCount: number;
    authorCount: number;
  };
  /**
   * Populated on a dry-run when the slug collides with an existing entry. Both
   * sides are the entry's *editorial* view — its title on the first line
   * followed by the body — so the dashboard renders a line-level diff of just
   * the content a reviewer can meaningfully merge. Metadata (dates, tags,
   * authors, status, …) is deliberately excluded from the diff and always taken
   * from the incoming bundle on overwrite.
   */
  conflict?: { existing: string; incoming: string };
}

export function parseEntryBundleZip(zip: Uint8Array): ParsedEntryBundle {
  const entries = readBundleEntries(zip, {
    maxEntries: MAX_ENTRIES,
    maxTotalBytes: MAX_TOTAL_BYTES,
  });

  const manifestEntry = entries.find((e) => e.path === MANIFEST_PATH);
  if (!manifestEntry) throw new Error(`Bundle is missing ${MANIFEST_PATH} manifest`);
  const manifest = parseManifest(
    parseBundleManifestJson(new TextDecoder().decode(manifestEntry.bytes)),
  );

  const entryEntry = entries.find((e) => e.path === ENTRY_PATH);
  if (!entryEntry) throw new Error(`Bundle is missing ${ENTRY_PATH}`);
  const parsed = parseFrontmatter(new TextDecoder().decode(entryEntry.bytes), {
    filePath: ENTRY_PATH,
  });

  const assets: ZipFileEntry[] = [];
  const tags: ParsedBundleTag[] = [];
  const authors: ParsedBundleAuthor[] = [];
  for (const entry of entries) {
    if (entry.path === MANIFEST_PATH || entry.path === ENTRY_PATH) continue;
    if (entry.path.startsWith(TAGS_PREFIX)) {
      tags.push(parseBundleTag(entry));
      continue;
    }
    if (entry.path.startsWith(AUTHORS_PREFIX)) {
      authors.push(parseBundleAuthor(entry));
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
    authors,
    manifest,
  };
}

function parseBundleTag(entry: ZipFileEntry): ParsedBundleTag {
  return parseFlatDefinition(entry, TAGS_PREFIX, 'tag');
}

function parseBundleAuthor(entry: ZipFileEntry): ParsedBundleAuthor {
  return parseFlatDefinition(entry, AUTHORS_PREFIX, 'author');
}

// Tags and authors both travel as a flat `<prefix><slug>.md`. Reject nesting /
// traversal and any non-markdown file so a crafted bundle cannot escape the
// directory or smuggle an executable payload past the importer.
function parseFlatDefinition(
  entry: ZipFileEntry,
  prefix: string,
  kind: 'tag' | 'author',
): { slug: string; frontmatter: Record<string, unknown>; body: string } {
  const rel = entry.path.slice(prefix.length);
  if (!isSafeRelativePath(rel) || rel.includes('/') || extname(rel) !== '.md') {
    throw new Error(`Unsafe ${kind} path in bundle: ${entry.path}`);
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

export async function exportEntryBundle({
  cwd,
  config,
  kind,
  slug,
}: {
  cwd: string;
  config: LaurelConfig;
  kind: EntryKind;
  slug: string;
}): Promise<{
  zip: Uint8Array;
  omittedAssets: string[];
  bundledTags: string[];
  bundledAuthors: string[];
}> {
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
  // Same handoff problem for authors: carry their definition files so the
  // receiver keeps name / bio / profile image instead of auto-stubbing.
  const authorDefs = await collectReferencedAuthorDefinitions({ cwd, config, frontmatter });

  const { assets, omitted } = await collectBundleAssets({
    cwd,
    config,
    frontmatter,
    body: parsed.body,
    // Tag feature images and author profile/cover images live under the same
    // assets dir; bundle them too so a freshly-created tag or author is not
    // left pointing at a missing image.
    extraFrontmatters: [...tagDefs, ...authorDefs].map((d) => d.frontmatter),
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
      bytes: new TextEncoder().encode(
        serializeMarkdownSource(frontmatter, parsed.body, ENTRY_PATH),
      ),
    },
    ...tagDefs.map((tag) => ({
      path: `${TAGS_PREFIX}${tag.slug}.md`,
      bytes: new TextEncoder().encode(
        serializeMarkdownSource(tag.frontmatter, tag.body, `${TAGS_PREFIX}${tag.slug}.md`),
      ),
    })),
    ...authorDefs.map((author) => ({
      path: `${AUTHORS_PREFIX}${author.slug}.md`,
      bytes: new TextEncoder().encode(
        serializeMarkdownSource(
          author.frontmatter,
          author.body,
          `${AUTHORS_PREFIX}${author.slug}.md`,
        ),
      ),
    })),
    ...assets.map((asset) => ({ path: `${ASSETS_PREFIX}${asset.rel}`, bytes: asset.bytes })),
  ];

  return {
    zip: createZipArchive(inputs),
    omittedAssets: omitted,
    bundledTags: tagDefs.map((t) => t.slug),
    bundledAuthors: authorDefs.map((a) => a.slug),
  };
}

/**
 * The import diff/merge surface is the entry's *editorial* content only: its
 * title and body. Metadata (dates, tags, authors, status, …) is never diffed
 * because a reviewer can't merge it line by line meaningfully; it always comes
 * from the incoming bundle. The editorial doc is the title on the first line
 * followed by the body, so a one-line title change and any body change are the
 * only hunks the reviewer sees.
 */
function editorialDoc(title: string, body: string): string {
  return `${title}\n${body}`;
}

function titleOf(frontmatter: Record<string, unknown>): string {
  return typeof frontmatter.title === 'string' ? frontmatter.title : '';
}

/** Split a merged editorial doc back into its title (first line) and body (rest). */
function splitEditorialDoc(doc: string): { title: string; body: string } {
  const nl = doc.indexOf('\n');
  if (nl === -1) return { title: doc, body: '' };
  return { title: doc.slice(0, nl), body: doc.slice(nl + 1) };
}

/** The editorial view of an entry already on disk, for diffing / stale checks. */
function editorialFromRaw(raw: string, filePath: string): string {
  const parsed = parseFrontmatter(raw, { filePath });
  return editorialDoc(titleOf(parsed.data), parsed.body);
}

export async function importEntryBundle({
  cwd,
  config,
  zip,
  onConflict,
  dryRun = false,
  mergedContent,
  expectedExisting,
}: {
  cwd: string;
  config: LaurelConfig;
  zip: Uint8Array;
  onConflict: ConflictPolicy;
  dryRun?: boolean;
  /**
   * When provided, this is the dashboard's per-line merge of the *editorial*
   * content (title on the first line, body after) — not a full entry. Only
   * honored when overwriting a real collision. The merged title and body are
   * recombined with the incoming bundle's metadata server-side, so the client
   * cannot smuggle frontmatter (status, slug, dates, …): status is still forced
   * to needs-review and the slug stays pinned to the target. Assets are still
   * taken from the bundle.
   */
  mergedContent?: string;
  /**
   * The editorial existing content the merge was built against (the dry-run
   * `conflict.existing`). If the entry's title/body on disk no longer matches,
   * the merge is stale and the write is rejected rather than silently
   * clobbering edits made since the diff was opened. A metadata-only change on
   * disk does not trip this, since metadata is taken from the bundle anyway.
   */
  expectedExisting?: string;
}): Promise<ImportEntryResult> {
  const bundle = parseEntryBundleZip(zip);
  const root = rootForKind(cwd, config, bundle.kind);
  await mkdir(root, { recursive: true });

  const preview = {
    title: typeof bundle.frontmatter.title === 'string' ? bundle.frontmatter.title : bundle.slug,
    excerpt: excerptFromBody(bundle.body),
    assetCount: bundle.assets.length,
    tagCount: bundle.tags.length,
    authorCount: bundle.authors.length,
  };

  const requestedSlug = safeSlug(String(bundle.frontmatter.slug ?? bundle.slug));
  const target = resolveImportTarget(root, requestedSlug, onConflict);
  const entryPath = relativePath(cwd, target.path);
  const collisionPath = join(root, `${requestedSlug}.md`);
  const collisionExists = existsSync(collisionPath);

  // Importing brings an entry in from outside, so it always lands as
  // needs-review — a reviewer approves it from there. (Export does not stamp
  // status; the directional flow lives entirely on the import side.)
  const frontmatter = { ...bundle.frontmatter, slug: target.slug, status: 'needs-review' };

  // On a dry-run collision, surface both editorial views (title + body) so the
  // dashboard can render a line-level diff of just the content. Metadata is left
  // out — on overwrite it always comes from the bundle. Computed against the
  // requested-slug path (where the collision is), independent of the chosen
  // policy, so the skip-policy probe still gets the diff.
  let conflict: { existing: string; incoming: string } | undefined;
  if (dryRun && collisionExists) {
    const existingRaw = await readFile(collisionPath, 'utf8');
    conflict = {
      existing: editorialFromRaw(existingRaw, collisionPath),
      incoming: editorialDoc(titleOf(frontmatter), bundle.body),
    };
  }

  if (target.skipped) {
    // The entry itself is not coming in, so neither are its tags or authors —
    // bringing a definition in for an entry we declined would leave an orphan.
    return {
      written: false,
      skipped: true,
      renamed: false,
      kind: bundle.kind,
      slug: requestedSlug,
      entryPath,
      assetPaths: [],
      importedTags: [],
      importedAuthors: [],
      warnings: [],
      preview,
      conflict,
    };
  }

  // A hand-merged entry only makes sense when overwriting an entry that really
  // exists; reject it otherwise so a merge can't ride in on a skip/rename or a
  // non-colliding import.
  if (
    mergedContent !== undefined &&
    !(onConflict === 'overwrite' && collisionExists && target.path === collisionPath)
  ) {
    throw new Error('A merged entry is only valid when overwriting an existing entry');
  }

  // The merge is editorial-only: the reviewer's merged title + body. Metadata
  // (slug, status, dates, tags, …) always comes from the incoming `frontmatter`
  // below, so the client cannot smuggle frontmatter through the merge.
  const mergedEditorial =
    mergedContent !== undefined ? splitEditorialDoc(mergedContent) : undefined;

  // Tag/author "not found" warnings are appended below as their definitions are
  // reconciled against the destination.
  const warnings: string[] = [];

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
  const existingTags = await existingDefinitionSlugs(tagsRoot, definitionFileSlug);
  const tagWrites: { dest: string; bytes: Uint8Array }[] = [];
  const importedTags: string[] = [];
  for (const tag of bundle.tags) {
    if (existingTags.has(tag.slug.toLowerCase())) continue;
    const dest = join(tagsRoot, `${tag.slug}.md`);
    await assertWritablePathHasNoSymlink(tagsRoot, dest);
    tagWrites.push({
      dest,
      bytes: new TextEncoder().encode(
        serializeMarkdownSource(tag.frontmatter, tag.body, relativePath(cwd, dest)),
      ),
    });
    importedTags.push(tag.slug);
  }

  // Flag tags the entry references that will neither pre-exist nor be created
  // (an older bundle without tags/, or a tag whose definition file was absent
  // at export time). The loader will auto-stub these from the slug, losing
  // every other field — surfacing it here lets the reviewer add the tag.
  const willExist = new Set([...existingTags, ...importedTags.map((s) => s.toLowerCase())]);
  for (const tagSlug of slugReferencesFrom(
    bundle.frontmatter.tags,
    bundle.frontmatter.primary_tag,
  )) {
    if (!willExist.has(tagSlug.toLowerCase())) {
      warnings.push(`tag "${tagSlug}" not found in content/tags and no definition was bundled`);
    }
  }

  // Authors follow the same "create only when absent, never overwrite" rule as
  // tags above. A shared author slug keeps the receiver's own name / image.
  const authorsRoot = absolutise(cwd, config.content.authors_dir);
  const existingAuthors = await existingDefinitionSlugs(authorsRoot, definitionFileSlug);
  const authorWrites: { dest: string; bytes: Uint8Array }[] = [];
  const importedAuthors: string[] = [];
  for (const author of bundle.authors) {
    if (existingAuthors.has(author.slug.toLowerCase())) continue;
    const dest = join(authorsRoot, `${author.slug}.md`);
    await assertWritablePathHasNoSymlink(authorsRoot, dest);
    authorWrites.push({
      dest,
      bytes: new TextEncoder().encode(
        serializeMarkdownSource(author.frontmatter, author.body, relativePath(cwd, dest)),
      ),
    });
    importedAuthors.push(author.slug);
  }

  // Flag authors the entry references that will neither pre-exist nor be created
  // (an older bundle without authors/, or a missing definition at export time).
  const authorsWillExist = new Set([
    ...existingAuthors,
    ...importedAuthors.map((s) => s.toLowerCase()),
  ]);
  for (const authorSlug of slugReferencesFrom(
    bundle.frontmatter.author,
    bundle.frontmatter.authors,
    bundle.frontmatter.primary_author,
  )) {
    if (!authorsWillExist.has(authorSlug.toLowerCase())) {
      warnings.push(
        `author "${authorSlug}" not found in content/authors and no definition was bundled`,
      );
    }
  }

  if (!dryRun) {
    if (mergedEditorial && expectedExisting !== undefined) {
      const currentRaw = await readFile(collisionPath, 'utf8');
      if (editorialFromRaw(currentRaw, collisionPath) !== expectedExisting) {
        throw new Error(
          'The existing entry changed since the diff was opened. Reopen the import to review the current content.',
        );
      }
    }
    // Recombine the merged title/body with the bundle's metadata. `frontmatter`
    // already pins the slug to the target and forces needs-review, so only the
    // title is overridden from the merge.
    const content = mergedEditorial
      ? serializeMarkdownSource(
          { ...frontmatter, title: mergedEditorial.title },
          mergedEditorial.body,
          entryPath,
        )
      : serializeMarkdownSource(frontmatter, bundle.body, entryPath);
    await writeFile(target.path, content, 'utf8');
    for (const write of [...writes, ...tagWrites, ...authorWrites]) {
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
    importedAuthors,
    warnings,
    preview,
    conflict,
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

async function collectBundleAssets({
  cwd,
  config,
  frontmatter,
  body,
  extraFrontmatters = [],
}: {
  cwd: string;
  config: LaurelConfig;
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

  return collectReferencedAssetBytes(assetsRoot, rels);
}

// Tag and author references in frontmatter take the same shapes: a bare slug
// string, an array of them, or `{ slug }` objects. The `primary_tag` /
// `primary_author` field is folded in by the caller so an entry that only names
// its tag/author there still travels with the definition (and is warned about
// when missing). Returns a de-duplicated list (case-insensitive) preserving
// first-seen order and casing.
function slugReferencesFrom(...values: unknown[]): string[] {
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

// Read the tag definition files for the slugs an entry references.
async function collectReferencedTagDefinitions({
  cwd,
  config,
  frontmatter,
}: {
  cwd: string;
  config: LaurelConfig;
  frontmatter: Record<string, unknown>;
}): Promise<ParsedBundleTag[]> {
  return collectReferencedDefinitions(
    absolutise(cwd, config.content.tags_dir),
    slugReferencesFrom(frontmatter.tags, frontmatter.primary_tag),
  );
}

// Read the author definition files for the slugs an entry references. Mirrors
// the tag collector: `author` / `authors` / `primary_author` (string, array, or
// `{ slug }`).
async function collectReferencedAuthorDefinitions({
  cwd,
  config,
  frontmatter,
}: {
  cwd: string;
  config: LaurelConfig;
  frontmatter: Record<string, unknown>;
}): Promise<ParsedBundleAuthor[]> {
  return collectReferencedDefinitions(
    absolutise(cwd, config.content.authors_dir),
    slugReferencesFrom(frontmatter.author, frontmatter.authors, frontmatter.primary_author),
  );
}

// Shared tag/author collector. A definition's canonical slug is its frontmatter
// `slug` when valid, else the file basename (mirroring the content loader), so a
// file named off-slug still matches. Definitions referenced but without a file
// are skipped — they have nothing to carry. Symlinked files are skipped to avoid
// reading through them out of the content directory.
async function collectReferencedDefinitions(
  root: string,
  referencedSlugs: string[],
): Promise<{ slug: string; frontmatter: Record<string, unknown>; body: string }[]> {
  const referenced = new Set(referencedSlugs.map((s) => s.toLowerCase()));
  if (referenced.size === 0) return [];

  let files: string[];
  try {
    files = (await readdir(root)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const defs: { slug: string; frontmatter: Record<string, unknown>; body: string }[] = [];
  const taken = new Set<string>();
  for (const file of files.sort()) {
    const abs = join(root, file);
    if (await isSymlink(abs)) continue;
    const raw = await readFile(abs, 'utf8').catch(() => undefined);
    if (raw === undefined) continue;
    const parsed = parseFrontmatter(raw, { filePath: abs });
    const slug = definitionFileSlug(file, parsed.data);
    if (!slug || !referenced.has(slug) || taken.has(slug)) continue;
    taken.add(slug);
    defs.push({ slug, frontmatter: parsed.data, body: parsed.body });
  }
  return defs;
}

// Resolve the slug a tag/author definition file represents, lower-cased for matching.
function definitionFileSlug(
  file: string,
  frontmatter: Record<string, unknown>,
): string | undefined {
  const fromFm = typeof frontmatter.slug === 'string' ? frontmatter.slug.trim().toLowerCase() : '';
  if (fromFm && /^[a-z0-9][a-z0-9-]*$/.test(fromFm)) return fromFm;
  const fromName = basename(file, '.md').toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(fromName) ? fromName : undefined;
}

// Lower-cased slugs already defined under a tag/author directory, used to decide
// whether a bundled definition is a fresh addition or would clobber a local one.
async function existingDefinitionSlugs(
  root: string,
  fileSlug: (file: string, frontmatter: Record<string, unknown>) => string | undefined,
): Promise<Set<string>> {
  let files: string[];
  try {
    files = (await readdir(root)).filter((f) => f.endsWith('.md'));
  } catch {
    return new Set();
  }
  const slugs = new Set<string>();
  for (const file of files) {
    const abs = join(root, file);
    const raw = await readFile(abs, 'utf8').catch(() => undefined);
    const slug =
      raw === undefined ? undefined : fileSlug(file, parseFrontmatter(raw, { filePath: abs }).data);
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

function rootForKind(cwd: string, config: LaurelConfig, kind: EntryKind): string {
  return absolutise(cwd, kind === 'post' ? config.content.posts_dir : config.content.pages_dir);
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
