import { mkdir, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Validate a user-supplied `build.output_dir` and resolve it to an absolute
 * path inside `cwd`. Refuses absolute paths, empty strings, the project root
 * itself, and any path that escapes `cwd` (e.g. `..`). This is the only thing
 * standing between a misconfigured nectar.toml and a stray `rm -rf` on the
 * user's filesystem.
 */
export function resolveOutputDir(cwd: string, configuredOutputDir: string): string {
  if (typeof configuredOutputDir !== 'string') {
    throw new Error('build.output_dir must be a string');
  }
  const trimmed = configuredOutputDir.trim();
  if (trimmed === '') {
    throw new Error('build.output_dir must not be empty');
  }
  if (isAbsolute(trimmed)) {
    throw new Error(
      `build.output_dir must be a relative path inside the project root; got absolute path ${JSON.stringify(configuredOutputDir)}`,
    );
  }
  const absoluteCwd = resolve(cwd);
  const absolute = resolve(absoluteCwd, trimmed);
  const rel = relative(absoluteCwd, absolute);
  if (rel === '' || rel === '.') {
    throw new Error(
      `build.output_dir must not point at the project root; got ${JSON.stringify(configuredOutputDir)}`,
    );
  }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(
      `build.output_dir must resolve inside the project root; got ${JSON.stringify(configuredOutputDir)} (resolves to ${absolute})`,
    );
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
