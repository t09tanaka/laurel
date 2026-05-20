import { createHash } from 'node:crypto';
import { dirname, join, sep } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { pLimit } from '~/util/concurrency.ts';
import { ensureDir, scanGlob } from '~/util/fs.ts';
import { stableStringify } from './manifest.ts';

// Subdirectory inside the build output that holds Nectar-emitted metadata for
// downstream tooling. Sibling files (e.g. additional deploy descriptors) can
// land alongside `build-manifest.json` without polluting the site root.
export const BUILD_MANIFEST_DIR = '.nectar';
export const BUILD_MANIFEST_FILENAME = 'build-manifest.json';

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

export interface BuildManifestFile {
  path: string;
  size: number;
  hash: string;
}

export interface BuildManifestJson {
  schema_version: typeof BUILD_MANIFEST_VERSION;
  generated_at: string;
  nectar: { version: string };
  theme: { name: string; version: string };
  config_hash: string;
  hash_algorithm: typeof HASH_ALGORITHM;
  route_count: number;
  asset_count: number;
  files: BuildManifestFile[];
}

export function buildManifestRelPath(): string {
  return `${BUILD_MANIFEST_DIR}/${BUILD_MANIFEST_FILENAME}`;
}

export function buildManifestAbsPath(outputDir: string): string {
  return join(outputDir, BUILD_MANIFEST_DIR, BUILD_MANIFEST_FILENAME);
}

export interface EmitBuildManifestOptions {
  outputDir: string;
  config: NectarConfig;
  theme: ThemeBundle;
  routeCount: number;
  assetCount: number;
  nectarVersion: string;
  // Visible for tests so the timestamp can be made deterministic.
  now?: Date;
}

export async function emitBuildManifest(
  opts: EmitBuildManifestOptions,
): Promise<BuildManifestJson> {
  const { outputDir, config, theme, routeCount, assetCount, nectarVersion, now } = opts;

  // The manifest references every other file we just emitted, so its own
  // contents depend on the rest of the tree. Excluding the manifest path
  // (and any sibling under `.nectar/` we may emit in the future) avoids a
  // chicken-and-egg dependency on its own hash.
  const selfRelPath = buildManifestRelPath();

  const files = await collectOutputFiles(outputDir, selfRelPath);

  const manifest: BuildManifestJson = {
    schema_version: BUILD_MANIFEST_VERSION,
    generated_at: (now ?? new Date()).toISOString(),
    nectar: { version: nectarVersion },
    theme: { name: theme.pkg.name, version: theme.pkg.version },
    config_hash: computeConfigHash(config),
    hash_algorithm: HASH_ALGORITHM,
    route_count: routeCount,
    asset_count: assetCount,
    files,
  };

  const dest = buildManifestAbsPath(outputDir);
  await ensureDir(dirname(dest));
  // Pretty-print so `git diff` and human inspection stay readable; the file
  // is small relative to a full site build.
  await Bun.write(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function collectOutputFiles(
  outputDir: string,
  excludeRelPath: string,
): Promise<BuildManifestFile[]> {
  const allRels = await scanGlob('**/*', { cwd: outputDir, onlyFiles: true });
  const relPaths: string[] = [];
  for (const rel of allRels) {
    const normalized = toPosix(rel);
    if (normalized === excludeRelPath) continue;
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

function sha256Str(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function sha256Buf(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}
