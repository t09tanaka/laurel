import type { NavigationItem } from '~/config/schema.ts';

export interface SiteData {
  title: string;
  description: string;
  url: string;
  locale: string;
  timezone: string;
  cover_image: string | undefined;
  logo: string | undefined;
  icon: string | undefined;
  accent_color: string;
  navigation: NavigationItem[];
  secondary_navigation: NavigationItem[];
  lang: string;
  twitter: string | undefined;
  facebook: string | undefined;
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
}

export interface ContentGraph {
  posts: Post[];
  pages: Page[];
  tags: Tag[];
  authors: Author[];
  bySlug: {
    posts: Map<string, Post>;
    pages: Map<string, Page>;
    tags: Map<string, Tag>;
    authors: Map<string, Author>;
  };
  site: SiteData;
}
