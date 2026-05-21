import type Handlebars from 'handlebars';
import { logger } from '~/util/logger.ts';
import type { NectarEngine } from '../engine.ts';
import { withTrustedCaptionHtml, withTrustedCaptionHtmlArray } from '../safe-context.ts';
import { applyGetFilter } from './get-filter.ts';

interface HelperOptions extends Handlebars.HelperOptions {
  hash: {
    visibility?: string;
    order?: string;
    limit?: number | string;
    from?: number | string;
    to?: number | string;
    columns?: number | string;
  };
}

interface IterationEntry {
  key?: string;
  value: unknown;
}

const warnedTiersGetHelpers = new WeakSet<NectarEngine>();

export function registerBlockHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper('foreach', function foreachHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as HelperOptions;
    const raw = args[0];
    const items = toEntries(raw);
    const from = parseNum(options.hash.from) ?? 1;
    const to = parseNum(options.hash.to) ?? items.length;
    const limit = parseNum(options.hash.limit) ?? Number.POSITIVE_INFINITY;

    let buffer = '';
    let renderedIndex = 0;
    // Ghost applies the visibility filter first, then slices by from/to/limit
    // against the already-filtered collection (see TryGhost/Ghost
    // `core/frontend/helpers/foreach.js`). The order matters when public and
    // members posts are interleaved: `visibility="public" limit=3` must yield
    // the first three *public* items, not three positions from the raw input.
    const visible = items.filter((entry) => visibilityFilter(entry.value, options.hash.visibility));
    const ordered =
      options.hash.order === undefined
        ? visible
        : applyEntryOrder(visible, String(options.hash.order));
    const sliced = ordered.slice(from - 1, to).slice(0, limit);
    const columns = parseColumns(options.hash.columns);
    const fnAny = options.fn as unknown as { blockParams?: number };
    const hasBlockParams = (fnAny?.blockParams ?? 0) > 0;
    for (let i = 0; i < sliced.length; i += 1) {
      const entry = sliced[i];
      const data = engine.hb.createFrame(
        (options.data as Record<string, unknown> | undefined) ?? {},
      );
      const foreachState: Record<string, unknown> = {
        index: i,
        number: i + 1,
        first: i === 0,
        last: i === sliced.length - 1,
        even: i % 2 === 0,
        odd: i % 2 !== 0,
        rowStart: i % columns === 0,
        rowEnd: (i + 1) % columns === 0 || i === sliced.length - 1,
      };
      if (entry.key !== undefined) foreachState.key = entry.key;
      Object.assign(data, foreachState);
      buffer += options.fn(entry.value, {
        data,
        ...(hasBlockParams ? { blockParams: [entry.value, foreachState] } : {}),
      });
      renderedIndex += 1;
    }
    if (renderedIndex === 0 && options.inverse) {
      buffer += options.inverse(this);
    }
    return buffer;
  });

  engine.hb.registerHelper('is', function isHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    // Ghost lets themes write `{{#is "post, page"}}` with commas or
    // `{{#is "post page"}}` with spaces (or any mix). Splitting on `[\s,]+`
    // covers both forms so a stray space in a theme template still matches.
    const targets = args
      .slice(0, -1)
      .flatMap((a) => (typeof a === 'string' ? a.split(/[\s,]+/) : []))
      .map((s) => s.trim())
      .filter(Boolean);
    const route = (options.data?.route ?? {}) as {
      kind?: string;
      data?: { pagination?: { page: number } };
    };
    const kind = route.kind;
    const aliases: Record<string, string[]> = {
      home: ['home', 'index'],
      index: ['home', 'index'],
      post: ['post'],
      page: ['page'],
      tag: ['tag'],
      author: ['author'],
      error: ['error'],
      paged: [],
    };
    const matches = targets.some((target) => {
      if (target === 'paged') return (route.data?.pagination?.page ?? 1) > 1;
      if (target === 'private') return isPrivatePublication(engine, options);
      const aliasSet = aliases[target] ?? [target];
      return kind ? aliasSet.includes(kind) : false;
    });
    return matches ? options.fn(this) : options.inverse(this);
  });

  engine.hb.registerHelper(
    'has',
    function hasHelper(this: unknown, options: Handlebars.HelperOptions) {
      const hash = options.hash as Record<string, unknown>;
      const ctx = this as Record<string, unknown>;
      let matched = false;
      for (const [key, raw] of Object.entries(hash)) {
        const value = String(raw ?? '');
        if (key.startsWith('count:')) {
          matched = evaluateCountAttr(ctx, key.slice('count:'.length), value);
        } else {
          switch (key) {
            case 'tag':
              matched = evaluateTagOrAuthorAttr(ctx.tags, value);
              break;
            case 'author':
              matched = evaluateTagOrAuthorAttr(ctx.authors, value);
              break;
            case 'visibility': {
              matched = evaluateVisibilityAttr(ctx.visibility, value);
              break;
            }
            case 'slug': {
              matched = String(ctx.slug ?? '') === value;
              break;
            }
            case 'number': {
              const frameNumber = parseNum(
                (options.data as { number?: unknown } | undefined)?.number,
              );
              const route = options.data?.route as
                | { data?: { pagination?: { page?: number } } }
                | undefined;
              const page = route?.data?.pagination?.page ?? 1;
              const actual =
                frameNumber !== undefined && Number.isFinite(frameNumber) ? frameNumber : page;
              matched = evaluateNumberAttr(actual, value);
              break;
            }
            case 'index': {
              const idx = (options.data as { index?: number } | undefined)?.index ?? 0;
              matched = evaluateNumberAttr(idx, value);
              break;
            }
            case 'any':
              matched = evaluateAnyAll(ctx, options.data, value, 'any');
              break;
            case 'all':
              matched = evaluateAnyAll(ctx, options.data, value, 'all');
              break;
            default:
              matched = String((ctx as Record<string, unknown>)[key] ?? '') === value;
          }
        }
        if (matched) break;
      }
      return matched ? options.fn(this) : options.inverse(this);
    },
  );

  registerContextBlock(engine, 'post', (route) => pickFromRoute(route, 'post'));
  registerContextBlock(engine, 'page', (route) => pickFromRoute(route, 'page'));
  registerContextBlock(engine, 'tag', (route) => pickFromRoute(route, 'tag'));
  registerContextBlock(engine, 'author', (route) => pickFromRoute(route, 'author'));

  engine.hb.registerHelper(
    'data',
    function dataHelper(this: unknown, options: Handlebars.HelperOptions) {
      const rootData = (options.data as Record<string, unknown> | undefined) ?? {};
      const data = engine.hb.createFrame(rootData);
      return options.fn(rootData, { data });
    },
  );

  registerAdjacentPostBlock(engine, 'prev_post', 'prev');
  registerAdjacentPostBlock(engine, 'next_post', 'next');

  engine.hb.registerHelper('get', function getHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const resource = String(args[0] ?? '');
    const hash = options.hash as Record<string, unknown>;
    const limitRaw = hash.limit;
    const limit: number | 'all' = limitRaw === 'all' ? 'all' : (parseNum(limitRaw) ?? 15);
    const requestedPage = Math.max(1, Math.trunc(parseNum(hash.page) ?? 1));
    const order = String(hash.order ?? 'published_at desc');
    const filter = stringifyGetHashValue(hash.filter);
    const slugFilter = parseSlugHashFilter(hash);
    const include = parseIncludeTokens(hash.include);
    const fields = parseFieldsTokens(hash.fields);
    const fnAny = options.fn as unknown as { blockParams?: number };
    const blockParams = (fnAny?.blockParams ?? 0) > 0;
    if (resource === 'tiers') warnTiersGetHelper(engine);
    const sorted = getSortedResource(engine, resource, order);
    const slugFiltered = slugFilter
      ? applyGetFilter(engine, resource, sorted, slugFilter, this, options.data?.route)
      : sorted;
    const filtered: readonly unknown[] = filter
      ? applyGetFilter(engine, resource, slugFiltered, filter, this, options.data?.route)
      : slugFiltered;
    const total = filtered.length;
    const pagination = computeGetPagination(total, requestedPage, limit);
    const paged =
      limit === 'all'
        ? filtered
        : filtered.slice((pagination.page - 1) * limit, pagination.page * limit);
    if (paged.length === 0 && options.inverse) {
      return options.inverse(this);
    }
    const presented = presentGetResource(engine, resource, paged);
    const included = applyGetIncludes(engine, resource, presented, include);
    const results = exposeGetResource(resource, applyGetFields(included, fields));
    const data = engine.hb.createFrame((options.data as Record<string, unknown> | undefined) ?? {});
    data.resource = resource;
    data.pagination = pagination;
    if (blockParams) {
      const paginationBlockParam = { resource, ...pagination, pagination };
      return options.fn(this, {
        data,
        blockParams: [results, paginationBlockParam],
      });
    }
    return options.fn(results, { data });
  });

  engine.hb.registerHelper('match', function matchHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const params = args.slice(0, -1);
    let result = false;
    if (params.length === 1) {
      result = Boolean(params[0]);
    } else if (params.length === 2) {
      result = looseEquals(params[0], params[1]);
    } else if (params.length === 3) {
      const [left, op, right] = params;
      result = compare(left, String(op), right);
    }
    if (options.fn) {
      return result ? options.fn(this) : options.inverse(this);
    }
    if (!result) return '';
    if (params.length === 1) return params[0];
    return result;
  });
}

