import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { absoluteUrl, withBasePath } from '~/util/url.ts';
import { buildContentApiNotFoundEnvelope } from './api/errors.ts';
import { projectPagination } from './api/pagination.ts';
import { buildContentApiHeadersBody, buildContentApiHtaccessBody } from './headers.ts';

// Static dump of Ghost Content API-shaped JSON under `dist/content/` so a
// browser-only consumer can `fetch('/content/posts.json')` and treat the
// response like a Content API page.
//
// Layout (each top-level collection ships in both `<resource>.json` and
// `<resource>/index.json` for static-host directory-index quirks; see #215):
//
//   content/posts.json                       — all published posts (single shard)
//   content/posts/page/<n>.json              — paginated shards (posts_per_page)
//   content/posts/<id>.json                  — single post by id
//   content/posts/slug/<slug>.json           — single post by slug
//   content/posts/tag/<slug>.json            — posts pre-filtered by tag
//   content/pages.json                       — all published pages
//   content/pages/<id>.json                  — single page by id
//   content/pages/slug/<slug>.json           — single page by slug
//   content/tags.json                        — all public tags
//   content/tags/slug/<slug>.json            — single public tag by slug
//   content/authors.json                     — all authors (with count.posts)
//   content/settings.json                    — site settings singleton
//   content/404.json                         — Ghost-shaped 404 error envelope
//
// Pre-baked tag shards exist because arbitrary Ghost NQL filtering needs a
// server. Operators who need a different filter can shape it client-side off
// `content/posts.json`. See docs/api.md.
//
// The CORS `_headers` (Netlify) and `_headers.cf` (Cloudflare Pages) twin
// files announce that `/content/*` is safe to read cross-origin and apply
// per-resource Cache-Control TTLs (posts short, tags/authors longer; see
// `headers.ts:CONTENT_API_CACHE_TTL`).

export interface EmitContentApiStubsOptions {
  content: ContentGraph;
  outputDir: string;
  // When set, rewrites relative URLs inside serialized `html` fields to
  // absolute URLs using `site.url + basePath`. Mirrors the Ghost Content
  // API `?absolute_urls=true` query at build time.
  absoluteUrls?: boolean;
  // Posts per paginated shard (`content/posts/page/<n>.json`). Defaults to
  // 15 to match Ghost's Content API default `limit`.
  postsPerPage?: number;
  // base_path for absolute URL rewriting. Defaults to '/'.
  basePath?: string;
  // When true, writes an Apache .htaccess into dist/content/ with the same
  // CORS and Cache-Control headers as the generated _headers files.
  emitHtaccess?: boolean;
}

export async function emitContentApiStubs(opts: EmitContentApiStubsOptions): Promise<void> {
  const { content, outputDir } = opts;
  const absoluteUrls = opts.absoluteUrls ?? false;
  const postsPerPage = opts.postsPerPage ?? 15;
  const basePath = opts.basePath ?? '/';
  const urlBase = absoluteUrls ? buildUrlBase(content.site.url, basePath) : undefined;

  const publishedPosts = content.posts.filter((p) => p.status === 'published');
  const tagUrlContext = { siteUrl: content.site.url, basePath };
  const serializedPosts = publishedPosts.map((p) => serializePost(p, urlBase, tagUrlContext));
  const publishedPages = content.pages.filter((p) => p.status === 'published');
  const serializedPages = publishedPages.map((p) => serializePage(p, urlBase));
  const publicTags = selectPublicTags(content.tags, publishedPosts);
  const serializedTags = publicTags.map(({ tag, countPosts }) =>
    serializeTag(tag, tagUrlContext, countPosts),
  );
  const serializedAuthors = content.authors.map(serializeAuthor);

  await Promise.all([
    writeCollection(outputDir, 'posts', serializedPosts),
    writeCollection(outputDir, 'pages', serializedPages),
    writeCollection(outputDir, 'tags', serializedTags),
    writeCollection(outputDir, 'authors', serializedAuthors),
    writeSettingsDump(outputDir, content.site),
    writePaginatedPosts(outputDir, serializedPosts, postsPerPage),
    writePerSlugPosts(outputDir, serializedPosts),
    writePerIdPosts(outputDir, serializedPosts),
    writePerSlugPages(outputDir, serializedPages),
    writePerIdPages(outputDir, serializedPages),
    writePerSlugTags(outputDir, publicTags, tagUrlContext),
    writePerTagPosts(outputDir, content.tags, publishedPosts, urlBase, tagUrlContext),
    writeContentApi404(outputDir),
    writeCorsHeaders(outputDir, '_headers'),
    writeCorsHeaders(outputDir, '_headers.cf'),
    writeContentHtaccess(outputDir, opts.emitHtaccess ?? false),
  ]);
}

