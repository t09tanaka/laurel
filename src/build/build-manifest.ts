import { createHash } from 'node:crypto';
import { dirname, join, sep } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ThemeBundle, ThemeCustomSettingDefinition } from '~/theme/types.ts';
import { pLimit } from '~/util/concurrency.ts';
import { ensureDir, scanGlob } from '~/util/fs.ts';
import { stableStringify } from './manifest.ts';

// Subdirectory inside the build output that holds Nectar-emitted metadata for
// downstream tooling. Sibling files (e.g. additional deploy descriptors) can
// land alongside `build-manifest.json` without polluting the site root.
export const BUILD_MANIFEST_DIR = '.nectar';
export const BUILD_MANIFEST_FILENAME = 'build-manifest.json';
export const CHANGED_PATHS_FILENAME = 'changed-paths.txt';

// Schema version for `build-manifest.json`. Bump when the JSON shape changes
// in a way that downstream consumers (deploy scripts, `nectar deploy`) cannot
// silently absorb.
export const BUILD_MANIFEST_VERSION = 1 as const;

// sha256 hex digests are used everywhere in this codebase (theme assets,
// incremental render cache). Keeping the choice explicit in the manifest
// payload lets future deploy tooling cross-check against ETag/Content-MD5 or
// switch algorithms without guesswork.
const HASH_ALGORITHM = 'sha256';

// Bounded fan-out for the per-file hash pass. Output trees can run into many
// thousands of files (image variants, locale shards); reading all of them
// concurrently blows past file-descriptor soft limits on macOS/Linux.
const HASH_CONCURRENCY = 32;

// CloudFront accepts at most 3,000 invalidation paths per request. When a site
// changes more than that, a single wildcard is safer than emitting a file that
// makes the documented AWS CLI command fail.
const CLOUDFRONT_INVALIDATION_PATH_LIMIT = 3000;

export interface BuildManifestFile {
  path: string;
  size: number;
  hash: string;
}

export interface BuildManifestJson {
  schema_version: typeof BUILD_MANIFEST_VERSION;
  generated_at: string;
  nectar: { version: string };
  theme: {
    name: string;
    version: string;
    custom_settings: Record<string, ThemeCustomSettingDefinition>;
  };
  config_hash: string;
  hash_algorithm: typeof HASH_ALGORITHM;
  route_count: number;
  asset_count: number;
  files: BuildManifestFile[];
}

export function buildManifestRelPath(): string {
  return `${BUILD_MANIFEST_DIR}/${BUILD_MANIFEST_FILENAME}`;
}

export function changedPathsRelPath(): string {
  return `${BUILD_MANIFEST_DIR}/${CHANGED_PATHS_FILENAME}`;
}

export function buildManifestAbsPath(outputDir: string): string {
  return join(outputDir, BUILD_MANIFEST_DIR, BUILD_MANIFEST_FILENAME);
}

export function changedPathsAbsPath(outputDir: string): string {
  return join(outputDir, BUILD_MANIFEST_DIR, CHANGED_PATHS_FILENAME);
}

export interface EmitBuildManifestOptions {
  outputDir: string;
  config: NectarConfig;
  theme: ThemeBundle;
  routeCount: number;
  assetCount: number;
  nectarVersion: string;
  previousBuildManifest?: BuildManifestJson | undefined;
  // Visible for tests so the timestamp can be made deterministic.
  now?: Date;
}

