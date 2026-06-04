import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { truncateExcerpt } from './search.ts';

// Algolia record shape. `objectID` is Algolia's required primary key; the
// remaining fields are a flat blog-oriented set users can map onto whichever
// index attributes they prefer. We do NOT emit DocSearch's `hierarchy.lvlN`
// shape here — DocSearch's crawler builds that, and forcing it on every
// record would mis-shape generic Algolia indices. See `emitDocSearchCss`
// for the DocSearch-compatible CSS classes promised by the task.
interface AlgoliaRecord {
  objectID: string;
  url: string;
  title: string;
  content: string;
  type: 'post' | 'page' | 'tag' | 'author';
  tags: string[];
  authors: string[];
  published_at?: string;
}

interface AlgoliaBundle {
  records: AlgoliaRecord[];
  meta: {
    generated_at: string;
    site_url: string;
    note: string;
  };
}

function postRecord(post: Post, excerptWords: number): AlgoliaRecord {
  return {
    objectID: `post:${post.id}`,
    url: post.url,
    title: post.title,
    content: truncateExcerpt(post.custom_excerpt ?? post.excerpt, excerptWords),
    type: 'post',
    tags: post.tags.map((t) => t.slug),
    authors: post.authors.map((a) => a.slug),
    published_at: post.published_at,
  };
}

function pageRecord(page: Page, excerptWords: number): AlgoliaRecord {
  return {
    objectID: `page:${page.id}`,
    url: page.url,
    title: page.title,
    content: truncateExcerpt(page.custom_excerpt ?? page.excerpt, excerptWords),
    type: 'page',
    tags: [],
    authors: [],
  };
}

function tagRecord(tag: Tag): AlgoliaRecord {
  return {
    objectID: `tag:${tag.id}`,
    url: tag.url,
    title: tag.name,
    content: '',
    type: 'tag',
    tags: [],
    authors: [],
  };
}

function authorRecord(author: Author): AlgoliaRecord {
  return {
    objectID: `author:${author.id}`,
    url: author.url,
    title: author.name,
    content: '',
    type: 'author',
    tags: [],
    authors: [],
  };
}

export function buildAlgoliaRecords(opts: {
  config: LaurelConfig;
  content: ContentGraph;
}): AlgoliaBundle {
  const { config, content } = opts;
  const cfg = config.components.search;
  const records: AlgoliaRecord[] = [];
  for (const post of content.posts) {
    if (post.visibility !== 'public' || post.status !== 'published') continue;
    records.push(postRecord(post, cfg.excerpt_words));
  }
  if (cfg.include_pages) {
    for (const page of content.pages) {
      if (page.status !== 'published') continue;
      records.push(pageRecord(page, cfg.excerpt_words));
    }
  }
  if (cfg.include_tags) {
    for (const tag of content.tags) {
      if (tag.visibility !== 'public') continue;
      records.push(tagRecord(tag));
    }
  }
  if (cfg.include_authors) {
    for (const author of content.authors) {
      records.push(authorRecord(author));
    }
  }
  return {
    records,
    meta: {
      generated_at: new Date().toISOString(),
      site_url: config.site.url,
      note: "Algolia records emitted by Laurel. Push with the `algoliasearch` CLI or SDK; pushing is the user's responsibility.",
    },
  };
}

export async function emitAlgoliaRecords(opts: {
  config: LaurelConfig;
  content: ContentGraph;
  outputDir: string;
}): Promise<string | null> {
  const { config, content, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (!cfg.emit_algolia_records) return null;
  const bundle = buildAlgoliaRecords({ config, content });
  const dir = join(outputDir, '.laurel');
  await ensureDir(dir);
  const dest = join(dir, 'algolia-records.json');
  await writeFile(dest, `${JSON.stringify(bundle)}\n`, 'utf8');
  return dest;
}

// DocSearch's widget renders its result list with a fixed set of class names
// (`.DocSearch`, `.DocSearch-Hit`, `.DocSearch-Hit-source`, …). Theming is
// driven by CSS custom properties under `:root`. We ship a starter stylesheet
// at `search/algolia-docsearch.css` so themes can drop in the DocSearch
// widget and have it match the site's accent without writing the full
// custom-property block themselves. Users can override any variable in
// their own stylesheet loaded after this one.
function docSearchCss(accent: string): string {
  return `:root {
  --docsearch-primary-color: ${accent};
  --docsearch-text-color: #1c1e21;
  --docsearch-muted-color: #6c757d;
  --docsearch-container-background: rgba(101, 108, 133, 0.8);
  --docsearch-modal-background: #f5f6f7;
  --docsearch-searchbox-background: #ebedf0;
  --docsearch-searchbox-focus-background: #fff;
  --docsearch-hit-color: #444950;
  --docsearch-hit-active-color: #fff;
  --docsearch-hit-background: #fff;
  --docsearch-highlight-color: ${accent};
  --docsearch-key-gradient: linear-gradient(-225deg, #d5dbe4, #f8f8f8);
  --docsearch-key-shadow: inset 0 -2px 0 0 #cdcde6, inset 0 0 1px 1px #fff, 0 1px 2px 1px rgba(30, 35, 90, 0.4);
  --docsearch-footer-background: #fff;
  --docsearch-footer-shadow: 0 -1px 0 0 #e0e3e8, 0 -3px 6px 0 rgba(69, 98, 155, 0.12);
}

/* Class-name hooks used by DocSearch (https://docsearch.algolia.com). These
   selectors are intentionally low-specificity so theme CSS loaded after this
   file can override them without !important. */
.DocSearch-Button { display: inline-flex; align-items: center; }
.DocSearch-Hit-source { color: var(--docsearch-primary-color); }
.DocSearch-Hit[aria-selected="true"] mark { color: var(--docsearch-hit-active-color); }
`;
}

export async function emitDocSearchCss(opts: {
  config: LaurelConfig;
  outputDir: string;
}): Promise<string | null> {
  const { config, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (!cfg.emit_algolia_records) return null;
  const dir = join(outputDir, 'search');
  await ensureDir(dir);
  const dest = join(dir, 'algolia-docsearch.css');
  await writeFile(dest, docSearchCss(config.site.accent_color), 'utf8');
  return dest;
}
