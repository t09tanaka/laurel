import { describe, expect, test } from 'bun:test';
import { renderRecommendationsHtml } from '~/build/recommendations-page.ts';
import type { NectarConfig, RecommendationItem } from '~/config/schema.ts';
import type { ContentGraph, SiteData } from '~/content/model.ts';

function makeSite(overrides: Partial<SiteData> = {}): SiteData {
  return {
    title: 'Example',
    description: 'desc',
    url: 'https://example.com',
    locale: 'en',
    direction: 'ltr',
    timezone: 'UTC',
    cover_image: undefined,
    logo: undefined,
    logo_width: undefined,
    logo_height: undefined,
    icon: undefined,
    accent_color: '#000',
    navigation: [],
    secondary_navigation: [],
    lang: 'en',
    twitter: undefined,
    facebook: undefined,
    members_enabled: false,
    paid_members_enabled: false,
    members_invite_only: false,
    comments_enabled: false,
    comments_access: 'all',
    recommendations_enabled: true,
    meta_title: undefined,
    meta_description: undefined,
    og_image: undefined,
    og_title: undefined,
    og_description: undefined,
    twitter_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    ...overrides,
  };
}

function makeConfig(
  recommendations: RecommendationItem[] = [],
  overrides: { base_path?: string; csp_nonce?: string } = {},
): NectarConfig {
  return {
    site: { title: 'Example' },
    build: {
      output_dir: 'dist',
      base_path: overrides.base_path ?? '/',
      csp_nonce: overrides.csp_nonce,
    },
    components: {},
    recommendations,
  } as unknown as NectarConfig;
}

function makeContent(site: SiteData): ContentGraph {
  return {
    posts: [],
    pages: [],
    tags: [],
    authors: [],
    tiers: [],
    bySlug: {
      posts: new Map(),
      pages: new Map(),
      tags: new Map(),
      authors: new Map(),
    },
    postsByTag: new Map(),
    postsByAuthor: new Map(),
    site,
  };
}

describe('renderRecommendationsHtml', () => {
  test('renders the all-recommendations anchor target portal-shim links to', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([{ title: 'Cool Site', url: 'https://cool.example' }]),
      content: makeContent(makeSite()),
    });
    expect(html).toContain('<section id="all-recommendations"');
    expect(html).toContain('Cool Site');
    expect(html).toContain('https://cool.example');
  });

  test('emits one card per recommendation with description and reason when provided', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([
        {
          title: 'First',
          url: 'https://a.example',
          description: 'Site A description.',
          reason: 'Recommended because A.',
        },
        { title: 'Second', url: 'https://b.example' },
      ]),
      content: makeContent(makeSite()),
    });
    const cards = html.split('<article class="recommendation-card">').length - 1;
    expect(cards).toBe(2);
    expect(html).toContain('Site A description.');
    expect(html).toContain('Recommended because A.');
    expect(html).toContain('First');
    expect(html).toContain('Second');
  });

  test('shows an empty state when no recommendations are configured', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([]),
      content: makeContent(makeSite({ recommendations_enabled: false })),
    });
    expect(html).toContain('recommendations-empty');
    expect(html).toContain('<section id="all-recommendations"');
  });

  test('escapes HTML in recommendation fields to prevent stored XSS via nectar.toml', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([
        {
          title: 'Evil <script>',
          url: 'https://x.example/?a=1&b=2',
          description: 'rude & crude',
        },
      ]),
      content: makeContent(makeSite()),
    });
    expect(html).toContain('Evil &lt;script&gt;');
    expect(html).toContain('rude &amp; crude');
    expect(html).toContain('https://x.example/?a=1&amp;b=2');
    expect(html).not.toContain('<script>');
  });

  test('opens external links in a new tab with rel=noopener', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([{ title: 'Cool', url: 'https://cool.example' }]),
      content: makeContent(makeSite()),
    });
    expect(html).toMatch(/href="https:\/\/cool\.example"[^>]*rel="noopener"/);
    expect(html).toContain('target="_blank"');
  });

  test('stamps build.csp_nonce onto the inline <style> tag', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([], { csp_nonce: 'rAnd0m+/=' }),
      content: makeContent(makeSite()),
    });
    expect(html).toMatch(/<style nonce="rAnd0m\+\/="[^>]*>body\{/);
  });

  test('omits nonce attribute when build.csp_nonce is unset', () => {
    const html = renderRecommendationsHtml({
      config: makeConfig([]),
      content: makeContent(makeSite()),
    });
    expect(html).not.toMatch(/<style[^>]*nonce=/);
  });
});
