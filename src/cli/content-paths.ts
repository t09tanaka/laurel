import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';

export type ContentKind = 'posts' | 'pages';
export const CONTENT_KINDS: readonly ContentKind[] = ['posts', 'pages'];

export interface ResolvedContentFile {
  kind: ContentKind;
  path: string;
}

export function absolutise(cwd: string, dir: string): string {
  return isAbsolute(dir) ? dir : resolve(cwd, dir);
}

export function contentSearchKinds(kindHint: ContentKind | undefined): ContentKind[] {
  return kindHint ? [kindHint] : [...CONTENT_KINDS];
}

// Resolve a slug to a Markdown file path. Fast path: `<dir>/<slug>.md` (the
// convention `nectar new` writes). Fallback: scan every `.md` under the
// candidate dirs and parse the leading YAML frontmatter for an explicit
// `slug: <value>` line. The scan only fires when the fast path misses, so
// the common case stays a single `existsSync` call.
export async function resolveContentSlugPath(
  slug: string,
  search: readonly ContentKind[],
  dirs: Record<ContentKind, string>,
): Promise<ResolvedContentFile | undefined> {
  for (const kind of search) {
    const fast = join(dirs[kind], `${slug}.md`);
    if (existsSync(fast)) return { kind, path: fast };
  }
  for (const kind of search) {
    const hit = await scanForFrontmatterSlug(dirs[kind], slug);
    if (hit) return { kind, path: hit };
  }
  return undefined;
}

async function scanForFrontmatterSlug(dir: string, slug: string): Promise<string | undefined> {
  if (!existsSync(dir)) return undefined;
  let rels: string[];
  try {
    rels = await scanGlob('**/*.md', { cwd: dir });
  } catch {
    return undefined;
  }
  for (const rel of rels) {
    if (pathContainsSymlink(dir, rel)) continue;
    const filePath = join(dir, rel);
    const raw = await readFile(filePath, 'utf8');
    if (extractFrontmatterSlug(raw) === slug) return filePath;
  }
  return undefined;
}

function extractFrontmatterSlug(raw: string): string | undefined {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === '---') return undefined;
    const match = line.match(/^\s*slug\s*:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/);
    if (match) return match[1];
  }
  return undefined;
}
