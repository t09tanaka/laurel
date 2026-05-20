import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerNavigationHelpers } from '~/render/helpers/navigation.ts';

interface NavItem {
  label: string;
  url: string;
}

function makeEngine(
  overrides: {
    basePath?: string;
    locale?: string;
    locales?: Record<string, Record<string, string>>;
    partials?: Record<string, string>;
  } = {},
): NectarEngine {
  const hb = Handlebars.create();
  const site = overrides.locale ? { locale: overrides.locale } : {};
  return {
    hb,
    config: { build: { base_path: overrides.basePath ?? '/' } } as NectarEngine['config'],
    content: { site } as unknown as NectarEngine['content'],
    theme: {
      locales: overrides.locales ?? {},
      partials: overrides.partials ?? {},
    } as unknown as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

function renderNavigation(navigation: NavItem[], routeUrl: string | undefined, hash = ''): string {
  const engine = makeEngine();
  registerNavigationHelpers(engine);
  const template = engine.hb.compile(`{{navigation${hash ? ` ${hash}` : ''}}}`);
  return template(
    {},
    {
      data: {
        site: { navigation, secondary_navigation: [] },
        route: routeUrl === undefined ? undefined : { url: routeUrl },
      },
    },
  );
}

describe('navigation helper', () => {
  test('emits aria-current="page" on the matching <a> and <li>', () => {
    const html = renderNavigation(
      [
        { label: 'Home', url: '/' },
        { label: 'Tags', url: '/tag/news/' },
      ],
      '/tag/news/',
    );
    expect(html).toContain(
      '<li class="nav-tags" aria-current="page"><a href="/tag/news/" aria-current="page">Tags</a></li>',
    );
    expect(html).toContain('<li class="nav-home"><a href="/">Home</a></li>');
  });

  test('treats trailing-slash differences as the same URL', () => {
    const html = renderNavigation([{ label: 'About', url: '/about' }], '/about/');
    expect(html).toContain(
      '<li class="nav-about" aria-current="page"><a href="/about" aria-current="page">About</a></li>',
    );
  });

  test('omits aria-current when nothing matches', () => {
    const html = renderNavigation([{ label: 'Home', url: '/' }], '/some-post/');
    expect(html).not.toContain('aria-current');
    expect(html).toBe('<ul class="nav"><li class="nav-home"><a href="/">Home</a></li></ul>');
  });

  test('omits aria-current when route is not available', () => {
    const html = renderNavigation([{ label: 'Home', url: '/' }], undefined);
    expect(html).not.toContain('aria-current');
  });

  // Issue #422: when buildRootData pre-enriches each item with `slug` and
  // `current`, the helper should honour those values directly instead of
  // recomputing them. This lets a custom site-loader override either field
  // (e.g. force `current: true` for an "active section") without forking the
  // helper.
  test('prefers pre-computed slug / current over locally derived values', () => {
    const engine = makeEngine();
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [{ label: 'Whatever', url: '/page-a', slug: 'forced-slug', current: true }],
            secondary_navigation: [],
          },
          route: { url: '/totally-different/' },
        },
      },
    );
    expect(html).toContain('class="nav-forced-slug"');
    expect(html).toContain('aria-current="page"');
  });
});

