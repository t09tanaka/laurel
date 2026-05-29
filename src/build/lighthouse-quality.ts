import { basename, relative, sep } from 'node:path';

export const LIGHTHOUSE_CATEGORIES = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
] as const;

type LighthouseCategory = (typeof LIGHTHOUSE_CATEGORIES)[number];

interface LighthouseTarget {
  route: string;
  url: string;
}

interface LighthouseScoreFailure {
  category: LighthouseCategory;
  score: number | null;
}

interface LighthouseReportSummary {
  url: string;
  failures: LighthouseScoreFailure[];
}

interface LighthouseJsonReport {
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  categories?: Partial<Record<LighthouseCategory, { score: number | null }>>;
}

export function routePathForDistFile(distRoot: string, file: string): string {
  const rel = relative(distRoot, file).split(sep);
  if (rel.length === 1 && rel[0] === 'index.html') {
    return '/';
  }
  if (basename(file) === 'index.html') {
    rel.pop();
    return `/${rel.map(encodeURIComponent).join('/')}/`;
  }
  return `/${rel.map(encodeURIComponent).join('/')}`;
}

export function selectLighthouseTargets(
  files: string[],
  options: {
    distRoot: string;
    origin: string;
    maxUrls?: number;
    includeRoutes?: ReadonlySet<string>;
    routeOrder?: readonly string[];
  },
): LighthouseTarget[] {
  const maxUrls = Math.max(1, options.maxUrls ?? 8);
  const byRoute = new Map<string, LighthouseTarget>();
  for (const file of files) {
    const route = routePathForDistFile(options.distRoot, file);
    if (!isLighthousePageRoute(route)) continue;
    if (options.includeRoutes && !options.includeRoutes.has(route)) continue;
    byRoute.set(route, { route, url: `${options.origin}${route}` });
  }

  const preferred = options.routeOrder?.filter((route) => byRoute.has(route)) ?? [];
  const preferredSet = new Set(preferred);
  const routes = [
    ...preferred,
    ...[...byRoute.keys()]
      .filter((route) => !preferredSet.has(route))
      .sort((a, b) => routePriority(a) - routePriority(b)),
  ];
  return routes.slice(0, maxUrls).map((route) => {
    const target = byRoute.get(route);
    if (!target) throw new Error(`missing Lighthouse target for ${route}`);
    return target;
  });
}

export function summarizeLighthouseReport(
  report: LighthouseJsonReport,
  minScore = 100,
): LighthouseReportSummary {
  const url = report.finalDisplayedUrl ?? report.finalUrl ?? report.requestedUrl ?? 'unknown URL';
  const failures: LighthouseScoreFailure[] = [];
  for (const category of LIGHTHOUSE_CATEGORIES) {
    const rawScore = report.categories?.[category]?.score;
    const score = rawScore === null || rawScore === undefined ? null : Math.round(rawScore * 100);
    if (score !== minScore) {
      failures.push({ category, score });
    }
  }
  return { url, failures };
}

export function formatLighthouseFailures(summaries: LighthouseReportSummary[]): string {
  const failing = summaries.filter((summary) => summary.failures.length > 0);
  if (failing.length === 0) {
    return '';
  }
  return failing
    .map((summary) => {
      const scores = summary.failures
        .map((failure) => `${failure.category}: ${failure.score ?? 'missing'}`)
        .join(', ');
      return `${summary.url}\n  ${scores}`;
    })
    .join('\n\n');
}

function routePriority(route: string): number {
  if (route === '/') return 0;
  if (/^\/[^/]+\/$/.test(route)) return 10;
  if (route.startsWith('/tag/')) return 20;
  if (route.startsWith('/author/')) return 30;
  if (route === '/404.html') return 40;
  return 50;
}

function isLighthousePageRoute(route: string): boolean {
  return route !== '/feed/' && !route.includes('/rss/');
}
