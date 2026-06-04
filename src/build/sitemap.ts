import type { LaurelConfig } from '~/config/schema.ts';
import { type TextStreamWriter, writeTextAndGzipStreams } from './emit.ts';
import { escapeXmlText } from './escaping.ts';
import {
  type FeedManifestMap,
  computeFeedHash,
  recordFeedManifest,
  shouldSkipFeedWrite,
} from './feed-cache.ts';
import { absoluteContentUrl, absoluteUrl } from './url.ts';

export type SitemapKind = 'posts' | 'pages' | 'tags' | 'authors';

export type SitemapChangefreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface SitemapEntry {
  url: string;
  lastmod?: string | undefined;
  kind?: SitemapKind | undefined;
  changefreq?: SitemapChangefreq | undefined;
  priority?: number | undefined;
  images?: SitemapImage[] | undefined;
}

export interface SitemapImage {
  url: string;
  caption?: string | undefined;
}

// Sitemap protocol caps each file at 50,000 URLs and 50 MiB uncompressed.
// We always split per Ghost's scheme (sitemap-posts.xml, sitemap-pages.xml,
// sitemap-tags.xml, sitemap-authors.xml) regardless of size; sitemap.xml is
// always the <sitemapindex> entry point so crawlers (and Search Console
// submissions) see the same shape Ghost emits. When a kind exceeds the URL
// cap we split it further into sitemap-<kind>-2.xml, sitemap-<kind>-3.xml,
// ...; the index references every page.
export const SITEMAP_MAX_URLS_PER_FILE = 50_000;

// The four Ghost sub-sitemap kinds, in the order they appear in the index.
// Order is load-bearing for stable golden snapshots: keep posts→pages→tags→authors.
const SITEMAP_KINDS: readonly SitemapKind[] = ['posts', 'pages', 'tags', 'authors'];

const SITEMAP_KIND_DEFAULTS: Record<
  SitemapKind,
  { changefreq: SitemapChangefreq; priority: number }
> = {
  // Per the integration spec, posts win the highest of the four buckets so
  // crawlers prioritise fresh article URLs; pages/tags/authors all sit at 0.6.
  posts: { changefreq: 'weekly', priority: 0.7 },
  pages: { changefreq: 'weekly', priority: 0.6 },
  tags: { changefreq: 'daily', priority: 0.6 },
  authors: { changefreq: 'daily', priority: 0.6 },
};

// Used for entries that arrive without a kind (e.g. ad-hoc callers that
// don't classify URLs). Keeps changefreq/priority deterministic instead of
// silently dropping them from the XML.
const SITEMAP_UNCLASSIFIED_DEFAULT = { changefreq: 'monthly', priority: 0.5 } as const;

export async function emitSitemap(opts: {
  config: LaurelConfig;
  outputDir: string;
  urls: SitemapEntry[];
  previousFeeds?: FeedManifestMap | undefined;
  nextFeeds?: FeedManifestMap | undefined;
}): Promise<void> {
  // Always emit Ghost's 5-file shape: sitemap.xml (sitemapindex) +
  // sitemap-{posts,pages,tags,authors}.xml, with -2.xml / -3.xml ... when
  // any one kind overflows the 50k cap.
  const buckets = bucketSitemapEntriesByKind(opts.urls);
  const indexEntries: { loc: string; lastmod: string | undefined }[] = [];

  for (const kind of SITEMAP_KINDS) {
    const entries = buckets.get(kind) ?? [];
    // We always emit at least sitemap-<kind>.xml (even when empty) so the
    // four Ghost endpoints exist on every deploy and external consumers
    // (e.g. Search Console "submit sitemap" forms) don't 404 mid-launch.
    const pages = entries.length === 0 ? [[]] : chunkEntries(entries, SITEMAP_MAX_URLS_PER_FILE);
    for (let i = 0; i < pages.length; i++) {
      const filename = sitemapKindFilename(kind, i + 1);
      const pageEntries = pages[i] ?? [];
      await writeSitemapUrlsetWithCache({
        outputDir: opts.outputDir,
        filename,
        config: opts.config,
        entries: pageEntries,
        previousFeeds: opts.previousFeeds,
        nextFeeds: opts.nextFeeds,
      });
      indexEntries.push({
        loc: absoluteUrl(filename, opts.config),
        lastmod: latestLastmodIso(pageEntries),
      });
    }
  }

  await writeSitemapIndexWithCache({
    outputDir: opts.outputDir,
    filename: 'sitemap.xml',
    entries: indexEntries,
    config: opts.config,
    previousFeeds: opts.previousFeeds,
    nextFeeds: opts.nextFeeds,
  });
}

