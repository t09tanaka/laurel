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
  opts: {
    site?: Partial<SiteData>;
    config?: Partial<NectarEngine['config']>;
    routeData?: Record<string, unknown>;
    routeKind?: string;
  } = {},
): string {
  const engine = makeEngine(opts.site, opts.config);
  registerGhostHeadFootHelpers(engine);
  const template = engine.hb.compile('{{{ghost_head}}}');
  return template(ctx, {
    data: {
      route: {
        kind: opts.routeKind,
        url: routeUrl,
        data: opts.routeData ?? { post: ctx },
      },
    },
  });
}

function extractJsonLd(html: string): string {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`no JSON-LD found in: ${html}`);
  return match[1];
}

function extractAllJsonLd(html: string): string[] {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(html);
  }
  return out;
}

interface BreadcrumbItem {
  '@type': string;
  position: number;
  name: string;
  item: string;
}
interface BreadcrumbList {
  '@type': string;
  itemListElement: BreadcrumbItem[];
}
function findBreadcrumb(html: string): BreadcrumbList | undefined {
  for (const raw of extractAllJsonLd(html)) {
    const parsed = JSON.parse(raw) as { '@type'?: string };
    if (parsed['@type'] === 'BreadcrumbList') return parsed as BreadcrumbList;
  }
  return undefined;
}

describe('ghost_head JSON-LD escaping', () => {
  test('escapes </script> in post title so it cannot break out of the script tag', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'Evil </script><script>alert(1)</script>',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    // Posts emit two JSON-LD blocks (Article + BreadcrumbList); both must be properly closed
    // exactly once each, and neither may leak an unescaped </script> from the payload.
    const blocks = extractAllJsonLd(html);
    expect(blocks.length).toBe(2);
    const closings = html.match(/<\/script>/g) ?? [];
    expect(closings.length).toBe(blocks.length);
    expect(html).not.toContain('</script><script>alert(1)');

    for (const raw of blocks) {
      expect(raw).toContain('\\u003C/script\\u003E');
    }
    const article = JSON.parse(blocks[0]) as { headline: string };
    expect(article.headline).toBe('Evil </script><script>alert(1)</script>');
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

describe('ghost_head og:image supplementary tags', () => {
  test('emits og:image:type derived from feature_image extension', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain('<meta property="og:image:type" content="image/svg+xml">');
  });

  test('maps common image extensions to the correct MIME type', () => {
    const cases: { url: string; expected: string }[] = [
      { url: '/img/a.jpg', expected: 'image/jpeg' },
      { url: '/img/a.jpeg', expected: 'image/jpeg' },
      { url: '/img/a.png', expected: 'image/png' },
      { url: '/img/a.gif', expected: 'image/gif' },
      { url: '/img/a.webp', expected: 'image/webp' },
      { url: '/img/a.avif', expected: 'image/avif' },
    ];
    for (const { url, expected } of cases) {
      const html = renderGhostHead({
        id: 'p1',
        title: 'cover',
        feature_image: url,
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      });
      expect(html).toContain(`<meta property="og:image:type" content="${expected}">`);
    }
  });

  test('omits og:image:type when the extension is unknown', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.bin',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).not.toContain('og:image:type');
  });

  test('emits og:image:width/height when feature_image dimensions are known', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.png',
      feature_image_width: 1200,
      feature_image_height: 630,
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
  });

  test('omits og:image:width/height when an explicit og_image overrides feature_image', () => {
    // og_image dimensions are not tracked in frontmatter, so emitting
    // feature_image_width/height alongside an unrelated og_image would be wrong.
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      og_image: 'https://cdn.example.org/share.png',
      feature_image: '/content/images/welcome-cover.png',
      feature_image_width: 1200,
      feature_image_height: 630,
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).not.toContain('og:image:width');
    expect(html).not.toContain('og:image:height');
  });

  test('emits og:image:alt and twitter:image:alt from feature_image_alt', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      feature_image_alt: 'A bee carrying a roll of parchment',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain(
      '<meta property="og:image:alt" content="A bee carrying a roll of parchment">',
    );
    expect(html).toContain(
      '<meta name="twitter:image:alt" content="A bee carrying a roll of parchment">',
    );
  });

  test('omits og:image:alt and twitter:image:alt when feature_image_alt is absent', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).not.toContain('og:image:alt');
    expect(html).not.toContain('twitter:image:alt');
  });

  test('escapes quotes and ampersands in feature_image_alt', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.svg',
      feature_image_alt: 'A & "B" tag',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain('<meta property="og:image:alt" content="A &amp; &quot;B&quot; tag">');
  });

  test('omits og:image:type when no image is present', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'no cover',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('twitter:image');
  });

  test('strips query strings and fragments before extension lookup', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'cover',
      feature_image: '/content/images/welcome-cover.png?v=2#frag',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
  });
});

