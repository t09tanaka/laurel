import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { NectarError } from '~/util/errors.ts';

/**
 * Validate a user-supplied `build.output_dir` and resolve it to an absolute
 * path inside `cwd`. Refuses absolute paths, empty strings, the project root
 * itself, and any path that escapes `cwd` (e.g. `..`). This is the only thing
 * standing between a misconfigured nectar.toml and a stray `rm -rf` on the
 * user's filesystem.
 */
export function resolveOutputDir(cwd: string, configuredOutputDir: string): string {
  if (typeof configuredOutputDir !== 'string') {
    throw new NectarError({ message: 'build.output_dir must be a string', code: 'config' });
  }
  const trimmed = configuredOutputDir.trim();
  if (trimmed === '') {
    throw new NectarError({ message: 'build.output_dir must not be empty', code: 'config' });
  }
  if (isAbsolute(trimmed)) {
    throw new NectarError({
      message: `build.output_dir must be a relative path inside the project root; got absolute path ${JSON.stringify(configuredOutputDir)}`,
      code: 'config',
    });
  }
  const absoluteCwd = resolve(cwd);
  const absolute = resolve(absoluteCwd, trimmed);
  const rel = relative(absoluteCwd, absolute);
  if (rel === '' || rel === '.') {
    throw new NectarError({
      message: `build.output_dir must not point at the project root; got ${JSON.stringify(configuredOutputDir)}`,
      code: 'config',
    });
  }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new NectarError({
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
