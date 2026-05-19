import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import slugify from 'slugify';
import type { NectarConfig } from '~/config/schema.ts';
import { toNectarError } from '~/util/errors.ts';
import { pathContainsSymlink } from '~/util/fs.ts';
import { readImageDimensions } from '~/util/image-size.ts';
import { directionForLocale } from '~/util/locale.ts';
import { logger } from '~/util/logger.ts';
import {
  asBool,
  asDateISO,
  asPositiveInt,
  asString,
  asStringArray,
  parseFrontmatter,
} from './frontmatter.ts';
import { renderMarkdown, truncateByWords } from './markdown.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from './model.ts';
import { buildPaywallStub, truncateMarkdownForPaywall } from './paywall.ts';

export interface LoadContentOptions {
  cwd: string;
  config: NectarConfig;
}

export async function loadContent({ cwd, config }: LoadContentOptions): Promise<ContentGraph> {
  const site = buildSite(config);

  const [authors, tags, posts, pages] = await Promise.all([
    loadAuthors(cwd, config),
    loadTags(cwd, config),
    loadPosts(cwd, config),
    loadPages(cwd, config),
  ]);

  const authorMap = new Map(authors.map((a) => [a.slug, a]));
  const tagMap = new Map(tags.map((t) => [t.slug, t]));

  const resolvedPosts: Post[] = [];
  for (const raw of posts) {
    if (raw.status === 'draft') continue;
    const resolved = resolvePostRelations(raw, authorMap, tagMap, site);
    resolvedPosts.push(resolved);
  }
  resolvedPosts.sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );
  for (let i = 0; i < resolvedPosts.length; i += 1) {
    const current = resolvedPosts[i];
    if (!current) continue;
    current.next = resolvedPosts[i - 1];
    current.prev = resolvedPosts[i + 1];
  }

  const resolvedPages: Page[] = [];
  for (const raw of pages) {
    if (raw.status === 'draft') continue;
    const resolved = resolvePageRelations(raw, authorMap, tagMap, site);
    resolvedPages.push(resolved);
  }
  resolvedPages.sort((a, b) => a.title.localeCompare(b.title));

  const allTags = Array.from(tagMap.values());
  const allAuthors = Array.from(authorMap.values());
  for (const tag of allTags) {
    tag.count.posts = resolvedPosts.filter((p) => p.tags.some((t) => t.slug === tag.slug)).length;
  }

  return {
    posts: resolvedPosts,
    pages: resolvedPages,
    tags: allTags,
    authors: allAuthors,
    bySlug: {
      posts: new Map(resolvedPosts.map((p) => [p.slug, p])),
      pages: new Map(resolvedPages.map((p) => [p.slug, p])),
      tags: tagMap,
      authors: authorMap,
    },
    site,
  };
}

function buildSite(config: NectarConfig): SiteData {
  return {
    title: config.site.title,
    description: config.site.description,
    url: config.site.url,
    locale: config.site.locale,
    lang: config.site.locale,
    direction: directionForLocale(config.site.locale),
    timezone: config.site.timezone,
    cover_image: config.site.cover_image,
    logo: config.site.logo,
    logo_width: config.site.logo_width,
    logo_height: config.site.logo_height,
    icon: config.site.icon,
    accent_color: config.site.accent_color,
    navigation: config.navigation,
    secondary_navigation: config.secondary_navigation,
    twitter: config.site.twitter,
    facebook: config.site.facebook,
  };
}

interface RawPost {
  id: string;
  slug: string;
  title: string;
  html: string;
  plaintext: string;
  word_count: number;
  reading_time: number;
  excerpt: string;
  custom_excerpt: string | undefined;
  feed_html: string;
  feed_excerpt: string;
  feature_image: string | undefined;
  feature_image_alt: string | undefined;
  feature_image_caption: string | undefined;
  feature_image_width: number | undefined;
  feature_image_height: number | undefined;
  featured: boolean;
  published_at: string;
  updated_at: string;
  created_at: string;
  visibility: 'public' | 'members' | 'paid';
  status: 'published' | 'draft' | 'scheduled';
  tagSlugs: string[];
  authorSlugs: string[];
  primaryTag: string | undefined;
  primaryAuthor: string | undefined;
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
}

