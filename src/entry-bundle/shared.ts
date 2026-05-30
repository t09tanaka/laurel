import { existsSync } from 'node:fs';
import { lstat, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { formatContentSource } from '~/content/format.ts';
import { pathContainsSymlink } from '~/util/fs.ts';
import { type ZipFileEntry, readZipArchive } from './zip.ts';

// Helpers shared by the two zip-bundle codecs (`~/entry-bundle` for a single
// post/page + assets, `~/components-bundle` for a set of `{slug}` snippets).
// These are security-sensitive (zip-slip / symlink-escape guards, decompressed
// size caps) and were previously copy-pasted between the two codecs; keeping a
// single source of truth means a hardening fix lands in both at once.

export type ConflictPolicy = 'skip' | 'overwrite' | 'rename';

// Read a zip and reject pathological archives BEFORE callers inspect entries:
// too many members, or a decompressed total beyond the codec's cap. Limits are
// passed in because each codec sets its own ceiling.
export function readBundleEntries(
  zip: Uint8Array,
  { maxEntries, maxTotalBytes }: { maxEntries: number; maxTotalBytes: number },
): ZipFileEntry[] {
  const entries = readZipArchive(zip);
  if (entries.length > maxEntries) {
    throw new Error(`Bundle has too many entries: ${entries.length} > ${maxEntries}`);
  }
  let total = 0;
  for (const entry of entries) {
    total += entry.bytes.length;
    if (total > maxTotalBytes) {
      throw new Error(`Bundle exceeds maximum total size of ${maxTotalBytes} bytes`);
    }
  }
  return entries;
}

export function parseBundleManifestJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid bundle manifest: not valid JSON');
  }
}

// Wrap JSON frontmatter + body and run it through the canonical content
// formatter so an imported file matches the on-disk format the editor writes.
export function serializeMarkdownSource(
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

// Resolve where an imported slug lands given the conflict policy. `validateSlug`
// lets a codec reject rename candidates that would no longer be a legal slug
// (e.g. the component slug pattern); when it returns false the rename search
// stops and a no-filename error is thrown.
export function resolveImportTarget(
  root: string,
  requestedSlug: string,
  onConflict: ConflictPolicy,
  options: { validateSlug?: (slug: string) => boolean } = {},
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
    if (options.validateSlug && !options.validateSlug(slug)) break;
    const candidate = join(root, `${slug}.md`);
    if (!existsSync(candidate)) return { path: candidate, slug, skipped: false, renamed: true };
  }
  throw new Error(`Could not find an available filename for slug: ${requestedSlug}`);
}

// Refuse to write outside `root`, or through any symlinked path segment, so a
// crafted slug/asset path cannot escape the configured directory. `label` only
// shapes the error message (e.g. "content directory" vs "components directory").
export async function assertWritablePathHasNoSymlink(
  root: string,
  target: string,
  options: { label?: string } = {},
): Promise<void> {
  const label = options.label ?? 'content directory';
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  if (!isInsidePath(rootAbs, targetAbs)) {
    throw new Error(`Refusing to write outside configured ${label}: ${target}`);
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

function isNotFoundError(err: unknown): boolean {
  return isRecord(err) && err.code === 'ENOENT';
}

export function isInsidePath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function relativePath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A bundle-internal relative path is safe iff it stays within the bundle: no
// absolute paths, no backslashes, and no empty / `.` / `..` segments. Used both
// to filter asset references on export and to reject zip-slip paths on import.
export function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

// Resolve a content reference (frontmatter value, `<img src>`, CSS `url(...)`,
// markdown image) to a path relative to the assets directory, or undefined when
// it is not a local asset under `assetsDir` (external URL, data: URI, outside
// the assets dir, or an unsafe path). `assetsDir` is the configured dir name
// (e.g. `content/images`).
export function assetRelFromReference(value: string, assetsDir: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('data:')) return undefined;
  const normalizedAssets = assetsDir.replace(/^\/+|\/+$/g, '');
  const normalized = value.replace(/^\/+/, '').split(/[?#]/, 1)[0] ?? '';
  if (!normalized.startsWith(`${normalizedAssets}/`)) return undefined;
  const rel = normalized.slice(normalizedAssets.length + 1);
  if (!isSafeRelativePath(rel)) return undefined;
  return rel;
}

// Read the bytes for a set of asset-relative paths under `assetsRoot`, dropping
// any that traverse a symlink, escape the root, or are not regular files. The
// dropped paths are returned in `omitted` so the caller can warn. Paths are
// de-duplicated and sorted for a deterministic bundle.
export async function collectReferencedAssetBytes(
  assetsRoot: string,
  rels: Iterable<string>,
): Promise<{ assets: { rel: string; bytes: Uint8Array }[]; omitted: string[] }> {
  const assets: { rel: string; bytes: Uint8Array }[] = [];
  const omitted: string[] = [];
  for (const rel of [...new Set(rels)].sort()) {
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