function warnTiersGetHelper(engine: NectarEngine): void {
  if (warnedTiersGetHelpers.has(engine)) return;
  warnedTiersGetHelpers.add(engine);
  logger.warn(
    'Ghost membership tiers are not backed by a live members backend in Nectar; {{#get "tiers"}} exposes configured static tiers only, or an empty list when none are configured.',
  );
}

function exposeGetResource(resource: string, results: unknown[]): unknown[] {
  Object.defineProperty(results, resource, {
    configurable: true,
    enumerable: false,
    value: results,
    writable: false,
  });
  return results;
}

// Ghost's `{{#get}}` exposes a `pagination` object to the block so themes can
// page through API results. `prev`/`next` are page numbers (or null) because
// `{{#get}}` queries are not tied to a route, so URL synthesis is the theme's
// job. `limit: 'all'` collapses to a single page covering every match.
export interface GetPagination {
  page: number;
  limit: number | 'all';
  pages: number;
  total: number;
  prev: number | null;
  next: number | null;
}

function computeGetPagination(
  total: number,
  requestedPage: number,
  limit: number | 'all',
): GetPagination {
  if (limit === 'all' || !Number.isFinite(limit) || limit <= 0) {
    return { page: 1, limit, pages: 1, total, prev: null, next: null };
  }
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.max(1, requestedPage);
  return {
    page,
    limit,
    pages,
    total,
    prev: page > 1 && total > 0 ? Math.min(page - 1, pages) : null,
    next: page < pages ? page + 1 : null,
  };
}

