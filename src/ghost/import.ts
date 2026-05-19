import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import slugify from 'slugify';
import TurndownService from 'turndown';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

interface GhostExport {
  db: Array<{
    data: {
      posts?: GhostPost[];
      tags?: GhostTag[];
      users?: GhostUser[];
      posts_tags?: Array<{ post_id: string; tag_id: string; sort_order?: number }>;
      posts_authors?: Array<{ post_id: string; user_id: string; sort_order?: number }>;
    };
  }>;
}

interface GhostPost {
  id: string;
  uuid?: string;
  title: string;
  slug: string;
  html?: string | null;
  mobiledoc?: string | null;
  lexical?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  featured?: boolean | 0 | 1;
  type?: 'post' | 'page';
  status?: string;
  visibility?: 'public' | 'members' | 'paid';
  custom_excerpt?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;
  canonical_url?: string | null;
  codeinjection_head?: string | null;
  codeinjection_foot?: string | null;
}

interface GhostTag {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  feature_image?: string | null;
  visibility?: string;
  meta_title?: string | null;
  meta_description?: string | null;
}

interface GhostUser {
  id: string;
  slug: string;
  name: string;
  bio?: string | null;
  profile_image?: string | null;
  cover_image?: string | null;
  website?: string | null;
  location?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
}

export interface ImportSummary {
  posts: number;
  pages: number;
  tags: number;
  authors: number;
}

export async function importGhostExport(opts: {
  cwd: string;
  file: string;
}): Promise<ImportSummary> {
  const raw = await readFile(opts.file, 'utf8');
  const parsed = JSON.parse(raw) as GhostExport;
  const data = parsed.db?.[0]?.data;
  if (!data) {
    throw new Error('Invalid Ghost export: db[0].data missing');
  }

  const posts = data.posts ?? [];
  const tags = data.tags ?? [];
  const users = data.users ?? [];
  const postsTags = data.posts_tags ?? [];
  const postsAuthors = data.posts_authors ?? [];

  const tagById = new Map(tags.map((t) => [t.id, t]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const tagSlugsForPost = (postId: string): string[] =>
    postsTags
      .filter((r) => r.post_id === postId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((r) => tagById.get(r.tag_id)?.slug)
      .filter((slug): slug is string => Boolean(slug));

  const authorSlugsForPost = (postId: string): string[] =>
    postsAuthors
      .filter((r) => r.post_id === postId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((r) => userById.get(r.user_id)?.slug)
      .filter((slug): slug is string => Boolean(slug));

  let postCount = 0;
  let pageCount = 0;
  for (const post of posts) {
    if (post.status && post.status !== 'published' && post.status !== 'draft') continue;
    const isPage = post.type === 'page';
    const slug = post.slug || slugify(post.title, { lower: true, strict: true });
    const dir = isPage ? 'content/pages' : 'content/posts';
    const body = renderPostBody(post);
    const frontmatter = buildFrontmatter({
      slug,
      title: post.title,
      date: post.published_at ?? post.created_at ?? undefined,
      updated_at: post.updated_at ?? undefined,
      featured: !!post.featured,
      feature_image: post.feature_image ?? undefined,
      feature_image_alt: post.feature_image_alt ?? undefined,
      feature_image_caption: post.feature_image_caption ?? undefined,
      visibility: post.visibility ?? 'public',
      status: post.status ?? 'published',
      tags: tagSlugsForPost(post.id),
      authors: authorSlugsForPost(post.id),
      custom_excerpt: post.custom_excerpt ?? undefined,
      meta_title: post.meta_title ?? undefined,
      meta_description: post.meta_description ?? undefined,
      og_title: post.og_title ?? undefined,
      og_description: post.og_description ?? undefined,
      og_image: post.og_image ?? undefined,
      twitter_title: post.twitter_title ?? undefined,
      twitter_description: post.twitter_description ?? undefined,
      twitter_image: post.twitter_image ?? undefined,
      canonical_url: post.canonical_url ?? undefined,
      codeinjection_head: post.codeinjection_head ?? undefined,
      codeinjection_foot: post.codeinjection_foot ?? undefined,
    });
    const dest = join(opts.cwd, dir, `${slug}.md`);
    await ensureDir(join(opts.cwd, dir));
    await writeFile(dest, `${frontmatter}\n\n${body}\n`, 'utf8');
    if (isPage) pageCount += 1;
    else postCount += 1;
  }

  let tagCount = 0;
  for (const tag of tags) {
    if (!tag.description && !tag.feature_image && !tag.meta_title) continue;
    const dest = join(opts.cwd, 'content/tags', `${tag.slug}.md`);
    await ensureDir(join(opts.cwd, 'content/tags'));
    const frontmatter = buildFrontmatter({
      slug: tag.slug,
      name: tag.name,
      description: tag.description ?? undefined,
      feature_image: tag.feature_image ?? undefined,
      meta_title: tag.meta_title ?? undefined,
      meta_description: tag.meta_description ?? undefined,
    });
    await writeFile(dest, `${frontmatter}\n`, 'utf8');
    tagCount += 1;
  }

  let authorCount = 0;
  for (const user of users) {
    const dest = join(opts.cwd, 'content/authors', `${user.slug}.md`);
    await ensureDir(join(opts.cwd, 'content/authors'));
    const frontmatter = buildFrontmatter({
      slug: user.slug,
      name: user.name,
      bio: user.bio ?? undefined,
      profile_image: user.profile_image ?? undefined,
      cover_image: user.cover_image ?? undefined,
      website: user.website ?? undefined,
      location: user.location ?? undefined,
      twitter: user.twitter ?? undefined,
      facebook: user.facebook ?? undefined,
      meta_title: user.meta_title ?? undefined,
      meta_description: user.meta_description ?? undefined,
    });
    await writeFile(dest, `${frontmatter}\n`, 'utf8');
    authorCount += 1;
  }

  return { posts: postCount, pages: pageCount, tags: tagCount, authors: authorCount };
}

function renderPostBody(post: GhostPost): string {
  if (post.html?.trim()) {
    return turndown.turndown(post.html);
  }
  if (post.lexical || post.mobiledoc) {
    logger.warn(
      `Post ${post.slug}: Mobiledoc/Lexical body not yet supported, skipping body. Use 'Export with HTML' from Ghost.`,
    );
  }
  return '';
}

function buildFrontmatter(data: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}