describe('navigation helper href sanitisation', () => {
  test('applies build.base_path to primary root-relative URLs only', () => {
    const engine = makeEngine({ basePath: '/blog' });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [
              { label: 'About', url: '/about/' },
              { label: 'External', url: 'https://example.com/' },
              { label: 'CDN', url: '//cdn.example.com/app.js' },
              { label: 'Mail', url: 'mailto:hi@example.com' },
              { label: 'Phone', url: 'tel:+15551234' },
              { label: 'Anchor', url: '#section' },
            ],
            secondary_navigation: [],
          },
          route: { url: '/about/' },
        },
      },
    );

    expect(html).toContain('href="/blog/about/"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('href="//cdn.example.com/app.js"');
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain('href="tel:+15551234"');
    expect(html).toContain('href="#section"');
  });

  test('applies build.base_path to secondary root-relative URLs', () => {
    const engine = makeEngine({ basePath: '/blog' });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation type="secondary"}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [],
            secondary_navigation: [{ label: 'Contact', url: '/contact/' }],
          },
          route: { url: '/contact/' },
        },
      },
    );

    expect(html).toContain('href="/blog/contact/"');
  });

  test('preserves http(s), mailto, tel, and relative URLs', () => {
    const html = renderNavigation(
      [
        { label: 'Site', url: 'https://example.com/' },
        { label: 'Mail', url: 'mailto:hi@example.com' },
        { label: 'Phone', url: 'tel:+15551234' },
        { label: 'About', url: '/about/' },
        { label: 'Anchor', url: '#section' },
      ],
      undefined,
    );
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain('href="tel:+15551234"');
    expect(html).toContain('href="/about/"');
    expect(html).toContain('href="#section"');
  });

  test('refuses javascript: navigation URL and collapses to #', () => {
    const html = renderNavigation([{ label: 'Evil', url: 'javascript:alert(1)' }], undefined);
    expect(html).toContain('<a href="#"');
    expect(html).not.toContain('javascript:');
  });

  test('refuses obfuscated javascript: variants in navigation URLs', () => {
    expect(renderNavigation([{ label: 'Evil', url: 'JaVaScRiPt:alert(1)' }], undefined)).toContain(
      '<a href="#"',
    );
    expect(
      renderNavigation([{ label: 'Evil', url: '\tjavascript:alert(1)' }], undefined),
    ).toContain('<a href="#"');
    expect(
      renderNavigation([{ label: 'Evil', url: '  javascript:alert(1)' }], undefined),
    ).toContain('<a href="#"');
  });

  test('refuses data:, vbscript:, file: navigation URLs', () => {
    expect(
      renderNavigation(
        [{ label: 'Evil', url: 'data:text/html,<script>alert(1)</script>' }],
        undefined,
      ),
    ).toContain('<a href="#"');
    expect(renderNavigation([{ label: 'Evil', url: 'vbscript:msgbox(1)' }], undefined)).toContain(
      '<a href="#"',
    );
    expect(renderNavigation([{ label: 'Evil', url: 'file:///etc/passwd' }], undefined)).toContain(
      '<a href="#"',
    );
  });
});

function renderPagination(pagination: {
  page: number;
  pages: number;
  total?: number;
  prev_url: string | undefined;
  next_url: string | undefined;
  base_url?: string | undefined;
}): string {
  const engine = makeEngine();
  registerNavigationHelpers(engine);
  const template = engine.hb.compile('{{pagination}}');
  return template(
    {},
    {
      data: {
        route: { data: { pagination } },
      },
    },
  );
}

function renderPaginationTemplate(
  source: string,
  pagination: {
    page: number;
    pages: number;
    total?: number;
    prev_url: string | undefined;
    next_url: string | undefined;
    base_url?: string | undefined;
  },
): string {
  const engine = makeEngine();
  registerNavigationHelpers(engine);
  const template = engine.hb.compile(source);
  return template(
    {},
    {
      data: {
        route: { data: { pagination } },
      },
    },
  );
}

describe('pagination helper href sanitisation', () => {
  test('renders newer and older anchors when URLs are present', () => {
    const html = renderPagination({
      page: 2,
      pages: 5,
      prev_url: '/page/1/',
      next_url: '/page/3/',
    });
    expect(html).toContain('class="newer-posts"');
    expect(html).toContain('class="older-posts"');
  });

  test('preserves safe relative URLs', () => {
    const html = renderPagination({
      page: 2,
      pages: 3,
      prev_url: '/page/1/',
      next_url: '/page/3/',
    });
    expect(html).toContain('href="/page/1/"');
    expect(html).toContain('href="/page/3/"');
  });

  test('refuses javascript: in prev_url and next_url', () => {
    const html = renderPagination({
      page: 2,
      pages: 3,
      prev_url: 'javascript:alert("prev")',
      next_url: 'javascript:alert("next")',
    });
    expect(html).not.toContain('javascript:');
    const hrefs = html.match(/href="[^"]*"/g) ?? [];
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const href of hrefs) {
      expect(href).toBe('href="#"');
    }
  });

  test('refuses obfuscated javascript: variants in pagination URLs', () => {
    const html = renderPagination({
      page: 2,
      pages: 3,
      prev_url: 'JAVASCRIPT:alert(1)',
      next_url: '\tjavascript:alert(1)',
    });
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('href="#"');
  });

  test('refuses data:, vbscript:, file: pagination URLs', () => {
    const html = renderPagination({
      page: 2,
      pages: 3,
      prev_url: 'data:text/html,<script>alert(1)</script>',
      next_url: 'vbscript:msgbox(1)',
    });
    expect(html).not.toContain('data:');
    expect(html).not.toContain('vbscript:');
    const hrefs = html.match(/href="[^"]*"/g) ?? [];
    for (const href of hrefs) {
      expect(href).toBe('href="#"');
    }
  });
});

