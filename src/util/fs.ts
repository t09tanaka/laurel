import { lstatSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

// Collect every relative path produced by a `Bun.Glob` scan into an array in
// one shot. The streaming `for await (const rel of glob.scan(...))` pattern
// makes downstream `Promise.all` / `pLimit` fan-outs impossible to start until
// the iterator is fully drained one entry at a time. `Array.fromAsync` is the
// straight-line equivalent that lets callers immediately hand the resulting
// list to a bounded parallel pipeline (read + parse + hash + …). Bun's glob
// scan is sequential under the hood either way, so collecting up front does
// not change scan throughput — it just unblocks the work that follows.
//
// Results are sorted in lexicographic order so the build is byte-identical
// across runs and across filesystems whose `readdir` order is not stable
// (HFS+/APFS, ext4 + dir_index, Lustre, NFS, …). Every caller used to need to
// remember to `.sort()` their own list to keep generated artefacts (asset
// manifests, route lists, build-manifest entries) reproducible; centralising
// it here makes deterministic output the default and stops new callers from
// reintroducing FS-order leaks.
export async function scanGlob(
  pattern: string,
  options: Parameters<Bun.Glob['scan']>[0],
): Promise<string[]> {
  const rels = await Array.fromAsync(new Bun.Glob(pattern).scan(options));
  rels.sort();
  return rels;
}

// Walks each component of `relativePath` under `baseDir` and returns true if any
// component is a symbolic link. Used to reject symlinked content/assets at build
// time so a malicious file like `content/posts/oops.md -> /home/runner/.npmrc`
// cannot be slurped into the published site.
export function pathContainsSymlink(baseDir: string, relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/).filter((p) => p.length > 0);
  let cur = baseDir;
  for (const part of parts) {
    cur = join(cur, part);
    try {
      if (lstatSync(cur).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}
