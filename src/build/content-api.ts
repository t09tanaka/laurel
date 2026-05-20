import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';

// Static dump of Ghost Content API-shaped JSON under `dist/content/` so a
// browser-only consumer can `fetch('/content/posts.json')` and treat the
// response like a Content API page. This is a stub: pagination is fixed at
// page 1 with all items in one shard. The CORS `_headers` (Netlify) and
// `_headers.cf` (Cloudflare Pages) twin files announce that `/content/*`
// is safe to read cross-origin. Pagination shards live in a separate task.

export interface EmitContentApiStubsOptions {
  content: ContentGraph;
  outputDir: string;
}

const CORS_HEADERS_BODY = [
  '/content/*',
  '  Access-Control-Allow-Origin: *',
  '  Access-Control-Allow-Methods: GET, HEAD, OPTIONS',
  '  Access-Control-Allow-Headers: Content-Type, Authorization',
  '  Cache-Control: public, max-age=300',
  '',
].join('\n');

export async function emitContentApiStubs(opts: EmitContentApiStubsOptions): Promise<void> {
  const { content, outputDir } = opts;

  await Promise.all([
    writePostsDump(outputDir, content.posts),
    writeSettingsDump(outputDir, content.site),
    writeCorsHeaders(outputDir, '_headers'),
    writeCorsHeaders(outputDir, '_headers.cf'),
  ]);
}

async function writePostsDump(outputDir: string, posts: Post[]): Promise<void> {
  const published = posts.filter((p) => p.status === 'published');
  const body = {
    posts: published.map(serializePost),
    meta: {
      pagination: {
        page: 1,
        limit: published.length,
        pages: 1,
        total: published.length,
        next: null,
        prev: null,
      },
    },
  };
  const dest = join(outputDir, 'content', 'posts.json');
  await ensureDir(join(outputDir, 'content'));
  await writeFile(dest, `${JSON.stringify(body)}\n`, 'utf8');
}

async function writeSettingsDump(outputDir: string, site: SiteData): Promise<void> {
  const body = { settings: serializeSettings(site) };
  const dest = join(outputDir, 'content', 'settings.json');
  await ensureDir(join(outputDir, 'content'));
  await writeFile(dest, `${JSON.stringify(body)}\n`, 'utf8');
}

// Append CORS rule to an existing `_headers` (or `_headers.cf`) if the
// deploy emitter already wrote one. The catch-all `/*` rule in those files
// is more specific than `/content/*` is for our use case, so we PREpend the
// CORS rule with a blank-line separator so first-match platforms pick it up
// for `/content/*` requests before falling through to defaults.
async function writeCorsHeaders(outputDir: string, filename: string): Promise<void> {
  const dest = join(outputDir, filename);
  await ensureDir(outputDir);
  let existing = '';
  try {
    existing = await readFile(dest, 'utf8');
  } catch {
    // No pre-existing file: write CORS rule alone.
  }
  if (existing.length === 0) {
    await writeFile(dest, CORS_HEADERS_BODY, 'utf8');
    return;
  }
  if (existing.includes('/content/*')) {
    // Already merged on a previous build run; leave it as-is.
    return;
  }
  const trimmed = existing.endsWith('\n') ? existing : `${existing}\n`;
  await writeFile(dest, `${CORS_HEADERS_BODY}\n${trimmed}`, 'utf8');
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

// Re-exported so future tests / docs can inspect the canonical CORS body.
export const CORS_HEADERS_TEXT = CORS_HEADERS_BODY;

// Exported only for type-completeness on consumers that want to render
// pages alongside posts. Currently unused by the stub emitter.
export function serializePage(page: Page): Record<string, unknown> {
  return {
    id: page.id,
    uuid: page.id,
    slug: page.slug,
    title: page.title,
    html: page.html,
    plaintext: page.plaintext,
    excerpt: page.excerpt,
    feature_image: page.feature_image ?? null,
    page: page.page,
    published_at: page.published_at,
    updated_at: page.updated_at,
    created_at: page.created_at,
    reading_time: page.reading_time,
    visibility: page.visibility,
    url: page.url,
  };
}
