import { describe, expect, test } from 'bun:test';
import { renderDefault404Html } from '~/build/error-page.ts';
import type { NectarConfig } from '~/config/schema.ts';
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
    recommendations_enabled: false,
    ...overrides,
  };
}

function makeConfig(overrides: { base_path?: string } = {}): NectarConfig {
  return {
    site: {
      title: 'Example',
      description: 'desc',
      url: 'https://example.com',
      locale: 'en',
      timezone: 'UTC',
      lang: 'en',
      navigation: [],
      secondary_navigation: [],
    },
    build: { output_dir: 'dist', base_path: overrides.base_path ?? '' },
    components: {},
  } as unknown as NectarConfig;
}

function makeContent(site: SiteData): ContentGraph {
  return {
    posts: [],
    pages: [],
    tags: [],
    authors: [],
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

describe('renderDefault404Html', () => {
  test('includes branded title and a link home', () => {
    const config = makeConfig();
    const content = makeContent(makeSite({ title: 'My Blog' }));
    const html = renderDefault404Html({ config, content });
    expect(html).toContain('<title>Page not found — My Blog</title>');
    expect(html).toContain('My Blog');
    expect(html).toContain('href="/"');
    expect(html).toContain('Return home');
  });

  test('respects build.base_path when emitting the home link', () => {
    const config = makeConfig({ base_path: '/blog/' });
    const content = makeContent(makeSite());
    const html = renderDefault404Html({ config, content });
    expect(html).toContain('href="/blog/"');
    expect(html).not.toMatch(/href="\/"/);
  });

  test('sets <html lang> from site.lang and is marked noindex', () => {
    const config = makeConfig();
    const content = makeContent(makeSite({ lang: 'ja' }));
    const html = renderDefault404Html({ config, content });
    expect(html).toContain('<html lang="ja"');
    expect(html).toContain('name="robots" content="noindex"');
  });

  test('escapes HTML special chars in site.title', () => {
    const config = makeConfig();
    const content = makeContent(makeSite({ title: 'A & B <script>' }));
    const html = renderDefault404Html({ config, content });
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  test('emits rtl direction when site.direction is rtl', () => {
    const config = makeConfig();
    const content = makeContent(makeSite({ direction: 'rtl' }));
    const html = renderDefault404Html({ config, content });
    expect(html).toContain('dir="rtl"');
  });
});
