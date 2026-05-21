import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { FaviconSet } from '~/build/favicons.ts';
import type { ContentGraph, SiteData } from '~/content/model.ts';
import {
  EMBED_PROVIDER_SCRIPT_DATA_KEY,
  collectEmbedProviderScripts,
} from '~/render/embed-provider-scripts.ts';
import type { NectarEngine } from '~/render/engine.ts';
import { registerGhostHeadFootHelpers } from '~/render/helpers/ghost-head.ts';
import { KOENIG_RUNTIME_DATA_KEY, collectKoenigRuntimeCardTypes } from '~/render/koenig-runtime.ts';

function makeEngine(
  site: Partial<SiteData> = {},
  config?: Partial<NectarEngine['config']>,
  favicons?: FaviconSet,
  theme?: Partial<NectarEngine['theme']>,
): NectarEngine {
  const hb = Handlebars.create();
  const baseTheme: NectarEngine['theme'] = {
    name: 'test-theme',
    rootDir: '',
    templates: {},
    partials: {},
    locales: {},
    assets: new Map(),
    pkg: {
      name: 'test-theme',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    },
  };
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
    members_enabled: false,
    paid_members_enabled: false,
    members_invite_only: false,
    comments_enabled: false,
    comments_access: 'all',
    recommendations_enabled: false,
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
    ...site,
  };
  return {
    hb,
    config: (config ?? {}) as NectarEngine['config'],
    content: { site: fullSite } as unknown as ContentGraph,
    theme: {
      ...baseTheme,
      ...theme,
      pkg: { ...baseTheme.pkg, ...theme?.pkg },
    } as NectarEngine['theme'],
    favicons,
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
    routeAlternates?: { locale: string; href: string }[];
    favicons?: FaviconSet;
    theme?: Partial<NectarEngine['theme']>;
  } = {},
): string {
  const engine = makeEngine(opts.site, opts.config, opts.favicons, opts.theme);
  registerGhostHeadFootHelpers(engine);
  const template = engine.hb.compile('{{{ghost_head}}}');
  return template(ctx, {
    data: {
      route: {
        kind: opts.routeKind,
        url: routeUrl,
        alternates: opts.routeAlternates,
        data: opts.routeData ?? { post: ctx },
      },
    },
  });
}

function renderGhostFoot(
  ctx: Record<string, unknown>,
  opts: {
    site?: Partial<SiteData>;
    config?: Partial<NectarEngine['config']>;
    theme?: Partial<NectarEngine['theme']>;
    data?: Record<string, unknown>;
  } = {},
): string {
  const engine = makeEngine(opts.site, opts.config, undefined, opts.theme);
  registerGhostHeadFootHelpers(engine);
  const template = engine.hb.compile('{{{ghost_foot}}}');
  return template(ctx, { data: { route: { url: '/', data: ctx }, ...opts.data } });
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

describe('ghost_head color-scheme meta', () => {
  test('emits a conservative light dark hint by default', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  test('prefers dark first when the effective theme background is dark', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      theme: {
        pkg: { customDefaults: { site_background_color: '#111111' } },
      } as Partial<NectarEngine['theme']>,
    });
    expect(html).toContain('<meta name="color-scheme" content="dark light">');
  });

  test('lets configured custom background override theme defaults', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      theme: {
        pkg: { customDefaults: { site_background_color: '#111111' } },
      } as Partial<NectarEngine['theme']>,
      config: { theme: { custom: { site_background_color: '#ffffff' } } } as Partial<
        NectarEngine['config']
      >,
    });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  test('honours explicit theme custom color_scheme values before background inference', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        theme: {
          custom: {
            color_scheme: 'Light',
            site_background_color: '#111111',
          },
        },
      } as Partial<NectarEngine['config']>,
    });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });
});

describe('ghost_head shared card assets', () => {
  test('omits card assets when theme package disables them', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      theme: { pkg: { card_assets: false } },
    });

    expect(html).not.toContain('ghost-card-assets.css');
    expect(html).not.toContain('ghost-card-assets.js');
  });

  test('emits local shared card CSS when theme package opts in', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      theme: { pkg: { card_assets: true } },
    });

    expect(html).toContain(
      '<link rel="stylesheet" type="text/css" href="/assets/ghost-card-assets.css?v=4">',
    );
    expect(html).not.toContain('ghost-card-assets.js');
  });

  test('honours base_path and exclude-specific cache key for the head stylesheet', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: { build: { base_path: '/blog/', csp_nonce: 'abc123' } } as Partial<
        NectarEngine['config']
      >,
      theme: { pkg: { card_assets: { exclude: ['bookmark', 'gallery'] } } },
    });

    expect(html).toMatch(/href="\/blog\/assets\/ghost-card-assets\.css\?v=4-[a-z0-9]+"/);
    expect(html).not.toContain('ghost-card-assets.js');
  });
});

describe('ghost_foot Koenig card runtime injection', () => {
  test('collects runtime-bearing Koenig card types from rendered body HTML', () => {
    const cards = collectKoenigRuntimeCardTypes(`
      <figure class="kg-card kg-video-card"></figure>
      <div class='kg-card kg-toggle-card'></div>
      <figure class="kg-card kg-bookmark-card"></figure>
    `);

    expect([...cards].sort()).toEqual(['toggle', 'video']);
  });

  test('omits the shared card runtime when no rendered card requested it', () => {
    const html = renderGhostFoot(
      {},
      {
        theme: { pkg: { card_assets: true } },
      },
    );

    expect(html).not.toContain('ghost-card-assets.js');
  });

  test('emits the shared card runtime in ghost_foot for detected runtime cards', () => {
    const html = renderGhostFoot(
      {},
      {
        config: { build: { base_path: '/blog/', csp_nonce: 'abc123' } } as Partial<
          NectarEngine['config']
        >,
        theme: { pkg: { card_assets: true } },
        data: { [KOENIG_RUNTIME_DATA_KEY]: new Set(['audio', 'toggle']) },
      },
    );

    expect(html).toContain(
      '<script defer src="/blog/assets/ghost-card-assets.js?v=4" nonce="abc123" data-nectar-koenig-runtime="audio,toggle"></script>',
    );
  });

  test('does not duplicate runtime injection when the detected cards are excluded', () => {
    const html = renderGhostFoot(
      {},
      {
        theme: { pkg: { card_assets: { exclude: ['toggle'] } } },
        data: { [KOENIG_RUNTIME_DATA_KEY]: new Set(['toggle']) },
      },
    );

    expect(html).not.toContain('ghost-card-assets.js');
  });
});

