import type { Post } from '~/content/model.ts';
import { logger } from '~/util/logger.ts';
import type { ResolvedCollection } from './routes-yaml.ts';

// Ghost's permalink templates use `{token}` placeholders that are resolved
// against the post being routed. The set we support mirrors Ghost's own
// permalink tokens (the subset that survives in a static-only world):
//
//   {slug}            — post slug
//   {id}              — post id
//   {primary_tag}     — primary_tag.slug, or `''` when the post has no tags
//   {primary_author}  — primary_author.slug, or `''` when the post has no authors
//   {year}            — 4-digit year of published_at
//   {month}           — 2-digit month of published_at
//   {day}             — 2-digit day of published_at
//
// Unknown tokens are reported via `unknownTokens` so the caller can warn and
// skip (rather than emit a URL that contains a literal `{foo}`). All values
// are substituted as-is — the schema validates that templates start with `/`
// and end with `/`, so the resulting URL inherits those guarantees.

export type PermalinkToken =
  | 'slug'
  | 'id'
  | 'primary_tag'
  | 'primary_author'
  | 'year'
  | 'month'
  | 'day';

const KNOWN_TOKENS: readonly PermalinkToken[] = [
  'slug',
  'id',
  'primary_tag',
  'primary_author',
  'year',
  'month',
  'day',
];

export interface PermalinkResolution {
  url: string;
  unknownTokens: string[];
}

// Parse `published_at` into Y/M/D parts. We parse defensively: when a post
// has no published_at (drafts in preview builds) all three parts fall back
// to empty strings, which would produce `//foo/` style URLs — the caller is
// expected to surface this as a warning and skip the post.
function dateParts(published_at: string | undefined): {
  year: string;
  month: string;
  day: string;
} {
  if (!published_at) return { year: '', month: '', day: '' };
  // `Date` rejects malformed ISO strings by returning NaN getters, which would
  // produce `NaN` strings in URLs — guard against that by falling through to
  // empty parts.
  const d = new Date(published_at);
  if (Number.isNaN(d.getTime())) return { year: '', month: '', day: '' };
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { year, month, day };
}

export function resolvePermalink(template: string, post: Post): PermalinkResolution {
  const { year, month, day } = dateParts(post.published_at);
  const values: Record<PermalinkToken, string> = {
    slug: post.slug,
    id: post.id,
    primary_tag: post.primary_tag?.slug ?? '',
    primary_author: post.primary_author?.slug ?? '',
    year,
    month,
    day,
  };

  const unknownTokens: string[] = [];
  // Match `{name}` where name is `[a-z_]+`. Anything outside our known set
  // is recorded so the caller can warn and skip the post — we don't want to
  // silently emit URLs with literal `{foo}` segments.
  const url = template.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    if ((KNOWN_TOKENS as readonly string[]).includes(name)) {
      return values[name as PermalinkToken];
    }
    unknownTokens.push(name);
    return '';
  });

  return { url, unknownTokens };
}

// Public list of accepted tokens for error messages and docs.
export function listKnownPermalinkTokens(): readonly PermalinkToken[] {
  return KNOWN_TOKENS;
}

// Filter language: Ghost's NQL is a small expression language; we implement
// the subset that real-world routes.yaml files use:
//
//   tag:foo                         — primary_tag or any tag has slug `foo`
//   tags:[a,b]                      — any tag slug matches a or b
//   author:alice                    — primary_author or any author has slug
//   authors:[a,b]                   — any author slug matches a or b
//   featured:true / featured:false  — post.featured equality
//   visibility:public               — post.visibility equality
//
// Multiple clauses can be joined with `+` (AND) — Ghost supports `,` (OR)
// too, but `+` covers the common collection-bucketing case; we leave OR for
// a follow-up if real themes need it.
//
// Anything outside this grammar parses to a `match-nothing` predicate plus a
// warning slot in the return value so the route planner can surface the issue
// once and the build still completes.

export type PostPredicate = (post: Post) => boolean;

export interface ParsedFilter {
  predicate: PostPredicate;
  warnings: string[];
}

function alwaysTrue(): boolean {
  return true;
}
function alwaysFalse(): boolean {
  return false;
}

function parseListValue(raw: string): string[] | null {
  // `[a,b,c]` — Ghost uses square brackets for set membership. Strip the
  // brackets and split on commas; trim whitespace because YAML inline lists
  // commonly include spaces.
  if (!(raw.startsWith('[') && raw.endsWith(']'))) return null;
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((s) => s.trim());
}