// The loader pre-sorts posts by `published_at desc` and pages by `title asc`.
// When the `get` helper's order matches that, we can reuse the loader's
// array directly and skip sorting entirely.
const DEFAULT_ORDERS: Record<string, string> = {
  posts: 'published_at desc',
  pages: 'title asc',
};

function getSortedResource(
  engine: NectarEngine,
  resource: string,
  order: string,
): readonly unknown[] {
  const base = baseResource(engine, resource);
  if (base.length === 0) return base;
  if (DEFAULT_ORDERS[resource] === order) return base;
  const cacheKey = `${resource}|${order}`;
  const cached = engine.sortedCache.get(cacheKey);
  if (cached) return cached;
  const sorted = applyOrder(base, order);
  engine.sortedCache.set(cacheKey, sorted);
  return sorted;
}

function presentGetResource(
  engine: NectarEngine,
  resource: string,
  results: readonly unknown[],
): readonly unknown[] {
  switch (resource) {
    case 'posts':
    case 'pages':
      return withTrustedCaptionHtmlArray(engine.hb, results);
    default:
      return results;
  }
}

function parseIncludeTokens(raw: unknown): readonly string[] {
  if (typeof raw !== 'string') return [];
  const tokens: string[] = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

function parseFieldsTokens(raw: unknown): readonly string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function stringifyGetHashValue(raw: unknown): string {
  if (raw == null) return '';
  if (isHandlebarsSafeString(raw)) return raw.toHTML();
  if (typeof raw === 'string') return raw;
  return String(raw);
}

function isHandlebarsSafeString(value: unknown): value is { toHTML(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toHTML' in value &&
    typeof value.toHTML === 'function'
  );
}

function parseSlugHashFilter(hash: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(hash, 'slug')) return undefined;
  const slug = String(hash.slug ?? '');
  return `slug:${quoteGetFilterValue(slug)}`;
}

function quoteGetFilterValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function applyGetFields(results: readonly unknown[], fields: readonly string[]): unknown[] {
  if (fields.length === 0) return results.slice();
  return results.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const projected: Record<string, unknown> = {};
    const record = item as Record<string, unknown>;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(record, field)) {
        projected[field] = record[field];
      }
    }
    return projected;
  });
}

// Ghost's `include=` query string surfaces relations / counts that aren't part
// of the default resource shape. Nectar pre-hydrates `authors` and `tags` on
// posts/pages at load time, so those tokens are no-ops. `count.posts` is the
// one that actually needs work on the way out: tags already carry the count
// from the loader, but author objects don't — wrap them with the count from
// the inverse `postsByAuthor` index so themes can render `{{count.posts}}`.
function applyGetIncludes(
  engine: NectarEngine,
  resource: string,
  results: readonly unknown[],
  include: readonly string[],
): unknown[] {
  if (include.length === 0 || !include.includes('count.posts')) {
    return results.slice();
  }
  if (resource === 'authors') {
    const postsByAuthor = (
      engine.content as { postsByAuthor?: ReadonlyMap<string, readonly unknown[]> }
    ).postsByAuthor;
    return results.map((item) => attachAuthorPostCount(item, postsByAuthor));
  }
  return results.slice();
}

function attachAuthorPostCount(
  author: unknown,
  postsByAuthor: ReadonlyMap<string, readonly unknown[]> | undefined,
): unknown {
  if (!author || typeof author !== 'object') return author;
  const existing = (author as { count?: { posts?: unknown } }).count;
  if (existing && typeof existing === 'object' && typeof existing.posts === 'number') {
    return author;
  }
  const slug = String((author as { slug?: unknown }).slug ?? '');
  const count = postsByAuthor?.get(slug)?.length ?? 0;
  return { ...(author as Record<string, unknown>), count: { posts: count } };
}

function baseResource(engine: NectarEngine, resource: string): readonly unknown[] {
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
      return [];
  }
}

function pickFromRoute(
  route: Record<string, unknown> | undefined,
  key: 'post' | 'page' | 'tag' | 'author',
): unknown {
  if (!route) return undefined;
  const data = route.data as Record<string, unknown> | undefined;
  return data ? data[key] : undefined;
}

function registerContextBlock(
  engine: NectarEngine,
  name: 'post' | 'page' | 'tag' | 'author',
  pick: (route: Record<string, unknown> | undefined) => unknown,
): void {
  engine.hb.registerHelper(
    name,
    function contextBlockHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as Record<string, unknown> | undefined;
      const value = (this as Record<string, unknown> | undefined)?.[name] ?? pick(route);
      if (!value) return options.inverse ? options.inverse(this) : '';
      return options.fn(withTrustedCaptionHtml(engine.hb, value));
    },
  );
}

