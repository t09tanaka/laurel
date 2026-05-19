import { access, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import slugify from 'slugify';
import TurndownService from 'turndown';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

export type OnConflict = 'skip' | 'overwrite' | 'rename';

export const ON_CONFLICT_VALUES: readonly OnConflict[] = ['skip', 'overwrite', 'rename'];

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
  skipped: number;
  overwritten: number;
  renamed: number;
}

export interface ImportGhostOptions {
  cwd: string;
  file: string;
  onConflict?: OnConflict;
}

export async function importGhostExport(opts: ImportGhostOptions): Promise<ImportSummary> {
  const onConflict: OnConflict = opts.onConflict ?? 'skip';
  const counters = { skipped: 0, overwritten: 0, renamed: 0 };

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
      .map((r) => {
        const t = tagById.get(r.tag_id);
        if (!t) return '';
        return safeSlug(t.slug) || safeSlug(t.name);
      })
      .filter((slug): slug is string => slug.length > 0);

  const authorSlugsForPost = (postId: string): string[] =>
    postsAuthors
      .filter((r) => r.post_id === postId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((r) => {
        const u = userById.get(r.user_id);
        if (!u) return '';
        return safeSlug(u.slug) || safeSlug(u.name);
      })
      .filter((slug): slug is string => slug.length > 0);

  let postCount = 0;
  let pageCount = 0;
  for (const post of posts) {
    if (post.status && post.status !== 'published' && post.status !== 'draft') continue;
    const isPage = post.type === 'page';
    const slug = safeSlug(post.slug) || safeSlug(post.title);
    if (!slug) {
      logger.warn(
        `Skipping post ${post.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(post.slug)} title=${JSON.stringify(post.title)}`,
      );
      continue;
    }
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
    const baseDir = join(opts.cwd, dir);
    const dest = join(baseDir, `${slug}.md`);
    assertWithin(baseDir, dest);
    await ensureDir(baseDir);
    const written = await writeWithConflictPolicy(
      dest,
      `${frontmatter}\n\n${body}\n`,
      onConflict,
      counters,
    );
    if (!written) continue;
    if (isPage) pageCount += 1;
    else postCount += 1;
  }

  let tagCount = 0;
  for (const tag of tags) {
    if (!tag.description && !tag.feature_image && !tag.meta_title) continue;
    const tagSlug = safeSlug(tag.slug) || safeSlug(tag.name);
    if (!tagSlug) {
      logger.warn(
        `Skipping tag ${tag.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(tag.slug)} name=${JSON.stringify(tag.name)}`,
      );
      continue;
    }
    const baseDir = join(opts.cwd, 'content/tags');
    const dest = join(baseDir, `${tagSlug}.md`);
    assertWithin(baseDir, dest);
    await ensureDir(baseDir);
    const frontmatter = buildFrontmatter({
      slug: tagSlug,
      name: tag.name,
      description: tag.description ?? undefined,
      feature_image: tag.feature_image ?? undefined,
      meta_title: tag.meta_title ?? undefined,
      meta_description: tag.meta_description ?? undefined,
    });
    const written = await writeWithConflictPolicy(dest, `${frontmatter}\n`, onConflict, counters);
    if (written) tagCount += 1;
  }

  let authorCount = 0;
  for (const user of users) {
    const userSlug = safeSlug(user.slug) || safeSlug(user.name);
    if (!userSlug) {
      logger.warn(
        `Skipping author ${user.id ?? '(no id)'}: cannot derive a safe slug from slug=${JSON.stringify(user.slug)} name=${JSON.stringify(user.name)}`,
      );
      continue;
    }
    const baseDir = join(opts.cwd, 'content/authors');
    const dest = join(baseDir, `${userSlug}.md`);
    assertWithin(baseDir, dest);
    await ensureDir(baseDir);
    const frontmatter = buildFrontmatter({
      slug: userSlug,
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
    const written = await writeWithConflictPolicy(dest, `${frontmatter}\n`, onConflict, counters);
    if (written) authorCount += 1;
  }

  return {
    posts: postCount,
    pages: pageCount,
    tags: tagCount,
    authors: authorCount,
    skipped: counters.skipped,
    overwritten: counters.overwritten,
    renamed: counters.renamed,
  };
}

async function writeWithConflictPolicy(
  dest: string,
  contents: string,
  onConflict: OnConflict,
  counters: { skipped: number; overwritten: number; renamed: number },
): Promise<boolean> {
  if (!(await pathExists(dest))) {
    await writeFile(dest, contents, 'utf8');
    return true;
  }
  switch (onConflict) {
    case 'skip':
      process.stderr.write(`Skipped (already exists): ${dest}\n`);
      counters.skipped += 1;
      return false;
    case 'overwrite':
      process.stderr.write(`Overwrote: ${dest}\n`);
      await writeFile(dest, contents, 'utf8');
      counters.overwritten += 1;
      return true;
    case 'rename': {
      const renamed = await nextAvailablePath(dest);
      process.stderr.write(`Renamed (conflict with ${dest}): ${renamed}\n`);
      await writeFile(renamed, contents, 'utf8');
      counters.renamed += 1;
      return true;
    }
  }
}

// Re-slugify any string from an untrusted Ghost export so it is safe to use as
// a single path segment. `strict: true` strips path separators, dots, and
// other punctuation that could otherwise enable path traversal (#160).
function safeSlug(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return slugify(input, { lower: true, strict: true });
}

// Defense in depth: even after safeSlug, refuse to write anywhere outside the
// expected base directory. Catches future regressions where a caller forgets
// to sanitize a slug before joining it into a path.
function assertWithin(baseDir: string, candidate: string): void {
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(resolvedBase + sep)) {
    throw new Error(
      `Refusing to write outside target directory: candidate=${resolvedCandidate} base=${resolvedBase}`,
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function nextAvailablePath(dest: string): Promise<string> {
  const ext = extname(dest);
  const base = ext ? dest.slice(0, -ext.length) : dest;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Could not find a non-conflicting filename for ${dest} after many attempts`);
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
