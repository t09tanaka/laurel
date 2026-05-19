import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { logger } from '~/util/logger.ts';

/**
 * Filename of the optional preserve list at the project root. Each non-empty,
 * non-comment line names a path (relative to the build output directory) that
 * the build should NOT discard when swapping the staging tree into place.
 *
 * Motivation: `commitStagingDir` atomically renames the staging dir over the
 * final output dir, which means anything the user dropped into `dist/` (e.g.
 * `CNAME` for GitHub Pages, `.well-known/`) is destroyed on the next build.
 * Listing those paths here causes them to be copied from the previous
 * `finalOutputDir` into the staging dir just before the swap.
 */
export const PRESERVE_FILE = '.nectarignore';

export async function loadPreservePatterns(cwd: string): Promise<string[]> {
  const file = Bun.file(join(cwd, PRESERVE_FILE));
  if (!(await file.exists())) return [];
  const text = await file.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export interface PreserveUserFilesOptions {
  cwd: string;
  finalOutputDir: string;
  stagingDir: string;
}

export interface PreserveResult {
  copied: number;
  skipped: number;
}

export async function preserveUserFiles({
  cwd,
  finalOutputDir,
  stagingDir,
}: PreserveUserFilesOptions): Promise<PreserveResult> {
  const patterns = await loadPreservePatterns(cwd);
  if (patterns.length === 0) return { copied: 0, skipped: 0 };

  const absoluteFinal = resolve(finalOutputDir);
  let copied = 0;
  let skipped = 0;

  for (const pattern of patterns) {
    if (isAbsolute(pattern)) {
      logger.warn(
        `${PRESERVE_FILE}: ignoring absolute path ${JSON.stringify(pattern)} (paths must be relative to build.output_dir)`,
      );
      skipped += 1;
      continue;
    }

    const src = resolve(absoluteFinal, pattern);
    const rel = relative(absoluteFinal, src);
    // Refuse anything that escapes the output dir. The user wrote these paths
    // by hand and a `..` slip would otherwise let us `cp` from outside dist/.
    if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${sep}`)) {
      logger.warn(`${PRESERVE_FILE}: ${JSON.stringify(pattern)} escapes build.output_dir; skipped`);
      skipped += 1;
      continue;
    }

    let srcStat: Awaited<ReturnType<typeof stat>>;
    try {
      srcStat = await stat(src);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // First build, or the user listed something that does not exist yet.
        // Not an error: the preserve list is forward-looking by design.
        continue;
      }
      throw err;
    }

    const dst = join(stagingDir, rel);
    let dstExists = false;
    try {
      await stat(dst);
      dstExists = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    if (dstExists) {
      // Build output occupies the same path. Letting preserve overwrite would
      // silently shadow generated artifacts (`_headers`, `robots.txt`, …) with
      // a stale copy from the previous build. Surface this and keep the new
      // output — users who want the static copy should disable the generator.
      logger.warn(
        `${PRESERVE_FILE}: ${JSON.stringify(pattern)} conflicts with build output; keeping fresh output`,
      );
      skipped += 1;
      continue;
    }

    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst, { recursive: srcStat.isDirectory() });
    copied += 1;
  }

  return { copied, skipped };
}