describe('ghost_foot embed provider script injection', () => {
  test('collects script-bearing embed providers from rendered body HTML', () => {
    const providers = collectEmbedProviderScripts(`
      <figure class="kg-card kg-embed-card" data-nectar-embed-provider="twitter"></figure>
      <figure class="kg-card kg-embed-card" data-nectar-embed-provider="twitter"></figure>
      <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/abc/"></blockquote>
      <blockquote class="tiktok-embed" cite="https://www.tiktok.com/@ghost/video/123"></blockquote>
    `);

    expect([...providers].sort()).toEqual(['instagram', 'tiktok', 'twitter']);
  });

  test('emits each provider script once in ghost_foot', () => {
    const html = renderGhostFoot(
      {},
      {
        config: { build: { csp_nonce: 'abc123' } } as Partial<NectarEngine['config']>,
        data: { [EMBED_PROVIDER_SCRIPT_DATA_KEY]: ['twitter', 'instagram', 'twitter', 'tiktok'] },
      },
    );

    expect(html.match(/data-nectar-embed-script=/g)?.length).toBe(3);
    expect(html).toContain(
      '<script async defer src="https://www.instagram.com/embed.js" nonce="abc123" data-nectar-embed-script="instagram"></script>',
    );
    expect(html).toContain(
      '<script async defer src="https://www.tiktok.com/embed.js" nonce="abc123" data-nectar-embed-script="tiktok"></script>',
    );
    expect(html).toContain(
      '<script async defer src="https://platform.twitter.com/widgets.js" nonce="abc123" data-nectar-embed-script="twitter"></script>',
    );
  });

  test('omits provider scripts when the page has no script-bearing embeds', () => {
    const html = renderGhostFoot({}, { data: { [EMBED_PROVIDER_SCRIPT_DATA_KEY]: [] } });

    expect(html).not.toContain('data-nectar-embed-script');
    expect(html).not.toContain('platform.twitter.com/widgets.js');
    expect(html).not.toContain('instagram.com/embed.js');
    expect(html).not.toContain('tiktok.com/embed.js');
  });
});

describe('ghost_head referrer policy meta', () => {
  test('emits strict-origin-when-cross-origin by default', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/');

    expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin">');
  });

  test('uses the configured site referrer policy', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { referrer_policy: 'no-referrer' },
    });

    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });
});

describe('ghost_head JSON-LD escaping', () => {
  test('emits twitter:card summary_large_image for routes', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'Twitter card',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

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

describe('ghost_head locale alternates', () => {
  test('emits hreflang alternate links from the route plan', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/ja/hello/', {
      routeAlternates: [
        { locale: 'en', href: 'https://example.com/en/hello/' },
        { locale: 'ja', href: 'https://example.com/ja/hello/' },
      ],
    });

    expect(html).toContain(
      '<link rel="alternate" hreflang="en" href="https://example.com/en/hello/">',
    );
    expect(html).toContain(
      '<link rel="alternate" hreflang="ja" href="https://example.com/ja/hello/">',
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

  test('omits dateModified when updated_at equals published_at (post never revised)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      datePublished: string;
      dateModified?: string;
    };
    expect(parsed.datePublished).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.dateModified).toBeUndefined();
  });

  test('emits dateModified when updated_at differs from published_at', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-02-15T10:30:00.000Z',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      datePublished: string;
      dateModified?: string;
    };
    expect(parsed.datePublished).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.dateModified).toBe('2026-02-15T10:30:00.000Z');
  });

  // JSON-LD enrichment (issue #867). Schema.org Article surfaces a few extra
  // fields beyond the basics that Google's Rich Results validator and other
  // crawlers consume to rank / disambiguate. Locking these into ghost_head
  // saves themes from having to inject their own JSON-LD shim.
  test('emits wordCount from the post `word_count` field (issue #867)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      word_count: 1234,
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as { wordCount?: number };
    expect(parsed.wordCount).toBe(1234);
  });

  test('omits wordCount when the post has no numeric word_count (issue #867)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as { wordCount?: number };
    expect(parsed.wordCount).toBeUndefined();
  });

  test('emits keywords from post tag names (issue #1035)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      tags: [{ name: 'News' }, { name: 'Tech' }, { name: '' }, { name: 42 }],
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as { keywords?: string };
    expect(parsed.keywords).toBe('News, Tech');
  });

  test('emits commentCount when the post comment count is known (issue #1035)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      comment_count: '7',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as { commentCount?: number };
    expect(parsed.commentCount).toBe(7);
  });

  test('omits commentCount when the post comment count is unknown (issue #1035)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as { commentCount?: number };
    expect(parsed.commentCount).toBeUndefined();
  });

  test('enriches page JSON-LD with structured content fields (issue #1035)', () => {
    const ctx = {
      id: 'page1',
      title: 'About',
      tags: [{ name: 'Company' }, { name: 'Docs' }],
      word_count: 321,
      comment_count: 0,
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    const html = renderGhostHead(ctx, '/about/', {
      routeKind: 'page',
      routeData: { page: ctx },
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      '@type': string;
      mainEntityOfPage?: { '@id': string };
      keywords?: string;
      wordCount?: number;
      commentCount?: number;
    };
    expect(parsed['@type']).toBe('Article');
    expect(parsed.mainEntityOfPage?.['@id']).toBe('https://example.com/about/');
    expect(parsed.keywords).toBe('Company, Docs');
    expect(parsed.wordCount).toBe(321);
    expect(parsed.commentCount).toBe(0);
  });

  test('emits publisher.sameAs from site-level social fields (issue #867)', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'A post',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/p1/',
      {
        site: { twitter: '@nectar_ssg', facebook: 'nectarssg' },
      },
    );
    const parsed = JSON.parse(extractJsonLd(html)) as {
      publisher: { sameAs?: string[] };
    };
    expect(parsed.publisher.sameAs).toContain('https://twitter.com/nectar_ssg');
    expect(parsed.publisher.sameAs).toContain('https://facebook.com/nectarssg');
  });

  test('emits author.sameAs on the primary_author entity (issue #867)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
      authors: [{ name: 'Jane Doe', url: 'https://example.com/author/jane/' }],
      primary_author: {
        name: 'Jane Doe',
        url: 'https://example.com/author/jane/',
        twitter: '@jane',
        mastodon: 'jane@hachyderm.io',
      },
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      author: { '@type': string; name: string; sameAs?: string[] }[];
    };
    expect(parsed.author).toHaveLength(1);
    expect(parsed.author[0].sameAs).toContain('https://twitter.com/jane');
    expect(parsed.author[0].sameAs).toContain('https://hachyderm.io/@jane');
  });

  test('co-authors past the primary do not carry sameAs duplicated from the primary (issue #867)', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
      authors: [
        { name: 'Jane', url: 'https://example.com/author/jane/' },
        { name: 'Bob', url: 'https://example.com/author/bob/' },
      ],
      primary_author: {
        name: 'Jane',
        url: 'https://example.com/author/jane/',
        twitter: 'jane',
      },
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      author: { name: string; sameAs?: string[] }[];
    };
    expect(parsed.author).toHaveLength(2);
    expect(parsed.author[0].sameAs).toBeDefined();
    expect(parsed.author[1].sameAs).toBeUndefined();
  });

  test('mainEntityOfPage continues to point at the canonical URL after enrichment (issue #867)', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'A post',
        word_count: 800,
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
});

