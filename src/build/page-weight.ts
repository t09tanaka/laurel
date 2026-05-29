import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { Parser } from 'htmlparser2';
import { routePathForDistFile } from '~/build/lighthouse-quality.ts';

interface PageWeightBudgets {
  htmlBytes: number;
  htmlGzipBytes: number;
  htmlBrotliBytes: number;
  totalBytes: number;
  cssBytes: number;
  jsBytes: number;
  imageBytes: number;
  fontBytes: number;
  maxImageBytes: number;
  maxExternalScripts: number;
  maxExternalStylesheets: number;
  maxExternalFonts: number;
}

export const DEFAULT_PAGE_WEIGHT_BUDGETS: PageWeightBudgets = {
  htmlBytes: 80 * 1024,
  htmlGzipBytes: 24 * 1024,
  htmlBrotliBytes: 20 * 1024,
  totalBytes: 512 * 1024,
  cssBytes: 80 * 1024,
  jsBytes: 80 * 1024,
  imageBytes: 384 * 1024,
  fontBytes: 128 * 1024,
  maxImageBytes: 256 * 1024,
  maxExternalScripts: 0,
  maxExternalStylesheets: 0,
  maxExternalFonts: 0,
};

type PageAssetKind = 'css' | 'js' | 'image' | 'font' | 'other';

interface PageWeightAsset {
  path: string;
  filePath: string;
  kind: PageAssetKind;
  bytes: number;
}

interface PageWeightSummary {
  route: string;
  htmlFile: string;
  htmlBytes: number;
  htmlGzipBytes: number;
  htmlBrotliBytes: number;
  totalBytes: number;
  assetBytes: Record<PageAssetKind, number>;
  maxImageBytes: number;
  localAssets: PageWeightAsset[];
  missingAssets: string[];
  externalScripts: string[];
  externalStylesheets: string[];
  externalFonts: string[];
}

interface SummarizePageWeightOptions {
  distRoot: string;
  htmlFile: string;
}

export async function summarizePageWeight(
  opts: SummarizePageWeightOptions,
): Promise<PageWeightSummary> {
  const html = await Bun.file(opts.htmlFile).text();
  const htmlBytes = Buffer.byteLength(html);
  const htmlGzipBytes = gzipSync(html).byteLength;
  const htmlBrotliBytes = brotliCompressSync(html).byteLength;
  const refs = collectAssetReferences(html);
  const localAssets: PageWeightAsset[] = [];
  const missingAssets: string[] = [];

  for (const path of refs.localPaths) {
    const filePath = resolveLocalAsset(opts.distRoot, path);
    if (!filePath) {
      missingAssets.push(path);
      continue;
    }
    const bytes = (await stat(filePath)).size;
    localAssets.push({ path, filePath, kind: classifyAsset(path), bytes });
  }

  const assetBytes: Record<PageAssetKind, number> = {
    css: 0,
    js: 0,
    image: 0,
    font: 0,
    other: 0,
  };
  let maxImageBytes = 0;
  for (const asset of localAssets) {
    assetBytes[asset.kind] += asset.bytes;
    if (asset.kind === 'image') maxImageBytes = Math.max(maxImageBytes, asset.bytes);
  }

  const totalBytes =
    htmlBytes +
    assetBytes.css +
    assetBytes.js +
    assetBytes.image +
    assetBytes.font +
    assetBytes.other;

  return {
    route: routePathForDistFile(opts.distRoot, opts.htmlFile),
    htmlFile: opts.htmlFile,
    htmlBytes,
    htmlGzipBytes,
    htmlBrotliBytes,
    totalBytes,
    assetBytes,
    maxImageBytes,
    localAssets,
    missingAssets,
    externalScripts: refs.externalScripts,
    externalStylesheets: refs.externalStylesheets,
    externalFonts: refs.externalFonts,
  };
}

export function formatPageWeightFailures(
  summaries: readonly PageWeightSummary[],
  budgets: PageWeightBudgets = DEFAULT_PAGE_WEIGHT_BUDGETS,
): string {
  return summaries
    .map((summary) => {
      const failures = pageWeightFailures(summary, budgets);
      if (failures.length === 0) return '';
      return `${summary.route}\n${failures.map((failure) => `  ${failure}`).join('\n')}`;
    })
    .filter((block) => block.length > 0)
    .join('\n\n');
}

function pageWeightFailures(summary: PageWeightSummary, budgets: PageWeightBudgets): string[] {
  const failures: string[] = [];
  pushBudgetFailure(failures, 'html', summary.htmlBytes, budgets.htmlBytes);
  pushBudgetFailure(failures, 'html gzip', summary.htmlGzipBytes, budgets.htmlGzipBytes);
  pushBudgetFailure(failures, 'html brotli', summary.htmlBrotliBytes, budgets.htmlBrotliBytes);
  pushBudgetFailure(failures, 'total', summary.totalBytes, budgets.totalBytes);
  pushBudgetFailure(failures, 'css', summary.assetBytes.css, budgets.cssBytes);
  pushBudgetFailure(failures, 'js', summary.assetBytes.js, budgets.jsBytes);
  pushBudgetFailure(failures, 'image', summary.assetBytes.image, budgets.imageBytes);
  pushBudgetFailure(failures, 'font', summary.assetBytes.font, budgets.fontBytes);
  pushBudgetFailure(failures, 'max image', summary.maxImageBytes, budgets.maxImageBytes);
  pushCountFailure(
    failures,
    'external script',
    summary.externalScripts,
    budgets.maxExternalScripts,
  );
  pushCountFailure(
    failures,
    'external stylesheet',
    summary.externalStylesheets,
    budgets.maxExternalStylesheets,
  );
  pushCountFailure(failures, 'external font', summary.externalFonts, budgets.maxExternalFonts);
  if (summary.missingAssets.length > 0) {
    failures.push(`missing local asset: ${summary.missingAssets.join(', ')}`);
  }
  return failures;
}