// `{{#prev_post}}` / `{{#next_post}}` scope into the adjacent post on a single
// post template. The content loader pre-wires `post.prev` (older) and
// `post.next` (newer) when sorting by `published_at desc`, so the helpers just
// hand that reference to the block body and fall through to inverse otherwise.
function registerAdjacentPostBlock(
  engine: NectarEngine,
  name: 'prev_post' | 'next_post',
  key: 'prev' | 'next',
): void {
  engine.hb.registerHelper(
    name,
    function adjacentPostHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown> | undefined;
      const fromCtx = ctx ? (ctx[key] as unknown) : undefined;
      const route = options.data?.route as
        | { data?: { post?: Record<string, unknown> } }
        | undefined;
      const fromRoute = route?.data?.post?.[key];
      const target = fromCtx ?? fromRoute;
      if (!target) return options.inverse ? options.inverse(this) : '';
      return options.fn(withTrustedCaptionHtml(engine.hb, target));
    },
  );
}

function isPrivatePublication(engine: NectarEngine, options: Handlebars.HelperOptions): boolean {
  const data = (options.data ?? {}) as {
    site?: { private?: unknown };
    blog?: { private?: unknown };
    setting?: { private?: unknown };
  };
  // Ghost's `private` context is a publication-wide password-protection flag,
  // not a route kind. Nectar has no runtime auth gate, so unset data stays
  // false; `[site].private = true` lets static deployments whose host enforces
  // protection render the matching theme branch.
  return (
    data.site?.private === true ||
    data.blog?.private === true ||
    data.setting?.private === true ||
    engine.content.site?.private === true
  );
}

function toEntries(value: unknown): IterationEntry[] {
  if (Array.isArray(value)) return value.map((item) => ({ value: item }));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
      key,
      value: item,
    }));
  }
  return [];
}

function parseNum(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Ghost's `{{#foreach columns=N}}` drives masonry / grid wrapping by exposing
// `@rowStart` / `@rowEnd` on each iteration. A 1-column layout (the default)
// marks every item as both start and end of its own row; higher column counts
// flip the flags at the row boundaries. Non-positive or unparseable values
// collapse to 1 so themes that pass a garbage value still render coherently
// instead of dividing by zero.
function parseColumns(value: unknown): number {
  const n = parseNum(value);
  if (n === undefined) return 1;
  const truncated = Math.trunc(n);
  return truncated >= 1 ? truncated : 1;
}

// Ghost's `visibility=` hash on `{{#foreach}}` reads the iterated item's own
// `visibility` field, which means the filter is polymorphic across resources:
//   - Posts carry `'public' | 'members' | 'paid' | 'tiers' | 'filter'`, so
//     `visibility="public"` drops anything gated behind membership or tiers.
//   - Tags carry `'public' | 'internal'` (Nectar's loader marks `hash-`-prefixed
//     slugs as `'internal'` to mirror Ghost's `#`-prefix convention), so
//     `visibility="public"` drops internal tags via the `tag.visibility ===
//     'public'` comparison.
//   - Authors, Pages, and Tiers have no per-row visibility variation in
//     Nectar's content graph. Authors omit the field entirely; Pages/Tiers
//     always materialise as `'public'`. The `?? 'public'` fallback below treats
//     a missing field as public so iterating those resources with
//     `visibility="public"` is a no-op rather than a wipeout.
// `visibility="all"` is the documented Ghost escape hatch that bypasses the
// filter entirely — used by themes that want to render internal tags or
// members-only posts in admin-adjacent UI.
function visibilityFilter(item: unknown, visibility: string | undefined): boolean {
  if (!visibility || visibility === 'all') return true;
  const obj = item as { visibility?: string };
  if (!obj || typeof obj !== 'object') return true;
  if (visibility === 'public') return (obj.visibility ?? 'public') === 'public';
  return (obj.visibility ?? 'public') === visibility;
}

// Ghost has used both `tiers` and `filter` for tier-specific gating across
// theme surfaces. Official themes such as Edition still branch on
// `{{#has visibility="filter"}}` for tier CTA copy, while current Ghost core
// templates use `visibility="tiers"`. Treat the filter branch as the
// tier-specific alias while preserving Ghost's comma-separated OR syntax, e.g.
// `{{#has visibility="public,members,paid"}}`.
function evaluateVisibilityAttr(raw: unknown, value: string): boolean {
  const visibility =
    String(raw ?? 'public')
      .trim()
      .toLowerCase() || 'public';
  const expectedValues = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return expectedValues.some((expected) => {
    if (expected === 'filter') return visibility === 'filter' || visibility === 'tiers';
    return visibility === expected;
  });
}

// `{{#has tag="news, sports"}}` / `{{#has author="jane"}}` match if any listed
// slug/name appears on the context's tags/authors array. Ghost also accepts a
// `count:` prefix on the value side — `{{#has tag="count:>1"}}` or
// `{{#has author="count:>1"}}` — meaning "collection size matches the inner
// comparison". We route that form back through `evaluateCountAttr` so both
// syntaxes share the same numeric comparator implementation.
function evaluateTagOrAuthorAttr(raw: unknown, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('count:')) {
    const tail = trimmed.slice('count:'.length);
    const length = Array.isArray(raw) ? raw.length : 0;
    return evaluateCountAttr({ __nectar_collection: length }, '__nectar_collection', tail);
  }
  const list = (raw as { slug?: string; name?: string }[] | undefined) ?? [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((needle) => list.some((entry) => entry.slug === needle || entry.name === needle));
}

// `{{#has number="3"}}` and `{{#has index="0"}}` compare a single integer
// position (pagination page, foreach @index, …) against literal, modulus, or
// comparison expressions. Ghost also accepts comma-separated patterns such as
// `number="3, 6, 9"`, which are evaluated as OR. `nth:N` is Ghost's modulus
// form: matches every Nth iteration (`number === 0 mod N` after 1-indexing).
// Plain integers fall back to equality. Range comparators (`>`, `<=`, …) are
// forwarded so themes can write `index=">2"` for "after the third item".
function evaluateNumberAttr(actual: number, value: string): boolean {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => evaluateSingleNumberPattern(actual, part));
}

