import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { truncateExcerpt } from './search.ts';

// Meilisearch documents use `id` as the primary key. Allowed characters are
// `a-zA-Z0-9-_`, so the colon-prefixed IDs we use for Algolia (`post:abc`)
// have to be sanitized. We rewrite the colon to `_` and keep the original
// type in a separate field for filtering.
interface MeilisearchDocument {
  id: string;
  url: string;
  title: string;
  content: string;
  type: 'post' | 'page' | 'tag' | 'author';
  tags: string[];
  authors: string[];
  published_at?: string;
}

interface MeilisearchBundle {
  documents: MeilisearchDocument[];
  meta: {
    generated_at: string;
    site_url: string;
    note: string;
  };
}

function sanitizeId(raw: string): string {
  // Meilisearch document IDs accept only [a-zA-Z0-9-_]. Replace anything
  // outside that range with `_` to keep the mapping injective for typical
  // slugs while staying valid for the push API.
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function postDoc(post: Post, excerptWords: number): MeilisearchDocument {
  return {
    id: sanitizeId(`post_${post.id}`),
    url: post.url,
    title: post.title,
    content: truncateExcerpt(post.custom_excerpt ?? post.excerpt, excerptWords),
    type: 'post',
    tags: post.tags.map((t) => t.slug),
    authors: post.authors.map((a) => a.slug),
    published_at: post.published_at,
  };
}

function pageDoc(page: Page, excerptWords: number): MeilisearchDocument {
  return {
    id: sanitizeId(`page_${page.id}`),
    url: page.url,
    title: page.title,
    content: truncateExcerpt(page.custom_excerpt ?? page.excerpt, excerptWords),
    type: 'page',
    tags: [],
    authors: [],
  };
}

function tagDoc(tag: Tag): MeilisearchDocument {
  return {
    id: sanitizeId(`tag_${tag.id}`),
    url: tag.url,
    title: tag.name,
    content: '',
    type: 'tag',
    tags: [],
    authors: [],
  };
}

function authorDoc(author: Author): MeilisearchDocument {
  return {
    id: sanitizeId(`author_${author.id}`),
    url: author.url,
    title: author.name,
    content: '',
    type: 'author',
    tags: [],
    authors: [],
  };
}

export function buildMeilisearchDocuments(opts: {
  config: LaurelConfig;
  content: ContentGraph;
}): MeilisearchBundle {
  const { config, content } = opts;
  const cfg = config.components.search;
  const documents: MeilisearchDocument[] = [];
  for (const post of content.posts) {
    if (post.visibility !== 'public' || post.status !== 'published') continue;
    documents.push(postDoc(post, cfg.excerpt_words));
  }
  if (cfg.include_pages) {
    for (const page of content.pages) {
      if (page.status !== 'published') continue;
      documents.push(pageDoc(page, cfg.excerpt_words));
    }
  }
  if (cfg.include_tags) {
    for (const tag of content.tags) {
      if (tag.visibility !== 'public') continue;
      documents.push(tagDoc(tag));
    }
  }
  if (cfg.include_authors) {
    for (const author of content.authors) {
      documents.push(authorDoc(author));
    }
  }
  return {
    documents,
    meta: {
      generated_at: new Date().toISOString(),
      site_url: config.site.url,
      note: "Meilisearch documents emitted by Laurel. Push with the `meilisearch-js` SDK (or the Meilisearch HTTP API); pushing is the user's responsibility.",
    },
  };
}

export async function emitMeilisearchRecords(opts: {
  config: LaurelConfig;
  content: ContentGraph;
  outputDir: string;
}): Promise<string | null> {
  const { config, content, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (!cfg.emit_meilisearch_records) return null;
  const bundle = buildMeilisearchDocuments({ config, content });
  const dir = join(outputDir, '.laurel');
  await ensureDir(dir);
  const dest = join(dir, 'meilisearch-records.json');
  await writeFile(dest, `${JSON.stringify(bundle)}\n`, 'utf8');
  return dest;
}