describe('ghost_head JSON-LD cache', () => {
  test('reuses rendered JSON-LD scripts for repeated renders of the same post id', () => {
    const engine = makeEngine();
    registerGhostHeadFootHelpers(engine);
    const template = engine.hb.compile('{{{ghost_head}}}');
    let wordCountReads = 0;
    const ctx: Record<string, unknown> = {
      id: 'cached-post',
      title: 'Cached post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    Object.defineProperty(ctx, 'word_count', {
      enumerable: true,
      get() {
        wordCountReads += 1;
        return 123;
      },
    });
    const route = {
      kind: 'post',
      url: '/cached-post/',
      data: { post: ctx },
    };

    const first = template(ctx, { data: { route } });
    const second = template(ctx, { data: { route } });

    expect(extractAllJsonLd(second)).toEqual(extractAllJsonLd(first));
    expect(wordCountReads).toBe(1);
  });

  test('keeps site URL and base_path variants in separate JSON-LD cache entries', () => {
    const engine = makeEngine({ url: 'https://first.example' }, {
      build: { base_path: '/blog' },
    } as Partial<NectarEngine['config']>);
    registerGhostHeadFootHelpers(engine);
    const template = engine.hb.compile('{{{ghost_head}}}');
    const ctx = {
      id: 'base-path-post',
      title: 'Base path post',
      feature_image: '/content/images/cover.png',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    const route = {
      kind: 'post',
      url: '/base-path-post/',
      data: { post: ctx },
    };

    const first = template(ctx, { data: { route } });
    engine.content.site.url = 'https://second.example';
    engine.config.build = { ...(engine.config.build ?? {}), base_path: '/news' };
    const second = template(ctx, { data: { route } });

    const firstArticle = JSON.parse(extractJsonLd(first)) as {
      image: { url: string };
      mainEntityOfPage: { '@id': string };
    };
    const secondArticle = JSON.parse(extractJsonLd(second)) as {
      image: { url: string };
      mainEntityOfPage: { '@id': string };
    };
    expect(firstArticle.image.url).toBe('https://first.example/blog/content/images/cover.png');
    expect(secondArticle.image.url).toBe('https://second.example/news/content/images/cover.png');
    expect(firstArticle.mainEntityOfPage['@id']).toBe('https://first.example/blog/base-path-post/');
    expect(secondArticle.mainEntityOfPage['@id']).toBe(
      'https://second.example/news/base-path-post/',
    );
  });
});

describe('ghost_head twitter:site / twitter:creator (issue #868)', () => {
  test('emits twitter:site from @site.twitter as a normalised @handle', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        title: 'A post',
        published_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      '/p1/',
      { site: { twitter: 'nectar_ssg' } },
    );
    expect(html).toContain('<meta name="twitter:site" content="@nectar_ssg">');
  });

  test('emits twitter:creator from post.primary_author.twitter', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
      primary_author: { name: 'Jane', twitter: '@jane_writes' },
    });
    expect(html).toContain('<meta name="twitter:creator" content="@jane_writes">');
  });

  test('accepts full twitter.com / x.com profile URLs for twitter:site', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 'A post', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      { site: { twitter: 'https://twitter.com/nectar_ssg' } },
    );
    expect(html).toContain('<meta name="twitter:site" content="@nectar_ssg">');
  });

  test('drops malformed twitter handles instead of rendering @/path/foo', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 'A post', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      { site: { twitter: 'https://example.com/not-twitter' } },
    );
    expect(html).not.toContain('twitter:site');
  });

  test('omits twitter:site / twitter:creator when neither value is configured', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).not.toContain('twitter:site');
    expect(html).not.toContain('twitter:creator');
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
          url: '/tag/news/',
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
          tag: { name: 'News', url: '/tag/news/' },
          posts: [
            { url: '/a/', title: 'A' },
            { url: '/b/', title: 'B' },
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
          author: { name: 'Jane', url: '/author/jane/' },
          posts: [{ url: '/x/', title: 'X' }],
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

  test('tag archive description falls back through tag metadata before site defaults', () => {
    const html = renderGhostHead({}, '/tag/news/', {
      routeKind: 'tag',
      routeData: {
        tag: {
          name: 'News',
          meta_description: 'Tag SEO description',
          description: 'Tag archive description',
          url: '/tag/news/',
        },
      },
    });

    expect(html).toContain('<meta name="description" content="Tag SEO description">');
    expect(html).toContain('<meta property="og:description" content="Tag SEO description">');
    const parsed = JSON.parse(extractJsonLd(html)) as { description: string };
    expect(parsed.description).toBe('Tag SEO description');

    const withoutMeta = renderGhostHead({}, '/tag/news/', {
      routeKind: 'tag',
      routeData: {
        tag: {
          name: 'News',
          description: 'Tag archive description',
          url: '/tag/news/',
        },
      },
    });
    expect(withoutMeta).toContain('<meta name="description" content="Tag archive description">');
    expect(withoutMeta).not.toContain('<meta name="description" content="desc">');

    const withoutTagDescription = renderGhostHead({}, '/tag/news/', {
      routeKind: 'tag',
      routeData: { tag: { name: 'News', url: '/tag/news/' } },
      site: { description: 'Site default description' },
    });
    expect(withoutTagDescription).toContain(
      '<meta name="description" content="Site default description">',
    );
  });

  test('tag archive uses tag social image and code injection fields', () => {
    const tag = {
      name: 'News',
      meta_title: 'News Meta',
      canonical_url: '/topics/news/',
      og_description: 'News OG description',
      og_image: '/content/images/news-og.jpg',
      twitter_image: '/content/images/news-twitter.jpg',
      codeinjection_head: '<meta name="tag-head" content="news">',
      url: '/tag/news/',
    };
    const html = renderGhostHead(
      {
        tag,
        og_image: tag.og_image,
        twitter_image: tag.twitter_image,
        codeinjection_head: tag.codeinjection_head,
      },
      '/tag/news/',
      {
        routeKind: 'tag',
        routeData: { tag },
      },
    );

    expect(html).toContain('<link rel="canonical" href="https://example.com/topics/news/">');
    expect(html).toContain('<meta property="og:url" content="https://example.com/topics/news/">');
    expect(html).toContain(
      '<meta property="og:image" content="https://example.com/content/images/news-og.jpg">',
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://example.com/content/images/news-og.jpg">',
    );
    expect(html).toContain('<meta property="og:description" content="News OG description">');
    expect(html).toContain('<meta name="tag-head" content="news">');
  });

  test('author archive description falls back through author metadata before site defaults', () => {
    const html = renderGhostHead({}, '/author/jane/', {
      routeKind: 'author',
      routeData: {
        author: {
          name: 'Jane',
          meta_description: 'Author SEO description',
          bio: 'Author biography',
          url: '/author/jane/',
        },
      },
    });

    expect(html).toContain('<meta name="description" content="Author SEO description">');
    expect(html).toContain('<meta property="og:description" content="Author SEO description">');
    const parsed = JSON.parse(extractJsonLd(html)) as { description: string };
    expect(parsed.description).toBe('Author SEO description');

    const withoutMeta = renderGhostHead({}, '/author/jane/', {
      routeKind: 'author',
      routeData: {
        author: {
          name: 'Jane',
          bio: 'Author biography',
          url: '/author/jane/',
        },
      },
    });
    expect(withoutMeta).toContain('<meta name="description" content="Author biography">');
    expect(withoutMeta).not.toContain('<meta name="description" content="desc">');

    const withoutBio = renderGhostHead({}, '/author/jane/', {
      routeKind: 'author',
      routeData: { author: { name: 'Jane', url: '/author/jane/' } },
      site: { description: 'Site default description' },
    });
    expect(withoutBio).toContain('<meta name="description" content="Site default description">');
  });

  test('author archive uses author social image and code injection fields', () => {
    const author = {
      name: 'Jane',
      bio: 'Author biography',
      url: '/author/jane/',
      og_description: 'Jane OG description',
      og_image: '/content/images/jane-og.jpg',
      twitter_image: '/content/images/jane-twitter.jpg',
      codeinjection_head: '<meta name="author-head" content="jane">',
      codeinjection_foot: '<script>window.__author = "jane"</script>',
    };
    const ctx = {
      author,
      codeinjection_head: author.codeinjection_head,
      codeinjection_foot: author.codeinjection_foot,
    };
    const head = renderGhostHead(ctx, '/author/jane/', {
      routeKind: 'author',
      routeData: { author },
    });

    expect(head).toContain(
      '<meta property="og:image" content="https://example.com/content/images/jane-og.jpg">',
    );
    expect(head).toContain(
      '<meta name="twitter:image" content="https://example.com/content/images/jane-og.jpg">',
    );
    expect(head).toContain('<meta property="og:description" content="Jane OG description">');
    expect(head).toContain('<meta name="author-head" content="jane">');

    const foot = renderGhostFoot(ctx);
    expect(foot).toContain('<script>window.__author = "jane"</script>');
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
  test('emits issue #1015 archive pagination links from route pagination URLs', () => {
    const html = renderGhostHead({}, '/blog/tag/news/page/2/', {
      routeData: {
        tag: { name: 'news', url: 'https://example.com/blog/tag/news/' },
        pagination: {
          page: 2,
          pages: 4,
          prev: 1,
          next: 3,
          total: 40,
          limit: 10,
          prev_url: '/blog/tag/news/',
          next_url: '/blog/tag/news/page/3/',
        },
      },
    });

    expect(html).toContain('<link rel="prev" href="https://example.com/blog/tag/news/">');
    expect(html).toContain('<link rel="next" href="https://example.com/blog/tag/news/page/3/">');
  });

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

describe('ghost_head favicon <link> tags', () => {
  test('emits nothing when the engine has no favicon set', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 't', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
    );
    expect(html).not.toContain('rel="icon"');
    expect(html).not.toContain('apple-touch-icon');
  });

  test('emits each declared favicon link with type/sizes/color attributes', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 't', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      {
        favicons: {
          copies: [],
          links: [
            { rel: 'icon', href: '/favicon.ico', type: 'image/x-icon' },
            { rel: 'icon', href: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
            { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
            { rel: 'mask-icon', href: '/safari-pinned-tab.svg', color: '#222222' },
            { rel: 'manifest', href: '/site.webmanifest' },
          ],
        },
      },
    );
    expect(html).toContain('<link rel="icon" href="/favicon.ico" type="image/x-icon">');
    expect(html).toContain(
      '<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32">',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">',
    );
    expect(html).toContain('<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#222222">');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
  });

  test('rewrites root-relative hrefs through base_path so /blog deploys still resolve', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 't', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      {
        config: { build: { base_path: '/blog/' } } as Partial<NectarEngine['config']>,
        favicons: {
          copies: [],
          links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
        },
      },
    );
    expect(html).toContain('<link rel="icon" href="/blog/favicon.svg" type="image/svg+xml">');
  });

  test('passes absolute URLs through unchanged regardless of base_path', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 't', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      {
        config: { build: { base_path: '/blog/' } } as Partial<NectarEngine['config']>,
        favicons: {
          copies: [],
          links: [{ rel: 'icon', href: 'https://cdn.example.com/favicon.png', type: 'image/png' }],
        },
      },
    );
    expect(html).toContain(
      '<link rel="icon" href="https://cdn.example.com/favicon.png" type="image/png">',
    );
  });

  test('escapes href and color attributes to prevent attribute breakout', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 't', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      {
        favicons: {
          copies: [],
          links: [
            {
              rel: 'mask-icon',
              href: 'https://evil.example.com/"><script>alert(1)</script>',
              color: '"><script>',
            },
          ],
        },
      },
    );
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&quot;');
  });
});