interface RawPage extends Omit<RawPost, 'featured' | 'visibility'> {
  show_title_and_feature_image: boolean;
  status: 'published' | 'draft';
}

async function loadPosts(cwd: string, config: NectarConfig): Promise<RawPost[]> {
  const dir = join(cwd, config.content.posts_dir);
  const posts = await loadMarkdownDir(dir, async (file, raw) =>
    normalizePost(file, raw, cwd, dir, config),
  );
  if (config.content.visibility_policy === 'skip') {
    return posts.filter((p) => p.visibility === 'public');
  }
  return posts;
}

async function loadPages(cwd: string, config: NectarConfig): Promise<RawPage[]> {
  const dir = join(cwd, config.content.pages_dir);
  return loadMarkdownDir(dir, async (file, raw) => normalizePage(file, raw, cwd, dir, config));
}

async function loadAuthors(cwd: string, config: NectarConfig): Promise<Author[]> {
  const dir = join(cwd, config.content.authors_dir);
  return loadMarkdownDir(dir, async (file, raw) => normalizeAuthor(file, raw, config));
}

async function loadTags(cwd: string, config: NectarConfig): Promise<Tag[]> {
  const dir = join(cwd, config.content.tags_dir);
  return loadMarkdownDir(dir, async (file, raw) => normalizeTag(file, raw, config));
}

async function loadMarkdownDir<T>(
  dir: string,
  normalize: (filePath: string, raw: string) => Promise<T>,
): Promise<T[]> {
  const glob = new Bun.Glob('**/*.md');
  const results: T[] = [];
  if (!existsSync(dir)) return results;
  for await (const rel of glob.scan({ cwd: dir })) {
    if (pathContainsSymlink(dir, rel)) {
      logger.warn(`Skipping symlinked content path: ${join(dir, rel)}`);
      continue;
    }
    const file = join(dir, rel);
    const raw = await readFile(file, 'utf8');
    try {
      results.push(await normalize(file, raw));
    } catch (err) {
      throw toNectarError(err, { file });
    }
  }
  return results;
}

function slugFromPath(filePath: string, rootDir: string): string {
  const rel = relative(rootDir, filePath);
  const withoutExt = rel.slice(0, rel.length - extname(rel).length);
  const candidate = withoutExt.replaceAll('\\', '/');
  return slugify(candidate.split('/').pop() ?? basename(filePath), { lower: true, strict: true });
}

function sanitizeUserSlug(input: string | undefined, context: string): string | undefined {
  if (input === undefined) return undefined;
  const sanitized = slugify(input, { lower: true, strict: true });
  if (sanitized.length === 0) {
    throw new Error(
      `Invalid slug ${JSON.stringify(input)} in ${context}: produces empty value after sanitization`,
    );
  }
  return sanitized;
}

function sanitizeUserSlugList(values: string[], _context: string): string[] {
  const out: string[] = [];
  for (const v of values) {
    const sanitized = slugify(v, { lower: true, strict: true });
    if (sanitized.length === 0) continue;
    out.push(sanitized);
  }
  return out;
}

