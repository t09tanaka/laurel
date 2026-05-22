import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { absolutise, resolveContentSlugPath } from '~/cli/content-paths.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { formatContentSource } from '~/content/format.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { pathContainsSymlink } from '~/util/fs.ts';

export type PageBundleAssetEncoding = 'utf8' | 'base64';
export type PageBundleConflictPolicy = 'skip' | 'overwrite' | 'rename';

export interface PageBundleAsset {
  path: string;
  encoding: PageBundleAssetEncoding;
  content: string;
}

export interface PageBundle {
  nectar: {
    schema: 'nectar.page.v1';
    generated_at: string;
  };
  site: {
    title: string;
    url: string;
  };
  page: {
    slug: string;
    path: string;
    frontmatter: Record<string, unknown>;
    body: string;
  };
  assets: PageBundleAsset[];
}

export interface ExportPageBundleOptions {
  cwd: string;
  config: NectarConfig;
  slug: string;
  includeAssets?: boolean;
}

export interface ImportPageBundleOptions {
  cwd: string;
  config: NectarConfig;
  bundle: PageBundle;
  onConflict: PageBundleConflictPolicy;
  dryRun?: boolean;
}

export interface ImportPageBundleResult {
  written: boolean;
  skipped: boolean;
  renamed: boolean;
  pagePath: string;
  assetPaths: string[];
}

export async function exportPageBundle({
  cwd,
  config,
  slug,
  includeAssets = true,
}: ExportPageBundleOptions): Promise<PageBundle> {
  const pageRoot = absolutise(cwd, config.content.pages_dir);
  const resolved = await resolveContentSlugPath(slug, ['pages'], {
    posts: absolutise(cwd, config.content.posts_dir),
    pages: pageRoot,
  });
  if (!resolved) throw new Error(`Page not found: ${slug}`);
  if (!(await isInsideExistingRoot(pageRoot, resolved.path))) {
    throw new Error(`Page is outside configured pages_dir: ${slug}`);
  }

  const raw = await readFile(resolved.path, 'utf8');
  const parsed = parseFrontmatter(raw, { filePath: resolved.path });
  const assets = includeAssets
    ? await collectBundleAssets({
        cwd,
        config,
        frontmatter: parsed.data,
        body: parsed.body,
      })
    : [];

  return {
    nectar: {
      schema: 'nectar.page.v1',
      generated_at: new Date().toISOString(),
    },
    site: {
      title: config.site.title,
      url: config.site.url,
    },
    page: {
      slug,
      path: relativePath(cwd, resolved.path),
      frontmatter: parsed.data,
      body: parsed.body,
    },
    assets,
  };
}

export async function importPageBundle({
  cwd,
  config,
  bundle,
  onConflict,
  dryRun = false,
}: ImportPageBundleOptions): Promise<ImportPageBundleResult> {
  const parsed = parsePageBundle(bundle);
  const pageRoot = absolutise(cwd, config.content.pages_dir);
  await mkdir(pageRoot, { recursive: true });

  const requestedSlug = safeSlug(String(parsed.page.frontmatter.slug ?? parsed.page.slug));
  const target = resolveImportTarget(pageRoot, requestedSlug, onConflict);
  const pagePath = relativePath(cwd, target.path);
  if (target.skipped) {
    return { written: false, skipped: true, renamed: false, pagePath, assetPaths: [] };
  }

  const frontmatter = { ...parsed.page.frontmatter, slug: target.slug };
  const body = parsed.page.body.endsWith('\n') ? parsed.page.body : `${parsed.page.body}\n`;
  const source = formatContentSource(
    `---\n${JSON.stringify(frontmatter)}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`,
    { filePath: pagePath },
  );

  const assetPaths = parsed.assets.map((asset) => asset.path);
  await validateWritableBundlePaths({ cwd, config, pagePath: target.path, assets: parsed.assets });
  if (!dryRun) {
    await writeFile(target.path, source, 'utf8');
    await writeBundleAssets({ cwd, config, assets: parsed.assets });
  }

  return {
    written: !dryRun,
    skipped: false,
    renamed: target.renamed,
    pagePath,
    assetPaths,
  };
}