describe('ghost_head CSP nonce', () => {
  test('emits nonce="..." on every JSON-LD script when build.csp_nonce is set', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 't', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/p1/',
      { config: { build: { csp_nonce: 'rAnd0m+Nonce/=' } } as Partial<NectarEngine['config']> },
    );
    // Posts emit Article + BreadcrumbList JSON-LD; both must carry the nonce.
    const scripts = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>/g) ?? [];
    expect(scripts.length).toBe(2);
    for (const tag of scripts) {
      expect(tag).toContain('nonce="rAnd0m+Nonce/="');
    }
  });

  test('omits nonce attribute when build.csp_nonce is unset', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 't',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(html).not.toContain('nonce=');
  });
});

describe('ghost_head article:* OG tags on post pages', () => {
  test('emits article:published_time / article:modified_time as ISO 8601 on post routes', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-02-15T10:30:00.000Z',
    });
    expect(html).toContain(
      '<meta property="article:published_time" content="2026-01-01T00:00:00.000Z">',
    );
    expect(html).toContain(
      '<meta property="article:modified_time" content="2026-02-15T10:30:00.000Z">',
    );
  });

  test('normalises non-ISO date strings into ISO 8601 for article:* tags', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      published_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(html).toMatch(
      /<meta property="article:published_time" content="2026-01-01T00:00:00\.000Z">/,
    );
    expect(html).toMatch(
      /<meta property="article:modified_time" content="2026-01-02T00:00:00\.000Z">/,
    );
  });

  test('emits one article:tag per tag in ctx.tags', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      tags: [{ name: 'News' }, { name: 'Tech' }, { name: 'Bees' }],
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(html).toContain('<meta property="article:tag" content="News">');
    expect(html).toContain('<meta property="article:tag" content="Tech">');
    expect(html).toContain('<meta property="article:tag" content="Bees">');
  });

  test('emits one article:author per author in ctx.authors', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      authors: [{ name: 'Jane Doe' }, { name: 'John Roe' }],
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(html).toContain('<meta property="article:author" content="Jane Doe">');
    expect(html).toContain('<meta property="article:author" content="John Roe">');
  });

  test('escapes attribute-breaking characters in article:tag / article:author', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      tags: [{ name: 'A & "B"' }],
      authors: [{ name: '<script>alert(1)</script>' }],
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    expect(html).toContain('<meta property="article:tag" content="A &amp; &quot;B&quot;">');
    expect(html).toContain(
      '<meta property="article:author" content="&lt;script&gt;alert(1)&lt;/script&gt;">',
    );
    expect(html).not.toContain('<script>alert(1)');
  });

  test('skips article:tag / article:author entries without a usable name', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'A post',
      tags: [{ name: 'OK' }, {}, { name: '' }, { name: 42 }],
      authors: [{ name: 'OK' }, { name: null }, {}],
      published_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const tagMatches = html.match(/article:tag/g) ?? [];
    const authorMatches = html.match(/article:author/g) ?? [];
    expect(tagMatches.length).toBe(1);
    expect(authorMatches.length).toBe(1);
  });

  test('omits article:* tags on non-post routes (home, tag archive, author archive)', () => {
    const homeHtml = renderGhostHead({ title: 'Hi' }, '/', {
      routeKind: 'home',
      routeData: {},
    });
    expect(homeHtml).not.toContain('article:');

    const tagHtml = renderGhostHead({ meta_title: 'News' }, '/tag/news/', {
      routeKind: 'tag',
      routeData: { tag: { name: 'News', url: 'https://example.com/tag/news/' } },
    });
    expect(tagHtml).not.toContain('article:');

    const authorHtml = renderGhostHead({ meta_title: 'Jane' }, '/author/jane/', {
      routeKind: 'author',
      routeData: { author: { name: 'Jane', url: 'https://example.com/author/jane/' } },
    });
    expect(authorHtml).not.toContain('article:');
  });

  test('omits article:* tags on static pages (page route)', () => {
    const html = renderGhostHead(
      { id: 'pg1', title: 'About', published_at: '2026-01-01', updated_at: '2026-01-01' },
      '/about/',
      { routeData: { page: { id: 'pg1', slug: 'about', title: 'About' } } },
    );
    expect(html).not.toContain('article:');
  });
});