describe('pagination helper block form', () => {
  test('exposes current page_url on the block context', () => {
    const html = renderPaginationTemplate('{{#pagination}}{{this.page_url}}{{/pagination}}', {
      page: 2,
      pages: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    });
    expect(html).toBe('/page/2/');
  });

  test('exposes numeric page and total fields for Ghost-compatible themes', () => {
    const html = renderPaginationTemplate(
      '{{#pagination}}page={{this.page}} total={{this.total}}{{/pagination}}',
      {
        page: 2,
        pages: 3,
        total: 17,
        prev_url: '/',
        next_url: '/page/3/',
        base_url: '/',
      },
    );
    expect(html).toBe('page=2 total=17');
  });

  test('exposes pagination as the first block param', () => {
    const html = renderPaginationTemplate(
      '{{#pagination as |pager|}}{{pager.page_url}}{{/pagination}}',
      {
        page: 1,
        pages: 3,
        prev_url: undefined,
        next_url: '/page/2/',
        base_url: '/',
      },
    );
    expect(html).toBe('/');
  });
});

function renderLink(hash: string, inner = 'Click'): string {
  const engine = makeEngine();
  registerNavigationHelpers(engine);
  const template = engine.hb.compile(`{{#link ${hash}}}${inner}{{/link}}`);
  return template({}, { data: {} });
}

describe('link helper href sanitisation', () => {
  test('passes through http(s), mailto, tel and relative URLs unchanged', () => {
    expect(renderLink('href="https://example.com/foo"')).toContain(
      '<a href="https://example.com/foo">',
    );
    expect(renderLink('href="http://example.com/"')).toContain('<a href="http://example.com/">');
    expect(renderLink('href="mailto:hi@example.com"')).toContain(
      '<a href="mailto:hi@example.com">',
    );
    expect(renderLink('href="tel:+15551234"')).toContain('<a href="tel:+15551234">');
    expect(renderLink('href="/about/"')).toContain('<a href="/about/">');
    expect(renderLink('href="#section"')).toContain('<a href="#section">');
    expect(renderLink('href="../sibling"')).toContain('<a href="../sibling">');
  });

  test('refuses javascript: URLs and collapses href to #', () => {
    const html = renderLink('href="javascript:alert(1)"');
    expect(html).toContain('<a href="#">');
    expect(html).not.toContain('javascript:');
  });

  test('refuses data: URLs', () => {
    const html = renderLink('href="data:text/html,<script>alert(1)</script>"');
    expect(html).toContain('<a href="#">');
    expect(html).not.toContain('data:');
  });

  test('refuses obfuscated schemes hidden behind control characters or whitespace', () => {
    expect(renderLink('href="\tjavascript:alert(1)"')).toContain('<a href="#">');
    expect(renderLink('href="  javascript:alert(1)"')).toContain('<a href="#">');
    expect(renderLink('href="JaVaScRiPt:alert(1)"')).toContain('<a href="#">');
    expect(renderLink('href=" javascript:alert(1)"')).toContain('<a href="#">');
  });

  test('refuses other unsafe schemes (vbscript:, file:)', () => {
    expect(renderLink('href="vbscript:msgbox(1)"')).toContain('<a href="#">');
    expect(renderLink('href="file:///etc/passwd"')).toContain('<a href="#">');
  });

  test('falls back to # when href is empty or whitespace-only', () => {
    expect(renderLink('href=""')).toContain('<a href="#">');
    expect(renderLink('href="   "')).toContain('<a href="#">');
  });
});

