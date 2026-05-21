import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import {
  formatLighthouseFailures,
  routePathForDistFile,
  selectLighthouseTargets,
  summarizeLighthouseReport,
} from '~/build/lighthouse-quality.ts';

describe('lighthouse quality gate helpers', () => {
  test('maps dist HTML files to public routes', () => {
    const dist = resolve('/site/dist');

    expect(routePathForDistFile(dist, join(dist, 'index.html'))).toBe('/');
    expect(routePathForDistFile(dist, join(dist, 'hello/index.html'))).toBe('/hello/');
    expect(routePathForDistFile(dist, join(dist, '404.html'))).toBe('/404.html');
  });

  test('selects stable representative routes before low-value deep pages', () => {
    const dist = resolve('/site/dist');
    const targets = selectLighthouseTargets(
      [
        join(dist, 'tag/news/index.html'),
        join(dist, 'author/honeybee/index.html'),
        join(dist, 'index.html'),
        join(dist, 'feed/index.html'),
        join(dist, 'hello/index.html'),
        join(dist, 'tag/news/rss/index.html'),
        join(dist, '404.html'),
      ],
      { distRoot: dist, origin: 'http://127.0.0.1:1234', maxUrls: 4 },
    );

    expect(targets.map((target) => target.route)).toEqual([
      '/',
      '/hello/',
      '/tag/news/',
      '/author/honeybee/',
    ]);
  });

  test('can restrict measured routes to discovered blog article URLs', () => {
    const dist = resolve('/site/dist');
    const targets = selectLighthouseTargets(
      [
        join(dist, 'about/index.html'),
        join(dist, 'hello/index.html'),
        join(dist, 'index.html'),
        join(dist, 'old-post/index.html'),
      ],
      {
        distRoot: dist,
        origin: 'http://127.0.0.1:1234',
        includeRoutes: new Set(['/', '/hello/', '/old-post/']),
        routeOrder: ['/', '/old-post/', '/hello/'],
      },
    );

    expect(targets.map((target) => target.route)).toEqual(['/', '/old-post/', '/hello/']);
  });

  test('reports every Lighthouse category below 100 with readable scores', () => {
    const summary = summarizeLighthouseReport({
      requestedUrl: 'http://127.0.0.1:1234/',
      categories: {
        performance: { score: 1 },
        accessibility: { score: 0.99 },
        'best-practices': { score: null },
        seo: { score: 1 },
      },
    });

    expect(summary.failures).toEqual([
      { category: 'accessibility', score: 99 },
      { category: 'best-practices', score: null },
    ]);
    expect(formatLighthouseFailures([summary])).toContain('accessibility: 99');
    expect(formatLighthouseFailures([summary])).toContain('best-practices: missing');
  });
});
