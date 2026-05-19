import { lstatSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
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