function evaluateSingleNumberPattern(actual: number, trimmed: string): boolean {
  if (trimmed.startsWith('nth:')) {
    const n = Number(trimmed.slice('nth:'.length));
    if (!Number.isFinite(n) || n <= 0) return false;
    // Ghost's nth uses 1-indexed positions; `nth:3` fires on the 3rd, 6th, … item.
    // Pagination pages are 1-indexed too, so the same modulus works.
    return actual > 0 && actual % n === 0;
  }
  const m = trimmed.match(/^(<=|>=|<|>)?\s*(-?\d+)$/);
  if (!m) return false;
  const op = m[1] ?? '=';
  const expected = Number(m[2]);
  switch (op) {
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    default:
      return actual === expected;
  }
}

// `{{#has any="twitter, facebook"}}` / `all="..."` check the truthiness of a
// list of property paths. Paths starting with `@` resolve against the data
// frame (`@labs.foo` → `options.data.labs.foo`); bare paths walk the current
// context. This matches Ghost's helper, which themes use to gate flag-driven
// blocks (`@labs.x`) and presence checks (`twitter`, `facebook`).
function evaluateAnyAll(
  ctx: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
  value: string,
  mode: 'any' | 'all',
): boolean {
  const paths = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (paths.length === 0) return false;
  const check = (path: string): boolean => {
    const useData = path.startsWith('@');
    const segs = (useData ? path.slice(1) : path).split('.');
    const root: unknown = useData ? data : ctx;
    let cursor: unknown = root;
    for (const seg of segs) {
      if (cursor == null || typeof cursor !== 'object') return false;
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    return Boolean(cursor);
  };
  return mode === 'any' ? paths.some(check) : paths.every(check);
}

// Ghost themes write `{{#has count:tags=">2"}}` to branch on collection size.
// Handlebars parses `count:tags` as the hash key and `">2"` as its string value,
// so we resolve `this[property]` (treating arrays by length and plain numbers as
// is), then parse a leading comparison operator off the value.
function evaluateCountAttr(ctx: Record<string, unknown>, property: string, value: string): boolean {
  if (!property) return false;
  const target = ctx[property];
  const actual = Array.isArray(target)
    ? target.length
    : typeof target === 'number' && Number.isFinite(target)
      ? target
      : 0;
  const m = value.trim().match(/^(<=|>=|=|<|>)?\s*(-?\d+)$/);
  if (!m) return false;
  const op = m[1] ?? '=';
  const expected = Number(m[2]);
  switch (op) {
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '=':
      return actual === expected;
    default:
      return false;
  }
}

// Ghost themes routinely write `{{match foo "=" "true"}}` even when `foo` is
// the literal boolean `true` (or vice versa). JS strict equality says
// `true === "true"` is `false`, so coerce the obvious string<->boolean
// literals before comparing. Same for `"false"` <-> `false`. Other types fall
// through to plain strict equality so themes that compare numbers or strings
// keep their existing semantics.
function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const lb = boolFromString(left);
  const rb = boolFromString(right);
  if (lb !== undefined && typeof right === 'boolean') return lb === right;
  if (rb !== undefined && typeof left === 'boolean') return rb === left;
  return false;
}

