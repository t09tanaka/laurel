import type Handlebars from 'handlebars';
import type { LaurelEngine } from '../engine.ts';

// `{{page_url}}` is the per-page URL builder used by Ghost's default
// `partials/pagination.hbs`. Ghost templates write `{{page_url next}}`,
// `{{page_url prev}}`, or `{{page_url 3}}` and expect either a usable URL or
// an empty string when the target page doesn't exist (first page has no prev,
// last page has no next).
//
// The helper resolves arguments against the current route's pagination
// payload (`route.data.pagination`). We rely on the build-side `base_url`
// field that `paginationInfo` now carries so we can build arbitrary
// `${base_url}page/N/` links without re-parsing prev_url / next_url.
//
// Out of range numeric inputs return empty so themes that pre-render number
// links (e.g. `{{#each (range 1 pages)}}<a href="{{page_url this}}">...`)
// don't emit broken hrefs.
export function registerPageUrlHelper(engine: LaurelEngine): void {
  engine.hb.registerHelper('page_url', function pageUrlHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const positional = args.length > 1 ? args[0] : undefined;
    const route = options.data?.route as { data?: { pagination?: PaginationForUrl } } | undefined;
    const pagination = route?.data?.pagination;
    if (!pagination) return '';
    const target = resolveTarget(positional, pagination);
    if (target === undefined) return '';
    if (target === 'prev') return pagination.prev_url ?? '';
    if (target === 'next') return pagination.next_url ?? '';
    // Numeric page index: 1 collapses to baseUrl, anything outside [1, pages]
    // is empty. base_url is required for numeric resolution.
    if (target < 1 || target > pagination.pages) return '';
    const baseUrl = pagination.base_url;
    if (!baseUrl) return '';
    return target === 1 ? baseUrl : `${baseUrl}page/${target}/`;
  });
}

interface PaginationForUrl {
  page: number;
  pages: number;
  prev: number | undefined;
  next: number | undefined;
  prev_url: string | undefined;
  next_url: string | undefined;
  base_url?: string | undefined;
}

type ResolvedTarget = 'prev' | 'next' | number | undefined;

function resolveTarget(input: unknown, pagination: PaginationForUrl): ResolvedTarget {
  if (typeof input === 'string') {
    const lowered = input.toLowerCase();
    if (lowered === 'prev' || lowered === 'previous') return 'prev';
    if (lowered === 'next') return 'next';
    const parsed = Number.parseInt(input, 10);
    if (Number.isFinite(parsed)) return parsed;
    return undefined;
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.trunc(input);
  }
  // Bare `{{page_url}}` without an argument resolves to the current page —
  // matches Ghost's behaviour where the helper falls back to `this`.
  if (input === undefined) {
    return pagination.page;
  }
  return undefined;
}
