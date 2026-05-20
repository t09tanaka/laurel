import { gzipSync } from 'node:zlib';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { writeBytes, writeHtml } from './emit.ts';

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
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
  urls: SitemapEntry[];
}): Promise<void> {
  const base = opts.config.site.url.replace(/\/$/, '');

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
      const xml = renderSitemapUrlset(pageEntries, base);
      await writeXmlWithGzip(opts.outputDir, filename, xml);
      indexEntries.push({
        loc: `${base}/${filename}`,
        lastmod: latestLastmodIso(pageEntries),
      });
    }
  }

  const indexXml = renderSitemapIndex(indexEntries);
  await writeXmlWithGzip(opts.outputDir, 'sitemap.xml', indexXml);
}

async function writeXmlWithGzip(outputDir: string, filename: string, xml: string): Promise<void> {
  await writeHtml(outputDir, filename, xml);
  // gzip variant: lets static hosts serve `sitemap.xml.gz` with
  // Content-Encoding: gzip to crawlers that prefer compressed payloads,
  // and gives operators a ready artifact to upload as-is to CDNs that
  // pre-compress. Sync gzip is fine here: each sitemap fits within tens
  // of MB at the 50k cap, and we already write a handful of files per
  // build, not thousands.
  const gz = gzipSync(Buffer.from(xml, 'utf8'));
  await writeBytes(outputDir, `${filename}.gz`, gz);
}

function renderSitemapUrlset(entries: SitemapEntry[], base: string): string {
  const body = entries
    .map((entry) => {
      const defaults = entry.kind
        ? SITEMAP_KIND_DEFAULTS[entry.kind]
        : SITEMAP_UNCLASSIFIED_DEFAULT;
      const changefreq = entry.changefreq ?? defaults.changefreq;
      const priority = entry.priority ?? defaults.priority;
      const loc = `<loc>${escapeXml(`${base}${entry.url}`)}</loc>`;
      const lastmod = entry.lastmod
        ? `<lastmod>${escapeXml(formatLastmod(entry.lastmod))}</lastmod>`
        : '';
      const cf = `<changefreq>${changefreq}</changefreq>`;
      const pr = `<priority>${formatSitemapPriority(priority)}</priority>`;
      return `<url>${loc}${lastmod}${cf}${pr}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

function renderSitemapIndex(entries: { loc: string; lastmod: string | undefined }[]): string {
  const body = entries
    .map((e) => {
      const loc = `<loc>${escapeXml(e.loc)}</loc>`;
      const lastmod = e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : '';
      return `<sitemap>${loc}${lastmod}</sitemap>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