async function normalizePost(
  filePath: string,
  raw: string,
  cwd: string,
  rootDir: string,
  config?: NectarConfig,
): Promise<RawPost> {
  const { data, body } = parseFrontmatter(raw, { filePath });
  const unsafeHtml = asBool(data.unsafe_html, false);
  const locale = config?.site.locale;
  const rendered = await renderMarkdown(body, { unsafe: unsafeHtml, locale });
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} frontmatter slug`) ??
    slugFromPath(filePath, rootDir);
  const title = asString(data.title) ?? slug;
  const dateContext = `${filePath}`;
  const published = asDateISO(
    data.date ?? data.published_at,
    new Date().toISOString(),
    `${dateContext} date`,
  );
  const updated = asDateISO(data.updated_at ?? data.date, published, `${dateContext} updated_at`);
  const created = asDateISO(data.created_at ?? data.date, published, `${dateContext} created_at`);
  const status = (asString(data.status) ?? 'published') as RawPost['status'];
  const visibility = (asString(data.visibility) ?? 'public') as RawPost['visibility'];
  const customExcerpt = asString(data.custom_excerpt ?? data.excerpt);

  let html = rendered.html;
  let plaintext = rendered.plaintext;
  let word_count = rendered.word_count;
  let reading_time = rendered.reading_time;
  let feedHtml = html;
  let feedPlaintext = plaintext;
  if (config && (visibility === 'members' || visibility === 'paid')) {
    const truncated = truncateMarkdownForPaywall(body, config.content.paywall_word_count);
    const reRendered = await renderMarkdown(truncated, { unsafe: unsafeHtml, locale });
    feedHtml = `${reRendered.html}${buildPaywallStub(visibility)}`;
    feedPlaintext = reRendered.plaintext;
    if (config.content.visibility_policy === 'truncate') {
      html = feedHtml;
      plaintext = feedPlaintext;
      word_count = reRendered.word_count;
      reading_time = reRendered.reading_time;
    }
  }

  const featureImage = asString(data.feature_image);
  const explicitWidth = asPositiveInt(data.feature_image_width);
  const explicitHeight = asPositiveInt(data.feature_image_height);
  const dims =
    explicitWidth && explicitHeight
      ? { width: explicitWidth, height: explicitHeight }
      : resolveLocalImageDimensions(featureImage, cwd, config);

  return {
    id: `post-${slug}`,
    slug,
    title,
    html,
    plaintext,
    word_count,
    reading_time,
    excerpt: customExcerpt ?? buildDefaultExcerpt(plaintext, locale),
    custom_excerpt: customExcerpt,
    feed_html: feedHtml,
    feed_excerpt: customExcerpt ?? buildDefaultExcerpt(feedPlaintext, locale),
    feature_image: featureImage,
    feature_image_alt: asString(data.feature_image_alt),
    feature_image_caption: asString(data.feature_image_caption),
    feature_image_width: explicitWidth ?? dims?.width,
    feature_image_height: explicitHeight ?? dims?.height,
    featured: asBool(data.featured, false),
    published_at: published,
    updated_at: updated,
    created_at: created,
    visibility,
    status,
    tagSlugs: sanitizeUserSlugList(asStringArray(data.tags), `${filePath} frontmatter tags`),
    authorSlugs: sanitizeUserSlugList(
      asStringArray(data.authors ?? data.author),
      `${filePath} frontmatter authors`,
    ),
    primaryTag: sanitizeUserSlug(asString(data.primary_tag), `${filePath} frontmatter primary_tag`),
    primaryAuthor: sanitizeUserSlug(
      asString(data.primary_author),
      `${filePath} frontmatter primary_author`,
    ),
    canonical_url: asString(data.canonical_url),
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    og_title: asString(data.og_title),
    og_description: asString(data.og_description),
    og_image: asString(data.og_image),
    twitter_title: asString(data.twitter_title),
    twitter_description: asString(data.twitter_description),
    twitter_image: asString(data.twitter_image),
    codeinjection_head: asString(data.codeinjection_head),
    codeinjection_foot: asString(data.codeinjection_foot),
  };
}

async function normalizePage(
  filePath: string,
  raw: string,
  cwd: string,
  rootDir: string,
  config?: NectarConfig,
): Promise<RawPage> {
  const base = await normalizePost(filePath, raw, cwd, rootDir, config);
  const { data } = parseFrontmatter(raw, { filePath });
  return {
    ...base,
    show_title_and_feature_image: asBool(data.show_title_and_feature_image, true),
    status: base.status === 'draft' ? 'draft' : 'published',
  };
}

async function normalizeAuthor(
  filePath: string,
  raw: string,
  config: NectarConfig,
): Promise<Author> {
  const { data, body } = parseFrontmatter(raw, { filePath });
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} author slug`) ??
    slugify(basename(filePath, extname(filePath)), { lower: true, strict: true });
  const name = asString(data.name) ?? slug;
  const bio = asString(data.bio) ?? body.trim();
  return {
    id: `author-${slug}`,
    slug,
    name,
    bio,
    profile_image: asString(data.profile_image),
    cover_image: asString(data.cover_image),
    website: asString(data.website),
    location: asString(data.location),
    twitter: asString(data.twitter),
    facebook: asString(data.facebook),
    linkedin: asString(data.linkedin),
    bluesky: asString(data.bluesky),
    mastodon: asString(data.mastodon),
    threads: asString(data.threads),
    tiktok: asString(data.tiktok),
    youtube: asString(data.youtube),
    instagram: asString(data.instagram),
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    url: joinUrl(config.site.url, `/author/${slug}/`),
  };
}

