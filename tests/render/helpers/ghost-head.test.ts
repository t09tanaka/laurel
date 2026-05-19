import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { ContentGraph, SiteData } from '~/content/model.ts';
import type { NectarEngine } from '~/render/engine.ts';
import { registerGhostHeadFootHelpers } from '~/render/helpers/ghost-head.ts';

function makeEngine(
  site: Partial<SiteData> = {},
  config?: Partial<NectarEngine['config']>,
): NectarEngine {
  const hb = Handlebars.create();
  const fullSite: SiteData = {
    title: 'Nectar Test',
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
    ...site,
  };
  return {
    hb,
    config: (config ?? {}) as NectarEngine['config'],
    content: { site: fullSite } as unknown as ContentGraph,
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

function renderGhostHead(
  ctx: Record<string, unknown>,
  routeUrl = '/some-post/',
  opts: { site?: Partial<SiteData>; config?: Partial<NectarEngine['config']> } = {},
): string {
  const engine = makeEngine(opts.site, opts.config);
  registerGhostHeadFootHelpers(engine);
  const template = engine.hb.compile('{{{ghost_head}}}');
  return template(ctx, {
    data: {
      route: { url: routeUrl, data: { post: ctx } },
    },
  });
}

function extractJsonLd(html: string): string {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`no JSON-LD found in: ${html}`);
  return match[1];
}

describe('ghost_head JSON-LD escaping', () => {
  test('escapes </script> in post title so it cannot break out of the script tag', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'Evil </script><script>alert(1)</script>',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    // Only the outer </script> closing the JSON-LD block may appear; the payload must be escaped.
    const closings = html.match(/<\/script>/g) ?? [];
    expect(closings.length).toBe(1);
    expect(html).not.toContain('</script><script>alert(1)');

    const jsonLd = extractJsonLd(html);
    expect(jsonLd).toContain('\\u003C/script\\u003E');
    // Parsing the escaped payload back through JSON must restore the original title.
    const parsed = JSON.parse(jsonLd) as { headline: string };
    expect(parsed.headline).toBe('Evil </script><script>alert(1)</script>');
  });

  test('escapes <, >, & in JSON-LD payload', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A & B < C > D',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const jsonLd = extractJsonLd(html);
    expect(jsonLd).not.toMatch(/[<>&]/);
    expect(jsonLd).toContain('\\u0026');
    expect(jsonLd).toContain('\\u003C');
    expect(jsonLd).toContain('\\u003E');
    const parsed = JSON.parse(jsonLd) as { headline: string };
    expect(parsed.headline).toBe('A & B < C > D');
  });

  test('og:image and twitter:image are absolute URLs when feature_image is a site-relative path', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain(
      '<meta property="og:image" content="https://example.com/content/images/welcome-cover.svg">',
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://example.com/content/images/welcome-cover.svg">',
    );
    const jsonLd = extractJsonLd(html);
    const parsed = JSON.parse(jsonLd) as { image: { url: string } };
    expect(parsed.image.url).toBe('https://example.com/content/images/welcome-cover.svg');
  });

  test('og:image keeps already-absolute URLs untouched', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      og_image: 'https://cdn.example.org/img.jpg',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.org/img.jpg">');
    expect(html).toContain('<meta name="twitter:image" content="https://cdn.example.org/img.jpg">');
  });

  test('escapes U+2028 / U+2029 which are valid JSON but invalid JS string literals', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'line sep ok',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const jsonLd = extractJsonLd(html);
    expect(jsonLd).not.toContain(' ');
    expect(jsonLd).not.toContain(' ');
    expect(jsonLd).toContain('\\u2028');
    expect(jsonLd).toContain('\\u2029');
  });
});

describe('ghost_head RSS feed autodiscovery', () => {
  test('emits absolute <link rel="alternate" type="application/rss+xml"> when RSS is enabled', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: { components: { rss: { enabled: true, items: 20 } } } as Partial<
        NectarEngine['config']
      >,
    });
    expect(html).toContain(
      '<link rel="alternate" type="application/rss+xml" title="Nectar Test" href="https://example.com/rss.xml">',
    );
  });

  test('omits the RSS discovery link when components.rss.enabled is false', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: { components: { rss: { enabled: false, items: 20 } } } as Partial<
        NectarEngine['config']
      >,
    });
    expect(html).not.toContain('application/rss+xml');
    expect(html).not.toContain('rss.xml');
  });

  test('escapes the site title inside the RSS link title attribute', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { title: 'A & "B"' },
      config: { components: { rss: { enabled: true, items: 20 } } } as Partial<
        NectarEngine['config']
      >,
    });
    expect(html).toContain(
      '<link rel="alternate" type="application/rss+xml" title="A &amp; &quot;B&quot;" href="https://example.com/rss.xml">',
    );
  });

  test('defaults to emitting the RSS link when config does not specify the RSS component', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/');
    expect(html).toContain(
      '<link rel="alternate" type="application/rss+xml" title="Nectar Test" href="https://example.com/rss.xml">',
    );
  });
});

describe('ghost_head JSON-LD Article schema required fields', () => {
  test('emits mainEntityOfPage pointing at the canonical URL for posts', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'A post',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/a-post/',
    );
    const parsed = JSON.parse(extractJsonLd(html)) as {
      mainEntityOfPage: { '@type': string; '@id': string };
    };
    expect(parsed.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://example.com/a-post/',
    });
  });

  test('emits image as an ImageObject with width/height when frontmatter provides them', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      feature_image_width: 1200,
      feature_image_height: 630,
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      image: { '@type': string; url: string; width: number; height: number };
    };
    expect(parsed.image).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/content/images/welcome-cover.svg',
      width: 1200,
      height: 630,
    });
  });

  test('emits image as an ImageObject without dimensions when frontmatter lacks them', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      image: Record<string, unknown>;
    };
    expect(parsed.image).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/content/images/welcome-cover.svg',
    });
  });

  test('emits publisher.logo with configured width/height', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'Hi',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/some-post/',
      {
        site: { logo: '/content/images/logo.png', logo_width: 600, logo_height: 60 },
      },
    );
    const parsed = JSON.parse(extractJsonLd(html)) as {
      publisher: { logo: Record<string, unknown> };
    };
    expect(parsed.publisher.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/content/images/logo.png',
      width: 600,
      height: 60,
    });
  });

  test('falls back to 60x60 default dimensions when logo dimensions are unconfigured', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'Hi',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/some-post/',
      { site: { logo: '/content/images/logo.png' } },
    );
    const parsed = JSON.parse(extractJsonLd(html)) as {
      publisher: { logo: { width: number; height: number } };
    };
    expect(parsed.publisher.logo.width).toBe(60);
    expect(parsed.publisher.logo.height).toBe(60);
  });

  test('omits publisher.logo entirely when no logo is configured', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'Hi',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      publisher: { logo?: unknown };
    };
    expect(parsed.publisher.logo).toBeUndefined();
  });

  test('non-article pages keep the WebSite shape without mainEntityOfPage', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/');
    const parsed = JSON.parse(extractJsonLd(html)) as {
      '@type': string;
      mainEntityOfPage?: unknown;
    };
    expect(parsed['@type']).toBe('WebSite');
    expect(parsed.mainEntityOfPage).toBeUndefined();
  });
});
