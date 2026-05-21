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

type FilterOp = '=' | '>' | '<' | '>=' | '<=' | '~' | '~^' | '~$';
type FilterScalar = string | number | boolean | null;

interface FilterValue {
  value: FilterScalar;
  quoted: boolean;
}

// A single comparison: `key OP value(s)` with optional negation. `op === '='`
// with no special-typed values is the fast path that hits the secondary index.
// Anything else (range comparators, typed nulls, list of typed values) goes
// through a linear scan.
interface ParsedClause {
  key: string;
  op: FilterOp;
  negate: boolean;
  values: FilterValue[];
}

type FilterExpr =
  | { kind: 'clause'; clause: ParsedClause }
  | { kind: 'and' | 'or'; left: FilterExpr; right: FilterExpr };

interface FilterTree {
  expr: FilterExpr | null;
  branches: ParsedClause[][];
  invalid: boolean;
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
  _ctx: unknown,
  _route?: unknown,
): unknown[] {
  const tree = parseFilterTree(filter);
  if (tree.invalid) return [];
  if (!tree.expr || tree.branches.length === 0) return items.slice();

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
      clause.values.every((v) => typeof v.value === 'string');
    const map = indexable ? index.get(clause.key as IndexedKey) : undefined;
    if (!map) {
      unindexed.push(clause);
      continue;
    }
    const matchSet = new Set<unknown>();
    for (const value of clause.values) {
      if (typeof value.value !== 'string') continue;
      const bucket = map.get(value.value);
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
    case 'products':
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

// Parses the Ghost NQL subset used by themes. Operator precedence is:
// parentheses, AND (`+`), then OR (`,`). Parsed expressions are converted to
// DNF so existing per-AND-branch index evaluation remains available.
function parseFilterTree(filter: string): FilterTree {
  const source = filter.trim();
  if (source === '') return { expr: null, branches: [], invalid: false };
  const parser = new FilterParser(source);
  const expr = parser.parse();
  if (parser.invalid) return { expr: null, branches: [], invalid: true };
  return { expr, branches: expr ? toDnf(expr) : [], invalid: false };
}

class FilterParser {
  invalid = false;
  #pos = 0;

  constructor(private readonly source: string) {}

  parse(): FilterExpr | null {
    const expr = this.#parseOr();
    this.#skipSpace();
    if (this.#pos < this.source.length) this.invalid = true;
    return expr;
  }

  #parseOr(): FilterExpr | null {
    let left = this.#parseAnd();
    while (!this.invalid) {
      this.#skipSpace();
      if (!this.#consume(',')) break;
      const right = this.#parseAnd();
      if (!right) continue;
      left = left ? { kind: 'or', left, right } : right;
    }
    return left;
  }

  #parseAnd(): FilterExpr | null {
    let left = this.#parsePrimary();
    while (!this.invalid) {
      this.#skipSpace();
      if (!this.#consume('+')) break;
      const right = this.#parsePrimary();
      if (!right) {
        this.invalid = true;
        return left;
      }
      left = left ? { kind: 'and', left, right } : right;
    }
    return left;
  }

  #parsePrimary(): FilterExpr | null {
    this.#skipSpace();
    const ch = this.#peek();
    if (ch === undefined || ch === ',' || ch === ')') return null;
    if (this.#consume('(')) {
      const expr = this.#parseOr();
      this.#skipSpace();
      if (!expr || !this.#consume(')')) this.invalid = true;
      return expr;
    }
    const clause = this.#parseClause();
    return clause ? { kind: 'clause', clause } : null;
  }

  #parseClause(): ParsedClause | null {
    const key = this.#readUntil(':').trim();
    if (key === '' || !this.#consume(':')) {
      this.invalid = true;
      return null;
    }
    this.#skipSpace();
    const negate = this.#consume('-');
    this.#skipSpace();
    const op = this.#parseOp();
    this.#skipSpace();
    const values = this.#consume('[') ? this.#parseListValues() : [this.#parseValue()];
    if (this.invalid || values.length === 0) return null;
    return { key, op, negate, values };
  }

  #parseOp(): FilterOp {
    for (const op of ['<=', '>=', '~^', '~$', '<', '>', '~'] as const) {
      if (this.source.startsWith(op, this.#pos)) {
        this.#pos += op.length;
        return op;
      }
    }
    return '=';
  }

  #parseListValues(): FilterValue[] {
    const values: FilterValue[] = [];
    while (!this.invalid) {
      this.#skipSpace();
      if (this.#consume(']')) return values;
      values.push(this.#parseValue());
      this.#skipSpace();
      if (this.#consume(',')) continue;
      if (this.#consume(']')) return values;
      this.invalid = true;
    }
    return values;
  }

  #parseValue(): FilterValue {
    this.#skipSpace();
    const quote = this.#peek();
    if (quote === "'" || quote === '"') return this.#parseQuotedValue(quote);

    const start = this.#pos;
    while (this.#pos < this.source.length) {
      const ch = this.source[this.#pos];
      if (ch === ',' || ch === '+' || ch === ')' || ch === ']') break;
      this.#pos += 1;
    }
    return decodeValue(this.source.slice(start, this.#pos).trim(), false);
  }

  #parseQuotedValue(quote: '"' | "'"): FilterValue {
    this.#pos += 1;
    let value = '';
    while (this.#pos < this.source.length) {
      const ch = this.source[this.#pos];
      this.#pos += 1;
      if (ch === '\\') {
        if (this.#pos >= this.source.length) {
          this.invalid = true;
          return decodeValue(value, true);
        }
        value += this.source[this.#pos];
        this.#pos += 1;
        continue;
      }
      if (ch === quote) return decodeValue(value, true);
      value += ch;
    }
    this.invalid = true;
    return decodeValue(value, true);
  }

  #readUntil(char: string): string {
    const start = this.#pos;
    while (this.#pos < this.source.length && this.source[this.#pos] !== char) {
      const ch = this.source[this.#pos];
      if (ch === ',' || ch === '+' || ch === ')' || ch === '(' || ch === '[' || ch === ']') break;
      this.#pos += 1;
    }
    return this.source.slice(start, this.#pos);
  }

  #skipSpace(): void {
    while (this.#pos < this.source.length && /\s/.test(this.source[this.#pos] ?? '')) {
      this.#pos += 1;
    }
  }

  #consume(char: string): boolean {
    if (this.source.startsWith(char, this.#pos)) {
      this.#pos += char.length;
      return true;
    }
    return false;
  }

  #peek(): string | undefined {
    return this.source[this.#pos];
  }
}

function toDnf(expr: FilterExpr): ParsedClause[][] {
  if (expr.kind === 'clause') return [[expr.clause]];
  if (expr.kind === 'or') return [...toDnf(expr.left), ...toDnf(expr.right)];
  const left = toDnf(expr.left);
  const right = toDnf(expr.right);
  const branches: ParsedClause[][] = [];
  for (const l of left) {
    for (const r of right) branches.push([...l, ...r]);
  }
  return branches;
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
// Maps the raw value into its NQL-decoded form. Strings stay strings; the
// literals `null`/`true`/`false` decode to their JS counterparts; bare numeric
// strings decode to numbers (so `>5` reads as a numeric comparison).
function decodeValue(value: string, quoted: boolean): FilterValue {
  if (!quoted) {
    if (value === 'null') return { value: null, quoted };
    if (value === 'true') return { value: true, quoted };
    if (value === 'false') return { value: false, quoted };
    if (value !== '' && !Number.isNaN(Number(value)) && /^-?\d+(?:\.\d+)?$/.test(value)) {
      return { value: Number(value), quoted };
    }
  }
  return { value, quoted };
}

// `fieldMatches` is the per-item evaluator used when the secondary index can't
// service the clause (range comparator, typed literal, or non-indexed key).
function fieldMatches(
  item: Record<string, unknown>,
  key: string,
  value: FilterValue,
  op: FilterOp,
): boolean {
  const actual = resolveField(item, key);
  if (op === '=') return compareEq(actual, value.value);
  if (op === '~' || op === '~^' || op === '~$') return compareContains(actual, value.value, op);
  return compareRange(actual, value.value, op);
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
      if (key.includes('.')) return resolvePath(item, key.split('.')) ?? null;
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

function resolvePath(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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

function compareContains(actual: unknown, expected: unknown, op: '~' | '~^' | '~$'): boolean {
  if (actual == null || expected == null) return false;
  if (Array.isArray(actual)) return actual.some((v) => compareContains(v, expected, op));
  const haystack = String(actual).toLowerCase();
  const needle = String(expected).toLowerCase();
  switch (op) {
    case '~':
      return haystack.includes(needle);
    case '~^':
      return haystack.startsWith(needle);
    case '~$':
      return haystack.endsWith(needle);
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
