import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

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

  engine.hb.registerHelper('get', function getHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const resource = String(args[0] ?? '');
    const hash = options.hash as Record<string, unknown>;
    const limit = parseNum(hash.limit) ?? 15;
    const order = String(hash.order ?? 'published_at desc');
    const filter = typeof hash.filter === 'string' ? hash.filter : '';
    const fnAny = options.fn as unknown as { blockParams?: number };
    const blockParams = (fnAny?.blockParams ?? 0) > 0;
    const sorted = getSortedResource(engine, resource, order);
    let results: unknown[] = filter
      ? applyFilter(sorted as unknown[], filter, this)
      : sorted.slice();
    results = results.slice(0, limit);
    if (results.length === 0 && options.inverse) {
      return options.inverse(this);
    }
    if (blockParams) {
      return options.fn(this, { blockParams: [results, { resource }] });
    }
    const data = engine.hb.createFrame((options.data as Record<string, unknown> | undefined) ?? {});
    data.resource = resource;
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

function applyFilter(items: unknown[], filter: string, ctx: unknown): unknown[] {
  return items.filter((item) => evaluateFilterExpr(item, filter, ctx));
}

function evaluateFilterExpr(item: unknown, filter: string, ctx: unknown): boolean {
  // Split on '+' (AND) at top level; ignore commas inside [].
  const clauses = filter
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  return clauses.every((clause) => evaluateClause(item, clause, ctx));
}

function evaluateClause(item: unknown, clause: string, ctx: unknown): boolean {
  // pattern: key:value, key:-value (not), key:[a,b]
  const colon = clause.indexOf(':');
  if (colon < 0) return true;
  const key = clause.slice(0, colon).trim();
  let value = clause.slice(colon + 1).trim();
  // Interpolate {{post.id}}-style references against ctx
  value = value.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const path = String(expr).trim().split('.');
    let cursor: unknown = ctx;
    for (const segment of path) {
      cursor =
        cursor && typeof cursor === 'object'
          ? (cursor as Record<string, unknown>)[segment]
          : undefined;
    }
    return cursor == null ? '' : String(cursor);
  });

  let negate = false;
  if (value.startsWith('-')) {
    negate = true;
    value = value.slice(1);
  }
  const itemObj = item as Record<string, unknown>;
  let matched = false;
  if (value.startsWith('[') && value.endsWith(']')) {
    const list = value
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim());
    matched = list.some((needle) => fieldMatches(itemObj, key, needle));
  } else {
    matched = fieldMatches(itemObj, key, value);
  }
  return negate ? !matched : matched;
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
