import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { LaurelError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { basePathDiskSegment, normalizeBasePath } from './base-path.ts';

/**
 * Resolve the directory a build actually writes into, accounting for
 * `emit_at_base_path`. When emit is on for a subpath deployment, the build
 * nests every artifact under the base_path segment (`dist/blog/...`) so the
 * on-disk tree mirrors the public URL tree. This is the single source of truth
 * for "where did/will the build land": both the build pipeline (to redirect
 * its writers) and `laurel deploy` (to find the manifest and verify a build
 * exists) call it so the two cannot drift apart.
 *
 * `emitAtBasePath` is tri-state: `undefined` falls back to "on when base_path
 * is a subpath", matching the config default. `outputDirSetting` is the raw
 * configured / overridden output dir (relative); `basePath` may be raw or
 * already-normalised (normalisation here is idempotent).
 */
export function resolveBuildOutputDir(
  cwd: string,
  outputDirSetting: string,
  basePath: string,
  emitAtBasePath?: boolean | undefined,
): string {
  const normalized = normalizeBasePath(basePath);
  const emit = emitAtBasePath ?? normalized !== '/';
  const segment = basePathDiskSegment(normalized);
  return emit && segment !== ''
    ? resolveOutputDir(cwd, join(outputDirSetting, segment))
    : resolveOutputDir(cwd, outputDirSetting);
}

/**
 * Validate a user-supplied `build.output_dir` and resolve it to an absolute
 * path inside `cwd`. Refuses absolute paths, empty strings, the project root
 * itself, and any path that escapes `cwd` (e.g. `..`). This is the only thing
 * standing between a misconfigured laurel.toml and a stray `rm -rf` on the
 * user's filesystem.
 */
export function resolveOutputDir(cwd: string, configuredOutputDir: string): string {
  if (typeof configuredOutputDir !== 'string') {
    throw new LaurelError({ message: 'build.output_dir must be a string', code: 'config' });
  }
  const trimmed = configuredOutputDir.trim();
  if (trimmed === '') {
    throw new LaurelError({ message: 'build.output_dir must not be empty', code: 'config' });
  }
  if (isAbsolute(trimmed)) {
    throw new LaurelError({
      message: `build.output_dir must be a relative path inside the project root; got absolute path ${JSON.stringify(configuredOutputDir)}`,
      code: 'config',
    });
  }
  const absoluteCwd = resolve(cwd);
  const absolute = resolve(absoluteCwd, trimmed);
  const rel = relative(absoluteCwd, absolute);
  if (rel === '' || rel === '.') {
    throw new LaurelError({
      message: `build.output_dir must not point at the project root; got ${JSON.stringify(configuredOutputDir)}`,
      code: 'config',
    });
  }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new LaurelError({
      message: `build.output_dir must resolve inside the project root; got ${JSON.stringify(configuredOutputDir)} (resolves to ${absolute})`,
      code: 'config',
    });
  }
  return absolute;
}

/**
 * Clear `dir` by deleting its children rather than the directory itself.
 * Creates `dir` when missing. Deleting children (instead of the directory)
 * limits the blast radius of a path-traversal: even if validation upstream
 * regresses, we never call `rm` on a path we did not just enumerate as a
 * child of an already-validated parent.
 */
export async function clearDirContents(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(dir, { recursive: true });
      return;
    }
    throw err;
  }
  await Promise.all(entries.map((entry) => rm(join(dir, entry), { recursive: true, force: true })));
}

/**
 * Create a sibling staging directory next to `finalDir` for the build to
 * write into. Same-parent placement guarantees the eventual `rename` is on a
 * single filesystem (no `EXDEV`). Returns the absolute path of the new dir.
 */
