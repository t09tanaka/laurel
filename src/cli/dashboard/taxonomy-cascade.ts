import slugify from 'slugify';
import type { LaurelConfig } from '~/config/schema.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { loadContent } from '~/content/loader.ts';
import type { Page, Post } from '~/content/model.ts';
import { absolutise } from '../content-paths.ts';

// Full text of a post/page captured before its frontmatter was rewritten, so a
// restore can put the file back byte-for-byte rather than re-deriving it.
export interface TaxonomyCascadeSnapshot {
  path: string;
  previousText: string;
}

type TaxonomyKind = 'tags' | 'authors';

// Mirror of the loader's slug derivation (`src/content/markdown.ts`,
// `slugify(value, { lower: true, strict: true })`) so the entries we strip
// match exactly what the taxonomy graph surfaced. Returns null for shapes the
// loader would have ignored.
function entrySlug(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const name = entry.trim();
    if (!name) return null;
    return slugify(name, { lower: true, strict: true });
  }
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    const explicitSlug = typeof obj.slug === 'string' ? obj.slug.trim() : '';
    const name =
      typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : explicitSlug;
    if (!name && !explicitSlug) return null;
    return explicitSlug
      ? slugify(explicitSlug, { lower: true, strict: true })
      : slugify(name, { lower: true, strict: true });
  }
  return null;
}

// Drop entries resolving to `targetSlug` from a single frontmatter value,
// preserving its original shape (scalar, scalar-array, or object-array). An
// empty result becomes `undefined` so the caller can delete the key rather than
// leave `tags: []` behind.
function stripValue(value: unknown, targetSlug: string): { changed: boolean; next: unknown } {
  if (value === undefined || value === null) return { changed: false, next: value };
  if (Array.isArray(value)) {
    const kept = value.filter((entry) => entrySlug(entry) !== targetSlug);
    if (kept.length === value.length) return { changed: false, next: value };
    return { changed: true, next: kept.length > 0 ? kept : undefined };
  }
  if (entrySlug(value) === targetSlug) return { changed: true, next: undefined };
  return { changed: false, next: value };
}

// Frontmatter keys that carry taxonomy references, by kind. Authors can appear
// under three keys (Ghost-style `primary_author`, plural `authors`, singular
// `author`), so all three are scrubbed.
const KEYS_BY_KIND: Record<TaxonomyKind, readonly string[]> = {
  tags: ['tags'],
  authors: ['primary_author', 'authors', 'author'],
};

// Returns the mutated frontmatter when at least one reference was removed,
// otherwise null. The input object is not mutated.
function removeReferences(
  frontmatter: Record<string, unknown>,
  kind: TaxonomyKind,
  targetSlug: string,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...frontmatter };
  let changed = false;
  for (const key of KEYS_BY_KIND[kind]) {
    if (!(key in next)) continue;
    const result = stripValue(next[key], targetSlug);
    if (!result.changed) continue;
    changed = true;
    if (result.next === undefined) {
      delete next[key];
    } else {
      next[key] = result.next;
    }
  }
  return changed ? next : null;
}

function referencesSlug(record: Post | Page, kind: TaxonomyKind, slug: string): boolean {
  return kind === 'tags'
    ? record.tags.some((tag) => tag.slug === slug)
    : record.authors.some((author) => author.slug === slug);
}

// Strip every reference to `slug` (of the given kind) from the frontmatter of
// posts and pages, capturing each rewritten file's prior full text. The file is
// re-serialized via `serialize` so it matches the dashboard's own write format.
export async function cascadeRemoveTaxonomyReferences(options: {
  cwd: string;
  config: LaurelConfig;
  kind: TaxonomyKind;
  slug: string;
  serialize: (frontmatter: Record<string, unknown>, body: string) => string;
}): Promise<TaxonomyCascadeSnapshot[]> {
  const { cwd, config, kind, slug, serialize } = options;
  const graph = await loadContent({ cwd, config, includeDrafts: true, includeFuturePosts: true });
  const targets: Array<{ record: Post | Page; dir: string; sourceKey: 'posts' | 'pages' }> = [
    ...graph.posts.map((record) => ({
      record,
      dir: config.content.posts_dir,
      sourceKey: 'posts' as const,
    })),
    ...graph.pages.map((record) => ({
      record,
      dir: config.content.pages_dir,
      sourceKey: 'pages' as const,
    })),
  ];
  const snapshots: TaxonomyCascadeSnapshot[] = [];
  for (const { record, dir, sourceKey } of targets) {
    if (!referencesSlug(record, kind, slug)) continue;
    const source = graph.sources?.[sourceKey].get(record.id);
    if (!source) continue;
    const absPath = absolutise(cwd, `${dir.replace(/\/$/, '')}/${source.path}`);
    const previousText = await Bun.file(absPath).text();
    const parsed = parseFrontmatter(previousText, { filePath: absPath });
    const nextFrontmatter = removeReferences(parsed.data, kind, slug);
    if (!nextFrontmatter) continue;
    await Bun.write(absPath, serialize(nextFrontmatter, parsed.body));
    snapshots.push({ path: absPath, previousText });
  }
  return snapshots;
}
