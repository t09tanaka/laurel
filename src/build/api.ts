import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { absoluteUrl, absoluteUrlWithBasePath } from '~/util/url.ts';
import { buildContentApiNotFoundEnvelope } from './api/errors.ts';
import { projectPagination } from './api/pagination.ts';

export interface EmitContentApiOptions {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
}

const API_BASE = 'ghost/api/content';
const COLLECTIONS = ['posts', 'pages', 'authors', 'tags'] as const;
type Collection = (typeof COLLECTIONS)[number];

interface ApiUrlContext {
  siteUrl: string;
  basePath: string;
}

export async function emitContentApiShadows(opts: EmitContentApiOptions): Promise<void> {
  const { config, content, outputDir } = opts;

  const absoluteUrls = config.components?.content_api?.absolute_urls ?? false;
  const postsPerPage = config.components?.content_api?.posts_per_page ?? 15;
  const urlBase = absoluteUrls ? buildUrlBase(content.site.url, config.build.base_path) : undefined;
  const urlContext = { siteUrl: content.site.url, basePath: config.build.base_path };

  const publishedPosts = content.posts.filter((p) => p.status === 'published');
  const publishedPages = content.pages.filter((p) => p.status === 'published');

  const serializedPosts = publishedPosts.map((p) => serializePost(p, urlBase, urlContext));
  const serializedPages = publishedPages.map((p) => serializePage(p, urlBase, urlContext));
  const publicTags = selectPublicTags(content.tags, publishedPosts);
  const serializedTags = publicTags.map(({ tag, countPosts }) =>
    serializeTag(tag, countPosts, urlContext),
  );
  const serializedAuthors = content.authors.map((author) => serializeAuthor(author, urlContext));

  await Promise.all([
    writeResourceWith(outputDir, 'posts', serializedPosts),
    writeResourceWith(outputDir, 'pages', serializedPages),
    writeResourceWith(outputDir, 'authors', serializedAuthors),
    writeResourceWith(outputDir, 'tags', serializedTags),
    writeSettings(outputDir, content.site),
    writePaginated(outputDir, 'posts', serializedPosts, postsPerPage),
    writePerTag(outputDir, content.tags, publishedPosts, urlBase, urlContext),
    writeContentApi404(outputDir),
  ]);

  await Promise.all([
    ...serializedPosts.map((post) => {
      const slug = String(post.slug);
      const id = String(post.id);
      const body = { posts: [post] };
      return Promise.all([
        writeBySlug(outputDir, 'posts', slug, body),
        writeById(outputDir, 'posts', id, body),
      ]).then(() => undefined);
    }),
    ...serializedPages.map((page) => {
      const slug = String(page.slug);
      const id = String(page.id);
      const body = { pages: [page] };
      return Promise.all([
        writeBySlug(outputDir, 'pages', slug, body),
        writeById(outputDir, 'pages', id, body),
      ]).then(() => undefined);
    }),
    ...content.authors.map((author) =>
      writeBySlug(outputDir, 'authors', author.slug, {
        authors: [serializeAuthor(author, urlContext)],
      }),
    ),
    ...publicTags.map(({ tag, countPosts }) =>
      writeBySlug(outputDir, 'tags', tag.slug, {
        tags: [serializeTag(tag, countPosts, urlContext)],
      }),
    ),
  ]);

  await writeRedirects(outputDir, config.build.base_path, content);
}

async function writeContentApi404(outputDir: string): Promise<void> {
  await writeJson(join(outputDir, API_BASE, '404.json'), buildContentApiNotFoundEnvelope());
}

async function writeResourceWith(
  outputDir: string,
  resource: Collection,
  data: Array<Record<string, unknown>>,
): Promise<void> {
  const body = {
    [resource]: data,
    meta: {
      pagination: projectPagination({ total: data.length }),
    },
  };
  await writeJson(join(outputDir, API_BASE, `${resource}.json`), body);
  await writeJson(join(outputDir, API_BASE, resource, 'index.json'), body);
}

async function writePaginated(
  outputDir: string,
  resource: 'posts',
  data: Array<Record<string, unknown>>,
  limit: number,
): Promise<void> {
  const total = data.length;
  const pages = total === 0 ? 1 : Math.max(1, Math.ceil(total / limit));
  for (let page = 1; page <= pages; page++) {
    const start = (page - 1) * limit;
    const slice = data.slice(start, start + limit);
    const body = {
      [resource]: slice,
      meta: {
        pagination: projectPagination({ page, limit, total }),
      },
    };
    await writeJson(join(outputDir, API_BASE, resource, 'page', `${page}.json`), body);
    await writeJson(join(outputDir, API_BASE, resource, 'page', `${page}`, 'index.json'), body);
  }
}

