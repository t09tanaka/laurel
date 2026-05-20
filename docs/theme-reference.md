# Theme Reference

A compact, machine-checked index of Nectar's theme surface: every Handlebars
helper Nectar registers, and the public shape of every content object Nectar
exposes to templates (`post`, `page`, `tag`, `author`, `@site`, pagination).

This document is the **shape-only** reference. For per-helper edge cases,
worked examples, and prose explanations, read
[`THEME_DEV.md`](./THEME_DEV.md). This file lists what exists; that file
explains how each piece behaves.

The helper inventory below is kept in sync with
`src/render/helpers/*.ts` via `bun run docs:theme-reference --check`. If you
add a helper, the check fails until you list it here.

## Helpers

Grouped by source module. Block helpers are marked `(block)`; the rest are
inline. Helpers that emit pre-escaped HTML return a Handlebars `SafeString`;
the rest return plain strings and Handlebars escapes them.

### Asset helpers — `src/render/helpers/assets.ts`

- `{{asset path}}` — Resolve a theme-relative path to its fingerprinted URL.
- `{{img_url image [size="..."] [absolute=true]}}` — Render a content/site
  image URL, optionally fingerprinted and absolutized.

### Block helpers — `src/render/helpers/blocks.ts`

- `{{#foreach collection [limit=N] [from=N] [to=N] [visibility="..."]}}…{{else}}…{{/foreach}}` (block) — Ghost's `each` with hash-arg slicing and visibility filters.
- `{{#is "name [, name…]"}}…{{else}}…{{/is}}` (block) — Branch on the active route context kind.
- `{{#has tag="..." author="..." visibility="..." slug="..." number=N}}…{{else}}…{{/has}}` (block) — Predicate over the current post/page.
- `{{#get "resource" [filter="…"] [limit=N] [order="…"] [include="…"]}}…{{else}}…{{/get}}` (block) — Query the static content graph as if it were the Ghost Content API.
- `{{#match left [op right]}}…{{else}}…{{/match}}` / `{{match left op right}}` (both) — Equality / comparison branching.

### Content helpers — `src/render/helpers/content.ts`

- `{{content [words=N]}}` — Rendered post/page HTML (SafeString).
- `{{excerpt [words=N] [characters=N]}}` — Plaintext excerpt.
- `{{reading_time [minute="1 min read"] [minutes="% min read"]}}` — Localized reading time.
- `{{authors [separator=", "] [autolink=true]}}` / `{{#authors}}…{{/authors}}` (both) — Author list with optional links.
- `{{tags [separator=", "] [autolink=true]}}` / `{{#tags}}…{{/tags}}` (both) — Tag list with optional links.
- `{{meta_title [page="%"]}}` — Resolved title with `meta_title` → title → site.title fallback.
- `{{meta_description}}` — Resolved description with the same fallback chain.
- `{{comments}}` — Empty (members/comments are out of scope).
- `{{recommendations}}` — Renders Ghost's recommendations component if configured.
- `{{access}}` — Site-wide access policy (distinct from `post.access`).
- `{{subscribe_form}}` — Renders the configured subscribe-form embed.
- `{{input_email}}` — Email input for subscribe forms.
- `{{post_class}}` — Space-joined CSS classes for `<article>` root.
- `{{body_class}}` — Space-joined CSS classes for `<body>` root.

### Date helpers — `src/render/helpers/date.ts`

- `{{date [value] [format="DD MMM YYYY"] [timeago=true]}}` — Format a date using the site locale + timezone.

### Flow helpers — `src/render/helpers/flow.ts`

- `{{or a b …}}` — First truthy argument, else last.
- `{{and a b …}}` — Last argument if all truthy, else first falsy.
- `{{not a}}` — Logical negation.
- `{{eq left right}}` — Equality predicate.
- `{{access}}` — Site-wide access policy (read-only; see content.ts entry above).

### Ghost head/foot helpers — `src/render/helpers/ghost-head.ts`

- `{{ghost_head}}` — Injected `<head>` block: meta tags, canonical, OG/Twitter, JSON-LD, opt-in shared card stylesheet from theme `package.json` `config.card_assets`, code injection head (SafeString).
- `{{ghost_foot}}` — Injected end-of-body block: code injection foot, static Portal runtime, and page-scoped Koenig card runtime hooks when the rendered body needs them (SafeString).

### i18n helpers — `src/render/helpers/i18n.ts`

- `{{t "key" [name=value …]}}` — Translation lookup against the theme's `locales/<locale>.json`; string values support interpolation, numeric/boolean values are stringified, and present empty-string values render as empty strings.
- `{{lang}}` — Active build locale code.

### Image-dimension helpers — `src/render/helpers/image-dimensions.ts`

- `{{image_dimensions image}}` — Resolve cached width/height for an image, used by Source for explicit `<img width height>`.

### Navigation helpers — `src/render/helpers/navigation.ts`