function clauseToPredicate(clause: string): { predicate: PostPredicate; warning?: string } {
  const colon = clause.indexOf(':');
  if (colon < 0) {
    return { predicate: alwaysFalse, warning: `unrecognised filter clause '${clause}'` };
  }
  const key = clause.slice(0, colon).trim();
  const value = clause.slice(colon + 1).trim();
  if (key === '' || value === '') {
    return { predicate: alwaysFalse, warning: `empty key or value in filter clause '${clause}'` };
  }

  switch (key) {
    case 'tag': {
      const list = parseListValue(value);
      if (list) {
        return {
          predicate: (post) => post.tags.some((t) => list.includes(t.slug)),
        };
      }
      return {
        predicate: (post) => post.tags.some((t) => t.slug === value),
      };
    }
    case 'tags': {
      const list = parseListValue(value);
      if (!list) {
        return {
          predicate: alwaysFalse,
          warning: `'tags:' expects a list like [a,b]; got '${value}'`,
        };
      }
      return { predicate: (post) => post.tags.some((t) => list.includes(t.slug)) };
    }
    case 'author': {
      const list = parseListValue(value);
      if (list) {
        return { predicate: (post) => post.authors.some((a) => list.includes(a.slug)) };
      }
      return { predicate: (post) => post.authors.some((a) => a.slug === value) };
    }
    case 'authors': {
      const list = parseListValue(value);
      if (!list) {
        return {
          predicate: alwaysFalse,
          warning: `'authors:' expects a list like [a,b]; got '${value}'`,
        };
      }
      return { predicate: (post) => post.authors.some((a) => list.includes(a.slug)) };
    }
    case 'featured':
      if (value === 'true') return { predicate: (post) => post.featured };
      if (value === 'false') return { predicate: (post) => !post.featured };
      return {
        predicate: alwaysFalse,
        warning: `'featured:' expects 'true' or 'false'; got '${value}'`,
      };
    case 'visibility':
      return { predicate: (post) => post.visibility === value };
    case 'status':
      return { predicate: (post) => post.status === value };
    case 'page':
      // Posts always have `page: false`; this clause is here for completeness
      // (themes that reuse Ghost filters defensively).
      if (value === 'true') return { predicate: alwaysFalse };
      if (value === 'false') return { predicate: alwaysTrue };
      return {
        predicate: alwaysFalse,
        warning: `'page:' expects 'true' or 'false'; got '${value}'`,
      };
    default:
      return { predicate: alwaysFalse, warning: `unsupported filter key '${key}'` };
  }
}

// Result of routing posts through the resolved `collections:` section. Each
// post that matched a collection picks up a permalink-derived URL path and
// remembers which collection won — `routes.ts` uses the collection to look
// up the per-bucket template; `loader.ts` uses the URL path to build the
// post's external `post.url`.
//
// Posts that match no collection are absent from the returned Map; the
// caller treats that as "use the legacy slug-based URL" so authors with no
// `collections:` section see the historical default.
export interface PostUrlAssignment {
  urlPath: string;
  collection: ResolvedCollection;
}

export function assignPostUrls(
  posts: readonly Post[],
  collections: readonly ResolvedCollection[],
): Map<string, PostUrlAssignment> {
  const assignments = new Map<string, PostUrlAssignment>();
  if (collections.length === 0) return assignments;

  // Pre-parse each collection's filter once; the predicates run for every
  // (post, collection) pair so memoising keeps the inner loop tight.
  const compiled = collections.map((collection) => {
    const { predicate, warnings } = parseFilter(collection.filter);
    for (const warning of warnings) {
      logger.warn(`routes.yaml: collections '${collection.url}' filter: ${warning}`);
    }
    return { collection, predicate };
  });

  for (const post of posts) {
    for (const { collection, predicate } of compiled) {
      if (!predicate(post)) continue;
      const { url, unknownTokens } = resolvePermalink(collection.permalink, post);
      if (unknownTokens.length > 0) {
        logger.warn(
          `routes.yaml: collections '${collection.url}' permalink '${collection.permalink}' references unknown token(s) ${unknownTokens
            .map((t) => `'${t}'`)
            .join(', ')} for post '${post.slug}'; falling back to /${post.slug}/.`,
        );
        // Skip this post for this collection. Try the next one — a less
        // specific collection without exotic tokens may still apply.
        continue;
      }
      assignments.set(post.id, { urlPath: url, collection });
      break;
    }
  }
  return assignments;
}

export function parseFilter(filter: string | undefined): ParsedFilter {
  if (filter === undefined || filter.trim() === '') {
    return { predicate: alwaysTrue, warnings: [] };
  }
  const clauses = filter
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (clauses.length === 0) {
    return { predicate: alwaysTrue, warnings: [] };
  }
  const warnings: string[] = [];
  const predicates: PostPredicate[] = [];
  for (const clause of clauses) {
    const { predicate, warning } = clauseToPredicate(clause);
    predicates.push(predicate);
    if (warning) warnings.push(warning);
  }
  const predicate: PostPredicate = (post) => predicates.every((p) => p(post));
  return { predicate, warnings };
}
