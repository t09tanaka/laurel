import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';
import { renderSearchShim } from '~/search/runtime.ts';
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

// Starter stylesheet for the default `{{> search}}` partial. Emitted as a
// sibling of the lunr widget at `search/search.css` so themes can opt in with
// a single `<link rel="stylesheet" href="/search/search.css">`. Selectors are
// kept low-specificity so site CSS loaded after this file can override them
// without `!important`. Themes that prefer their own styling can skip the
// link. Issue #1135.
function searchUiCss(accent: string): string {
  return `:root {
  --nectar-search-accent: ${accent};
  --nectar-search-border: #d1d5db;
  --nectar-search-text: #1f2937;
  --nectar-search-muted: #6b7280;
  --nectar-search-bg: #ffffff;
  --nectar-search-hover-bg: #f3f4f6;
}

.nectar-search { position: relative; margin: 1rem 0; }
.nectar-search__label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  color: var(--nectar-search-muted);
}
.nectar-search__input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.75rem;
  font: inherit;
  color: var(--nectar-search-text);
  background: var(--nectar-search-bg);
  border: 1px solid var(--nectar-search-border);
  border-radius: 6px;
}
.nectar-search__input:focus {
  outline: none;
  border-color: var(--nectar-search-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nectar-search-accent) 25%, transparent);
}
.nectar-search__results {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  background: var(--nectar-search-bg);
  border: 1px solid var(--nectar-search-border);
  border-radius: 6px;
  overflow: hidden;
}
.nectar-search__results:empty { display: none; }
.nectar-search__results li {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--nectar-search-border);
}
.nectar-search__results li:last-child { border-bottom: 0; }
.nectar-search__results li:hover { background: var(--nectar-search-hover-bg); }
.nectar-search__results a {
  display: block;
  font-weight: 600;
  color: var(--nectar-search-text);
  text-decoration: none;
}
.nectar-search__results a:hover { color: var(--nectar-search-accent); }
.nectar-search__results p {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--nectar-search-muted);
}
`;
}

export async function emitSearchUiCss(opts: {
  config: NectarConfig;
  outputDir: string;
}): Promise<string | null> {
  const { config, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  const dir = join(outputDir, 'search');
  await ensureDir(dir);
  const dest = join(dir, 'search.css');
  await writeFile(dest, searchUiCss(config.site.accent_color), 'utf8');
  return dest;
}

// Emit the client-side runtime shim that wires `[data-ghost-search]` triggers
// (and cmd+K / ctrl+K) into a Pagefind modal. Only emitted when the configured
// engine actually produces a Pagefind index (`pagefind` or `json+pagefind`);
// for other engines the shim would 404 on its `/pagefind/pagefind-ui.js`
// import, so we skip emission entirely. See #553/#554/#556.
export async function emitSearchShim(opts: {
  config: NectarConfig;
  outputDir: string;
}): Promise<string | null> {
  const { config, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (cfg.engine !== 'pagefind' && cfg.engine !== 'json+pagefind') return null;
  const dir = join(outputDir, 'search');
  await ensureDir(dir);
  const dest = join(dir, 'ghost-search.js');
  const js = renderSearchShim({ basePath: config.build.base_path });
  await writeFile(dest, js, 'utf8');
  return dest;
}

// Inject a tiny `<script defer src="/search/ghost-search.js">` into rendered
// HTML so Ghost themes that ship `[data-ghost-search]` buttons get a working
// Pagefind modal without theme edits. We post-process the rendered HTML
// rather than touching `ghost_head` because the helper is shared territory
// with other in-flight work and we want to keep this change scoped to
// search-specific code paths.
export function injectSearchShimScript(html: string, basePath: string, cspNonce?: string): string {
  // Don't inject twice on the same document. The marker attribute also makes
  // the side-effect visible to manual inspection.
  if (html.includes('data-nectar-search-shim')) return html;
  // Only inject if the HTML actually references a Ghost search trigger;
  // pages without any `data-ghost-search` element don't need the runtime.
  if (!/data-ghost-search\b/i.test(html)) return html;
  const headCloseMatch = /<\/head\s*>/i.exec(html);
  if (!headCloseMatch) return html;
  const normalized = basePath && basePath !== '/' ? basePath : '/';
  const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
  const src = `${prefix}search/ghost-search.js`;
  const nonce = cspNonce ? ` nonce="${cspNonce}"` : '';
  const tag = `<script defer src="${src}" data-nectar-search-shim${nonce}></script>`;
  const insertAt = headCloseMatch.index;
  return `${html.slice(0, insertAt)}${tag}${html.slice(insertAt)}`;
}

// Inject `<meta name="pagefind-skip">` into the <head> of HTML rendered for a
// non-public post (visibility ∈ {members, paid, internal}). Pagefind's
// crawler honours this meta as a signal to drop the page from the index, so
// members-only and paid posts stay out of the public search bundle even
// though the static HTML is still emitted to disk (themes may render
// teaser/locked variants). Issue #555.
//
// Implemented as a post-render HTML rewrite (rather than via `ghost_head`)
// to keep this PR scoped to search-specific files — `ghost_head.ts` is held
// open by other in-flight work.
export function injectPagefindSkipMeta(html: string): string {
  if (html.includes('name="pagefind-skip"') || html.includes("name='pagefind-skip'")) {
    return html;
  }
  const headOpenMatch = /<head\b[^>]*>/i.exec(html);
  if (!headOpenMatch) return html;
  const insertAt = headOpenMatch.index + headOpenMatch[0].length;
  const tag = `<meta name="pagefind-skip">`;
  return `${html.slice(0, insertAt)}${tag}${html.slice(insertAt)}`;
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
