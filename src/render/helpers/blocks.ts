import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';
import { applyGetFilter } from './get-filter.ts';

interface HelperOptions extends Handlebars.HelperOptions {
  hash: {
    visibility?: string;
    limit?: number | string;
    from?: number | string;
    to?: number | string;
  };
}

export function registerBlockHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper('foreach', function foreachHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as HelperOptions;
    const raw = args[0];
    const items = toArray(raw);
    const limit = parseNum(options.hash.limit) ?? items.length;
    const from = parseNum(options.hash.from) ?? 1;
    const to = parseNum(options.hash.to) ?? Math.min(items.length, from + limit - 1);

    let buffer = '';
    let renderedIndex = 0;
    const visible = items.filter((item) => visibilityFilter(item, options.hash.visibility));
    const sliced = visible.slice(from - 1, to);
    for (let i = 0; i < sliced.length; i += 1) {
      const item = sliced[i];
      const data = engine.hb.createFrame(
        (options.data as Record<string, unknown> | undefined) ?? {},
      );
      data.index = i;
      data.number = i + 1;
      data.first = i === 0;
      data.last = i === sliced.length - 1;
      data.even = i % 2 === 0;
      data.odd = i % 2 !== 0;
      data.rowStart = false;
      data.rowEnd = false;
      buffer += options.fn(item, { data });
      renderedIndex += 1;
    }
    if (renderedIndex === 0 && options.inverse) {
      buffer += options.inverse(this);
    }
    return buffer;
  });

  engine.hb.registerHelper('is', function isHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const targets = args
      .slice(0, -1)
      .flatMap((a) => (typeof a === 'string' ? a.split(',') : []))
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
      paged: [],
    };
    const matches = targets.some((target) => {
      if (target === 'paged') return (route.data?.pagination?.page ?? 1) > 1;
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
        switch (key) {
          case 'tag': {
            const tags = (ctx.tags as { slug: string; name: string }[]) ?? [];
            matched = value
              .split(',')
              .map((s) => s.trim())
              .some((needle) => tags.some((t) => t.slug === needle || t.name === needle));
            break;
          }
          case 'author': {
            const authors = (ctx.authors as { slug: string; name: string }[]) ?? [];
            matched = value
              .split(',')
              .map((s) => s.trim())
              .some((needle) => authors.some((a) => a.slug === needle || a.name === needle));
            break;
          }
          case 'visibility': {
            matched = String(ctx.visibility ?? '') === value;
            break;
          }
          case 'slug': {
            matched = String(ctx.slug ?? '') === value;
            break;
          }
          case 'number': {
            const n = Number(value);
            const route = options.data?.route as
              | { data?: { pagination?: { page?: number } } }
              | undefined;
            matched = (route?.data?.pagination?.page ?? 1) === n;
            break;
          }
          default:
            matched = String((ctx as Record<string, unknown>)[key] ?? '') === value;
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
    const filter = typeof hash.filter === 'string' ? hash.filter : '';
    const include = parseIncludeTokens(hash.include);
    const fnAny = options.fn as unknown as { blockParams?: number };
    const blockParams = (fnAny?.blockParams ?? 0) > 0;
    const sorted = getSortedResource(engine, resource, order);
    const filtered: unknown[] = filter
      ? applyGetFilter(engine, resource, sorted, filter, this, options.data?.route)
      : sorted.slice();
    const total = filtered.length;
    const pagination = computeGetPagination(total, requestedPage, limit);
    const paged =
      limit === 'all'
        ? filtered
        : filtered.slice((pagination.page - 1) * limit, pagination.page * limit);
    if (paged.length === 0 && options.inverse) {
      return options.inverse(this);
    }
    const results = applyGetIncludes(engine, resource, paged, include);
    const data = engine.hb.createFrame((options.data as Record<string, unknown> | undefined) ?? {});
    data.resource = resource;
    data.pagination = pagination;
    if (blockParams) {
      return options.fn(this, {
        data,
        blockParams: [results, { resource, pagination }],
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
      result = params[0] === params[1];
    } else if (params.length === 3) {
      const [left, op, right] = params;
      result = compare(left, String(op), right);
    }
    if (options.fn) {
      return result ? options.fn(this) : options.inverse(this);
    }
    return result;
  });
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
  const page = Math.min(Math.max(1, requestedPage), pages);
  return {
    page,
    limit,
    pages,
    total,
    prev: page > 1 ? page - 1 : null,
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
  const sorted: readonly unknown[] = applyOrder(base as unknown[], order);
  engine.sortedCache.set(cacheKey, sorted);
  return sorted;
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
    case 'tags':
      return engine.content.tags;
    case 'authors':
      return engine.content.authors;
    case 'pages':
      return engine.content.pages;
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
      const value = pick(route) ?? (this as Record<string, unknown>)?.[name];
      if (!value) return options.inverse ? options.inverse(this) : '';
      return options.fn(value);
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
      return options.fn(target);
    },
  );
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>);
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

function visibilityFilter(item: unknown, visibility: string | undefined): boolean {
  if (!visibility || visibility === 'all') return true;
  const obj = item as { visibility?: string };
  if (!obj || typeof obj !== 'object') return true;
  if (visibility === 'public') return (obj.visibility ?? 'public') === 'public';
  return (obj.visibility ?? 'public') === visibility;
}

function compare(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case '=':
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '<':
      return Number(left) < Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<=':
      return Number(left) <= Number(right);
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

function applyOrder(items: unknown[], order: string): unknown[] {
  const clauses = order.split(',').map((s) => s.trim());
  return items.slice().sort((a, b) => {
    for (const clause of clauses) {
      const [field, dir = 'asc'] = clause.split(/\s+/);
      const av = (a as Record<string, unknown>)[field ?? ''];
      const bv = (b as Record<string, unknown>)[field ?? ''];
      const cmp = compareValues(av, bv);
      if (cmp !== 0) return dir.toLowerCase() === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