describe('ghost_head accent_color CSS variable', () => {
  test('emits :root{--ghost-accent-color} style when accent_color is set', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/', {
      site: { accent_color: '#ff8800' },
    });
    expect(html).toContain('<style>:root{--ghost-accent-color:#ff8800}</style>');
  });

  test('accepts 3-digit and 8-digit hex accent colors', () => {
    const a = renderGhostHead({ title: 'Hi' }, '/', {
      site: { accent_color: '#abc' },
    });
    expect(a).toContain('<style>:root{--ghost-accent-color:#abc}</style>');
    const b = renderGhostHead({ title: 'Hi' }, '/', {
      site: { accent_color: '#aabbccdd' },
    });
    expect(b).toContain('<style>:root{--ghost-accent-color:#aabbccdd}</style>');
  });

  test('accepts CSS named colors as accent_color', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/', {
      site: { accent_color: 'rebeccapurple' },
    });
    expect(html).toContain('<style>:root{--ghost-accent-color:rebeccapurple}</style>');
  });

  test('omits the style tag entirely when accent_color is empty', () => {
    const html = renderGhostHead({ title: 'Hi' }, '/', {
      site: { accent_color: '' },
    });
    expect(html).not.toContain('--ghost-accent-color');
    expect(html).not.toMatch(/<style>:root\{/);
  });

  test('rejects accent_color values that try to break out of the style tag', () => {
    const malicious = [
      '</style><script>alert(1)</script>',
      'red; background: url(//evil)',
      'red }html{background:red',
      '#abc; }',
      '#zzzzzz',
      '"',
      'expression(alert(1))',
    ];
    for (const value of malicious) {
      const html = renderGhostHead({ title: 'Hi' }, '/', {
        site: { accent_color: value },
      });
      expect(html).not.toContain('--ghost-accent-color');
      expect(html).not.toContain('<script>alert(1)');
      expect(html).not.toContain('</style><script>');
    }
  });
});

describe('ghost_head RSS alternate link href shape', () => {
  test('builds an absolute rss.xml href from a site.url without a trailing slash', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com' },
    });
    expect(html).toContain(
      '<link rel="alternate" type="application/rss+xml" title="Nectar Test" href="https://example.com/rss.xml">',
    );
  });

  test('builds an absolute rss.xml href from a site.url with a trailing slash', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com/' },
    });
    expect(html).toContain(
      '<link rel="alternate" type="application/rss+xml" title="Nectar Test" href="https://example.com/rss.xml">',
    );
  });
});

// Issue #421: site-level meta_title / og_title / twitter_title plus
// og_image / twitter_image act as the last fallback when nothing on the
// current ctx supplies a value. Without these, a homepage shows just the
// raw site.title / site.description with no way to customise the social
// preview from config alone.
describe('ghost_head site-wide meta/og/twitter fallbacks (issue #421)', () => {
  test('falls back to @site.meta_title when no ctx title is in scope', () => {
    const html = renderGhostHead({}, '/', {
      site: { meta_title: 'Configured Site Title' },
      routeData: {},
    });
    expect(html).toContain('<meta property="og:title" content="Configured Site Title">');
    expect(html).toContain('<meta name="twitter:title" content="Configured Site Title">');
  });

  test('tag archive without an override falls back to tag.name before site titles', () => {
    const tag = { name: 'News', url: '/tag/news/' };
    const html = renderGhostHead({ tag, meta_title: 'News | Nectar Test' }, '/tag/news/', {
      routeKind: 'tag',
      routeData: { tag },
      site: { meta_title: 'Configured Site Title' },
    });
    expect(html).toContain('<meta property="og:title" content="News">');
    expect(html).toContain('<meta name="twitter:title" content="News">');
    expect(html).not.toContain('content="News | Nectar Test"');
    expect(html).not.toContain('content="Configured Site Title"');
  });

  test('tag archive respects tag.meta_title before tag.name', () => {
    const tag = { name: 'News', meta_title: 'Custom News Title', url: '/tag/news/' };
    const html = renderGhostHead({ tag }, '/tag/news/', {
      routeKind: 'tag',
      routeData: { tag },
    });
    expect(html).toContain('<meta property="og:title" content="Custom News Title">');
    expect(html).toContain('<meta name="twitter:title" content="Custom News Title">');
  });

  test('author archive without an override falls back to author.name before site titles', () => {
    const author = { name: 'Jane Doe', url: '/author/jane/' };
    const html = renderGhostHead(
      { author, meta_title: 'Jane Doe | Nectar Test' },
      '/author/jane/',
      {
        routeKind: 'author',
        routeData: { author },
        site: { meta_title: 'Configured Site Title' },
      },
    );
    expect(html).toContain('<meta property="og:title" content="Jane Doe">');
    expect(html).toContain('<meta name="twitter:title" content="Jane Doe">');
    expect(html).not.toContain('content="Jane Doe | Nectar Test"');
    expect(html).not.toContain('content="Configured Site Title"');
  });

  test('@site.og_image is the last fallback for og:image / twitter:image', () => {
    const html = renderGhostHead({}, '/', {
      site: { og_image: 'https://cdn.example.com/share.png' },
      routeData: {},
    });
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.example.com/share.png">',
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://cdn.example.com/share.png">',
    );
  });

  test('@site.meta_description is used when ctx has no description / excerpt', () => {
    const html = renderGhostHead({}, '/', {
      site: { meta_description: 'Tagline from config' },
      routeData: {},
    });
    expect(html).toContain('<meta name="description" content="Tagline from config">');
    expect(html).toContain('<meta property="og:description" content="Tagline from config">');
  });

  test('non-public post descriptions only expose custom_excerpt', () => {
    const html = renderGhostHead(
      {
        title: 'Members post',
        visibility: 'paid',
        custom_excerpt: 'Public teaser',
        excerpt: 'Paid generated excerpt',
        plaintext: 'Paid body text.',
      },
      '/members-post/',
      { site: { description: '' } },
    );
    expect(html).toContain('<meta name="description" content="Public teaser">');
    expect(html).toContain('<meta property="og:description" content="Public teaser">');
    expect(html).not.toContain('Paid generated excerpt');

    const withoutCustom = renderGhostHead(
      {
        title: 'Members post',
        visibility: 'members',
        excerpt: 'Paid generated excerpt',
        plaintext: 'Paid body text.',
      },
      '/members-post/',
      { site: { description: '' } },
    );
    expect(withoutCustom).not.toContain('Paid generated excerpt');
    expect(withoutCustom).not.toContain('Paid body text');
  });

  test('ctx title still wins over @site.meta_title', () => {
    const html = renderGhostHead({ title: 'Per-Post Title' }, '/some-post/', {
      site: { meta_title: 'Configured Site Title' },
      routeData: { post: { title: 'Per-Post Title' } },
    });
    expect(html).toContain('<meta property="og:title" content="Per-Post Title">');
    expect(html).not.toContain('Configured Site Title');
  });
});