async function writeContentApi404(outputDir: string): Promise<void> {
  await writeJson(join(outputDir, 'content', '404.json'), buildContentApiNotFoundEnvelope());
}

// Writes a Ghost-shaped collection envelope to BOTH
//   `dist/content/<resource>.json`
// and
//   `dist/content/<resource>/index.json`.
// Same payload, identical bytes; the duo emit covers static-host directory
// index quirks without forcing the consumer to know the host's resolution
// rules. See #215.
async function writeCollection(
  outputDir: string,
  resource: 'posts' | 'pages' | 'tags' | 'authors',
  items: Array<Record<string, unknown>>,
): Promise<void> {
  const body = {
    [resource]: items,
    meta: {
      pagination: projectPagination({ total: items.length }),
    },
  };
  const flat = join(outputDir, 'content', `${resource}.json`);
  const dirIndex = join(outputDir, 'content', resource, 'index.json');
  await Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]);
}

async function writePaginatedPosts(
  outputDir: string,
  posts: Array<Record<string, unknown>>,
  limit: number,
): Promise<void> {
  const total = posts.length;
  // `pages` is at least 1 so an empty collection still gets a `/page/1.json`
  // pointer. Mirrors `projectPagination`'s clamp.
  const pages = total === 0 ? 1 : Math.max(1, Math.ceil(total / limit));
  const writes: Array<Promise<void>> = [];
  for (let page = 1; page <= pages; page++) {
    const start = (page - 1) * limit;
    const slice = posts.slice(start, start + limit);
    const body = {
      posts: slice,
      meta: {
        pagination: projectPagination({ page, limit, total }),
      },
    };
    const flat = join(outputDir, 'content', 'posts', 'page', `${page}.json`);
    const dirIndex = join(outputDir, 'content', 'posts', 'page', `${page}`, 'index.json');
    writes.push(writeJson(flat, body), writeJson(dirIndex, body));
  }
  await Promise.all(writes);
}

