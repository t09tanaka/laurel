import type { NectarEngine } from '../engine.ts';

type IndexedKey = 'id' | 'slug' | 'tag' | 'tags' | 'author' | 'authors' | 'featured';

const INDEXED_KEYS: ReadonlyArray<IndexedKey> = [
  'id',
  'slug',
  'tag',
  'tags',
  'author',
  'authors',
  'featured',
];

const INDEXED_SET: ReadonlySet<string> = new Set<string>(INDEXED_KEYS);

export type FilterIndex = Map<IndexedKey, Map<string, Set<unknown>>>;

interface ParsedClause {
  key: string;
  negate: boolean;
  values: string[];
}

// Routes the Ghost `{{#get}}` filter through per-resource secondary indexes
// instead of a linear scan. Without this, a related-posts block calling
// `{{#get "posts" filter="tags:foo+id:-{{post.id}}"}}` on every article render
// is O(N) per call — 10k posts blow up to 10^8 ops over a full build.
export function applyGetFilter(
  engine: NectarEngine,
  resource: string,
  items: readonly unknown[],
  filter: string,
  ctx: unknown,
): unknown[] {
  const clauses = parseFilterClauses(filter, ctx);
  if (clauses.length === 0) return items.slice();

  const index = getFilterIndex(engine, resource);
  if (!index) {
    return items.filter((item) => clauses.every((c) => evaluateClause(item, c)));
  }

  let candidates: Set<unknown> | null = null;
  const unindexed: ParsedClause[] = [];

  for (const clause of clauses) {
    const map = INDEXED_SET.has(clause.key) ? index.get(clause.key as IndexedKey) : undefined;
    if (!map) {
      unindexed.push(clause);
      continue;
    }
    const matchSet = new Set<unknown>();
    for (const value of clause.values) {
      const bucket = map.get(value);
      if (bucket) for (const it of bucket) matchSet.add(it);
    }
    if (clause.negate) {
      const source: Iterable<unknown> = candidates ?? items;
      const next = new Set<unknown>();
      for (const it of source) if (!matchSet.has(it)) next.add(it);
      candidates = next;
    } else if (candidates === null) {
      candidates = matchSet;
    } else {
      const [small, big] =
        matchSet.size < candidates.size ? [matchSet, candidates] : [candidates, matchSet];
      const next = new Set<unknown>();
      for (const it of small) if (big.has(it)) next.add(it);
      candidates = next;
    }
  }

  const filtered =
    candidates === null
      ? items.slice()
      : items.filter((it) => (candidates as Set<unknown>).has(it));

  if (unindexed.length === 0) return filtered;
  return filtered.filter((item) => unindexed.every((c) => evaluateClause(item, c)));
}

function getFilterIndex(engine: NectarEngine, resource: string): FilterIndex | undefined {
  if (!engine.filterIndexCache) engine.filterIndexCache = new Map<string, FilterIndex>();
  const cached = engine.filterIndexCache.get(resource);
  if (cached) return cached;
  const items = baseResource(engine, resource);
  if (items === undefined) return undefined;
  const built = buildFilterIndex(items);
  engine.filterIndexCache.set(resource, built);
  return built;
}

function baseResource(engine: NectarEngine, resource: string): readonly unknown[] | undefined {
  switch (resource) {
    case 'posts':
      return engine.content.posts;
    case 'pages':
      return engine.content.pages;
    case 'tags':
      return engine.content.tags;
    case 'authors':
      return engine.content.authors;
    default:
      return undefined;
  }
}

function buildFilterIndex(items: readonly unknown[]): FilterIndex {
  const index: FilterIndex = new Map();
  for (const key of INDEXED_KEYS) index.set(key, new Map<string, Set<unknown>>());
  for (const item of items) {
    const obj = item as Record<string, unknown>;
    addEntry(index, 'id', String(obj.id ?? ''), item);
    addEntry(index, 'slug', String(obj.slug ?? ''), item);
    addEntry(index, 'featured', obj.featured ? 'true' : 'false', item);
    indexTaxonomy(index, 'tag', obj.tags, item);
    indexTaxonomy(index, 'tags', obj.tags, item);
    indexTaxonomy(index, 'author', obj.authors, item);
    indexTaxonomy(index, 'authors', obj.authors, item);
  }
  return index;
}

function indexTaxonomy(index: FilterIndex, key: IndexedKey, raw: unknown, item: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const entry of raw) {
    const ref = entry as { slug?: unknown; name?: unknown };
    if (typeof ref?.slug === 'string') addEntry(index, key, ref.slug, item);
    if (typeof ref?.name === 'string' && ref.name !== ref.slug) {
      addEntry(index, key, ref.name, item);
    }
  }
}

function addEntry(index: FilterIndex, key: IndexedKey, value: string, item: unknown): void {
  const map = index.get(key);
  if (!map) return;
  let set = map.get(value);
  if (!set) {
    set = new Set<unknown>();
    map.set(value, set);
  }
  set.add(item);
}

function parseFilterClauses(filter: string, ctx: unknown): ParsedClause[] {
  const clauses: ParsedClause[] = [];
  for (const raw of filter.split('+')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = parseClause(trimmed, ctx);
    if (parsed) clauses.push(parsed);
  }
  return clauses;
}

function parseClause(clause: string, ctx: unknown): ParsedClause | null {
  const colon = clause.indexOf(':');
  if (colon < 0) return null;
  const key = clause.slice(0, colon).trim();
  let value = clause.slice(colon + 1).trim();
  value = interpolate(value, ctx);
  let negate = false;
  if (value.startsWith('-')) {
    negate = true;
    value = value.slice(1);
  }
  let values: string[];
  if (value.startsWith('[') && value.endsWith(']')) {
    values = value
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim());
  } else {
    values = [value];
  }
  return { key, negate, values };
}

function interpolate(value: string, ctx: unknown): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const path = String(expr).trim().split('.');
    let cursor: unknown = ctx;
    for (const seg of path) {
      cursor =
        cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[seg] : undefined;
    }
    return cursor == null ? '' : String(cursor);
  });
}

function evaluateClause(item: unknown, clause: ParsedClause): boolean {
  const obj = item as Record<string, unknown>;
  const matched = clause.values.some((value) => fieldMatches(obj, clause.key, value));
  return clause.negate ? !matched : matched;
}

function fieldMatches(item: Record<string, unknown>, key: string, value: string): boolean {
  switch (key) {
    case 'id':
      return String(item.id ?? '') === value;
    case 'slug':
      return String(item.slug ?? '') === value;
    case 'featured':
      return Boolean(item.featured) === (value === 'true');
    case 'tag':
    case 'tags':
      return (
        Array.isArray(item.tags) &&
        item.tags.some((t) => {
          const tag = t as { slug?: string; name?: string };
          return tag.slug === value || tag.name === value;
        })
      );
    case 'author':
    case 'authors':
      return (
        Array.isArray(item.authors) &&
        item.authors.some((a) => {
          const author = a as { slug?: string; name?: string };
          return author.slug === value || author.name === value;
        })
      );
    case 'visibility':
      return String(item.visibility ?? 'public') === value;
    default:
      return String(item[key] ?? '') === value;
  }
}