export function parsePageBundle(input: unknown): PageBundle {
  if (!isRecord(input)) throw new Error('Invalid page bundle: expected an object');
  const nectar = input.nectar;
  if (!isRecord(nectar) || nectar.schema !== 'nectar.page.v1') {
    throw new Error('Expected nectar.page.v1 page bundle');
  }
  const page = input.page;
  if (!isRecord(page) || typeof page.slug !== 'string' || !isRecord(page.frontmatter)) {
    throw new Error('Invalid page bundle: page.slug and page.frontmatter are required');
  }
  if (typeof page.body !== 'string') {
    throw new Error('Invalid page bundle: page.body must be a string');
  }
  const site = isRecord(input.site) ? input.site : {};
  const assets = Array.isArray(input.assets) ? input.assets.map(parseAsset) : [];
  return {
    nectar: {
      schema: 'nectar.page.v1',
      generated_at:
        typeof nectar.generated_at === 'string' ? nectar.generated_at : new Date(0).toISOString(),
    },
    site: {
      title: typeof site.title === 'string' ? site.title : '',
      url: typeof site.url === 'string' ? site.url : '',
    },
    page: {
      slug: page.slug,
      path: typeof page.path === 'string' ? page.path : '',
      frontmatter: page.frontmatter,
      body: page.body,
    },
    assets,
  };
}

function parseAsset(input: unknown): PageBundleAsset {
  if (!isRecord(input)) throw new Error('Invalid page bundle: asset must be an object');
  if (typeof input.path !== 'string' || typeof input.content !== 'string') {
    throw new Error('Invalid page bundle: asset.path and asset.content are required');
  }
  if (input.encoding !== 'utf8' && input.encoding !== 'base64') {
    throw new Error('Invalid page bundle: asset.encoding must be utf8 or base64');
  }
  return { path: input.path, encoding: input.encoding, content: input.content };
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
}): Promise<PageBundleAsset[]> {
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

  const assets: PageBundleAsset[] = [];
  for (const rel of [...rels].sort()) {
    if (pathContainsSymlink(assetsRoot, rel)) continue;
    const abs = join(assetsRoot, rel);
    if (!(await isInsideExistingRoot(assetsRoot, abs))) continue;
    const info = await stat(abs).catch(() => undefined);
    if (!info?.isFile()) continue;
    assets.push({ path: joinPath(config.content.assets_dir, rel), ...(await readAsset(abs)) });
  }
  return assets;
}

async function readAsset(abs: string): Promise<Pick<PageBundleAsset, 'encoding' | 'content'>> {
  const buffer = await readFile(abs);
  const utf8 = buffer.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(buffer)) return { encoding: 'utf8', content: utf8 };
  return { encoding: 'base64', content: buffer.toString('base64') };
}

async function writeBundleAssets({
  cwd,
  config,
  assets,
}: {
  cwd: string;
  config: NectarConfig;
  assets: PageBundleAsset[];
}): Promise<void> {
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  await mkdir(assetsRoot, { recursive: true });
  for (const asset of assets) {
    const rel = assetRelFromReference(asset.path, config.content.assets_dir);
    if (!rel) throw new Error(`Asset path is outside content assets_dir: ${asset.path}`);
    const dest = join(assetsRoot, rel);
    if (!isInsidePath(assetsRoot, dest)) {
      throw new Error(`Asset path is outside content assets_dir: ${asset.path}`);
    }
    await assertWritablePathHasNoSymlink(assetsRoot, dest);
    await mkdir(dirname(dest), { recursive: true });
    const contents =
      asset.encoding === 'utf8' ? asset.content : Buffer.from(asset.content, 'base64');
    await writeFile(dest, contents);
  }
}

async function validateWritableBundlePaths({
  cwd,
  config,
  pagePath,
  assets,
}: {
  cwd: string;
  config: NectarConfig;
  pagePath: string;
  assets: PageBundleAsset[];
}): Promise<void> {
  await assertWritablePathHasNoSymlink(absolutise(cwd, config.content.pages_dir), pagePath);
  const assetsRoot = absolutise(cwd, config.content.assets_dir);
  for (const asset of assets) {
    const rel = assetRelFromReference(asset.path, config.content.assets_dir);
    if (!rel) throw new Error(`Asset path is outside content assets_dir: ${asset.path}`);
    await assertWritablePathHasNoSymlink(assetsRoot, join(assetsRoot, rel));
  }
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
  pageRoot: string,
  requestedSlug: string,
  onConflict: PageBundleConflictPolicy,
): { path: string; slug: string; skipped: boolean; renamed: boolean } {
  const first = join(pageRoot, `${requestedSlug}.md`);
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
    const candidate = join(pageRoot, `${slug}.md`);
    if (!existsSync(candidate)) return { path: candidate, slug, skipped: false, renamed: true };
  }
  throw new Error(`Could not find an available page filename for slug: ${requestedSlug}`);
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
    throw new Error(`Invalid page slug in bundle: ${value}`);
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

async function isInsideExistingRoot(root: string, target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    return isInsidePath(resolve(root), resolve(target));
  } catch {
    return false;
  }
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function relativePath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/');
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/^\/+/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
