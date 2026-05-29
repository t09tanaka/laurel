import { dirname, join } from 'node:path';
import { assetPublicUrl, joinPath } from '~/theme/assets.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';
import { CARD_ASSETS_CSS_PATH, CARD_ASSETS_JS_PATH, isCardAssetsEnabled } from './card-assets.ts';
import type { HeaderRule } from './headers.ts';
import { type HtmlPreloadLink, collectHtmlPreloadLinks } from './perf-hints.ts';

const EARLY_HINTS_FILENAME = 'early-hints.json';
const SUPPORTED_AS = new Set(['style', 'script', 'font', 'image']);

export interface EarlyHintLink {
  href: string;
  as: string;
  crossorigin?: string;
  integrity?: string;
  type?: string;
}

export interface RouteEarlyHints {
  route: string;
  output_path: string;
  links: EarlyHintLink[];
}

type EarlyHintsJson = Omit<RouteEarlyHints, 'output_path'>;

export function buildKnownEarlyHintHrefs(theme: ThemeBundle, basePath: string): Set<string> {
  const out = new Set<string>();
  for (const asset of theme.assets.values()) {
    addHrefVariants(out, assetPublicUrl(asset, basePath));
  }
  if (isCardAssetsEnabled(theme.pkg.card_assets)) {
    addHrefVariants(out, joinPath(basePath, CARD_ASSETS_CSS_PATH));
    addHrefVariants(out, joinPath(basePath, CARD_ASSETS_JS_PATH));
  }
  return out;
}

export function collectRouteEarlyHints(opts: {
  routeUrl: string;
  outputPath: string;
  html: string;
  knownHrefs: ReadonlySet<string>;
  maxLinks: number;
}): RouteEarlyHints | null {
  if (opts.maxLinks <= 0) return null;
  const links: EarlyHintLink[] = [];
  const seen = new Set<string>();
  for (const link of collectHtmlPreloadLinks(opts.html)) {
    const hint = normalizeEarlyHintLink(link, opts.knownHrefs);
    if (!hint) continue;
    const key = `${hint.href}\0${hint.as}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(hint);
    if (links.length >= opts.maxLinks) break;
  }
  if (links.length === 0) return null;
  return {
    route: opts.routeUrl,
    output_path: opts.outputPath,
    links,
  };
}

export function earlyHintsArtifactPath(outputPath: string): string {
  if (outputPath.endsWith('/index.html')) {
    return `${outputPath.slice(0, -'index.html'.length)}${EARLY_HINTS_FILENAME}`;
  }
  if (outputPath === 'index.html') return EARLY_HINTS_FILENAME;
  if (outputPath.endsWith('.html')) {
    return `${outputPath.slice(0, -'.html'.length)}.${EARLY_HINTS_FILENAME}`;
  }
  return `${outputPath}.${EARLY_HINTS_FILENAME}`;
}

export async function emitEarlyHintsArtifacts(opts: {
  outputDir: string;
  routes: readonly RouteEarlyHints[];
}): Promise<void> {
  for (const route of opts.routes) {
    const outputPath = earlyHintsArtifactPath(route.output_path);
    const dest = join(opts.outputDir, outputPath);
    await ensureDir(dirname(dest));
    const body: EarlyHintsJson = {
      route: route.route,
      links: route.links,
    };
    await Bun.write(dest, `${JSON.stringify(body, null, 2)}\n`);
  }
}

export function buildEarlyHintsHeaderRules(
  routes: readonly RouteEarlyHints[],
  basePath = '/',
): HeaderRule[] {
  return routes.map((route) => ({
    pattern: routePatternWithBasePath(route.route, basePath),
    headers: route.links.map((link) => ({
      key: 'Link',
      value: formatLinkHeader(link),
    })),
  }));
}

function routePatternWithBasePath(route: string, basePath: string): string {
  const path = route === '/' ? '' : route.replace(/^\/+/, '');
  return joinPath(basePath, path);
}

export function formatLinkHeader(link: EarlyHintLink): string {
  const parts = [`<${link.href}>`, 'rel=preload', `as=${link.as}`];
  if (link.crossorigin !== undefined) {
    parts.push(
      link.crossorigin === '' ? 'crossorigin' : `crossorigin=${quoteParam(link.crossorigin)}`,
    );
  }
  if (link.type !== undefined) parts.push(`type=${quoteParam(link.type)}`);
  if (link.integrity !== undefined) parts.push(`integrity=${quoteParam(link.integrity)}`);
  return parts.join('; ');
}

function normalizeEarlyHintLink(
  link: HtmlPreloadLink,
  knownHrefs: ReadonlySet<string>,
): EarlyHintLink | null {
  const href = stripFragment(link.href.trim());
  const as = link.as.trim().toLowerCase();
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  if (!SUPPORTED_AS.has(as)) return null;
  if (!knownHrefs.has(href)) return null;
  const out: EarlyHintLink = { href, as };
  if (link.crossorigin !== undefined) out.crossorigin = link.crossorigin;
  if (link.integrity !== undefined) out.integrity = link.integrity;
  if (link.type !== undefined) out.type = link.type;
  return out;
}

function addHrefVariants(out: Set<string>, href: string): void {
  out.add(stripFragment(href));
  try {
    out.add(stripFragment(decodeURI(href)));
  } catch {
    // Keep the original href only when percent-decoding is malformed.
  }
}

function stripFragment(href: string): string {
  const hashAt = href.indexOf('#');
  return hashAt === -1 ? href : href.slice(0, hashAt);
}

function quoteParam(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