async function normalizeTag(filePath: string, raw: string, config: NectarConfig): Promise<Tag> {
  const { data } = parseFrontmatter(raw, { filePath });
  const slug =
    sanitizeUserSlug(asString(data.slug), `${filePath} tag slug`) ??
    slugify(basename(filePath, extname(filePath)), { lower: true, strict: true });
  const name = asString(data.name) ?? slug;
  return {
    id: `tag-${slug}`,
    slug,
    name,
    description: asString(data.description) ?? '',
    feature_image: asString(data.feature_image),
    visibility: slug.startsWith('hash-') ? 'internal' : 'public',
    meta_title: asString(data.meta_title),
    meta_description: asString(data.meta_description),
    url: joinUrl(config.site.url, `/tag/${slug}/`),
    count: { posts: 0 },
  };
}

// Resolves an in-repo image URL (e.g. `/content/images/foo.svg`) to a file
// path under the configured assets_dir and reads its intrinsic dimensions.
// Returns undefined for remote URLs, absolute filesystem references, or any
// path that escapes the assets root.
function resolveLocalImageDimensions(
  featureImage: string | undefined,
  cwd: string,
  config: NectarConfig | undefined,
): { width: number; height: number } | undefined {
  if (!featureImage || !config) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(featureImage)) return undefined;
  const marker = '/content/images/';
  const idx = featureImage.indexOf(marker);
  if (idx < 0) return undefined;
  const rest = featureImage.slice(idx + marker.length).split(/[?#]/)[0] ?? '';
  if (rest === '' || rest.includes('..')) return undefined;
  const assetsRoot = join(cwd, config.content.assets_dir);
  const filePath = join(assetsRoot, rest);
  const rel = relative(assetsRoot, filePath);
  if (rel.startsWith('..') || rel.includes(`..${'/'}`)) return undefined;
  if (!existsSync(filePath)) return undefined;
  const dims = readImageDimensions(filePath);
  if (!dims) {
    logger.warn(`Could not determine image dimensions for ${filePath}`);
  }
  return dims;
}

function resolvePostRelations(
  raw: RawPost,
  authors: Map<string, Author>,
  tags: Map<string, Tag>,
  site: SiteData,
): Post {
  const tagList = resolveTagSlugs(raw.tagSlugs, tags, site);
  const authorList = resolveAuthorSlugs(raw.authorSlugs, authors, site);
  const primary_tag = raw.primaryTag ? tagList.find((t) => t.slug === raw.primaryTag) : tagList[0];
  const primary_author = raw.primaryAuthor
    ? authorList.find((a) => a.slug === raw.primaryAuthor)
    : authorList[0];
  const url = joinUrl(site.url, `/${raw.slug}/`);

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    html: raw.html,
    plaintext: raw.plaintext,
    excerpt: raw.excerpt,
    custom_excerpt: raw.custom_excerpt,
    feature_image: raw.feature_image,
    feature_image_alt: raw.feature_image_alt,
    feature_image_caption: raw.feature_image_caption,
    feature_image_width: raw.feature_image_width,
    feature_image_height: raw.feature_image_height,
    featured: raw.featured,
    page: false,
    published_at: raw.published_at,
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    reading_time: raw.reading_time,
    word_count: raw.word_count,
    visibility: raw.visibility,
    status: raw.status,
    tags: tagList,
    primary_tag,
    authors: authorList,
    primary_author,
    url,
    canonical_url: raw.canonical_url,
    meta_title: raw.meta_title,
    meta_description: raw.meta_description,
    og_title: raw.og_title,
    og_description: raw.og_description,
    og_image: raw.og_image,
    twitter_title: raw.twitter_title,
    twitter_description: raw.twitter_description,
    twitter_image: raw.twitter_image,
    codeinjection_head: raw.codeinjection_head,
    codeinjection_foot: raw.codeinjection_foot,
    comments: true,
    prev: undefined,
    next: undefined,
    feed_html: raw.feed_html,
    feed_excerpt: raw.feed_excerpt,
  };
}

