import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';

export interface EmitContentApiOptions {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
}

const API_BASE = 'ghost/api/content';

export async function emitContentApiShadows(opts: EmitContentApiOptions): Promise<void> {
  const { content, outputDir } = opts;

  await Promise.all([
    writeResource(outputDir, 'posts', content.posts, serializePost),
    writeResource(outputDir, 'pages', content.pages, serializePage),
    writeResource(outputDir, 'authors', content.authors, serializeAuthor),
    writeResource(outputDir, 'tags', content.tags, serializeTag),
    writeSettings(outputDir, content.site),
  ]);

  await Promise.all([
    ...content.posts.map((post) =>
      writeBySlug(outputDir, 'posts', post.slug, { posts: [serializePost(post)] }),
    ),
    ...content.pages.map((page) =>
      writeBySlug(outputDir, 'pages', page.slug, { pages: [serializePage(page)] }),
    ),
    ...content.authors.map((author) =>
      writeBySlug(outputDir, 'authors', author.slug, { authors: [serializeAuthor(author)] }),
    ),
    ...content.tags.map((tag) =>
      writeBySlug(outputDir, 'tags', tag.slug, { tags: [serializeTag(tag)] }),
    ),
  ]);
}

async function writeResource<T, U>(
  outputDir: string,
  resource: 'posts' | 'pages' | 'authors' | 'tags',
  items: T[],
  serialize: (item: T) => U,
): Promise<void> {
  const data = items.map(serialize);
  const body = {
    [resource]: data,
    meta: {
      pagination: {
        page: 1,
        limit: data.length,
        pages: 1,
        total: data.length,
        next: null,
        prev: null,
      },
    },
  };
  await writeJson(join(outputDir, API_BASE, `${resource}.json`), body);
}

async function writeBySlug(
  outputDir: string,
  resource: 'posts' | 'pages' | 'authors' | 'tags',
  slug: string,
  body: Record<string, unknown>,
): Promise<void> {
  await writeJson(join(outputDir, API_BASE, resource, 'slug', `${slug}.json`), body);
}

async function writeSettings(outputDir: string, site: SiteData): Promise<void> {
  const settings = {
    title: site.title,
    description: site.description,
    url: site.url,
    locale: site.locale,
    lang: site.lang,
    timezone: site.timezone,
    cover_image: site.cover_image ?? null,
    logo: site.logo ?? null,
    icon: site.icon ?? null,
    accent_color: site.accent_color,
    twitter: site.twitter ?? null,
    facebook: site.facebook ?? null,
    navigation: site.navigation,
    secondary_navigation: site.secondary_navigation,
  };
  await writeJson(join(outputDir, API_BASE, 'settings.json'), { settings });
}

async function writeJson(dest: string, body: unknown): Promise<void> {
  await ensureDir(dirname(dest));
  await writeFile(dest, `${JSON.stringify(body)}\n`, 'utf8');
}

function serializePost(post: Post): Record<string, unknown> {
  return {
    id: post.id,
    uuid: post.id,
    slug: post.slug,
    title: post.title,
    html: post.html,
    plaintext: post.plaintext,
    excerpt: post.excerpt,
    custom_excerpt: post.custom_excerpt ?? null,
    feature_image: post.feature_image ?? null,
    feature_image_alt: post.feature_image_alt ?? null,
    feature_image_caption: post.feature_image_caption ?? null,
    featured: post.featured,
    page: post.page,
    published_at: post.published_at,
    updated_at: post.updated_at,
    created_at: post.created_at,
    reading_time: post.reading_time,
    visibility: post.visibility,
    tags: post.tags.map(serializeTag),
    primary_tag: post.primary_tag ? serializeTag(post.primary_tag) : null,
    authors: post.authors.map(serializeAuthor),
    primary_author: post.primary_author ? serializeAuthor(post.primary_author) : null,
    url: post.url,
    canonical_url: post.canonical_url ?? null,
    meta_title: post.meta_title ?? null,
    meta_description: post.meta_description ?? null,
    og_title: post.og_title ?? null,
    og_description: post.og_description ?? null,
    og_image: post.og_image ?? null,
    twitter_title: post.twitter_title ?? null,
    twitter_description: post.twitter_description ?? null,
    twitter_image: post.twitter_image ?? null,
    codeinjection_head: post.codeinjection_head ?? null,
    codeinjection_foot: post.codeinjection_foot ?? null,
    comments: post.comments,
  };
}

function serializePage(page: Page): Record<string, unknown> {
  return {
    id: page.id,
    uuid: page.id,
    slug: page.slug,
    title: page.title,
    html: page.html,
    plaintext: page.plaintext,
    excerpt: page.excerpt,
    custom_excerpt: page.custom_excerpt ?? null,
    feature_image: page.feature_image ?? null,
    feature_image_alt: page.feature_image_alt ?? null,
    feature_image_caption: page.feature_image_caption ?? null,
    page: page.page,
    published_at: page.published_at,
    updated_at: page.updated_at,
    created_at: page.created_at,
    reading_time: page.reading_time,
    visibility: page.visibility,
    tags: page.tags.map(serializeTag),
    primary_tag: page.primary_tag ? serializeTag(page.primary_tag) : null,
    authors: page.authors.map(serializeAuthor),
    primary_author: page.primary_author ? serializeAuthor(page.primary_author) : null,
    url: page.url,
    canonical_url: page.canonical_url ?? null,
    meta_title: page.meta_title ?? null,
    meta_description: page.meta_description ?? null,
    og_title: page.og_title ?? null,
    og_description: page.og_description ?? null,
    og_image: page.og_image ?? null,
    twitter_title: page.twitter_title ?? null,
    twitter_description: page.twitter_description ?? null,
    twitter_image: page.twitter_image ?? null,
    codeinjection_head: page.codeinjection_head ?? null,
    codeinjection_foot: page.codeinjection_foot ?? null,
  };
}

function serializeTag(tag: Tag): Record<string, unknown> {
  return {
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    description: tag.description,
    feature_image: tag.feature_image ?? null,
    visibility: tag.visibility,
    meta_title: tag.meta_title ?? null,
    meta_description: tag.meta_description ?? null,
    url: tag.url,
    count: tag.count,
  };
}

function serializeAuthor(author: Author): Record<string, unknown> {
  return {
    id: author.id,
    slug: author.slug,
    name: author.name,
    bio: author.bio,
    profile_image: author.profile_image ?? null,
    cover_image: author.cover_image ?? null,
    website: author.website ?? null,
    location: author.location ?? null,
    twitter: author.twitter ?? null,
    facebook: author.facebook ?? null,
    meta_title: author.meta_title ?? null,
    meta_description: author.meta_description ?? null,
    url: author.url,
  };
}
