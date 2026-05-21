import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, ListPost, Page, Post, SiteData, Tag } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';

export interface PaginationInfo {
  page: number;
  prev: number | undefined;
  next: number | undefined;
  pages: number;
  total: number;
  limit: number;
  prev_url: string | undefined;
  next_url: string | undefined;
  // Base URL of the paginated listing (e.g. `/`, `/tag/foo/`, `/author/bar/`).
  // Carried on the pagination payload so the {{page_url N}} helper can build
  // arbitrary `${base_url}page/N/` links without re-parsing prev_url/next_url.
  base_url: string;
}

export type RouteKind = 'index' | 'home' | 'post' | 'page' | 'tag' | 'author' | 'custom' | 'error';

export interface ErrorContext {
  statusCode: number;
  message: string;
}

export interface RouteContext {
  kind: RouteKind;
  url: string;
  outputPath: string;
  outputContentType?:
    | 'text/html'
    | 'application/rss+xml'
    | 'application/atom+xml'
    | 'text/plain'
    | 'application/json';
  template: string;
  variant?: 'amp';
  locale?: string;
  alternates?: RouteAlternate[];
  lastmod?: string;
  // Whether this route should appear in public discovery surfaces (sitemap,
  // feed indices, link checkers). Defaults to true when omitted. Routes set
  // this to false when they are reachable but not canonical entry points —
  // currently `/page/N/` pagination archives (which duplicate `/` with offset
  // posts) and `/404.html` (which should not be crawled as a real page). See
  // #781. The build pipeline reads this when populating sitemap URLs.
  indexable?: boolean;
  data: {
    // Aggregate list of posts for `home` / `index` / `tag` / `author` routes.
    // Narrowed to `ListPost[]` so callers don't accidentally reach for the
    // heavy per-post body fields (`html`, `feed_html`, `feed_excerpt`) in
    // list-card contexts — those only render correctly for the dedicated
    // `post` / `page` routes. Themes that genuinely need the body in a list
    // context should iterate `content.posts` directly.
    // See `ListPost` in `~/content/model.ts` for the rationale and #524.
    posts?: ListPost[];
    pagination?: PaginationInfo;
    post?: Post;
    page?: Page;
    tag?: Tag;
    author?: Author;
    error?: ErrorContext;
  };
  meta: {
    title: string;
    description: string;
    canonical: string;
    image: string | undefined;
  };
}

export interface RouteAlternate {
  locale: string;
  url: string;
  href: string;
}

export interface RenderInputs {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  site: SiteData;
}