- `{{navigation [type="primary"]}}` — Render the configured site navigation (SafeString).
- `{{pagination}}` — Render the prev/next/page-N controls (SafeString).
- `{{#link href="…" [class="…"] [target="…"]}}…{{/link}}` (block) — Anchor with active-class detection.
- `{{link_class for="/path" [activeClass="nav-current"]}}` — Active-class string for a path.

### Number helpers — `src/render/helpers/numbers.ts`

- `{{number value [style="..."] [...Intl.NumberFormat options]}}` — Locale-aware number formatting.
- `{{currency value [currency="USD"] [...Intl.NumberFormat options]}}` — Currency-formatted number.

### Page-URL helper — `src/render/helpers/page-url.ts`

- `{{page_url N}}` — Build the Nth page URL for the current paginated listing.

### String helpers — `src/render/helpers/strings.ts`

- `{{concat a b …}}` — String concatenation.
- `{{raw value}}` / `{{{{raw}}}}…{{{{/raw}}}}` — Emit explicitly trusted HTML without escaping (SafeString).
- `{{encode value}}` — URL-encode a value.
- `{{upper value}}` — Upper-case a value.
- `{{lower value}}` — Lower-case a value.
- `{{plural count one="…" other="…"}}` — Pluralization with locale-aware fallback.

### URL helpers — `src/render/helpers/urls.ts`

- `{{url [absolute=true]}}` — Current route URL.
- `{{social_url type="twitter|facebook|linkedin|bluesky|mastodon|threads|tiktok|youtube|instagram"}}` — Social profile URL on the current author/site.
- `{{twitter_url handleOrUrl}}` — Twitter/X profile URL for a positional handle or full URL.
- `{{facebook_url handleOrUrl}}` — Facebook profile URL for a positional handle or full URL.

## Built-in context shapes

Nectar's render context maps directly to Ghost's resource shape. The
JSDoc-style listing below mirrors the exact TypeScript types declared in
[`src/content/model.ts`](../src/content/model.ts) and
[`src/render/types.ts`](../src/render/types.ts). Optional fields are typed
with `| undefined` to make absence explicit in templates that branch on
`{{#if foo}}`.

### `Post`

```ts
interface Post {
  id: string;
  slug: string;
  title: string;
  /** Sanitized rendered HTML (paywall-truncated when visibility != "public"). */
  html: string;
  /** Plain-text projection of `html`, used by excerpt/search/word_count. */
  plaintext: string;
  /** Default excerpt (custom_excerpt or first paragraph of plaintext). */
  excerpt: string;
  custom_excerpt: string | undefined;
  feature_image: string | undefined;
  feature_image_alt: string | undefined;
  feature_image_caption: string | undefined;
  feature_image_width: number | undefined;
  feature_image_height: number | undefined;
  featured: boolean;
  /** Always `false` for posts (`true` only on `Page`). */
  page: false;
  published_at: string; // ISO-8601
  updated_at: string;   // ISO-8601
  created_at: string;   // ISO-8601
  reading_time: number; // minutes
  word_count: number;
  /**
   * Ghost-compatible visibility. `tiers` (gated to specific tiers) and
   * `filter` (NQL expression) are treated as members-grade gating since
   * Nectar has no signed-in viewer, but the exact upstream value is
   * preserved on this field. See #325.
   */
  visibility: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
  status: 'published' | 'draft' | 'scheduled';
  tags: Tag[];
  primary_tag: Tag | undefined;
  authors: Author[];
  primary_author: Author | undefined;
  /** Absolute path under the site root, e.g. `/hello-world/`. */
  url: string;
  canonical_url: string | undefined;
  meta_title: string | undefined;
  meta_description: string | undefined;
  og_title: string | undefined;
  og_description: string | undefined;
  og_image: string | undefined;
  twitter_title: string | undefined;
  twitter_description: string | undefined;
  twitter_image: string | undefined;
  codeinjection_head: string | undefined;
  codeinjection_foot: string | undefined;
  comments: boolean;
  /** Always `false` (anonymous viewer in static builds). See #208. */
  access: false;
  prev: Post | undefined;
  next: Post | undefined;
  /** RSS-safe HTML (always paywall-truncated for non-public posts). */
  feed_html: string;
  feed_excerpt: string;
}
```

### `Page`

