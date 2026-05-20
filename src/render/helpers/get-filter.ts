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

type FilterOp = '=' | '>' | '<' | '>=' | '<=';

// A single comparison: `key OP value(s)` with optional negation. `op === '='`
// with no special-typed values is the fast path that hits the secondary index.
// Anything else (range comparators, typed nulls, list of typed values) goes
// through a linear scan.
interface ParsedClause {
  key: string;
  op: FilterOp;
  negate: boolean;
  // Values after interpolation, before type coercion. Each is a raw string
  // that may decode to a typed scalar via `decodeValue`.
  values: string[];
}

// Ghost-NQL supports OR at the top level via `,` and AND via `+`. Each OR
// branch ANDs its clauses. We evaluate per branch and union the results.
interface FilterTree {
  branches: ParsedClause[][];
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
  route?: unknown,
): unknown[] {
  const tree = parseFilterTree(filter, ctx, route);
  if (tree.branches.length === 0) return items.slice();

  // Each OR branch contributes a set; final result = union.
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const branch of tree.branches) {
    const matched = applyAndBranch(engine, resource, items, branch);
    for (const it of matched) {
      if (!seen.has(it)) {
        seen.add(it);
        out.push(it);
      }
    }
  }
  // Preserve original order by re-projecting through `items`.
  if (tree.branches.length === 1) return out;
  const order = new Map<unknown, number>();
  items.forEach((it, i) => order.set(it, i));
  out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return out;
}

function applyAndBranch(
  engine: NectarEngine,
  resource: string,
  items: readonly unknown[],
  clauses: ParsedClause[],
): unknown[] {
  if (clauses.length === 0) return items.slice();
  const index = getFilterIndex(engine, resource);
  if (!index) return items.filter((item) => clauses.every((c) => evaluateClause(item, c)));

  let candidates: Set<unknown> | null = null;
  const unindexed: ParsedClause[] = [];

  for (const clause of clauses) {
    // Only equality lookups on indexed keys with no typed-null/typed-boolean
    // values can use the secondary index. Range comparators and typed values
    // fall through to per-item evaluation.
    const indexable =
      clause.op === '=' &&
      INDEXED_SET.has(clause.key) &&
      clause.values.every((v) => !isTypedLiteral(v));
    const map = indexable ? index.get(clause.key as IndexedKey) : undefined;
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
    case 'tiers':
      return engine.content.tiers;
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

// Splits the filter source into OR branches (top-level `,`) then AND clauses
// (top-level `+`). Both splits skip over any character that sits inside a
// `[...]` bracket group or `{{...}}` interpolation, so `tag:[a,b]+id:c` parses
// as `[tag:[a,b], id:c]` and `id:{{post.id,fallback}}` keeps the embedded `,`
// inside the interpolation rather than becoming an OR boundary.
function parseFilterTree(filter: string, ctx: unknown, route?: unknown): FilterTree {
  const branches: ParsedClause[][] = [];
  for (const branchSrc of splitTopLevel(filter, ',')) {
    const clauses: ParsedClause[] = [];
    for (const raw of splitTopLevel(branchSrc, '+')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const parsed = parseClause(trimmed, ctx, route);
      if (parsed) clauses.push(parsed);
    }
    if (clauses.length > 0) branches.push(clauses);
  }
  return { branches };
}

function splitTopLevel(src: string, delim: ',' | '+'): string[] {
  const out: string[] = [];
  let depth = 0;
  let interpolating = false;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (!interpolating && ch === '{' && src[i + 1] === '{') {
      interpolating = true;
      i += 1;
      continue;
    }
    if (interpolating && ch === '}' && src[i + 1] === '}') {
      interpolating = false;
      i += 1;
      continue;
    }
    if (interpolating) continue;
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === delim && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out;
}

function parseClause(clause: string, ctx: unknown, route?: unknown): ParsedClause | null {
  const colon = clause.indexOf(':');
  if (colon < 0) return null;
  const key = clause.slice(0, colon).trim();
  let value = clause.slice(colon + 1).trim();
  value = interpolate(value, ctx, route);
  let negate = false;
  if (value.startsWith('-')) {
    negate = true;
    value = value.slice(1);
  }
  // Leading comparison operator: `>`, `<`, `>=`, `<=`. Anything else is `=`.
  let op: FilterOp = '=';
  const opMatch = value.match(/^(<=|>=|<|>)\s*/);
  if (opMatch) {
    op = opMatch[1] as FilterOp;
    value = value.slice(opMatch[0].length);
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
  return { key, op, negate, values };
}

// Ghost themes write filter expressions like `id:-{{post.id}}` that need to
// resolve the route's primary object (`post`, `page`, `tag`, `author`) even
// when the surrounding Handlebars `this` is something else — e.g. a partial
// invoked outside a `{{#post}}` scope, or a sidebar rendered on a tag archive.
// Falling back to `route.data` keeps `{{post.id}}` interpolating to the actual
// post id instead of an empty string (which, with negation, would silently
// match every post in the collection).
function interpolate(value: string, ctx: unknown, route?: unknown): string {
  const routeData =
    route && typeof route === 'object' ? (route as Record<string, unknown>).data : undefined;
  return value.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const path = String(expr).trim().split('.');
    const fromCtx = resolvePath(ctx, path);
    if (fromCtx != null) return stringifyForFilter(fromCtx);
    const fromRoute = resolvePath(routeData, path);
    return fromRoute == null ? '' : stringifyForFilter(fromRoute);
  });
}

// Ruby-style themes use `filter="tags:[{{post.tags}}]"` to surface
// related-posts collections. `post.tags` is a `Tag[]` (objects with `slug`,
// `name`, etc.) — `String(arr)` would emit `[object Object],[object Object]`
// which then evaluates to the literal string and silently matches nothing.
// Project arrays of resource objects down to their slugs (or names as a
// fallback) so the NQL list parser sees `news,opinion`. Plain scalars and
// primitive arrays round-trip via `String()` unchanged.
function stringifyForFilter(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const slug = obj.slug;
          if (typeof slug === 'string' && slug.length > 0) return slug;
          const name = obj.name;
          if (typeof name === 'string' && name.length > 0) return name;
          return '';
        }
        return String(item);
      })
      .filter((s) => s.length > 0)
      .join(',');
  }
  if (value != null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const slug = obj.slug;
    if (typeof slug === 'string') return slug;
    const name = obj.name;
    if (typeof name === 'string') return name;
    return '';
  }
  return String(value);
}