async function writePerTag(
  outputDir: string,
  tags: Tag[],
  posts: Post[],
  urlBase: string | undefined,
  urlContext: ApiUrlContext,
): Promise<void> {
  await Promise.all(
    tags.map((tag) => {
      const matching = posts.filter((post) => post.tags.some((t) => t.id === tag.id));
      const serialized = matching.map((p) => serializePost(p, urlBase, urlContext));
      const body = {
        posts: serialized,
        meta: {
          pagination: projectPagination({ total: serialized.length }),
        },
      };
      const flat = join(outputDir, API_BASE, 'posts', 'tag', `${tag.slug}.json`);
      const dirIndex = join(outputDir, API_BASE, 'posts', 'tag', tag.slug, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writeBySlug(
  outputDir: string,
  resource: Collection,
  slug: string,
  body: Record<string, unknown>,
): Promise<void> {
  await writeJson(join(outputDir, API_BASE, resource, 'slug', `${slug}.json`), body);
  await writeJson(join(outputDir, API_BASE, resource, 'slug', slug, 'index.json'), body);
}

async function writeById(
  outputDir: string,
  resource: Collection,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  await writeJson(join(outputDir, API_BASE, resource, `${id}.json`), body);
  await writeJson(join(outputDir, API_BASE, resource, id, 'index.json'), body);
}

async function writeSettings(outputDir: string, site: SiteData): Promise<void> {
  const settings = {
    title: site.title,
    description: site.description,
    url: site.url,
    locale: site.locale,
    lang: site.lang,
    direction: site.direction,
    timezone: site.timezone,
    cover_image: site.cover_image ?? null,
    logo: site.logo ?? null,
    icon: site.icon ?? null,
    accent_color: site.accent_color,
    twitter: site.twitter ?? null,
    facebook: site.facebook ?? null,
    navigation: site.navigation,
    // See content-api.ts: SiteData stores `undefined` for an empty secondary
    // nav (so Handlebars `{{#unless}}` works), but the API contract is "always
    // an array". Normalise back here. See #324.
    secondary_navigation: site.secondary_navigation ?? [],
    members_enabled: site.members_enabled,
    paid_members_enabled: site.paid_members_enabled,
    members_invite_only: site.members_invite_only,
    recommendations_enabled: site.recommendations_enabled,
  };
  const body = { settings };
  await writeJson(join(outputDir, API_BASE, 'settings.json'), body);
  await writeJson(join(outputDir, API_BASE, 'settings', 'index.json'), body);
}

async function writeRedirects(
  outputDir: string,
  basePath: string,
  content: ContentGraph,
): Promise<void> {
  const prefix = `${normalizeBasePath(basePath)}/${API_BASE}`;
  const lines: string[] = [
    '# Ghost Content API trailing-slash routing (auto-generated by nectar)',
    '# Maps SDK requests like /posts/?key=... to the JSON shadow files.',
  ];

  for (const resource of [...COLLECTIONS, 'settings'] as const) {
    lines.push(`${prefix}/${resource}/  ${prefix}/${resource}/index.json  200`);
  }

  const slugMap: Record<Collection, Array<{ slug: string }>> = {
    posts: content.posts,
    pages: content.pages,
    authors: content.authors,
    tags: content.tags.filter((tag) => tag.visibility === 'public'),
  };
  for (const resource of COLLECTIONS) {
    for (const item of slugMap[resource]) {
      lines.push(
        `${prefix}/${resource}/slug/${item.slug}/  ${prefix}/${resource}/slug/${item.slug}/index.json  200`,
      );
    }
  }

  await writeFile(join(outputDir, '_redirects'), `${lines.join('\n')}\n`, 'utf8');
}

function normalizeBasePath(basePath: string): string {
  if (basePath === '/' || basePath === '') return '';
  return `/${basePath.replace(/^\/+|\/+$/g, '')}`;
}

function buildUrlBase(siteUrl: string, basePath: string): string {
  const root = siteUrl.replace(/\/+$/, '');
  if (basePath === '/' || basePath === '') return root;
  const trimmed = basePath.replace(/^\/+|\/+$/g, '');
  return trimmed.length === 0 ? root : `${root}/${trimmed}`;
}

function serializeApiUrl(url: string, ctx: ApiUrlContext): string {
  if (/^https?:/i.test(url)) return url;
  const normalizedBasePath = normalizeApiBasePath(ctx.basePath);
  if (
    normalizedBasePath !== '/' &&
    (url === normalizedBasePath.replace(/\/$/, '') || url.startsWith(normalizedBasePath))
  ) {
    return absoluteUrl(ctx.siteUrl, url);
  }
  return absoluteUrlWithBasePath(ctx.siteUrl, normalizedBasePath, url);
}

function normalizeApiBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/';
  return `/${basePath.replace(/^\/+|\/+$/g, '')}/`;
}

function rewriteHtmlAbsolute(html: string, urlBase: string | undefined): string {
  if (!urlBase || html.length === 0) return html;
  return html.replace(/(\s(?:src|href|poster|action)=")(\/[^"]*)(")/g, (_m, p1, p2, p3) => {
    if (p2.startsWith('//')) return `${p1}${p2}${p3}`;
    return `${p1}${urlBase}${p2}${p3}`;
  });
}

async function writeJson(dest: string, body: unknown): Promise<void> {
  await ensureDir(dirname(dest));
  await writeFile(dest, `${JSON.stringify(body)}\n`, 'utf8');
}

function serializePost(
  post: Post,
  urlBase: string | undefined,
  urlContext: ApiUrlContext,
): Record<string, unknown> {
  const isPublic = post.visibility === 'public';
  return {
    id: post.id,
    uuid: post.uuid ?? post.id,
    slug: post.slug,
    title: post.title,
    html: isPublic ? rewriteHtmlAbsolute(post.html, urlBase) : '',
    plaintext: isPublic ? post.plaintext : '',
    excerpt: isPublic ? post.excerpt : '',
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
    // `access: 'public'` marks the payload as the public anonymous view.
    // See docs/api-stability.md and content-api.ts for the rationale.
    access: 'public',
    tags: post.tags.map((tag) => serializeTag(tag, undefined, urlContext)),
    primary_tag: post.primary_tag ? serializeTag(post.primary_tag, undefined, urlContext) : null,
    authors: post.authors.map((a) => serializeAuthorBare(a, urlContext)),
    primary_author: post.primary_author
      ? serializeAuthorBare(post.primary_author, urlContext)
      : null,
    url: serializeApiUrl(post.url, urlContext),
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

function serializePage(
  page: Page,
  urlBase: string | undefined,
  urlContext: ApiUrlContext,
): Record<string, unknown> {
  return {
    id: page.id,
    uuid: page.uuid ?? page.id,
    slug: page.slug,
    title: page.title,
    html: rewriteHtmlAbsolute(page.html, urlBase),
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
    access: 'public',
    tags: page.tags.map((tag) => serializeTag(tag, undefined, urlContext)),
    primary_tag: page.primary_tag ? serializeTag(page.primary_tag, undefined, urlContext) : null,
    authors: page.authors.map((a) => serializeAuthorBare(a, urlContext)),
    primary_author: page.primary_author
      ? serializeAuthorBare(page.primary_author, urlContext)
      : null,
    url: serializeApiUrl(page.url, urlContext),
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

function selectPublicTags(
  tags: Tag[],
  publishedPosts: Post[],
): Array<{ tag: Tag; countPosts: number }> {
  return tags
    .filter((tag) => tag.visibility === 'public')
    .map((tag) => ({
      tag,
      countPosts: publishedPosts.filter((post) => post.tags.some((t) => t.id === tag.id)).length,
    }))
    .sort((a, b) => a.tag.name.localeCompare(b.tag.name));
}

function serializeTag(
  tag: Tag,
  countPosts: number | undefined,
  urlContext: ApiUrlContext,
): Record<string, unknown> {
  return {
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    description: tag.description,
    feature_image: tag.feature_image ?? null,
    accent_color: tag.accent_color ?? null,
    visibility: tag.visibility,
    meta_title: tag.meta_title ?? null,
    meta_description: tag.meta_description ?? null,
    url: serializeApiUrl(tag.url, urlContext),
    count: { ...tag.count, posts: countPosts ?? tag.count?.posts ?? 0 },
  };
}

function serializeAuthor(author: Author, urlContext: ApiUrlContext): Record<string, unknown> {
  return {
    ...serializeAuthorBare(author, urlContext),
    count: author.count,
  };
}

function serializeAuthorBare(author: Author, urlContext: ApiUrlContext): Record<string, unknown> {
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
    url: serializeApiUrl(author.url, urlContext),
  };
}