async function writeSitemapUrlsetWithCache(opts: {
  outputDir: string;
  filename: string;
  config: LaurelConfig;
  entries: SitemapEntry[];
  previousFeeds?: FeedManifestMap | undefined;
  nextFeeds?: FeedManifestMap | undefined;
}): Promise<void> {
  const hash = computeFeedHash({
    type: 'sitemap-urlset',
    filename: opts.filename,
    config: sitemapHashConfig(opts.config),
    entries: opts.entries,
  });
  const key = `sitemap:${opts.filename}`;
  recordFeedManifest(opts.nextFeeds, key, { hash, outputPath: opts.filename });
  if (
    await shouldSkipFeedWrite({
      outputDir: opts.outputDir,
      outputPath: opts.filename,
      hash,
      previousFeeds: opts.previousFeeds,
      key,
      companions: [`${opts.filename}.gz`],
    })
  ) {
    return;
  }
  await writeTextAndGzipStreams(opts.outputDir, opts.filename, (writer) =>
    writeSitemapUrlset(writer, opts.entries, opts.config),
  );
}

async function writeSitemapIndexWithCache(opts: {
  outputDir: string;
  filename: string;
  entries: { loc: string; lastmod: string | undefined }[];
  config: LaurelConfig;
  previousFeeds?: FeedManifestMap | undefined;
  nextFeeds?: FeedManifestMap | undefined;
}): Promise<void> {
  const hash = computeFeedHash({
    type: 'sitemap-index',
    filename: opts.filename,
    config: sitemapHashConfig(opts.config),
    entries: opts.entries,
  });
  const key = `sitemap:${opts.filename}`;
  recordFeedManifest(opts.nextFeeds, key, { hash, outputPath: opts.filename });
  if (
    await shouldSkipFeedWrite({
      outputDir: opts.outputDir,
      outputPath: opts.filename,
      hash,
      previousFeeds: opts.previousFeeds,
      key,
      companions: [`${opts.filename}.gz`],
    })
  ) {
    return;
  }
  await writeTextAndGzipStreams(opts.outputDir, opts.filename, (writer) =>
    writeSitemapIndex(writer, opts.entries),
  );
}

async function writeSitemapUrlset(
  writer: TextStreamWriter,
  entries: SitemapEntry[],
  config: LaurelConfig,
): Promise<void> {
  const hasImages = entries.some((entry) =>
    (entry.images ?? []).some((image) => normalizeSitemapImageUrl(image.url, config)),
  );
  await writeSitemapDocumentOpen(writer, 'urlset', { imageNamespace: hasImages });
  for (const entry of entries) {
    const defaults = entry.kind ? SITEMAP_KIND_DEFAULTS[entry.kind] : SITEMAP_UNCLASSIFIED_DEFAULT;
    const changefreq = entry.changefreq ?? defaults.changefreq;
    const priority = entry.priority ?? defaults.priority;
    const loc = `<loc>${escapeXmlText(absoluteUrl(entry.url, config))}</loc>`;
    const images = renderSitemapImages(entry.images ?? [], config);
    const lastmod = entry.lastmod
      ? `<lastmod>${escapeXmlText(formatLastmod(entry.lastmod))}</lastmod>`
      : '';
    const cf = `<changefreq>${changefreq}</changefreq>`;
    const pr = `<priority>${formatSitemapPriority(priority)}</priority>`;
    await writer.write(
      `${formatXmlBlock('url', [loc, ...images, lastmod, cf, pr].filter(Boolean))}\n`,
    );
  }
  await writeSitemapDocumentClose(writer, 'urlset');
}

