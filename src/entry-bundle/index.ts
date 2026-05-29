import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

export interface EntryBundleManifest {
  schema: string;
  kind: EntryKind;
  slug: string;
  path: string;
  site?: { title: string; url: string };
  generated_at?: string;
}

export interface ParsedEntryBundle {
  kind: EntryKind;
  slug: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  assets: ZipFileEntry[];
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
  warnings: string[];
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
  for (const entry of entries) {
    if (entry.path === MANIFEST_PATH || entry.path === ENTRY_PATH) continue;
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
    manifest,
  };
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
}): Promise<{ zip: Uint8Array; omittedAssets: string[] }> {
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
  const frontmatter = { ...parsed.data, status: 'needs-review' };

  const { assets, omitted } = await collectBundleAssets({
    cwd,
    config,
    frontmatter: parsed.data,
    body: parsed.body,
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
    ...assets.map((asset) => ({ path: `${ASSETS_PREFIX}${asset.rel}`, bytes: asset.bytes })),
  ];

  return { zip: createZipArchive(inputs), omittedAssets: omitted };
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

  const requestedSlug = safeSlug(String(bundle.frontmatter.slug ?? bundle.slug));
  const target = resolveImportTarget(root, requestedSlug, onConflict);
  const entryPath = relativePath(cwd, target.path);
  if (target.skipped) {
    return {
      written: false,
      skipped: true,
      renamed: false,
      kind: bundle.kind,
      slug: requestedSlug,
      entryPath,
      assetPaths: [],
      warnings: [],
    };
  }

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
  }

  return {
    written: !dryRun,
    skipped: false,
    renamed: target.renamed,
    kind: bundle.kind,
    slug: target.slug,
    entryPath,
    assetPaths,
    warnings,
  };
}

export async function markEntryNeedsReview({
  cwd,
  config,
  kind,
  slug,
}: {
  cwd: string;
  config: NectarConfig;
  kind: EntryKind;
  slug: string;
}): Promise<void> {
  const root = rootForKind(cwd, config, kind);
  const resolved = await resolveContentSlugPath(slug, [kind === 'post' ? 'posts' : 'pages'], {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: absolutise(cwd, config.content.pages_dir),
  });
  if (!resolved) throw new Error(`${kind} not found: ${slug}`);
  if (!isInsidePath(resolve(root), resolve(resolved.path))) {
    throw new Error(`${kind} is outside its configured directory: ${slug}`);
  }
  const raw = await readFile(resolved.path, 'utf8');
  const parsed = parseFrontmatter(raw, { filePath: resolved.path });
  const frontmatter = { ...parsed.data, status: 'needs-review' };
  await writeFile(
    resolved.path,
    serializeEntryMarkdown(frontmatter, parsed.body, resolved.path),
    'utf8',
  );
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
}: {
  cwd: string;
  config: NectarConfig;
  frontmatter: Record<string, unknown>;
  body: string;
}): Promise<{ assets: { rel: string; bytes: Uint8Array }[]; omitted: string[] }> {
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  const rels = new Set<string>();
  for (const value of collectStringValues(frontmatter)) {
    const rel = assetRelFromReference(value, config.content.assets_dir);
    if (rel) rels.add(rel);
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
  await assertNotSymlink(current);
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