export async function emitBuildManifest(
  opts: EmitBuildManifestOptions,
): Promise<BuildManifestJson> {
  const {
    outputDir,
    config,
    theme,
    routeCount,
    assetCount,
    nectarVersion,
    previousBuildManifest,
    now,
  } = opts;

  // The deploy manifest feeds the changed-paths companion artifact, so both
  // files are excluded from the hash list to avoid self-referential output.
  const excludedRelPaths = new Set([buildManifestRelPath(), changedPathsRelPath()]);

  const files = await collectOutputFiles(outputDir, excludedRelPaths);

  const manifest: BuildManifestJson = {
    schema_version: BUILD_MANIFEST_VERSION,
    generated_at: (now ?? new Date()).toISOString(),
    nectar: { version: nectarVersion },
    theme: {
      name: theme.pkg.name,
      version: theme.pkg.version,
      custom_settings: serializeCustomSettings(theme.pkg.custom),
    },
    config_hash: computeConfigHash(config),
    hash_algorithm: HASH_ALGORITHM,
    route_count: routeCount,
    asset_count: assetCount,
    files,
  };

  const changedPaths = computeCloudFrontChangedPaths(previousBuildManifest, manifest);

  const dest = buildManifestAbsPath(outputDir);
  await ensureDir(dirname(dest));
  // Pretty-print so `git diff` and human inspection stay readable; the file
  // is small relative to a full site build.
  await Bun.write(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(changedPathsAbsPath(outputDir), formatChangedPaths(changedPaths));
  return manifest;
}

function serializeCustomSettings(
  custom: Record<string, ThemeCustomSettingDefinition>,
): Record<string, ThemeCustomSettingDefinition> {
  const out: Record<string, ThemeCustomSettingDefinition> = {};
  for (const key of Object.keys(custom).sort()) {
    const def = custom[key];
    if (!def) continue;
    out[key] = {
      ...def,
      ...(def.options ? { options: [...def.options] } : {}),
    };
  }
  return out;
}

export async function loadBuildManifest(outputDir: string): Promise<BuildManifestJson | undefined> {
  const file = Bun.file(buildManifestAbsPath(outputDir));
  if (!(await file.exists())) return undefined;
  try {
    const parsed = (await file.json()) as Partial<BuildManifestJson>;
    if (parsed.schema_version !== BUILD_MANIFEST_VERSION) return undefined;
    if (!Array.isArray(parsed.files)) return undefined;
    if (parsed.hash_algorithm !== HASH_ALGORITHM) return undefined;
    return parsed as BuildManifestJson;
  } catch {
    return undefined;
  }
}

async function collectOutputFiles(
  outputDir: string,
  excludeRelPaths: ReadonlySet<string>,
): Promise<BuildManifestFile[]> {
  const allRels = await scanGlob('**/*', { cwd: outputDir, onlyFiles: true });
  const relPaths: string[] = [];
  for (const rel of allRels) {
    const normalized = toPosix(rel);
    if (excludeRelPaths.has(normalized)) continue;
    relPaths.push(normalized);
  }

  const limit = pLimit(HASH_CONCURRENCY);
  const entries = await Promise.all(
    relPaths.map((rel) =>
      limit(async (): Promise<BuildManifestFile> => {
        const abs = join(outputDir, rel);
        const buf = Buffer.from(await Bun.file(abs).arrayBuffer());
        return {
          path: rel,
          size: buf.byteLength,
          hash: sha256Buf(buf),
        };
      }),
    ),
  );

  // Sort by path so the manifest is deterministic across filesystems whose
  // directory iteration order differs from lexicographic.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

function computeConfigHash(config: NectarConfig): string {
  return sha256Str(stableStringify(config));
}

function computeCloudFrontChangedPaths(
  previous: BuildManifestJson | undefined,
  current: BuildManifestJson,
): string[] {
  if (!previous) return ['/*'];

  const previousFiles = publicFileHashMap(previous.files);
  const currentFiles = publicFileHashMap(current.files);
  const changedRelPaths = new Set<string>();

  for (const [path, hash] of currentFiles) {
    if (previousFiles.get(path) !== hash) changedRelPaths.add(path);
  }
  for (const path of previousFiles.keys()) {
    if (!currentFiles.has(path)) changedRelPaths.add(path);
  }

  const cloudFrontPaths = new Set<string>();
  for (const relPath of changedRelPaths) {
    for (const path of toCloudFrontPaths(relPath)) {
      cloudFrontPaths.add(path);
    }
  }

  if (cloudFrontPaths.size > CLOUDFRONT_INVALIDATION_PATH_LIMIT) return ['/*'];
  return [...cloudFrontPaths].sort();
}

function publicFileHashMap(files: BuildManifestFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    if (!isPublicOutputPath(file.path)) continue;
    map.set(file.path, file.hash);
  }
  return map;
}

function isPublicOutputPath(path: string): boolean {
  return (
    path !== '.nectar-manifest.json' &&
    path !== BUILD_MANIFEST_DIR &&
    !path.startsWith(`${BUILD_MANIFEST_DIR}/`)
  );
}

function toCloudFrontPaths(relPath: string): string[] {
  if (relPath === 'index.html') return ['/', '/index.html'];
  if (relPath.endsWith('/index.html')) {
    const dir = relPath.slice(0, -'index.html'.length);
    return [`/${dir}`, `/${relPath}`];
  }
  return [`/${relPath}`];
}

function formatChangedPaths(paths: string[]): string {
  return paths.length === 0 ? '' : `${paths.join('\n')}\n`;
}

function sha256Str(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function sha256Buf(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}