describe('link helper target/rel handling', () => {
  test('auto-injects rel="noopener noreferrer" when target="_blank"', () => {
    const html = renderLink('href="https://example.com/" target="_blank"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test('auto-injects rel even when target casing varies (e.g. _Blank, _BLANK)', () => {
    const lower = renderLink('href="https://example.com/" target="_Blank"');
    expect(lower).toContain('rel="noopener noreferrer"');
    const upper = renderLink('href="https://example.com/" target="_BLANK"');
    expect(upper).toContain('rel="noopener noreferrer"');
  });

  test('merges author-supplied rel with noopener/noreferrer when target="_blank"', () => {
    const html = renderLink('href="https://example.com/" target="_blank" rel="external nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*\bexternal\b[^"]*"/);
    expect(html).toMatch(/rel="[^"]*\bnofollow\b[^"]*"/);
    expect(html).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/);
    expect(html).toMatch(/rel="[^"]*\bnoreferrer\b[^"]*"/);
  });

  test('does not duplicate tokens when author already supplied noopener', () => {
    const html = renderLink('href="https://example.com/" target="_blank" rel="noopener"');
    const relMatch = html.match(/rel="([^"]*)"/);
    expect(relMatch).not.toBeNull();
    const tokens = (relMatch?.[1] ?? '').split(/\s+/).filter(Boolean);
    expect(tokens.filter((t) => t === 'noopener')).toHaveLength(1);
    expect(tokens).toContain('noreferrer');
  });

  test('omits rel when target is absent and no rel supplied', () => {
    const html = renderLink('href="https://example.com/"');
    expect(html).not.toContain(' rel=');
    expect(html).not.toContain(' target=');
  });

  test('passes through author-supplied rel when target is not _blank', () => {
    const html = renderLink('href="https://example.com/" target="_self" rel="nofollow"');
    expect(html).toContain('target="_self"');
    expect(html).toContain('rel="nofollow"');
    expect(html).not.toContain('noopener');
  });

  test('omits rel when target is "_self" with no rel supplied', () => {
    const html = renderLink('href="https://example.com/" target="_self"');
    expect(html).toContain('target="_self"');
    expect(html).not.toContain(' rel=');
  });
});

function renderLinkClass(routeUrl: string | undefined, hash: string): string {
  const engine = makeEngine();
  registerNavigationHelpers(engine);
  const template = engine.hb.compile(`{{link_class ${hash}}}`);
  return template(
    {},
    {
      data: {
        route: routeUrl === undefined ? undefined : { url: routeUrl },
      },
    },
  );
}

function renderIsActive(routeUrl: string | undefined, hash: string): string {
  const engine = makeEngine();
  registerNavigationHelpers(engine);
  const template = engine.hb.compile(`{{is_active ${hash}}}`);
  return template(
    {},
    {
      data: {
        route: routeUrl === undefined ? undefined : { url: routeUrl },
      },
    },
  );
}

// Issue #779: parent-route highlighting. A trailing-slash target like
// `/tag/news/` represents a section root; sub-routes (`/tag/news/page/2/`,
// `/tag/news/something/`) should still receive the active class so a
// "current tag" link doesn't lose its highlight on paginated sub-pages.
describe('link_class helper parent-route matching', () => {
  test('returns the active class on an exact match', () => {
    expect(renderLinkClass('/tag/news/', 'for="/tag/news/"')).toBe('nav-current');
  });

  test('respects custom activeClass hash on an exact match', () => {
    expect(renderLinkClass('/x/', 'for="/x/" activeClass="is-active"')).toBe('is-active');
  });

  test('returns the active class for a paginated sub-route of a trailing-slash target', () => {
    expect(renderLinkClass('/tag/news/page/2/', 'for="/tag/news/"')).toBe('nav-current');
  });

  test('returns the active class for a deeper sub-route of a trailing-slash target', () => {
    expect(renderLinkClass('/tag/news/page/2/', 'for="/tag/"')).toBe('nav-current');
  });

  test('still treats a missing-slash route as a descendant of a trailing-slash target', () => {
    expect(renderLinkClass('/tag/news', 'for="/tag/news/"')).toBe('nav-current');
  });

  test('does not match a sibling route that shares a prefix without a slash boundary', () => {
    // `/tag/news-flash/` is NOT a descendant of `/tag/news/` even though the
    // prefix matches lexically. The trailing slash on the target enforces
    // the boundary.
    expect(renderLinkClass('/tag/news-flash/', 'for="/tag/news/"')).toBe('');
  });

  test('returns empty when target has no trailing slash and route is a sub-path', () => {
    // Without the trailing-slash opt-in, the helper keeps the strict
    // equality behaviour it had pre-#779.
    expect(renderLinkClass('/tag/news/page/2/', 'for="/tag/news"')).toBe('');
  });

  test('honours custom activeClass', () => {
    expect(renderLinkClass('/tag/news/page/2/', 'for="/tag/news/" activeClass="is-active"')).toBe(
      'is-active',
    );
  });

  test('returns empty when route is unset', () => {
    expect(renderLinkClass(undefined, 'for="/tag/news/"')).toBe('');
  });

  test('returns empty when target is unset', () => {
    expect(renderLinkClass('/tag/news/', 'activeClass="nav-current"')).toBe('');
  });
});