async function writeSitemapIndex(
  writer: TextStreamWriter,
  entries: { loc: string; lastmod: string | undefined }[],
): Promise<void> {
  await writeSitemapDocumentOpen(writer, 'sitemapindex');
  for (const e of entries) {
    const loc = `<loc>${escapeXmlText(e.loc)}</loc>`;
    const lastmod = e.lastmod ? `<lastmod>${escapeXmlText(e.lastmod)}</lastmod>` : '';
    await writer.write(`${formatXmlBlock('sitemap', [loc, lastmod].filter(Boolean))}\n`);
  }
  await writeSitemapDocumentClose(writer, 'sitemapindex');
}

function renderSitemapImages(images: SitemapImage[], config: LaurelConfig): string[] {
  const blocks: string[] = [];
  for (const image of images) {
    const loc = normalizeSitemapImageUrl(image.url, config);
    if (!loc) continue;
    const children = [`<image:loc>${escapeXmlText(loc)}</image:loc>`];
    const caption = normalizeSitemapImageCaption(image.caption);
    if (caption) {
      children.push(`<image:caption>${escapeXmlText(caption)}</image:caption>`);
    }
    blocks.push(formatXmlBlock('image:image', children));
  }
  return blocks;
}

function normalizeSitemapImageUrl(url: string, config: LaurelConfig): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return undefined;
  return absoluteContentUrl(trimmed, config);
}

function normalizeSitemapImageCaption(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const stripped = value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || undefined;
}

async function writeSitemapDocumentOpen(
  writer: TextStreamWriter,
  root: 'urlset' | 'sitemapindex',
  opts: { imageNamespace?: boolean } = {},
): Promise<void> {
  const namespaces = ['xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'];
  if (opts.imageNamespace) {
    namespaces.push('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
  }
  const open = `<${root} ${namespaces.join(' ')}>`;
  await writer.write(`<?xml version="1.0" encoding="UTF-8"?>\n${open}\n`);
}

async function writeSitemapDocumentClose(
  writer: TextStreamWriter,
  root: 'urlset' | 'sitemapindex',
): Promise<void> {
  await writer.write(`</${root}>\n`);
}

function formatXmlBlock(name: 'url' | 'sitemap' | 'image:image', children: string[]): string {
  const lines = [`  <${name}>`];
  for (const child of children) {
    for (const line of child.split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  lines.push(`  </${name}>`);
  return lines.join('\n');
}

function bucketSitemapEntriesByKind(urls: SitemapEntry[]): Map<SitemapKind, SitemapEntry[]> {
  const buckets = new Map<SitemapKind, SitemapEntry[]>([
    ['posts', []],
    ['pages', []],
    ['tags', []],
    ['authors', []],
  ]);
  for (const entry of urls) {
    // Unclassified entries (no kind) fall into 'pages' — most ad-hoc URLs
    // (home, custom routes) are page-like and Ghost's sitemap-pages bucket
    // is the natural catch-all.
    const kind: SitemapKind = entry.kind ?? 'pages';
    buckets.get(kind)?.push(entry);
  }
  return buckets;
}

function chunkEntries<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sitemapKindFilename(kind: SitemapKind, page: number): string {
  return page === 1 ? `sitemap-${kind}.xml` : `sitemap-${kind}-${page}.xml`;
}

function sitemapHashConfig(config: LaurelConfig): Record<string, unknown> {
  return {
    siteUrl: config.site.url,
    basePath: config.build.base_path,
    trailingSlash: config.build.trailing_slash,
  };
}

function latestLastmodIso(entries: SitemapEntry[]): string | undefined {
  let latest = Number.NEGATIVE_INFINITY;
  let latestSource: string | undefined;
  for (const e of entries) {
    if (!e.lastmod) continue;
    const t = Date.parse(e.lastmod);
    if (!Number.isNaN(t) && t > latest) {
      latest = t;
      latestSource = e.lastmod;
    }
  }
  return latestSource ? formatLastmod(latestSource) : undefined;
}

// Sitemap protocol accepts W3C datetime; pass ISO timestamps through and fall back
// to the raw string so callers can pre-format if they prefer date-only.
function formatLastmod(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

// Sitemap priority is a number in [0.0, 1.0] with at most one decimal of
// meaningful precision per protocol. Clamp and round so out-of-range inputs
// don't produce invalid XML.
function formatSitemapPriority(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped.toFixed(1);
}
