// Canonical projector for the `meta.pagination` block that Ghost's Content API
// surfaces on every collection response. Centralising the shape here keeps the
// flat `/content/posts.json` stub (src/build/content-api.ts) and the
// SDK-shaped `/ghost/api/content/{resource}/[index.json]` shadows
// (src/build/api.ts) in lockstep so the upstream `@tryghost/content-api` SDK
// can deserialise either entry point without divergent `pages` / `next` /
// `prev` semantics.
//
// The Ghost shape is:
//   { page, limit, pages, total, next, prev }
// where:
//   - `page` is 1-based,
//   - `limit` is the configured page size (NOT the count of items returned),
//   - `pages` is `max(1, ceil(total / limit))` so the meta still parses on
//     an empty collection,
//   - `next` / `prev` are numbers when navigable, otherwise `null`.
//
// `limit: 'all'` is the canonical Ghost knob that returns every item in a
// single page; in that mode `pages` collapses to `1` and `next` / `prev` are
// always `null` regardless of `total`.

export interface PaginationInput {
  // 1-based page number. Defaults to 1.
  page?: number;
  // Page size. Either a positive integer or the literal `'all'` to disable
  // pagination. Defaults to the total count (single-page) when omitted, which
  // matches the legacy stub behaviour.
  limit?: number | 'all';
  // Total number of items across all pages.
  total: number;
}

export interface PaginationMeta {
  page: number;
  limit: number | 'all';
  pages: number;
  total: number;
  next: number | null;
  prev: number | null;
}

export function projectPagination(input: PaginationInput): PaginationMeta {
  const total = Math.max(0, Math.trunc(input.total));
  const limit: number | 'all' = normalizeLimit(input.limit, total);
  const page = Math.max(1, Math.trunc(input.page ?? 1));

  if (limit === 'all') {
    return {
      page: 1,
      limit: 'all',
      pages: 1,
      total,
      next: null,
      prev: null,
    };
  }

  // `pages` is at least 1 even when `total === 0` so consumers can always
  // index into the response without a separate empty-collection branch.
  const pages = total === 0 ? 1 : Math.max(1, Math.ceil(total / limit));
  // Clamp `page` to a real index so callers that pass an over-the-end page
  // still get a well-formed (terminal) meta block instead of NaN next/prev.
  const clampedPage = Math.min(page, pages);
  const next = clampedPage < pages ? clampedPage + 1 : null;
  const prev = clampedPage > 1 ? clampedPage - 1 : null;
  return {
    page: clampedPage,
    limit,
    pages,
    total,
    next,
    prev,
  };
}

function normalizeLimit(limit: PaginationInput['limit'], total: number): number | 'all' {
  if (limit === 'all') return 'all';
  if (limit === undefined) {
    // Single-page default. Use a sentinel of 1 when there are no items so we
    // never divide by zero in `pages` and the shape stays stable.
    return total === 0 ? 1 : total;
  }
  const numeric = Math.trunc(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`projectPagination: limit must be a positive integer or 'all' (got ${limit})`);
  }
  return numeric;
}