describe('is_active helper', () => {
  test('returns the default active class on an exact match', () => {
    expect(renderIsActive('/x/', 'for="/x/"')).toBe('nav-current');
  });

  test('respects custom activeClass hash on an exact match', () => {
    expect(renderIsActive('/x/', 'for="/x/" activeClass="is-active"')).toBe('is-active');
  });

  test('uses link_class parent-route matching semantics', () => {
    expect(renderIsActive('/tag/news/page/2/', 'for="/tag/news/"')).toBe('nav-current');
    expect(renderIsActive('/tag/news/page/2/', 'for="/tag/news"')).toBe('');
  });

  test('returns empty when route or target is unset', () => {
    expect(renderIsActive(undefined, 'for="/tag/news/"')).toBe('');
    expect(renderIsActive('/tag/news/', 'activeClass="nav-current"')).toBe('');
  });
});

function renderPaginationWithLocale(
  pagination: {
    page: number;
    pages: number;
    prev_url: string | undefined;
    next_url: string | undefined;
  },
  locale: string,
  locales: Record<string, Record<string, string>>,
): string {
  const engine = makeEngine({ locale, locales });
  registerNavigationHelpers(engine);
  const template = engine.hb.compile('{{pagination}}');
  return template(
    {},
    {
      data: {
        route: { data: { pagination } },
      },
    },
  );
}