// Issue #419: site-level codeinjection_head / codeinjection_foot are spliced
// verbatim by {{ghost_head}} / {{ghost_foot}}. Both emit the site value first
// so per-page overrides can shadow it in document order.
describe('ghost_head / ghost_foot site-level codeinjection (issue #419)', () => {
  function renderGhostFoot(
    ctx: Record<string, unknown>,
    siteOverrides: Partial<NonNullable<Parameters<typeof renderGhostHead>[2]>['site']> = {},
  ): string {
    const engine = makeEngine(siteOverrides);
    registerGhostHeadFootHelpers(engine);
    const template = engine.hb.compile('{{{ghost_foot}}}');
    return template(ctx, { data: { route: { url: '/', data: {} } } });
  }

  test('site.codeinjection_head ships verbatim into the head', () => {
    const html = renderGhostHead({}, '/', {
      site: { codeinjection_head: '<meta name="x-site" content="from-site">' },
    });
    expect(html).toContain('<meta name="x-site" content="from-site">');
  });

  test('site.codeinjection_head appears before per-page codeinjection_head', () => {
    const html = renderGhostHead(
      { codeinjection_head: '<meta name="x-page" content="from-page">' },
      '/',
      { site: { codeinjection_head: '<meta name="x-site" content="from-site">' } },
    );
    const sitePos = html.indexOf('x-site');
    const pagePos = html.indexOf('x-page');
    expect(sitePos).toBeGreaterThan(-1);
    expect(pagePos).toBeGreaterThan(-1);
    expect(sitePos).toBeLessThan(pagePos);
  });

  test('site.codeinjection_foot ships verbatim before the page-level foot', () => {
    const html = renderGhostFoot(
      { codeinjection_foot: '<!-- page -->' },
      { codeinjection_foot: '<!-- site -->' },
    );
    expect(html).toContain('<!-- site -->');
    expect(html).toContain('<!-- page -->');
    expect(html.indexOf('site')).toBeLessThan(html.indexOf('page'));
  });

  test('empty site.codeinjection_foot does not emit a stray newline', () => {
    const html = renderGhostFoot({});
    expect(html).toBe('');
  });
});

// Issue #408: `nectar import-ghost` writes per-post `codeinjection_head` /
// `codeinjection_foot` into frontmatter (gated behind `build.allow_code_injection`).
// These fields surface on the post context, so `{{ghost_head}}` / `{{ghost_foot}}`
// must splice them into the rendered page even when the site-level value is
// absent. The earlier #419 tests cover the site-level and the combined site +
// post case; these cases pin down the post-only path explicitly.
describe('ghost_head / ghost_foot post-level codeinjection (issue #408)', () => {
  function renderPostGhostFoot(ctx: Record<string, unknown>): string {
    const engine = makeEngine();
    registerGhostHeadFootHelpers(engine);
    const template = engine.hb.compile('{{{ghost_foot}}}');
    return template(ctx, { data: { route: { url: '/some-post/', data: { post: ctx } } } });
  }

  test('post.codeinjection_head ships verbatim into the head without a site value', () => {
    const html = renderGhostHead({
      codeinjection_head: '<script src="https://cdn.example.com/widget.js"></script>',
    });
    expect(html).toContain('<script src="https://cdn.example.com/widget.js"></script>');
  });

  test('post.codeinjection_foot ships verbatim before </body> without a site value', () => {
    const html = renderPostGhostFoot({
      codeinjection_foot: '<script>window.__post = 1;</script>',
    });
    expect(html).toBe('<script>window.__post = 1;</script>');
  });

  test('omitting post.codeinjection_head emits no per-post block', () => {
    // Negative case: a post without the field must not accidentally splice the
    // site value twice or emit an empty stub. With both site and post empty,
    // the helper output must contain none of the marker text.
    const html = renderGhostHead({});
    expect(html).not.toContain('x-post');
  });

  test('post.codeinjection_head appears after the site value (document order)', () => {
    // Per-post overrides shadow site-wide values by appearing later in the
    // document. A theme that injects an analytics snippet site-wide can still
    // ship a per-post override that overrides the same global.
    const html = renderGhostHead(
      { codeinjection_head: '<meta name="x-post" content="post">' },
      '/',
      { site: { codeinjection_head: '<meta name="x-site" content="site">' } },
    );
    const sitePos = html.indexOf('x-site');
    const postPos = html.indexOf('x-post');
    expect(sitePos).toBeGreaterThan(-1);
    expect(postPos).toBeGreaterThan(-1);
    expect(sitePos).toBeLessThan(postPos);
  });
});

// Issue #209: [components.analytics] injects a provider-specific snippet into
// every page's {{ghost_head}}. The snippet is emitted before any
// codeinjection_head so operators can still override it manually.
describe('ghost_head analytics provider snippet (issue #209)', () => {
  test('emits the Plausible script when provider is plausible', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'plausible', site: 'example.com' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>',
    );
  });

  test('emits the Umami script when provider is umami', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'umami', site: 'abc-123' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script async defer src="https://cloud.umami.is/script.js" data-website-id="abc-123"></script>',
    );
  });

  test('emits the Fathom script when provider is fathom', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'fathom', site: 'ABCDEFGH' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script src="https://cdn.usefathom.com/script.js" data-site="ABCDEFGH" defer></script>',
    );
  });

  test('emits both the Simple Analytics script and the <noscript> pixel', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'simpleanalytics' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script async defer src="https://scripts.simpleanalyticscdn.com/latest.js"></script>',
    );
    expect(html).toContain(
      '<noscript><img src="https://queue.simpleanalyticscdn.com/noscript.gif"',
    );
  });

  test('emits gtag.js loader and inline init for googleanalytics', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'googleanalytics', site: 'G-XYZ123' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ123"></script>',
    );
    expect(html).toContain("gtag('config', 'G-XYZ123')");
  });

  test('emits no snippet when provider is none', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'none' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('plausible.io');
    expect(html).not.toContain('umami.is');
    expect(html).not.toContain('usefathom.com');
    expect(html).not.toContain('simpleanalyticscdn.com');
    expect(html).not.toContain('googletagmanager.com');
  });

  test('omits the snippet when a site-required provider is missing the site id', () => {
    // Plausible / Umami / Fathom / GA all need a site identifier. Without it
    // the snippet is silently dropped rather than emit a half-formed tag.
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { analytics: { provider: 'plausible' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('plausible.io');
  });

  test('analytics snippet appears before codeinjection_head so operators can override it', () => {
    const html = renderGhostHead(
      { codeinjection_head: '<meta name="x-post" content="post">' },
      '/',
      {
        config: {
          components: { analytics: { provider: 'plausible', site: 'example.com' } },
        } as unknown as Partial<NectarEngine['config']>,
      },
    );
    const analyticsPos = html.indexOf('plausible.io');
    const injectionPos = html.indexOf('x-post');
    expect(analyticsPos).toBeGreaterThan(-1);
    expect(injectionPos).toBeGreaterThan(-1);
    expect(analyticsPos).toBeLessThan(injectionPos);
  });

  test('escapes attribute-breaking characters in the site identifier', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: {
          analytics: { provider: 'plausible', site: 'evil" onload="alert(1)' },
        },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('onload="alert');
    expect(html).toContain('&quot;');
  });
});