function pushBudgetFailure(
  failures: string[],
  label: string,
  actual: number,
  budget: number,
): void {
  if (actual <= budget) return;
  failures.push(`${label}: ${formatBytes(actual)} > ${formatBytes(budget)}`);
}

function pushCountFailure(
  failures: string[],
  label: string,
  urls: readonly string[],
  budget: number,
): void {
  if (urls.length <= budget) return;
  failures.push(`${label}: ${urls.length} > ${budget} (${urls.join(', ')})`);
}

interface AssetReferences {
  localPaths: string[];
  externalScripts: string[];
  externalStylesheets: string[];
  externalFonts: string[];
}

function collectAssetReferences(html: string): AssetReferences {
  const localPaths = new Set<string>();
  const externalScripts = new Set<string>();
  const externalStylesheets = new Set<string>();
  const externalFonts = new Set<string>();

  const addUrl = (value: string | undefined, externalKind?: 'script' | 'stylesheet' | 'font') => {
    const normalized = normalizeAssetUrl(value);
    if (!normalized) return;
    if (normalized.kind === 'local') {
      localPaths.add(normalized.path);
      return;
    }
    if (externalKind === 'script') externalScripts.add(normalized.url);
    else if (externalKind === 'stylesheet') externalStylesheets.add(normalized.url);
    else if (externalKind === 'font') externalFonts.add(normalized.url);
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'script') {
          addUrl(attrs.src, 'script');
          return;
        }
        if (name === 'img') {
          addUrl(attrs.src);
          addSrcset(attrs.srcset, addUrl);
          return;
        }
        if (name === 'source') {
          addUrl(attrs.src);
          addSrcset(attrs.srcset, addUrl);
          return;
        }
        if (name === 'video') {
          addUrl(attrs.poster);
          return;
        }
        if (name === 'link') {
          const rel = attrs.rel?.toLowerCase() ?? '';
          const as = attrs.as?.toLowerCase() ?? '';
          if (/\bstylesheet\b/.test(rel)) addUrl(attrs.href, 'stylesheet');
          else if (/\bpreload\b/.test(rel) && as === 'font') addUrl(attrs.href, 'font');
          else if (/\bpreload\b/.test(rel) || /\bmodulepreload\b/.test(rel)) addUrl(attrs.href);
          else if (/\bicon\b/.test(rel)) addUrl(attrs.href);
          return;
        }
        if (name === 'meta') {
          const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
          if (IMAGE_META_KEYS.has(key)) addUrl(attrs.content);
        }
      },
    },
    {
      decodeEntities: true,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
    },
  );
  parser.write(html);
  parser.end();

  return {
    localPaths: [...localPaths],
    externalScripts: [...externalScripts],
    externalStylesheets: [...externalStylesheets],
    externalFonts: [...externalFonts],
  };
}

function addSrcset(value: string | undefined, addUrl: (value: string | undefined) => void): void {
  if (!value) return;
  if (value.trimStart().startsWith('data:')) {
    addUrl(value);
    return;
  }
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const firstWs = trimmed.search(/\s/);
    addUrl(firstWs === -1 ? trimmed : trimmed.slice(0, firstWs));
  }
}

function normalizeAssetUrl(
  value: string | undefined,
): { kind: 'local'; path: string } | { kind: 'external'; url: string } | undefined {
  const raw = value?.trim();
  if (!raw || raw.startsWith('#')) return undefined;
  const noSuffix = raw.split(/[?#]/)[0] ?? '';
  if (!noSuffix || noSuffix.startsWith('data:') || noSuffix.startsWith('blob:')) return undefined;
  if (noSuffix.startsWith('//')) return { kind: 'external', url: noSuffix };
  if (/^https?:\/\//i.test(noSuffix)) return { kind: 'external', url: noSuffix };
  if (/^[a-z][a-z0-9+.-]*:/i.test(noSuffix)) return undefined;
  const path = noSuffix.startsWith('/') ? noSuffix : `/${noSuffix}`;
  if (path.includes('\0') || path.includes('..')) return undefined;
  return { kind: 'local', path };
}

function resolveLocalAsset(distRoot: string, publicPath: string): string | undefined {
  const clean = publicPath.replace(/^\/+/, '');
  const direct = resolve(distRoot, clean);
  if (isInside(distRoot, direct) && existsSync(direct)) return direct;

  const segments = clean.split('/').filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) {
    const candidate = resolve(distRoot, segments.slice(i).join('/'));
    if (isInside(distRoot, candidate) && existsSync(candidate)) return candidate;
  }
  return undefined;
}

function isInside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
}

function classifyAsset(path: string): PageAssetKind {
  const ext = extname(path).toLowerCase();
  if (ext === '.css') return 'css';
  if (ext === '.js' || ext === '.mjs') return 'js';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (FONT_EXTS.has(ext)) return 'font';
  return 'other';
}

const IMAGE_EXTS = new Set(['.avif', '.gif', '.ico', '.jpg', '.jpeg', '.png', '.svg', '.webp']);
const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const IMAGE_META_KEYS = new Set([
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
