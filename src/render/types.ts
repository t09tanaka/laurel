import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
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
}

export type RouteKind = 'index' | 'home' | 'post' | 'page' | 'tag' | 'author' | 'custom' | 'error';

export interface RouteContext {
  kind: RouteKind;
  url: string;
  outputPath: string;
  template: string;
  lastmod?: string;
  data: {
    posts?: Post[];
    pagination?: PaginationInfo;
    post?: Post;
    page?: Page;
    tag?: Tag;
    author?: Author;
  };
  meta: {
    title: string;
    description: string;
    canonical: string;
    image: string | undefined;
  };
}

export interface RenderInputs {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  site: SiteData;
}