// Issue #123: Source-style themes render visible `[data-portal]` buttons when
// members are enabled. Nectar ships a static runtime in {{ghost_foot}} so those
// buttons navigate or warn instead of silently doing nothing.
describe('ghost_foot static Portal runtime injection (issue #123)', () => {
  test('emits no runtime when members are disabled', () => {
    const html = renderGhostFoot({});

    expect(html).not.toContain('nectar-portal.js');
    expect(html).not.toContain('NectarPortal');
  });

  test('emits runtime config and asset when members are enabled', () => {
    const html = renderGhostFoot(
      {},
      {
        site: { members_enabled: true },
        config: {
          build: { base_path: '/' },
          components: {
            portal: {
              provider: 'buttondown',
              paid: false,
              invite_only: false,
              publication: 'my-newsletter',
            },
          },
          recommendations: [],
        } as unknown as Partial<NectarEngine['config']>,
      },
    );

    expect(html).toContain('window.NectarPortal=');
    expect(html).toContain('"signup":"https://buttondown.email/my-newsletter"');
    expect(html).toContain('"signin":"https://buttondown.email/login"');
    expect(html).toContain('src="/assets/nectar-portal.js?v=');
  });

  test('includes configured upgrade URL and recommendations deep-link', () => {
    const html = renderGhostFoot(
      {},
      {
        site: { members_enabled: true },
        config: {
          build: { base_path: '/blog/' },
          components: {
            portal: {
              provider: 'custom',
              paid: true,
              invite_only: false,
              upgrade_url: 'https://example.test/checkout',
            },
          },
          recommendations: [{ title: 'Friend', url: 'https://friend.test' }],
        } as unknown as Partial<NectarEngine['config']>,
      },
    );

    expect(html).toContain('"upgrade":"https://example.test/checkout"');
    expect(html).toContain('"recommendations":"/blog/recommendations/#all-recommendations"');
    expect(html).toContain('src="/blog/assets/nectar-portal.js?v=');
  });

  test('escapes inline config so a URL cannot break out of the script tag', () => {
    const html = renderGhostFoot(
      {},
      {
        site: { members_enabled: true },
        config: {
          build: { base_path: '/' },
          components: {
            portal: {
              provider: 'custom',
              paid: false,
              invite_only: false,
              signup_url: '</script><script>alert(1)</script>',
            },
          },
          recommendations: [],
        } as unknown as Partial<NectarEngine['config']>,
      },
    );

    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003C/script');
  });

  test('keeps site and page codeinjection_foot around the runtime', () => {
    const html = renderGhostFoot(
      { codeinjection_foot: '<!-- page -->' },
      {
        site: {
          members_enabled: true,
          codeinjection_foot: '<!-- site -->',
        },
        config: {
          build: { base_path: '/' },
          components: { portal: { provider: 'custom', paid: false, invite_only: false } },
          recommendations: [],
        } as unknown as Partial<NectarEngine['config']>,
      },
    );

    expect(html.indexOf('<!-- site -->')).toBeLessThan(html.indexOf('NectarPortal'));
    expect(html.indexOf('NectarPortal')).toBeLessThan(html.indexOf('<!-- page -->'));
  });
});

// Issue #462: [components.portal].inject_script wires Ghost's Portal client
// script into every page via {{ghost_head}} so themes that ship
// `data-portal="…"` triggers (Source, Casper) light up against a real
// Members backend without hand-rolled markup.
describe('ghost_head Portal script injection (issue #462)', () => {
  test('omits the portal script when inject_script is false (default)', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { portal: { inject_script: false } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('portal.min.js');
    expect(html).not.toContain('data-portal');
  });

  test('emits the unpkg-hosted portal script with data-ghost when inject_script is true', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com' },
      config: {
        components: {
          portal: {
            inject_script: true,
            script_src: 'https://unpkg.com/@tryghost/portal@latest/umd/portal.min.js',
          },
        },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script defer src="https://unpkg.com/@tryghost/portal@latest/umd/portal.min.js" data-i18n="true" data-ghost="https://example.com"></script>',
    );
  });

  test('honours a self-hosted script_src override', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com' },
      config: {
        components: {
          portal: { inject_script: true, script_src: '/assets/portal.min.js' },
        },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script defer src="/assets/portal.min.js" data-i18n="true" data-ghost="https://example.com"></script>',
    );
  });

  test('drops the snippet when script_src is a dangerous URL scheme', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com' },
      config: {
        components: {
          portal: { inject_script: true, script_src: 'javascript:alert(1)' },
        },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('data-portal');
  });
});

// Issue #462: [components.search].engine = "sodo-search" / "json+sodo-search"
// injects Ghost's Sodo Search client into {{ghost_head}} so themes that ship
// a `<button data-ghost-search>` trigger have a working modal UI.
describe('ghost_head Sodo Search script injection (issue #462)', () => {
  test('omits the sodo-search script for default json engine', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      config: {
        components: { search: { enabled: true, engine: 'json' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('sodo-search');
  });

  test('emits the sodo-search script when engine is sodo-search', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com' },
      config: {
        components: {
          search: {
            enabled: true,
            engine: 'sodo-search',
            sodo_search_src:
              'https://unpkg.com/@tryghost/sodo-search@latest/umd/sodo-search.min.js',
          },
        },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script defer src="https://unpkg.com/@tryghost/sodo-search@latest/umd/sodo-search.min.js" data-sodo-search="https://example.com"></script>',
    );
  });

  test('also emits the script when engine combines json with sodo-search', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/', {
      site: { url: 'https://example.com' },
      config: {
        components: {
          search: {
            enabled: true,
            engine: 'json+sodo-search',
            sodo_search_src: '/assets/sodo-search.min.js',
          },
        },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain(
      '<script defer src="/assets/sodo-search.min.js" data-sodo-search="https://example.com"></script>',
    );
  });
});

describe('ghost_head LCP preload (#147)', () => {
  test('emits a preload tag with fetchpriority=high for post.feature_image', () => {
    const html = renderGhostHead(
      { id: 'p1', title: 'Hi', feature_image: 'https://cdn.example.com/cover.jpg' },
      '/some-post/',
      { routeKind: 'post' },
    );
    expect(html).toContain(
      '<link rel="preload" as="image" href="https://cdn.example.com/cover.jpg" fetchpriority="high" type="image/jpeg">',
    );
  });

  test('skips preload when route has no feature_image', () => {
    const html = renderGhostHead({ id: 'p1', title: 'Hi' }, '/some-post/', { routeKind: 'post' });
    expect(html).not.toContain('rel="preload" as="image"');
  });

  test('skips preload on archive routes (tag/author/home)', () => {
    const html = renderGhostHead(
      { feature_image: 'https://cdn.example.com/cover.jpg' },
      '/tag/foo/',
      {
        routeKind: 'tag',
        routeData: { tag: { feature_image: 'https://cdn.example.com/cover.jpg' } },
      },
    );
    expect(html).not.toContain('rel="preload" as="image"');
  });

  test('respects performance.preload_lcp_image=false', () => {
    const html = renderGhostHead(
      { id: 'p1', feature_image: 'https://cdn.example.com/cover.jpg' },
      '/some-post/',
      {
        routeKind: 'post',
        config: { performance: { preload_lcp_image: false } } as unknown as Partial<
          NectarEngine['config']
        >,
      },
    );
    expect(html).not.toContain('rel="preload" as="image"');
  });

  test('skips data: and blob: feature_image values', () => {
    const html = renderGhostHead(
      { id: 'p1', feature_image: 'data:image/png;base64,iVBOR...' },
      '/some-post/',
      { routeKind: 'post' },
    );
    expect(html).not.toContain('rel="preload" as="image"');
  });
});

describe('ghost_head preconnect to external image origins (#530)', () => {
  test('emits preconnect for unique third-party image origins', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        feature_image: 'https://cdn.example.com/cover.jpg',
        og_image: 'https://images.unsplash.com/foo.jpg',
      },
      '/some-post/',
      { routeKind: 'post' },
    );
    expect(html).toContain('<link rel="preconnect" href="https://cdn.example.com" crossorigin>');
    expect(html).toContain(
      '<link rel="preconnect" href="https://images.unsplash.com" crossorigin>',
    );
  });

  test("skips the site's own origin", () => {
    const html = renderGhostHead(
      { id: 'p1', feature_image: 'https://example.com/local.jpg' },
      '/some-post/',
      { routeKind: 'post', site: { url: 'https://example.com' } },
    );
    expect(html).not.toContain('rel="preconnect"');
  });

  test('skips relative and data: URLs', () => {
    const html = renderGhostHead(
      {
        id: 'p1',
        feature_image: '/content/images/local.jpg',
        og_image: 'data:image/png;base64,xxx',
      },
      '/some-post/',
      { routeKind: 'post' },
    );
    expect(html).not.toContain('rel="preconnect"');
  });

  test('caps at max_preconnect_origins (default 3)', () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      feature_image: `https://cdn${i}.example.net/x.jpg`,
    }));
    const html = renderGhostHead({}, '/', {
      routeKind: 'index',
      routeData: { posts },
    });
    const matches = html.match(/<link rel="preconnect"/g) ?? [];
    expect(matches.length).toBe(3);
  });

  test('honours max_preconnect_origins override', () => {
    const html = renderGhostHead(
      { id: 'p1', feature_image: 'https://cdn.example.com/c.jpg' },
      '/some-post/',
      {
        routeKind: 'post',
        config: { performance: { max_preconnect_origins: 0 } } as unknown as Partial<
          NectarEngine['config']
        >,
      },
    );
    expect(html).not.toContain('rel="preconnect"');
  });

  test('respects performance.preconnect_image_origins=false', () => {
    const html = renderGhostHead(
      { id: 'p1', feature_image: 'https://cdn.example.com/c.jpg' },
      '/some-post/',
      {
        routeKind: 'post',
        config: { performance: { preconnect_image_origins: false } } as unknown as Partial<
          NectarEngine['config']
        >,
      },
    );
    expect(html).not.toContain('rel="preconnect"');
  });
});

