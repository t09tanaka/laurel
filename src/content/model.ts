import type { NavigationItem } from '~/config/schema.ts';

export interface ContentSourceFingerprint {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface SiteBuildData {
  provider?: 'cloudflare_pages' | 'netlify' | 'vercel' | undefined;
  environment?: 'production' | 'preview' | 'development' | undefined;
  branch?: string | undefined;
  build_id?: string | undefined;
  commit_sha?: string | undefined;
}

export interface SiteData {
  title: string;
  description: string;
  url: string;
  cdn_url?: string | undefined;
  admin_url?: string | undefined;
  locale: string;
  locales?: string[];
  localeRouting?: boolean;
  direction: 'ltr' | 'rtl';
  timezone: string;
  cover_image: string | undefined;
  logo: string | undefined;
  logo_width: number | undefined;
  logo_height: number | undefined;
  icon: string | undefined;
  accent_color: string;
  referrer_policy?: string | undefined;
  // Ghost marks password-protected publications as "private". Nectar is
  // static-only and cannot enforce that access control itself, but operators
  // can set `[site].private = true` when their host handles protection so
  // themes using `{{#is "private"}}` / `@site.private` take the same branch.
  private?: boolean;
  navigation: NavigationItem[];
  // Optional rather than `NavigationItem[]` so the loader can pass `undefined`
  // when the operator hasn't configured any secondary items. Themes like Wave
  // / Alto / London guard with `{{#unless @site.secondary_navigation}}`, which
  // expects a falsy value when empty — Handlebars treats `[]` as truthy, so an
  // empty array would silently disable those branches. See issue #324.
  secondary_navigation: NavigationItem[] | undefined;
  lang: string;
  twitter: string | undefined;
  facebook: string | undefined;
  linkedin?: string | undefined;
  bluesky?: string | undefined;
  mastodon?: string | undefined;
  threads?: string | undefined;
  tiktok?: string | undefined;
  youtube?: string | undefined;
  instagram?: string | undefined;
  github?: string | undefined;
  members_enabled: boolean;
  paid_members_enabled: boolean;
  members_invite_only: boolean;
  members_support_address?: string | undefined;
  allow_self_signup?: boolean | undefined;
  member_count?: number | undefined;
  comments_enabled: boolean;
  comments_access: 'all' | 'members' | 'paid';
  portal_button: boolean;
  portal_button_icon: string;
  portal_button_signup_text: string;
  portal_button_style: string;
  portal_name: boolean | string;
  portal_plans: string[];
  portal_signup_checkbox_required: boolean;
  portal_signup_terms_html: string;
  signup_url: string;
  recommendations_enabled: boolean;
  // Optional Stripe publishable key surfaced through `@site` for themes that
  // probe `{{@site.stripe_publishable_key}}` to decide whether to render a
  // client-only checkout widget. Default `undefined` (members out-of-scope);
  // see schema.ts for the safety rationale and `[site].stripe_publishable_key`
  // for the config-side description. Declared optional so test fixtures and
  // synthetic SiteData literals that pre-date this field don't break. Issue #491.
  stripe_publishable_key?: string | undefined;
  // Site-wide SEO defaults. Themes that read `@site.meta_title` /
  // `@site.meta_description` fall back to these when a post/page does not
  // override; `{{ghost_head}}` uses them as the last fallback before
  // `@site.title` / `@site.description`.
  meta_title: string | undefined;
  meta_description: string | undefined;
  og_image: string | undefined;
  og_title: string | undefined;
  og_description: string | undefined;
  twitter_image: string | undefined;
  twitter_title: string | undefined;
  twitter_description: string | undefined;
  // Raw HTML spliced into every page's `{{ghost_head}}` / `{{ghost_foot}}`.
  // Already gated behind the `build.allow_code_injection` flag at config
  // load time (see loader.ts) so reaching here means the operator opted in.
  codeinjection_head: string | undefined;
  codeinjection_foot: string | undefined;
  // Optional deploy metadata surfaced to templates as `@site.build`. It stays
  // absent for local/default builds so theme guards remain falsy unless a
  // deploy provider or explicit config/env override populated it.
  build?: SiteBuildData | undefined;
}

export interface Author {
  id: string;
  slug: string;
  locale?: string;
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
  github?: string | undefined;
  accent_color: string | undefined;
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
  url: string;
  count: { posts: number };
}

export interface Tag {
  id: string;
  slug: string;
  locale?: string;
  name: string;
  description: string;
  feature_image: string | undefined;
  accent_color: string | undefined;
  visibility: 'public' | 'internal';
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
  url: string;
  count: { posts: number };
}

export interface Post {
  id: string;
  uuid?: string;
  slug: string;
  locale?: string;
  title: string;
  html: string;
  excerpt: string;
  custom_excerpt: string | undefined;
  feature_image: string | undefined;
  feature_image_alt: string | undefined;
  feature_image_caption: string | undefined;
  feature_image_width: number | undefined;
  feature_image_height: number | undefined;
  featured: boolean;
  page: false;
  published_at: string;
  updated_at: string;
  created_at: string;
  reading_time: number;
  word_count: number;
  comment_id: string;
  count: PostEngagementCount;
  // Ghost exposes additional visibility states beyond the simple public/members/paid
  // tri-state when a post is gated to specific tiers or via a NQL filter. Nectar's
  // static runtime has no tier-aware viewer, so `tiers` and `filter` are rendered
  // and indexed the same as `members` (non-public, paywall-eligible). They are
  // still typed distinctly so themes that branch on `post.visibility` get the
  // exact upstream value instead of a coerced one. See #325.
  visibility: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
  status: 'published' | 'draft' | 'scheduled' | 'needs-review' | 'approved';
  tiers: Tier[];
  // Ghost's `email_only` flag — posts authored to ship via newsletter only
  // and not appear on the web. Default `false`. Routes are skipped by the
  // route planner unless `[build].emit_email_only_stub = true`, which opts
  // into a placeholder `/email-only/<slug>/` page so subscribers receiving
  // the email can still link back to a canonical archive entry.
  email_only: boolean;
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
  custom_template: string | undefined;
  comments: boolean;
  // Ghost exposes `post.access` as a boolean telling the theme whether the
  // *current viewer* may read the gated body. Nectar's static build has no
  // signed-in viewer, so every render targets an anonymous reader and
  // `access` is always `false`. Themes that branch on `{{#if this.access}}` /
  // `{{#unless this.access}}` (Source's lock-icon flow, members-only badges)
  // therefore take the anonymous branch. The standalone `{{access}}` helper
  // and root-level `ctx.access` cover the *site* access policy and are
  // intentionally separate — see #208.
  access: false;
  email_subject: string | undefined;
  email_card_segments?: EmailCardSegment[];
  frontmatter?: string | undefined;
  send_email_when_published: boolean;
  prev: AdjacentPost | undefined;
  next: AdjacentPost | undefined;
  post_class: string;
  published_at_rfc2822?: string;
  feed_html: string;
  feed_excerpt: string;
}

export type AdjacentPost = Pick<
  Post,
  | 'id'
  | 'uuid'
  | 'slug'
  | 'title'
  | 'excerpt'
  | 'custom_excerpt'
  | 'feature_image'
  | 'feature_image_alt'
  | 'feature_image_caption'
  | 'feature_image_width'
  | 'feature_image_height'
  | 'featured'
  | 'page'
  | 'published_at'
  | 'updated_at'
  | 'reading_time'
  | 'visibility'
  | 'tags'
  | 'primary_tag'
  | 'authors'
  | 'primary_author'
  | 'url'
  | 'access'
  | 'post_class'
>;

export interface PostEngagementCount {
  signups?: number | undefined;
  clicks?: number | undefined;
  comments?: number | undefined;
  conversions?: number | undefined;
  positive_feedback?: number | undefined;
  negative_feedback?: number | undefined;
}

export interface EmailCardSegment {
  type: 'email' | 'email-cta';
  html?: string | undefined;
  visibility?: Record<string, unknown> | undefined;
}

export interface Page {
  id: string;
  uuid?: string;
  slug: string;
  locale?: string;
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
  page: true;
  published_at: string;
  updated_at: string;
  created_at: string;
  reading_time: number;
  word_count: number;
  visibility: 'public';
  status: 'published' | 'draft' | 'needs-review' | 'approved';
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
  post_class: string;
  // Pages are always public in Nectar (no gated pages), but Ghost still
  // exposes `page.access` so themes can branch uniformly across posts/pages.
  // The anonymous-viewer rule from `Post.access` applies; see #208.
  access: false;
}

// Shape that mirrors Ghost's `Tier` resource closely enough for themes that
// iterate `{{#get "tiers"}}` and branch on `type` / `monthly_price`. Stripe
// price ids and `currency_symbol` are intentionally omitted — Nectar is
// static and never settles payments, so those fields would be cosmetic
// noise. `trial_days` is always `0` for the same reason.
export interface Tier {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: 'free' | 'paid';
  active: true;
  visibility: 'public';
  trial_days: 0;
  monthly_price: number | undefined;
  yearly_price: number | undefined;
  currency: string | undefined;
  welcome_page_url: string | undefined;
  benefits: string[];
}

// Reusable HTML+CSS snippet keyed by `slug`. Posts and pages embed it via the
// `{slug}` shortcode. The body is expanded inline at the tag position; the CSS
// is collected per page and emitted into `<head>` (deduped by slug).
//
// Stored as `content/components/<slug>.md` with frontmatter (`slug`,
// `description`) plus two fenced code blocks in the body: ```css ... ``` and
// ```html ... ```. Round-trips cleanly through git and any markdown editor.
export interface ComponentSnippet {
  slug: string;
  description: string;
  css: string;
  html: string;
  source: ContentSourceFingerprint;
}

export interface ContentGraph {
  posts: Post[];
  pages: Page[];
  tags: Tag[];
  authors: Author[];
  tiers: Tier[];
  // Optional so older test fixtures and reduced graphs that don't load
  // components still satisfy ContentGraph. Render-side code treats an
  // absent / empty list as "no shortcodes registered" — `{slug}` text in
  // bodies is then left as-is.
  components?: ComponentSnippet[];
  bySlug: {
    posts: Map<string, Post>;
    pages: Map<string, Page>;
    tags: Map<string, Tag>;
    authors: Map<string, Author>;
    components?: Map<string, ComponentSnippet>;
  };
  // Inverse indices keyed by slug. Built once during content load so the route
  // planner can resolve tag/author archives in O(1) instead of scanning
  // `posts` for every tag/author (O(tags x posts), O(authors x posts)).
  postsByTag: Map<string, Post[]>;
  postsByAuthor: Map<string, Post[]>;
  sources?: {
    posts: Map<string, ContentSourceFingerprint>;
    pages: Map<string, ContentSourceFingerprint>;
    tags: Map<string, ContentSourceFingerprint>;
    authors: Map<string, ContentSourceFingerprint>;
  };
  // Posts whose frontmatter sets `email_only: true`. Excluded from every other
  // collection on the graph (`posts`, `bySlug.posts`, `postsByTag`,
  // `postsByAuthor`) so feeds, search, OG generation, and the public route
  // plan never see them. The route planner reads this list directly when
  // `[build].emit_email_only_stub = true` to emit `/email-only/<slug>/`
  // placeholder URLs that a delivered newsletter can link to.
  emailOnlyPosts: Post[];
  site: SiteData;
  locales?: string[];
  localeRouting?: boolean;
}

// Subset of `Post` that aggregate routes (home / index / tag archive /
// author archive) expose through `RouteContext.data.posts`. These routes
// render their items through post-card partials (`{{#foreach posts}} ... {{/foreach}}`)
// that only need metadata + the pre-computed `excerpt`; the heavy
// per-post fields (`html`, `feed_html`, `feed_excerpt`) are
// only required by the dedicated `post` / `page` routes that render the
// full body. Narrowing the list shape at the type level keeps plugin
// authors and downstream code from accidentally pulling the full HTML
// bodies into long-lived references when iterating a list slice, and
// documents what an aggregate list-card actually consumes.
//
// At runtime the references are still the same `Post` objects — this is
// purely a compile-time restriction. A future change can swap the
// underlying storage for a lazily-materialised body (see #524) without
// touching call sites that already use `ListPost`. Themes that
// genuinely need the body in a list context (rare; e.g. RSS-style "full
// post on home page" layouts) should iterate `content.posts` directly
// instead of `route.data.posts`.
export type ListPost = Omit<Post, 'html' | 'feed_html' | 'feed_excerpt'>;

// Even leaner shape for "card-only" use cases (recommendations, related
// posts, sidebar widgets) where the renderer only needs the link, the
// title, the cover image, and the excerpt blurb. Provided so plugins
// can type their card APIs against the minimum surface and stay forward
// compatible when more list-only optimisations land.
export type CardPost = Pick<
  Post,
  | 'id'
  | 'slug'
  | 'title'
  | 'excerpt'
  | 'custom_excerpt'
  | 'feature_image'
  | 'feature_image_alt'
  | 'feature_image_caption'
  | 'feature_image_width'
  | 'feature_image_height'
  | 'url'
  | 'published_at'
  | 'updated_at'
  | 'reading_time'
  | 'primary_tag'
  | 'primary_author'
  | 'tags'
  | 'authors'
  | 'visibility'
  | 'featured'
  | 'access'
  | 'page'
>;