function boolFromString(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function compare(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case '=':
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '>':
    case '<':
    case '>=':
    case '<=':
      return compareOrder(left, right, op);
    case '~':
      return String(left).includes(String(right));
    case '~^':
      return String(left).startsWith(String(right));
    case '~$':
      return String(left).endsWith(String(right));
    default:
      return false;
  }
}

// Ghost's `{{#match}}` numeric comparators must work on both numbers and
// strings. The previous implementation coerced both sides with `Number()`,
// which silently produced `NaN > NaN === false` for non-numeric strings like
// `{{#match foo ">" bar}}`. Detect numeric-ish operands and use numeric
// comparison; otherwise fall back to lexicographic string comparison, which
// JS's relational operators handle natively.
function compareOrder(left: unknown, right: unknown, op: '>' | '<' | '>=' | '<='): boolean {
  const ln = toComparableNumber(left);
  const rn = toComparableNumber(right);
  if (ln !== null && rn !== null) {
    switch (op) {
      case '>':
        return ln > rn;
      case '<':
        return ln < rn;
      case '>=':
        return ln >= rn;
      case '<=':
        return ln <= rn;
    }
  }
  const ls = String(left ?? '');
  const rs = String(right ?? '');
  switch (op) {
    case '>':
      return ls > rs;
    case '<':
      return ls < rs;
    case '>=':
      return ls >= rs;
    case '<=':
      return ls <= rs;
  }
}

function toComparableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function applyOrder(items: readonly unknown[], order: string): unknown[] {
  return items.slice().sort((a, b) => compareByOrder(a, b, order));
}

function applyEntryOrder(entries: readonly IterationEntry[], order: string): IterationEntry[] {
  return entries.slice().sort((a, b) => compareByOrder(a.value, b.value, order));
}

function compareByOrder(a: unknown, b: unknown, order: string): number {
  const clauses = order.split(',').map((s) => s.trim());
  for (const clause of clauses) {
    const [field, dir = 'asc'] = clause.split(/\s+/);
    const av = resolveOrderValue(a, field ?? '');
    const bv = resolveOrderValue(b, field ?? '');
    const cmp = compareValues(av, bv);
    if (cmp !== 0) return dir.toLowerCase() === 'desc' ? -cmp : cmp;
  }
  return 0;
}

function resolveOrderValue(item: unknown, field: string): unknown {
  if (!item || typeof item !== 'object' || field === '') return undefined;
  const record = item as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, field)) return record[field];
  if (!field.includes('.')) return record[field];

  let cursor: unknown = item;
  for (const segment of field.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}
