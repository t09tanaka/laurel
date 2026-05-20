import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// When a brand-new project (or a checkout where someone deleted `content/`)
// runs `nectar check` / `nectar build` / `nectar lint`, the underlying loader
// throws ENOENT and the user sees an opaque crash. Instead, create the
// expected content sub-directories on demand and warn so the user knows the
// state changed. The warning is intentionally on stderr (via `logger.warn`)
// so JSON consumers still see it through the structured warning channel.
//
// Returns the list of directories that were created (empty when everything
// already existed), so callers / tests can assert behaviour without re-stating
// the dir layout.
export async function ensureContentDirs(cwd: string, config: NectarConfig): Promise<string[]> {
  const candidates = [
    config.content.posts_dir,
    config.content.pages_dir,
    config.content.tags_dir,
    config.content.authors_dir,
  ];
  const created: string[] = [];
  for (const rel of candidates) {
    if (typeof rel !== 'string' || rel.length === 0) continue;
    const abs = isAbsolute(rel) ? rel : join(cwd, rel);
    if (existsSync(abs)) continue;
    try {
      await ensureDir(abs);
      created.push(abs);
    } catch (err) {
      // Surface a warning but don't escalate to error — the loader will
      // throw a NectarError with the path if it really can't be read.
      logger.warn(
        `Could not create missing content directory ${rel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (created.length > 0) {
    const list = created.map((p) => relative(cwd, p) || p).join(', ');
    // Emit at info level (not warn) so `--strict` runs don't fail purely on
    // a fresh checkout. The expected operator response is "edit nectar.toml
    // if you don't want these dirs" — a noisier warning would punish the
    // common "just cloned, just ran build" path. Users hunting noise can
    // still see the message because info goes to stderr.
    logger.info(
      `Created missing content directories (${created.length}): ${list}. Add markdown files under them or remove the entries from nectar.toml [content].`,
    );
  }
  return created;
}
