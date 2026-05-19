import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pLimit } from '~/util/concurrency.ts';
import { ensureDir, pathContainsSymlink } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Bounded fan-out for per-file fs copies. Matches EMIT_CONCURRENCY in emit.ts so
// large static trees do not exhaust the file-descriptor table on real sites.
const COPY_CONCURRENCY = 32;

// Mirrors the user's `<cwd>/<staticDir>` tree into the output root, verbatim.
// Runs as the final emit step so files dropped here win over both theme assets
// and generated platform files (`_headers`, `_redirects`, `robots.txt`, …) —
// matches the passthrough semantics users coming from Hugo / Astro / 11ty
// expect. Symlinked entries are skipped (same defence as `copyContentAssets`)
// so a malicious `static/oops.txt -> /home/runner/.npmrc` cannot escape into
// the published site. A missing or empty directory is a no-op.
export async function copyStaticDir(opts: {
  cwd: string;
  staticDir: string;
  outputDir: string;
}): Promise<number> {
  const { cwd, staticDir, outputDir } = opts;
  if (staticDir.length === 0) return 0;

  const source = join(cwd, staticDir);
  const glob = new Bun.Glob('**/*');
  const tasks: Array<{ src: string; dst: string }> = [];
  try {
    for await (const rel of glob.scan({ cwd: source, onlyFiles: true, dot: true })) {
      if (pathContainsSymlink(source, rel)) {
        logger.warn(`Skipping symlinked static passthrough file: ${join(source, rel)}`);
        continue;
      }
      tasks.push({ src: join(source, rel), dst: join(outputDir, rel) });
    }
  } catch {
    // Directory may not exist — passthrough is optional, so swallow.
  }
  if (tasks.length === 0) return 0;

  const dirs = new Set(tasks.map((t) => dirname(t.dst)));
  await Promise.all(Array.from(dirs, (d) => ensureDir(d)));
  const limit = pLimit(COPY_CONCURRENCY);
  await Promise.all(tasks.map((t) => limit(() => copyFile(t.src, t.dst))));
  return tasks.length;
}