export async function prepareStagingDir(finalDir: string): Promise<string> {
  const parent = dirname(finalDir);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(finalDir)}.tmp-`));
  return staging;
}

/**
 * Atomically move `stagingDir` into place at `finalDir`. If `finalDir` already
 * exists, it is renamed aside first, then the staging dir is moved in, then
 * the displaced old dir is removed. The window during which `finalDir` does
 * not exist is bounded by a single `rename` syscall — readers see either the
 * old tree or the new tree, never a partial mix.
 *
 * On failure we attempt to restore the old dir so the previous build remains
 * usable; the caller is still expected to clean up `stagingDir` if the move
 * never started.
 */
export async function commitStagingDir(stagingDir: string, finalDir: string): Promise<void> {
  const oldDir = `${finalDir}.old-${randomBytes(6).toString('hex')}`;
  let displaced = false;
  try {
    await rename(finalDir, oldDir);
    displaced = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  try {
    await rename(stagingDir, finalDir);
  } catch (err) {
    if (displaced) {
      await rename(oldDir, finalDir).catch(() => {});
    }
    throw err;
  }
  if (displaced) {
    await rm(oldDir, { recursive: true, force: true });
  }
}

interface CleanupStaleOutputOptions {
  outputDir: string;
  keepRelPaths: Iterable<string>;
  preservePatterns?: readonly string[] | undefined;
  previousOutputFiles?: readonly { path: string }[] | undefined;
}

interface CleanupStaleOutputResult {
  removed: string[];
}

/**
 * Remove files from outputDir that were not emitted by the current build.
 * This is intentionally a set-difference cleanup, not `rm -rf dist`: we only
 * delete entries we enumerated under an already-validated output directory,
 * and symlinks are unlinked as symlinks instead of followed.
 */
export async function cleanupStaleOutput({
  outputDir,
  keepRelPaths,
  preservePatterns = [],
  previousOutputFiles,
}: CleanupStaleOutputOptions): Promise<CleanupStaleOutputResult> {
  await mkdir(outputDir, { recursive: true });

  const keep = new Set<string>();
  for (const rel of keepRelPaths) {
    const normalized = normalizeOutputRelPath(rel);
    if (normalized) keep.add(normalized);
  }

  const preserve = normalizePreservePatterns(outputDir, preservePatterns);
  const removed: string[] = [];
  const manifestCandidates = previousOutputFiles
    ?.map((file) => normalizeOutputRelPath(file.path))
    .filter((rel): rel is string => rel !== undefined);
  const { files, dirs } = manifestCandidates
    ? manifestCleanupTree(manifestCandidates)
    : await listOutputTree(outputDir);
  for (const rel of files) {
    if (isKept(rel, keep)) continue;
    if (isPreserved(rel, preserve)) continue;
    await rm(join(outputDir, fromPosix(rel)), { recursive: true, force: true });
    removed.push(rel);
  }

  const keepPrefixes = buildDirectoryPrefixes([...keep, ...preserve]);
  dirs.sort((a, b) => b.length - a.length);
  for (const rel of dirs) {
    if (keepPrefixes.has(rel)) continue;
    await rmdir(join(outputDir, fromPosix(rel))).catch(() => undefined);
  }

  removed.sort();
  return { removed };
}

function manifestCleanupTree(files: readonly string[]): { files: string[]; dirs: string[] } {
  const uniqueFiles = new Set(files);
  const dirs = new Set<string>();
  for (const file of uniqueFiles) {
    const parts = file.split('/');
    parts.pop();
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      dirs.add(cur);
    }
  }
  return {
    files: [...uniqueFiles].sort(),
    dirs: [...dirs].sort(),
  };
}

function isKept(rel: string, keep: ReadonlySet<string>): boolean {
  return matchesPathOrAncestor(rel, keep);
}

function normalizePreservePatterns(outputDir: string, patterns: readonly string[]): Set<string> {
  const root = resolve(outputDir);
  const out = new Set<string>();
  for (const pattern of patterns) {
    if (isAbsolute(pattern)) {
      logger.warn(
        `.laurelignore: ignoring absolute path ${JSON.stringify(pattern)} (paths must be relative to build.output_dir)`,
      );
      continue;
    }
    const target = resolve(root, pattern);
    const rel = relative(root, target);
    const normalized = normalizeOutputRelPath(rel);
    if (!normalized || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      logger.warn(`.laurelignore: ${JSON.stringify(pattern)} escapes build.output_dir; skipped`);
      continue;
    }
    out.add(normalized);
  }
  return out;
}

function isPreserved(rel: string, preserve: ReadonlySet<string>): boolean {
  return matchesPathOrAncestor(rel, preserve);
}

function matchesPathOrAncestor(rel: string, paths: ReadonlySet<string>): boolean {
  if (paths.has(rel)) return true;
  let cur = rel;
  while (true) {
    const index = cur.lastIndexOf('/');
    if (index < 0) return false;
    cur = cur.slice(0, index);
    if (paths.has(cur)) return true;
  }
}

function buildDirectoryPrefixes(paths: Iterable<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      prefixes.add(cur);
    }
  }
  return prefixes;
}

async function listOutputTree(outputDir: string): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [];
  await walkOutput(outputDir, '', files, dirs);
  files.sort();
  dirs.sort();
  return { files, dirs };
}

async function walkOutput(
  root: string,
  relDir: string,
  files: string[],
  dirs: string[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(join(root, fromPosix(relDir)), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      dirs.push(rel);
      await walkOutput(root, rel, files, dirs);
    } else {
      files.push(rel);
    }
  }
}

function normalizeOutputRelPath(path: string): string | undefined {
  const normalized = toPosix(path).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }
  return normalized;
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function fromPosix(path: string): string {
  return sep === '/' ? path : path.split('/').join(sep);
}