```ts
interface Page {
  id: string;
  slug: string;
  title: string;
  html: string;
  plaintext: string;
  excerpt: string;
  custom_excerpt: string | undefined;
  feature_image: string | undefined;
  feature_image_alt: string | undefined;
  feature_image_caption: string | undefined;
  feature_image_width: number | undefined;
  feature_image_height: number | undefined;
  /** Always `true` for pages (`false` on `Post`). */
  page: true;
  published_at: string;
  updated_at: string;
  created_at: string;
  reading_time: number;
  word_count: number;
  /** Pages are always public — Nectar does not gate pages. */
  visibility: 'public';
  status: 'published' | 'draft';
  tags: Tag[];
  primary_tag: Tag | undefined;
  authors: Author[];
  primary_author: Author | undefined;
  url: string;
  canonical_url: string | undefined;
  meta_title: string | undefined;
  meta_description: string | undefined;
  og_title: string | undefined;
  og_description: string | undefined;
  og_image: string | undefined;
  twitter_title: string | undefined;
  twitter_description: string | undefined;
  twitter_image: string | undefined;
  codeinjection_head: string | undefined;
  codeinjection_foot: string | undefined;
  show_title_and_feature_image: boolean;
  custom_template: string | undefined;
  access: false;
}
```

### `Tag`

```ts
interface Tag {
  id: string;
  slug: string;
  name: string;
  description: string;
  feature_image: string | undefined;
  /**
   * `internal` tags are hidden from public archives + sitemaps (matching
   * Ghost's `#hash-` tag convention).
   */
  visibility: 'public' | 'internal';
  meta_title: string | undefined;
  meta_description: string | undefined;
  url: string;
  count: { posts: number };
}
```

### `Author`

```ts
interface Author {
  id: string;
  slug: string;
  name: string;
  bio: string;
  profile_image: string | undefined;
  cover_image: string | undefined;
  website: string | undefined;
  location: string | undefined;
  twitter: string | undefined;
  facebook: string | undefined;
  linkedin: string | undefined;
  bluesky: string | undefined;
  mastodon: string | undefined;
  threads: string | undefined;
  tiktok: string | undefined;
  youtube: string | undefined;
  instagram: string | undefined;
  meta_title: string | undefined;
  meta_description: string | undefined;
  url: string;
}
```

### `@site` (a.k.a. `@blog` and `@setting`)

```ts
interface SiteData {
  title: string;
  description: string;
  url: string;
  locale: string;
  direction: 'ltr' | 'rtl';
  timezone: string;
  cover_image: string | undefined;
  logo: string | undefined;
  logo_width: number | undefined;
  logo_height: number | undefined;
  icon: string | undefined;
  accent_color: string;
  navigation: NavigationItem[];
  /**
   * Optional, not `[]`, so themes can guard with
   * `{{#unless @site.secondary_navigation}}…{{/unless}}`. See #324.
   */
  secondary_navigation: NavigationItem[] | undefined;
  lang: string;
  twitter: string | undefined;
  facebook: string | undefined;
  members_enabled: boolean;
  paid_members_enabled: boolean;
  members_invite_only: boolean;
  comments_enabled: boolean;
  recommendations_enabled: boolean;
  meta_title: string | undefined;
  meta_description: string | undefined;
  og_image: string | undefined;
  og_title: string | undefined;
  og_description: string | undefined;
  twitter_image: string | undefined;
  twitter_title: string | undefined;
  twitter_description: string | undefined;
  codeinjection_head: string | undefined;
  codeinjection_foot: string | undefined;
  /**
   * Deploy metadata, omitted for ordinary local builds.
   */
  build?: {
    provider?: 'cloudflare_pages';
    branch?: string;
    commit_sha?: string;
  };
}
```

### `pagination` (when present on a paginated route)

```ts
interface PaginationInfo {
  page: number;          // 1-based current page
  prev: number | undefined;
  next: number | undefined;
  pages: number;         // total page count
  total: number;         // total post count
  limit: number;         // per-page size
  prev_url: string | undefined;
  next_url: string | undefined;
  /** Base URL of the paginated listing, e.g. `/`, `/tag/news/`, `/author/casper/`. */
  base_url: string;
}
```

### `RouteContext` (the value the engine renders against)

```ts
type RouteKind = 'index' | 'home' | 'post' | 'page' | 'tag' | 'author' | 'custom' | 'error';

interface RouteContext {
  kind: RouteKind;
  url: string;
  outputPath: string;
  template: string;
  lastmod?: string;
  /**
   * Whether this route appears in sitemap/RSS/link-checker discovery.
   * Defaults to true when omitted. Pagination tails and the 404 are
   * `indexable: false`. See #781.
   */
  indexable?: boolean;
  data: {
    posts?: Post[];
    pagination?: PaginationInfo;
    post?: Post;
    page?: Page;
    tag?: Tag;
    author?: Author;
    error?: { statusCode: number; message: string };
  };
  meta: {
    title: string;
    description: string;
    canonical: string;
    image: string | undefined;
  };
}
```

## Regenerating the helper inventory

```bash
# Print the live registration list.
bun run docs:theme-reference

# Verify every registered helper appears in this document.
bun run docs:theme-reference -- --check
```

The `--check` mode is wired into CI: any new helper added to
`src/render/helpers/` without a corresponding entry above will fail the
gate. Add the entry under the matching section (or create a new section if
you added a new module under `src/render/helpers/`), then re-run.