async function writePerSlugPosts(
  outputDir: string,
  posts: Array<Record<string, unknown>>,
): Promise<void> {
  await Promise.all(
    posts.map((post) => {
      const slug = String(post.slug);
      const body = { posts: [post] };
      const flat = join(outputDir, 'content', 'posts', 'slug', `${slug}.json`);
      const dirIndex = join(outputDir, 'content', 'posts', 'slug', slug, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writePerIdPosts(
  outputDir: string,
  posts: Array<Record<string, unknown>>,
): Promise<void> {
  await Promise.all(
    posts.map((post) => {
      const id = String(post.id);
      const body = { posts: [post] };
      const flat = join(outputDir, 'content', 'posts', `${id}.json`);
      const dirIndex = join(outputDir, 'content', 'posts', id, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writePerSlugPages(
  outputDir: string,
  pages: Array<Record<string, unknown>>,
): Promise<void> {
  await Promise.all(
    pages.map((page) => {
      const slug = String(page.slug);
      const body = { pages: [page] };
      const flat = join(outputDir, 'content', 'pages', 'slug', `${slug}.json`);
      const dirIndex = join(outputDir, 'content', 'pages', 'slug', slug, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writePerIdPages(
  outputDir: string,
  pages: Array<Record<string, unknown>>,
): Promise<void> {
  await Promise.all(
    pages.map((page) => {
      const id = String(page.id);
      const body = { pages: [page] };
      const flat = join(outputDir, 'content', 'pages', `${id}.json`);
      const dirIndex = join(outputDir, 'content', 'pages', id, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writePerSlugTags(
  outputDir: string,
  tags: Array<{ tag: Tag; countPosts: number }>,
  tagUrlContext: TagUrlContext,
): Promise<void> {
  await Promise.all(
    tags.map(({ tag, countPosts }) => {
      const serialized = serializeTag(tag, tagUrlContext, countPosts);
      const body = { tags: [serialized] };
      const flat = join(outputDir, 'content', 'tags', 'slug', `${tag.slug}.json`);
      const dirIndex = join(outputDir, 'content', 'tags', 'slug', tag.slug, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writePerTagPosts(
  outputDir: string,
  tags: Tag[],
  posts: Post[],
  urlBase: string | undefined,
  tagUrlContext: TagUrlContext,
): Promise<void> {
  await Promise.all(
    tags.map((tag) => {
      const matching = posts.filter((post) => post.tags.some((t) => t.id === tag.id));
      const serialized = matching.map((p) => serializePost(p, urlBase, tagUrlContext));
      const body = {
        posts: serialized,
        meta: {
          pagination: projectPagination({ total: serialized.length }),
        },
      };
      const flat = join(outputDir, 'content', 'posts', 'tag', `${tag.slug}.json`);
      const dirIndex = join(outputDir, 'content', 'posts', 'tag', tag.slug, 'index.json');
      return Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]).then(() => undefined);
    }),
  );
}

async function writeSettingsDump(outputDir: string, site: SiteData): Promise<void> {
  // Settings is a singleton, not a collection, so no pagination meta. The
  // duo emit still applies so SDK trailing-slash requests resolve cleanly.
  const body = { settings: serializeSettings(site) };
  const flat = join(outputDir, 'content', 'settings.json');
  const dirIndex = join(outputDir, 'content', 'settings', 'index.json');
  await Promise.all([writeJson(flat, body), writeJson(dirIndex, body)]);
}

async function writeJson(dest: string, body: unknown): Promise<void> {
  await ensureDir(dirname(dest));
  await writeFile(dest, `${JSON.stringify(body)}\n`, 'utf8');
}

async function writeContentHtaccess(outputDir: string, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const dest = join(outputDir, 'content', '.htaccess');
  await ensureDir(dirname(dest));
  await writeFile(dest, buildContentApiHtaccessBody(), 'utf8');
}

// Append CORS rule to an existing `_headers` (or `_headers.cf`) if the
// deploy emitter already wrote one. The catch-all `/*` rule in those files
// is more specific than `/content/*` is for our use case, so we PREpend the
// per-resource CORS+cache-control rules with a blank-line separator so
// first-match platforms pick them up before falling through to defaults.
async function writeCorsHeaders(outputDir: string, filename: string): Promise<void> {
  const dest = join(outputDir, filename);
  await ensureDir(outputDir);
  let existing = '';
  try {
    existing = await readFile(dest, 'utf8');
  } catch {
    // No pre-existing file: write CORS rules alone.
  }
  const body = buildContentApiHeadersBody();
  if (existing.length === 0) {
    await writeFile(dest, body, 'utf8');
    return;
  }
  if (existing.includes('/content/posts/*') || existing.includes('/content/tags/*')) {
    // Already merged on a previous build run; leave it as-is.
    return;
  }
  // Drop the legacy single-block `/content/*` body if present so reruns
  // upgrade cleanly to the per-resource layout without duplicating rules.
  const stripped = stripLegacyContentBlock(existing);
  const trimmed = stripped.endsWith('\n') ? stripped : `${stripped}\n`;
  await writeFile(dest, `${body}\n${trimmed}`, 'utf8');
}

function stripLegacyContentBlock(existing: string): string {
  // The pre-#751 CORS body was a single `/content/*` rule. Detect and remove
  // it so we don't end up with both old and new rule blocks after upgrade.
  const lines = existing.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line === '/content/*') {
      // Skip until next blank line (rule boundary).
      while (i < lines.length && (lines[i] ?? '') !== '') i++;
      // Skip the blank separator too.
      if (i < lines.length && (lines[i] ?? '') === '') i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

function buildUrlBase(siteUrl: string, basePath: string): string {
  const root = siteUrl.replace(/\/+$/, '');
  if (basePath === '/' || basePath === '') return root;
  const trimmed = basePath.replace(/^\/+|\/+$/g, '');
  return trimmed.length === 0 ? root : `${root}/${trimmed}`;
}

// Rewrites `src="/..."`, `href="/..."`, `srcset` entries, and any other
// attribute whose value is a relative URL into an absolute URL rooted at
// `urlBase`. Leaves already-absolute URLs (`http://`, `https://`, `//`,
// `data:`, `mailto:`, `tel:`, fragment-only `#...`) untouched.
function rewriteHtmlAbsolute(html: string, urlBase: string | undefined): string {
  if (!urlBase || html.length === 0) return html;
  // src / href attributes pointing at a relative URL.
  return html.replace(/(\s(?:src|href|poster|action)=")(\/[^"]*)(")/g, (_m, p1, p2, p3) => {
    if (p2.startsWith('//')) return `${p1}${p2}${p3}`;
    return `${p1}${urlBase}${p2}${p3}`;
  });
}

function serializeSettings(site: SiteData): Record<string, unknown> {
  return {
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
    // SiteData carries `undefined` when no secondary nav is configured (so
    // theme `{{#unless}}` guards work in templates, see #324). The Ghost
    // Content API contract is "always an array, possibly empty", so normalise
    // here to keep API consumers happy.
    secondary_navigation: site.secondary_navigation ?? [],
    // Members-related fields are intentionally hardcoded false / empty:
    // Nectar is static-only and never authenticates members.
    members_enabled: false,
    paid_members_enabled: false,
    members_invite_only: false,
    members_signup_access: 'none',
    recommendations_enabled: site.recommendations_enabled,
    portal_button: false,
    portal_name: false,
    portal_plans: [],
    portal_default_plan: 'free',
    portal_products: [],
  };
}

interface TagUrlContext {
  siteUrl: string | undefined;
  basePath: string;
}

function serializePost(
  post: Post,
  urlBase: string | undefined,
  tagUrlContext: TagUrlContext,
): Record<string, unknown> {
  // Public JSON omits all members-only body content. For non-public posts
  // (visibility != 'public') we strip the paywalled body fields so the
  // static dump cannot be used to bypass a paywall configured upstream.
  // Themes that need the gated preview still consume the rendered HTML
  // pages, which apply the configured `visibility_policy` truncation.
  const isPublic = post.visibility === 'public';
  return {
    id: post.id,
    uuid: post.id,
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
    // `access: 'public'` signals to API consumers that this payload is the
    // public, anonymous-reader view. Restricted posts still appear in the
    // collection (with body stripped above) so client navigation surfaces
    // members-only entries; the `access` field marks the payload itself,
    // not the underlying gating, as public. See docs/api-stability.md.
    access: 'public',
    tags: post.tags.map((tag) => serializeTag(tag, tagUrlContext)),
    primary_tag: post.primary_tag ? serializeTag(post.primary_tag, tagUrlContext) : null,
    authors: post.authors.map((a) => serializeAuthorBare(a)),
    primary_author: post.primary_author ? serializeAuthorBare(post.primary_author) : null,
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
  tagUrlContext: TagUrlContext,
  countPosts = tag.count?.posts ?? 0,
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
    url: serializeTagUrl(tag.url, tagUrlContext),
    count: { ...tag.count, posts: countPosts },
  };
}

function serializeTagUrl(url: string, { siteUrl, basePath }: TagUrlContext): string {
  if (url.length === 0) return url;
  const withSlash = url.endsWith('/') ? url : `${url}/`;
  if (/^https?:/i.test(withSlash)) return withSlash;
  const normalizedBasePath = normalizeApiBasePath(basePath);
  const path = pathHasBasePath(withSlash, normalizedBasePath)
    ? withSlash
    : withBasePath(basePath, withSlash);
  return absoluteUrl(siteUrl, path);
}

function normalizeApiBasePath(basePath: string): string {
  if (basePath === '/' || basePath === '') return '';
  return `/${basePath.replace(/^\/+|\/+$/g, '')}`;
}

function pathHasBasePath(path: string, basePath: string): boolean {
  if (basePath.length === 0) return true;
  return path === `${basePath}/` || path.startsWith(`${basePath}/`);
}

function serializeAuthor(author: Author): Record<string, unknown> {
  return {
    ...serializeAuthorBare(author),
    count: author.count,
  };
}

function serializeAuthorBare(author: Author): Record<string, unknown> {
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

// Re-exported so future tests / docs can inspect the canonical CORS body.
export { buildContentApiHeadersBody as buildCorsHeadersBody } from './headers.ts';

// Exported only for type-completeness on consumers that want to render
// pages alongside posts.
export function serializePage(page: Page, urlBase?: string): Record<string, unknown> {
  return {
    id: page.id,
    uuid: page.id,
    slug: page.slug,
    title: page.title,
    html: rewriteHtmlAbsolute(page.html, urlBase),
    plaintext: page.plaintext,
    excerpt: page.excerpt,
    feature_image: page.feature_image ?? null,
    page: page.page,
    published_at: page.published_at,
    updated_at: page.updated_at,
    created_at: page.created_at,
    reading_time: page.reading_time,
    visibility: page.visibility,
    access: 'public',
    url: page.url,
  };
}