function resolvePageRelations(
  raw: RawPage,
  authors: Map<string, Author>,
  tags: Map<string, Tag>,
  site: SiteData,
): Page {
  const tagList = resolveTagSlugs(raw.tagSlugs, tags, site);
  const authorList = resolveAuthorSlugs(raw.authorSlugs, authors, site);
  const primary_tag = raw.primaryTag ? tagList.find((t) => t.slug === raw.primaryTag) : tagList[0];
  const primary_author = raw.primaryAuthor
    ? authorList.find((a) => a.slug === raw.primaryAuthor)
    : authorList[0];
  const url = joinUrl(site.url, `/${raw.slug}/`);

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    html: raw.html,
    plaintext: raw.plaintext,
    excerpt: raw.excerpt,
    custom_excerpt: raw.custom_excerpt,
    feature_image: raw.feature_image,
    feature_image_alt: raw.feature_image_alt,
    feature_image_caption: raw.feature_image_caption,
    feature_image_width: raw.feature_image_width,
    feature_image_height: raw.feature_image_height,
    page: true,
    published_at: raw.published_at,
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    reading_time: raw.reading_time,
    word_count: raw.word_count,
    visibility: 'public',
    status: raw.status,
    tags: tagList,
    primary_tag,
    authors: authorList,
    primary_author,
    url,
    canonical_url: raw.canonical_url,
    meta_title: raw.meta_title,
    meta_description: raw.meta_description,
    og_title: raw.og_title,
    og_description: raw.og_description,
    og_image: raw.og_image,
    twitter_title: raw.twitter_title,
    twitter_description: raw.twitter_description,
    twitter_image: raw.twitter_image,
    codeinjection_head: raw.codeinjection_head,
    codeinjection_foot: raw.codeinjection_foot,
    show_title_and_feature_image: raw.show_title_and_feature_image,
  };
}

function resolveTagSlugs(slugs: string[], tags: Map<string, Tag>, site: SiteData): Tag[] {
  return slugs.map((slug) => {
    const existing = tags.get(slug);
    if (existing) return existing;
    const created: Tag = {
      id: `tag-${slug}`,
      slug,
      name: titleCase(slug),
      description: '',
      feature_image: undefined,
      visibility: 'public',
      meta_title: undefined,
      meta_description: undefined,
      url: joinUrl(site.url, `/tag/${slug}/`),
      count: { posts: 0 },
    };
    tags.set(slug, created);
    return created;
  });
}

function resolveAuthorSlugs(
  slugs: string[],
  authors: Map<string, Author>,
  site: SiteData,
): Author[] {
  return slugs.map((slug) => {
    const existing = authors.get(slug);
    if (existing) return existing;
    const created: Author = {
      id: `author-${slug}`,
      slug,
      name: titleCase(slug),
      bio: '',
      profile_image: undefined,
      cover_image: undefined,
      website: undefined,
      location: undefined,
      twitter: undefined,
      facebook: undefined,
      linkedin: undefined,
      bluesky: undefined,
      mastodon: undefined,
      threads: undefined,
      tiktok: undefined,
      youtube: undefined,
      instagram: undefined,
      meta_title: undefined,
      meta_description: undefined,
      url: joinUrl(site.url, `/author/${slug}/`),
    };
    authors.set(slug, created);
    return created;
  });
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

// `plaintext.slice(0, 200)` cut by code-unit count, which means 200 Japanese
// characters (a much denser unit than 200 English characters) for CJK posts and
// inconsistent excerpt length across scripts. Take the first 50 word-like
// segments instead so excerpts are roughly comparable regardless of language.
const DEFAULT_EXCERPT_WORDS = 50;
function buildDefaultExcerpt(plaintext: string, locale: string | undefined): string {
  return truncateByWords(plaintext, DEFAULT_EXCERPT_WORDS, locale);
}
