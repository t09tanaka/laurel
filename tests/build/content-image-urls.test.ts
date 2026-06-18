import { describe, expect, test } from 'bun:test';
import type { LaurelConfig } from '~/config/schema.ts';
import { rewriteContentImageUrls } from '~/build/content-image-urls.ts';
import type { ContentImageAssetPlan, ContentImageAssetPlanEntry } from '~/build/emit.ts';

function makeConfig(opts: { siteUrl?: string; basePath?: string } = {}): LaurelConfig {
  return {
    site: { url: opts.siteUrl ?? 'https://example.com' },
    build: { base_path: opts.basePath ?? '/' },
  } as unknown as LaurelConfig;
}

function makePlan(entries: { rel: string; outputRel: string }[]): ContentImageAssetPlan {
  const full: ContentImageAssetPlanEntry[] = entries.map((e) => ({
    rel: e.rel,
    sourcePath: `/src/${e.rel}`,
    outputRel: e.outputRel,
    size: 1,
    mtimeMs: 0,
    hash: e.outputRel.split('/')[1] ?? 'hash',
  }));
  return { entries: full, byRel: new Map(full.map((e) => [e.rel, e])) };
}

const COVER_ENTRY = { rel: 'welcome-cover.svg', outputRel: '_images/abcdef0123456789/welcome-cover.svg' };
const NESTED_ENTRY = { rel: '2022/01/cover.png', outputRel: '_images/0011223344556677/cover.png' };

function jsonLdScript(imageUrl: string): string {
  const entity = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    image: { '@type': 'ImageObject', url: imageUrl },
  };
  return `<script type="application/ld+json">${JSON.stringify(entity)}</script>`;
}

function extractImageUrl(html: string): string {
  const body = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
  return (JSON.parse(body) as { image: { url: string } }).image.url;
}

describe('rewriteContentImageUrls — JSON-LD image URLs (404 regression)', () => {
  test('rewrites a site-absolute ImageObject.url to the fingerprinted path', () => {
    const html = jsonLdScript('https://example.com/content/images/welcome-cover.svg');
    const out = rewriteContentImageUrls(html, {
      config: makeConfig(),
      plan: makePlan([COVER_ENTRY]),
    });
    expect(extractImageUrl(out)).toBe(
      'https://example.com/_images/abcdef0123456789/welcome-cover.svg',
    );
  });

  test('rewrites a root-relative ImageObject.url to the fingerprinted path', () => {
    const html = jsonLdScript('/content/images/welcome-cover.svg');
    const out = rewriteContentImageUrls(html, {
      config: makeConfig(),
      plan: makePlan([COVER_ENTRY]),
    });
    expect(extractImageUrl(out)).toBe('/_images/abcdef0123456789/welcome-cover.svg');
  });

  test('honours base_path for absolute ImageObject.url (nested rel)', () => {
    const html = jsonLdScript('https://example.com/blog/content/images/2022/01/cover.png');
    const out = rewriteContentImageUrls(html, {
      config: makeConfig({ basePath: '/blog/' }),
      plan: makePlan([NESTED_ENTRY]),
    });
    expect(extractImageUrl(out)).toBe(
      'https://example.com/blog/_images/0011223344556677/cover.png',
    );
  });

  test('og:image meta and JSON-LD image.url resolve to the same fingerprinted URL', () => {
    const html = [
      '<meta property="og:image" content="https://example.com/content/images/welcome-cover.svg">',
      jsonLdScript('https://example.com/content/images/welcome-cover.svg'),
    ].join('\n');
    const out = rewriteContentImageUrls(html, {
      config: makeConfig(),
      plan: makePlan([COVER_ENTRY]),
    });
    const expected = 'https://example.com/_images/abcdef0123456789/welcome-cover.svg';
    expect(out).toContain(`<meta property="og:image" content="${expected}">`);
    expect(extractImageUrl(out)).toBe(expected);
  });

  test('leaves a URL not covered by the plan unchanged', () => {
    const html = jsonLdScript('https://example.com/content/images/not-in-plan.png');
    const out = rewriteContentImageUrls(html, {
      config: makeConfig(),
      plan: makePlan([COVER_ENTRY]),
    });
    expect(extractImageUrl(out)).toBe('https://example.com/content/images/not-in-plan.png');
  });

  test('does not touch /content/images/ URLs inside non-ld+json scripts', () => {
    const html =
      '<script>var x = "/content/images/welcome-cover.svg";</script>';
    const out = rewriteContentImageUrls(html, {
      config: makeConfig(),
      plan: makePlan([COVER_ENTRY]),
    });
    expect(out).toBe(html);
  });

  test('preserves JSON-LD escaping of <, >, & after rewrite', () => {
    const entity = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'A & B < C > D',
      image: { '@type': 'ImageObject', url: 'https://example.com/content/images/welcome-cover.svg' },
    };
    const json = JSON.stringify(entity)
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/&/g, '\\u0026');
    const html = `<script type="application/ld+json">${json}</script>`;
    const out = rewriteContentImageUrls(html, {
      config: makeConfig(),
      plan: makePlan([COVER_ENTRY]),
    });
    expect(out).toContain('\\u003C');
    expect(out).toContain('\\u003E');
    expect(out).toContain('\\u0026');
    expect(out).toContain('/_images/abcdef0123456789/welcome-cover.svg');
  });

  test('no-op when the plan is empty', () => {
    const html = jsonLdScript('https://example.com/content/images/welcome-cover.svg');
    const out = rewriteContentImageUrls(html, { config: makeConfig(), plan: makePlan([]) });
    expect(out).toBe(html);
  });
});
