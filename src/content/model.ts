import type { NavigationItem } from '~/config/schema.ts';

export interface SiteData {
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
  secondary_navigation: NavigationItem[];
  lang: string;
  twitter: string | undefined;
  facebook: string | undefined;
  members_enabled: boolean;
  paid_members_enabled: boolean;
  members_invite_only: boolean;
  comments_enabled: boolean;
  recommendations_enabled: boolean;
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
}

export interface Author {
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

export interface Tag {
  id: string;
  slug: string;
  name: string;
  description: string;
  feature_image: string | undefined;
  visibility: 'public' | 'internal';
  meta_title: string | undefined;
  meta_description: string | undefined;
  url: string;
  count: { posts: number };
}

export interface Post {
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
  featured: boolean;
  page: false;
  published_at: string;
  updated_at: string;
  created_at: string;
  reading_time: number;
  word_count: number;
  visibility: 'public' | 'members' | 'paid';
  status: 'published' | 'draft' | 'scheduled';
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
  comments: boolean;
  prev: Post | undefined;
  next: Post | undefined;
  feed_html: string;
  feed_excerpt: string;
}

export interface Page {
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
  page: true;
  published_at: string;
  updated_at: string;
  created_at: string;
  reading_time: number;
  word_count: number;
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

export interface ContentGraph {
  posts: Post[];
  pages: Page[];
  tags: Tag[];
  authors: Author[];
  tiers: Tier[];
  bySlug: {
    posts: Map<string, Post>;
    pages: Map<string, Page>;
    tags: Map<string, Tag>;
    authors: Map<string, Author>;
  };
  // Inverse indices keyed by slug. Built once during content load so the route
  // planner can resolve tag/author archives in O(1) instead of scanning
  // `posts` for every tag/author (O(tags x posts), O(authors x posts)).
  postsByTag: Map<string, Post[]>;
  postsByAuthor: Map<string, Post[]>;
  site: SiteData;
}