describe('ghost_head BreadcrumbList JSON-LD', () => {
  test('emits Home > Tag > Post for a post with a primary tag', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'A post',
        primary_tag: {
          name: 'News',
          url: 'https://example.com/tag/news/',
        },
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/a-post/',
    );
    const breadcrumb = findBreadcrumb(html);
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb?.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Nectar Test',
        item: 'https://example.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'News',
        item: 'https://example.com/tag/news/',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'A post',
        item: 'https://example.com/a-post/',
      },
    ]);
  });

  test('emits Home > Post when the post has no primary tag', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'Tagless',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/tagless/',
    );
    const breadcrumb = findBreadcrumb(html);
    expect(breadcrumb?.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Nectar Test',
        item: 'https://example.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Tagless',
        item: 'https://example.com/tagless/',
      },
    ]);
  });

  test('emits Home > Tag for a tag archive page', () => {
    const html = renderGhostHead(
      { meta_title: 'News - Nectar Test', meta_description: 'News posts' },
      '/tag/news/',
      {
        routeData: {
          tag: { name: 'News', url: 'https://example.com/tag/news/' },
        },
      },
    );
    const breadcrumb = findBreadcrumb(html);
    expect(breadcrumb?.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Nectar Test',
        item: 'https://example.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'News',
        item: 'https://example.com/tag/news/',
      },
    ]);
  });

  test('emits Home > Author for an author archive page', () => {
    const html = renderGhostHead(
      { meta_title: 'Jane Doe - Nectar Test', meta_description: 'Author archive' },
      '/author/jane/',
      {
        routeData: {
          author: { name: 'Jane Doe', url: 'https://example.com/author/jane/' },
        },
      },
    );
    const breadcrumb = findBreadcrumb(html);
    expect(breadcrumb?.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Nectar Test',
        item: 'https://example.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Jane Doe',
        item: 'https://example.com/author/jane/',
      },
    ]);
  });

  test('omits BreadcrumbList on the home route', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/', { routeData: {} });
    expect(findBreadcrumb(html)).toBeUndefined();
  });

  test('omits BreadcrumbList on standalone static pages', () => {
    const html = renderGhostHead(
      { id: 'pg1', title: 'About', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/about/',
      { routeData: { page: { id: 'pg1', slug: 'about', title: 'About' } } },
    );
    expect(findBreadcrumb(html)).toBeUndefined();
  });

  test('Article JSON-LD is emitted before BreadcrumbList JSON-LD', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'A post',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/a-post/',
    );
    const blocks = extractAllJsonLd(html);
    expect(blocks.length).toBe(2);
    const first = JSON.parse(blocks[0]) as { '@type': string };
    const second = JSON.parse(blocks[1]) as { '@type': string };
    expect(first['@type']).toBe('Article');
    expect(second['@type']).toBe('BreadcrumbList');
  });
});

describe('ghost_head JSON-LD route-aware shapes', () => {
  test('home route emits WebSite with SearchAction potentialAction', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/', {
      routeKind: 'home',
      routeData: {},
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      '@type': string;
      potentialAction: {
        '@type': string;
        target: { '@type': string; urlTemplate: string };
        'query-input': string;
      };
    };
    expect(parsed['@type']).toBe('WebSite');
    expect(parsed.potentialAction).toEqual({
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://example.com/?s={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    });
  });

  test('tag archive emits CollectionPage with ItemList referencing each post', () => {
    const html = renderGhostHead(
      { meta_title: 'News - Nectar Test', meta_description: 'News posts' },
      '/tag/news/',
      {
        routeKind: 'tag',
        routeData: {
          tag: { name: 'News', url: 'https://example.com/tag/news/' },
          posts: [
            { url: 'https://example.com/a/', title: 'A' },
            { url: 'https://example.com/b/', title: 'B' },
          ],
        },
      },
    );
    const parsed = JSON.parse(extractJsonLd(html)) as {
      '@type': string;
      name: string;
      url: string;
      isPartOf: { '@type': string; name: string; url: string };
      mainEntity: {
        '@type': string;
        numberOfItems: number;
        itemListElement: {
          '@type': string;
          position: number;
          url: string;
          name: string;
        }[];
      };
    };
    expect(parsed['@type']).toBe('CollectionPage');
    expect(parsed.name).toBe('News - Nectar Test');
    expect(parsed.url).toBe('https://example.com/tag/news/');
    expect(parsed.isPartOf).toEqual({
      '@type': 'WebSite',
      name: 'Nectar Test',
      url: 'https://example.com',
    });
    expect(parsed.mainEntity['@type']).toBe('ItemList');
    expect(parsed.mainEntity.numberOfItems).toBe(2);
    expect(parsed.mainEntity.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, url: 'https://example.com/a/', name: 'A' },
      { '@type': 'ListItem', position: 2, url: 'https://example.com/b/', name: 'B' },
    ]);
  });

  test('author archive emits CollectionPage with ItemList referencing each post', () => {
    const html = renderGhostHead(
      { meta_title: 'Jane - Nectar Test', meta_description: 'Author archive' },
      '/author/jane/',
      {
        routeKind: 'author',
        routeData: {
          author: { name: 'Jane', url: 'https://example.com/author/jane/' },
          posts: [{ url: 'https://example.com/x/', title: 'X' }],
        },
      },
    );
    const parsed = JSON.parse(extractJsonLd(html)) as {
      '@type': string;
      mainEntity: { '@type': string; itemListElement: unknown[] };
    };
    expect(parsed['@type']).toBe('CollectionPage');
    expect(parsed.mainEntity['@type']).toBe('ItemList');
    expect(parsed.mainEntity.itemListElement).toHaveLength(1);
  });

  test('paginated home (index kind) emits CollectionPage', () => {
    const html = renderGhostHead({}, '/page/2/', {
      routeKind: 'index',
      routeData: {
        posts: [{ url: 'https://example.com/p1/', title: 'P1' }],
        pagination: {
          page: 2,
          pages: 3,
          prev: 1,
          next: 3,
          total: 30,
          limit: 10,
          prev_url: '/',
          next_url: '/page/3/',
        },
      },
    });
    const parsed = JSON.parse(extractJsonLd(html)) as { '@type': string };
    expect(parsed['@type']).toBe('CollectionPage');
  });

  test('CollectionPage ItemList omits posts missing url or title', () => {
    const html = renderGhostHead({}, '/tag/news/', {
      routeKind: 'tag',
      routeData: {
        tag: { name: 'News', url: 'https://example.com/tag/news/' },
        posts: [
          { url: 'https://example.com/a/', title: 'A' },
          { url: 'https://example.com/b/' },
          { title: 'no url' },
        ],
      },
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      mainEntity: { numberOfItems: number; itemListElement: unknown[] };
    };
    expect(parsed.mainEntity.numberOfItems).toBe(1);
    expect(parsed.mainEntity.itemListElement).toHaveLength(1);
  });

  test('home kind still emits BreadcrumbList suppression (no breadcrumb)', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/', {
      routeKind: 'home',
      routeData: {},
    });
    expect(findBreadcrumb(html)).toBeUndefined();
  });
});