// Issue #780: pagination labels go through the {{t}} translation table so
// non-English themes render "前の記事" / "次の記事" instead of forced English.
describe('pagination helper i18n', () => {
  const pagination = {
    page: 2,
    pages: 3,
    prev_url: '/page/1/',
    next_url: '/page/3/',
  };

  test('falls back to English when no locales are configured', () => {
    const html = renderPagination(pagination);
    expect(html).toContain('Newer Posts');
    expect(html).toContain('Older Posts');
    expect(html).toContain('Page 2 of 3');
  });

  test('uses the active locale entries when present', () => {
    const html = renderPaginationWithLocale(pagination, 'ja', {
      en: {},
      ja: {
        'Newer Posts': '新しい記事',
        'Older Posts': '古い記事',
        Page: 'ページ',
        of: '/',
      },
    });
    expect(html).toContain('新しい記事');
    expect(html).toContain('古い記事');
    expect(html).toContain('ページ 2 / 3');
  });

  test('falls back to the English entry when the active locale lacks the key', () => {
    const html = renderPaginationWithLocale(pagination, 'ja', {
      en: { 'Newer Posts': 'EN Newer', 'Older Posts': 'EN Older' },
      ja: {},
    });
    expect(html).toContain('EN Newer');
    expect(html).toContain('EN Older');
  });

  test('escapes translated labels so a malicious locale cannot inject HTML', () => {
    const html = renderPaginationWithLocale(pagination, 'evil', {
      en: {},
      evil: { 'Newer Posts': '<script>1</script>', 'Older Posts': '<img src=x>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// Issues #549 / #464: when the theme ships `partials/navigation.hbs`, the
// helper should render that partial with the resolved navigation context
// instead of emitting its bespoke <ul class="nav"> fallback.
describe('navigation helper theme partial override', () => {
  test('renders partials/navigation.hbs when the theme provides one', () => {
    const engine = makeEngine({
      partials: {
        navigation: `<nav class="theme-nav">{{#each navigation}}<a href="{{url}}" data-slug="{{slug}}"{{#if current}} aria-current="page"{{/if}}>{{label}}</a>{{/each}}</nav>`,
      },
    });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [
              { label: 'Home', url: '/' },
              { label: 'About', url: '/about/' },
            ],
            secondary_navigation: [],
          },
          route: { url: '/about/' },
        },
      },
    );
    expect(html).toContain('class="theme-nav"');
    expect(html).toContain('data-slug="home"');
    expect(html).toContain('data-slug="about"');
    expect(html).toContain('href="/about/" data-slug="about" aria-current="page"');
    expect(html).not.toContain('<ul class="nav">');
  });

  test('forwards type="secondary" and the resolved items into the theme partial', () => {
    const engine = makeEngine({
      partials: {
        navigation: `<nav data-type="{{type}}">{{#each navigation}}<i>{{label}}</i>{{/each}}</nav>`,
      },
    });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation type="secondary"}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [],
            secondary_navigation: [{ label: 'Contact', url: '/contact/' }],
          },
          route: { url: '/' },
        },
      },
    );
    expect(html).toContain('data-type="secondary"');
    expect(html).toContain('<i>Contact</i>');
  });

  test('sanitises item URLs before exposing them to the theme partial', () => {
    const engine = makeEngine({
      partials: {
        navigation: `<nav>{{#each navigation}}<a href="{{url}}">{{label}}</a>{{/each}}</nav>`,
      },
    });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [{ label: 'Evil', url: 'javascript:alert(1)' }],
            secondary_navigation: [],
          },
          route: { url: '/' },
        },
      },
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  test('falls back to bespoke <ul class="nav"> when the theme has no navigation partial', () => {
    const engine = makeEngine({ partials: {} });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{navigation}}');
    const html = template(
      {},
      {
        data: {
          site: {
            navigation: [{ label: 'Home', url: '/' }],
            secondary_navigation: [],
          },
          route: { url: '/' },
        },
      },
    );
    expect(html).toContain('<ul class="nav">');
    expect(html).toContain('<li class="nav-home" aria-current="page">');
  });
});

// Issues #550 / #465: when the theme ships `partials/pagination.hbs`, the
// helper should render that partial with the pagination object as the root
// context instead of emitting its bespoke <nav class="pagination"> markup.
describe('pagination helper theme partial override', () => {
  test('renders partials/pagination.hbs when the theme provides one', () => {
    const engine = makeEngine({
      partials: {
        pagination: `<nav class="theme-pagination">p{{page}}/{{pages}} total={{total}}|{{prev_url}}|{{next_url}}</nav>`,
      },
    });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{pagination}}');
    const html = template(
      {},
      {
        data: {
          route: {
            data: {
              pagination: {
                page: 2,
                pages: 4,
                total: 18,
                prev_url: '/page/1/',
                next_url: '/page/3/',
              },
            },
          },
        },
      },
    );
    expect(html).toBe('<nav class="theme-pagination">p2/4 total=18|/page/1/|/page/3/</nav>');
  });

  test('skips render when pagination.pages <= 1 even if a theme partial is present', () => {
    const engine = makeEngine({
      partials: {
        pagination: `<nav class="theme-pagination">should not appear</nav>`,
      },
    });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{pagination}}');
    const html = template(
      {},
      {
        data: {
          route: {
            data: {
              pagination: { page: 1, pages: 1, prev_url: undefined, next_url: undefined },
            },
          },
        },
      },
    );
    expect(html).toBe('');
  });

  test('falls back to bespoke pagination markup when the theme has no pagination partial', () => {
    const engine = makeEngine({ partials: {} });
    registerNavigationHelpers(engine);
    const template = engine.hb.compile('{{pagination}}');
    const html = template(
      {},
      {
        data: {
          route: {
            data: {
              pagination: { page: 2, pages: 3, prev_url: '/page/1/', next_url: '/page/3/' },
            },
          },
        },
      },
    );
    expect(html).toContain('<nav class="pagination"');
    expect(html).toContain('Page 2 of 3');
    expect(html).toContain('href="/page/1/"');
    expect(html).toContain('href="/page/3/"');
  });
});