describe('ghost_head component head hints (#1726)', () => {
  test('emits giscus preconnect when comments can render its script', () => {
    const html = renderGhostHead({ id: 'p1', comments: true }, '/some-post/', {
      routeKind: 'post',
      config: {
        components: { comments: { provider: 'giscus', repo: 'acme/site' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain('<link rel="preconnect" href="https://giscus.app" crossorigin>');
  });

  test('emits utterances preconnect when comments can render its script', () => {
    const html = renderGhostHead({ id: 'p1' }, '/some-post/', {
      routeKind: 'post',
      config: {
        components: { comments: { provider: 'utterances', repo: 'acme/site' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain('<link rel="preconnect" href="https://utteranc.es" crossorigin>');
  });

  test('emits disqus preconnect to the configured shortname origin', () => {
    const html = renderGhostHead({ id: 'p1' }, '/some-post/', {
      routeKind: 'post',
      config: {
        components: { comments: { provider: 'disqus', shortname: 'mysite' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).toContain('<link rel="preconnect" href="https://mysite.disqus.com">');
  });

  test('omits comments hints when provider config cannot emit a script', () => {
    const html = renderGhostHead({ id: 'p1' }, '/some-post/', {
      routeKind: 'post',
      config: {
        components: { comments: { provider: 'disqus', shortname: 'bad/name' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('bad/name.disqus.com');
    expect(html).not.toContain('giscus.app');
    expect(html).not.toContain('utteranc.es');
  });

  test('post.comments=false suppresses configured comments hints', () => {
    const html = renderGhostHead({ id: 'p1', comments: false }, '/some-post/', {
      routeKind: 'post',
      config: {
        components: { comments: { provider: 'giscus', repo: 'acme/site' } },
      } as unknown as Partial<NectarEngine['config']>,
    });
    expect(html).not.toContain('giscus.app');
  });
});

describe('ghost_head JSON-LD ISO 8601 date normalization (#778)', () => {
  test('normalizes a bare-date published_at to a full ISO 8601 timestamp', () => {
    // Without #778 the field landed in the JSON payload as the raw
    // "2026-01-01" string, which Google Rich Results flags as an incomplete
    // Date / DateTime value.
    const html = renderGhostHead({
      id: 'p1',
      title: 'Hi',
      published_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      datePublished: string;
      dateModified?: string;
    };
    expect(parsed.datePublished).toBe('2026-01-01T00:00:00.000Z');
    // updated_at === published_at -> dateModified is suppressed.
    expect(parsed.dateModified).toBeUndefined();
  });

  test('normalizes RFC 2822 strings to ISO 8601', () => {
    const html = renderGhostHead({
      id: 'p1',
      title: 'Hi',
      published_at: 'Tue, 12 Feb 2026 09:30:00 GMT',
      updated_at: 'Wed, 13 Feb 2026 10:30:00 GMT',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      datePublished: string;
      dateModified: string;
    };
    expect(parsed.datePublished).toBe('2026-02-12T09:30:00.000Z');
    expect(parsed.dateModified).toBe('2026-02-13T10:30:00.000Z');
  });

  test('passes Date instances through as ISO 8601', () => {
    // The frontmatter parser sometimes hands the helper a Date object (YAML
    // `2026-03-01T00:00:00Z` deserialises that way). Without the normaliser
    // JSON.stringify would still emit ISO 8601, but the OG `article:*_time`
    // path already uses the same helper, so going through toIso8601 here
    // keeps both surfaces aligned.
    const html = renderGhostHead({
      id: 'p1',
      title: 'Hi',
      published_at: new Date('2026-03-15T08:00:00Z'),
      updated_at: new Date('2026-03-20T08:00:00Z'),
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      datePublished: string;
      dateModified: string;
    };
    expect(parsed.datePublished).toBe('2026-03-15T08:00:00.000Z');
    expect(parsed.dateModified).toBe('2026-03-20T08:00:00.000Z');
  });

  test('drops unparseable date values rather than emitting malformed JSON-LD', () => {
    // #313's frontmatter loader throws on truly broken dates, but the helper
    // is also called from hand-built test contexts and from theme partials
    // that can hand it surprise values. The safer default is "omit the
    // field" so Google sees a Date-less Article rather than an invalid one.
    const html = renderGhostHead({
      id: 'p1',
      title: 'Hi',
      // Intentionally garbage: not a Date, not a parseable string.
      published_at: 'not-a-date',
      updated_at: 'still-not-a-date',
    });
    const parsed = JSON.parse(extractJsonLd(html)) as {
      datePublished?: string;
      dateModified?: string;
    };
    expect(parsed.datePublished).toBeUndefined();
    expect(parsed.dateModified).toBeUndefined();
  });
});