function resolvePath(source: unknown, path: string[]): unknown {
  let cursor: unknown = source;
  for (const seg of path) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function evaluateClause(item: unknown, clause: ParsedClause): boolean {
  const obj = item as Record<string, unknown>;
  const matched = clause.values.some((value) => fieldMatches(obj, clause.key, value, clause.op));
  return clause.negate ? !matched : matched;
}

// NQL has typed scalar literals: `null`, `true`, `false`, ISO-ish dates, and
// numbers. `featured:null` is "IS NULL", not the string "null" — without this,
// a theme writing `featured:-null` to mean "featured is set" would silently
// match nothing.
function isTypedLiteral(value: string): boolean {
  return value === 'null' || value === 'true' || value === 'false';
}

// Maps the raw value into its NQL-decoded form. Strings stay strings; the
// literals `null`/`true`/`false` decode to their JS counterparts; bare numeric
// strings decode to numbers (so `>5` reads as a numeric comparison).
function decodeValue(value: string): string | number | boolean | null {
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value)) && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

// `fieldMatches` is the per-item evaluator used when the secondary index can't
// service the clause (range comparator, typed literal, or non-indexed key).
function fieldMatches(
  item: Record<string, unknown>,
  key: string,
  value: string,
  op: FilterOp,
): boolean {
  const decoded = decodeValue(value);
  const actual = resolveField(item, key);
  if (op === '=') return compareEq(actual, decoded);
  return compareRange(actual, decoded, op);
}

// Resolves the field path used in NQL keys. Ghost surfaces `primary_tag` and
// `primary_author` as objects; the loader's pre-computed `primary_tag.slug` is
// what themes filter on. Date fields are kept as strings so lexicographic
// compare on ISO timestamps matches numeric/date order.
function resolveField(item: Record<string, unknown>, key: string): unknown {
  switch (key) {
    case 'id':
      return item.id;
    case 'slug':
      return item.slug;
    case 'featured':
      return item.featured;
    case 'visibility':
      return item.visibility ?? 'public';
    case 'tag':
    case 'tags':
      return collectRefSlugs(item.tags);
    case 'author':
    case 'authors':
      return collectRefSlugs(item.authors);
    case 'primary_tag':
      return (item.primary_tag as { slug?: unknown } | undefined)?.slug ?? null;
    case 'primary_author':
      return (item.primary_author as { slug?: unknown } | undefined)?.slug ?? null;
    case 'published_at':
    case 'updated_at':
    case 'created_at':
      return item[key] ?? null;
    case 'status':
    case 'type':
    case 'page':
    case 'feature_image':
    case 'tier':
    case 'tiers':
      return item[key] ?? null;
    default:
      return item[key] ?? null;
  }
}

function collectRefSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const ref = entry as { slug?: unknown; name?: unknown };
    if (typeof ref?.slug === 'string') out.push(ref.slug);
    if (typeof ref?.name === 'string' && ref.name !== ref.slug) out.push(ref.name);
  }
  return out;
}

function compareEq(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((v) => compareEq(v, expected));
  if (expected === null) return actual == null;
  if (expected === true || expected === false) {
    if (typeof actual === 'boolean') return actual === expected;
    return Boolean(actual) === expected;
  }
  if (typeof expected === 'number') {
    if (typeof actual === 'number') return actual === expected;
    if (typeof actual === 'string') {
      const n = Number(actual);
      return Number.isFinite(n) && n === expected;
    }
    return false;
  }
  // expected is string here
  if (actual == null) return false;
  return String(actual) === expected;
}

// Range comparators (`>`, `<`, `>=`, `<=`) work on numbers and on string-typed
// dates. String values compare lexicographically; ISO 8601 timestamps sort
// correctly under string compare, so `published_at:>"2024-01-01"` Just Works.
function compareRange(actual: unknown, expected: unknown, op: '>' | '<' | '>=' | '<='): boolean {
  if (actual == null || expected == null) return false;
  if (Array.isArray(actual)) return actual.some((v) => compareRange(v, expected, op));
  const an = toNumeric(actual);
  const en = toNumeric(expected);
  if (an !== null && en !== null) {
    switch (op) {
      case '>':
        return an > en;
      case '<':
        return an < en;
      case '>=':
        return an >= en;
      case '<=':
        return an <= en;
    }
  }
  const as = String(actual);
  const es = String(expected);
  switch (op) {
    case '>':
      return as > es;
    case '<':
      return as < es;
    case '>=':
      return as >= es;
    case '<=':
      return as <= es;
  }
}

function toNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
