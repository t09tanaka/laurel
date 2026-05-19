import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

export interface SearchEntryPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;
  tags: string[];
  authors: string[];
  published_at: string;
}

export interface SearchEntryPage {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;
}

export interface SearchEntryTag {
  id: string;
  slug: string;
  name: string;
  url: string;
}

export interface SearchEntryAuthor {
  id: string;
  slug: string;
  name: string;
  url: string;
}

export interface SearchIndex {
  posts: SearchEntryPost[];
  pages: SearchEntryPage[];
  tags: SearchEntryTag[];
  authors: SearchEntryAuthor[];
  meta: {
    generated_at: string;
    site_url: string;
    note: string;
  };
}

// Truncate a paragraph at a word boundary. The frontmatter `excerpt` already
// caps content at the configured paywall, but raw post excerpts can still be
// hundreds of words for posts without a `custom_excerpt`. Keep search.json
// small so a 500-post site still ships under a few hundred KB and stays
// practical to fetch over a single request from a fuzzy-search client.
export function truncateExcerpt(text: string, words: number): string {
  if (words <= 0) return '';
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= words) return trimmed;
  return `${tokens.slice(0, words).join(' ')}…`;
}

function buildPostEntry(post: Post, excerptWords: number): SearchEntryPost {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: truncateExcerpt(post.custom_excerpt ?? post.excerpt, excerptWords),
    url: post.url,
    tags: post.tags.map((t) => t.slug),
    authors: post.authors.map((a) => a.slug),
    published_at: post.published_at,
  };
}

function buildPageEntry(page: Page, excerptWords: number): SearchEntryPage {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    excerpt: truncateExcerpt(page.custom_excerpt ?? page.excerpt, excerptWords),
    url: page.url,
  };
}

function buildTagEntry(tag: Tag): SearchEntryTag {
  return {
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    url: tag.url,
  };
}

function buildAuthorEntry(author: Author): SearchEntryAuthor {
  return {
    id: author.id,
    slug: author.slug,
    name: author.name,
    url: author.url,
  };
}

export function buildSearchIndex(opts: {
  config: NectarConfig;
  content: ContentGraph;
}): SearchIndex {
  const { config, content } = opts;
  const cfg = config.components.search;
  const posts = content.posts
    .filter((p) => p.visibility === 'public' && p.status === 'published')
    .map((p) => buildPostEntry(p, cfg.excerpt_words));
  const pages = cfg.include_pages
    ? content.pages
        .filter((p) => p.status === 'published')
        .map((p) => buildPageEntry(p, cfg.excerpt_words))
    : [];
  const tags = cfg.include_tags
    ? content.tags.filter((t) => t.visibility === 'public').map(buildTagEntry)
    : [];
  const authors = cfg.include_authors ? content.authors.map(buildAuthorEntry) : [];

  return {
    posts,
    pages,
    tags,
    authors,
    meta: {
      generated_at: new Date().toISOString(),
      site_url: config.site.url,
      note: "Nectar emits search.json as a flat fuzzy-search index. This is NOT Ghost's /search/ API; the field set is divergent and the endpoint shape is not replicated. Wire it to lunr / Fuse / minisearch on the client.",
    },
  };
}

export async function emitSearchJson(opts: {
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
}): Promise<string | null> {
  const { config, content, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (cfg.engine !== 'json' && cfg.engine !== 'json+pagefind' && cfg.engine !== 'json+lunr')
    return null;
  const index = buildSearchIndex({ config, content });
  const dest = join(outputDir, 'content', 'search.json');
  await ensureDir(join(outputDir, 'content'));
  await writeFile(dest, `${JSON.stringify(index)}\n`, 'utf8');
  return dest;
}

export async function runPagefind(opts: {
  config: NectarConfig;
  outputDir: string;
}): Promise<boolean> {
  const { config, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return false;
  if (cfg.engine !== 'pagefind' && cfg.engine !== 'json+pagefind') return false;

  const bin = cfg.pagefind_bin ?? 'pagefind';
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([bin, '--site', outputDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    logger.warn(
      `Pagefind index skipped: \`${bin}\` is not installed or not on PATH (${err instanceof Error ? err.message : String(err)}). Install Pagefind (https://pagefind.app/docs/installation/) or set [components.search].pagefind_bin to the binary path.`,
    );
    return false;
  }
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderrText = await new Response(proc.stderr).text();
    logger.warn(
      `Pagefind exited with code ${proc.exitCode}${stderrText ? `: ${stderrText.trim()}` : ''}. The pagefind/ output may be missing or partial.`,
    );
    return false;
  }
  return true;
}