describe('ghost_head rel="prev"/rel="next" for paginated archives', () => {
  test('emits absolute rel="next" on the first page of a paginated tag archive', () => {
    const html = renderGhostHead({}, '/tag/news/', {
      routeData: {
        tag: { name: 'news', url: 'https://example.com/tag/news/' },
        pagination: {
          page: 1,
          pages: 3,
          prev: undefined,
          next: 2,
          total: 30,
          limit: 10,
          prev_url: undefined,
          next_url: '/tag/news/page/2/',
        },
      },
    });
    expect(html).toContain('<link rel="next" href="https://example.com/tag/news/page/2/">');
    expect(html).not.toContain('rel="prev"');
  });

  test('emits both rel="prev" and rel="next" on an interior pagination page', () => {
    const html = renderGhostHead({}, '/tag/news/page/2/', {
      routeData: {
        tag: { name: 'news', url: 'https://example.com/tag/news/' },
        pagination: {
          page: 2,
          pages: 3,
          prev: 1,
          next: 3,
          total: 30,
          limit: 10,
          prev_url: '/tag/news/',
          next_url: '/tag/news/page/3/',
        },
      },
    });
    expect(html).toContain('<link rel="prev" href="https://example.com/tag/news/">');
    expect(html).toContain('<link rel="next" href="https://example.com/tag/news/page/3/">');
  });

  test('emits only rel="prev" on the last pagination page', () => {
    const html = renderGhostHead({}, '/tag/news/page/3/', {
      routeData: {
        tag: { name: 'news', url: 'https://example.com/tag/news/' },
        pagination: {
          page: 3,
          pages: 3,
          prev: 2,
          next: undefined,
          total: 30,
          limit: 10,
          prev_url: '/tag/news/page/2/',
          next_url: undefined,
        },
      },
    });
    expect(html).toContain('<link rel="prev" href="https://example.com/tag/news/page/2/">');
    expect(html).not.toContain('rel="next"');
  });

  test('omits rel="prev"/rel="next" entirely on routes without pagination', () => {
    const html = renderGhostHead({ id: 'p1', title: 'A post' }, '/a-post/', {
      routeData: { post: { id: 'p1', title: 'A post' } },
    });
    expect(html).not.toContain('rel="prev"');
    expect(html).not.toContain('rel="next"');
  });

  test('omits rel="prev"/rel="next" on a single-page archive', () => {
    const html = renderGhostHead({}, '/tag/solo/', {
      routeData: {
        tag: { name: 'solo', url: 'https://example.com/tag/solo/' },
        pagination: {
          page: 1,
          pages: 1,
          prev: undefined,
          next: undefined,
          total: 3,
          limit: 10,
          prev_url: undefined,
          next_url: undefined,
        },
      },
    });
    expect(html).not.toContain('rel="prev"');
    expect(html).not.toContain('rel="next"');
  });

  test('emits rel="prev"/rel="next" for the home/index archive too', () => {
    const html = renderGhostHead({}, '/page/2/', {
      routeData: {
        pagination: {
          page: 2,
          pages: 3,
          prev: 1,
          next: 3,
          total: 30,
          limit: 10,
          prev_url: '/',
          next_url: '/page/3/',
        },
      },
    });
    expect(html).toContain('<link rel="prev" href="https://example.com/">');
    expect(html).toContain('<link rel="next" href="https://example.com/page/3/">');
  });
});
