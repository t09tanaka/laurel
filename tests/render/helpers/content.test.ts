import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { HelperDelegate, HelperOptions } from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerContentHelpers } from '~/render/helpers/content.ts';
import { registerI18nHelpers } from '~/render/helpers/i18n.ts';

function makeEngine(overrides: Partial<NectarEngine> = {}): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: {} as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
    ...overrides,
  };
}

function makeEngineWithComments(
  comments: Record<string, unknown>,
  siteUrl = 'https://example.com',
  build: Record<string, unknown> = {},
): NectarEngine {
  return makeEngine({
    config: {
      components: { comments },
      build,
    } as unknown as NectarEngine['config'],
    content: { site: { url: siteUrl } } as unknown as NectarEngine['content'],
  });
}

describe('access helper', () => {
  test('inline use returns false so themes can rely on the contract', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{access}}')({})).toBe('false');
  });

  test('`{{#unless access}}` enters the block (matches Ghost lock-icon flow)', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{#unless access}}LOCK{{/unless}}')({})).toBe('LOCK');
  });

  test('`{{#if access}}` falls through to the inverse', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{#if access}}YES{{else}}NO{{/if}}')({})).toBe('NO');
  });

  test('helper wins over a stray `access` context property', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{access}}')({ access: true })).toBe('false');
  });

  test('block form `{{#access}}…{{else}}…{{/access}}` renders the inverse', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{#access}}YES{{else}}NO{{/access}}')({})).toBe('NO');
  });
});

describe('recommendations helper', () => {
  test('emits an empty placeholder so the Source theme sidebar renders without a missing-helper warning', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{recommendations}}')({})).toBe(
      '<ul class="recommendations" data-nectar-recommendations></ul>',
    );
  });

  test('renders configured recommendations from [[recommendations]] in nectar.toml', () => {
    const engine = makeEngine({
      config: {
        recommendations: [
          { title: 'First', url: 'https://a.example', description: 'desc A' },
          { title: 'Second', url: 'https://b.example' },
        ],
      } as unknown as NectarEngine['config'],
    });
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{recommendations}}')({});
    expect(html).toContain('First');
    expect(html).toContain('Second');
    expect(html).toContain('href="https://a.example"');
    expect(html).toContain('desc A');
    expect(html).toContain('rel="noopener"');
  });

  test('caps the sidebar list at 5 items by default to match Ghost', () => {
    const engine = makeEngine({
      config: {
        recommendations: Array.from({ length: 8 }, (_, i) => ({
          title: `Site ${i}`,
          url: `https://${i}.example`,
        })),
      } as unknown as NectarEngine['config'],
    });
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{recommendations}}')({});
    const liCount = html.split('<li').length - 1;
    expect(liCount).toBe(5);
    expect(html).toContain('Site 0');
    expect(html).toContain('Site 4');
    expect(html).not.toContain('Site 5');
  });

  test('limit=0 renders every configured recommendation', () => {
    const engine = makeEngine({
      config: {
        recommendations: Array.from({ length: 8 }, (_, i) => ({
          title: `Site ${i}`,
          url: `https://${i}.example`,
        })),
      } as unknown as NectarEngine['config'],
    });
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{recommendations limit=0}}')({});
    const liCount = html.split('<li').length - 1;
    expect(liCount).toBe(8);
  });

  test('escapes HTML in title and description', () => {
    const engine = makeEngine({
      config: {
        recommendations: [
          { title: '<script>', url: 'https://x.example/?a=1&b=2', description: 'a & b' },
        ],
      } as unknown as NectarEngine['config'],
    });
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{recommendations}}')({});
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).not.toContain('<script>');
  });
});

describe('subscribe_form helper', () => {
  test('emits Ghost-compatible data-members-form so theme members.js hooks attach', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{subscribe_form}}')({});
    expect(html).toContain('data-members-form="subscribe"');
    expect(html).toContain('data-members-email');
    // The `data-nectar-subscribe` marker lets optional client-side scripts
    // hook onto the form without disturbing the Ghost `data-members-form`
    // contract.
    expect(html).toContain('data-nectar-subscribe');
    expect(html).toContain('data-members-submit');
  });

  test('includes documented data-members-label hidden input so themes can tag subscribers', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{subscribe_form label="newsletter"}}')({});
    expect(html).toContain('<input data-members-label type="hidden" value="newsletter">');
  });

  test('honors placeholder and button_text hash options and escapes them as attributes', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile(
      '{{subscribe_form placeholder="jamie@example.com" button_text="Join"}}',
    )({});
    expect(html).toContain('placeholder="jamie@example.com"');
    expect(html).toContain('<span>Join</span>');
  });

  test('escapes user-supplied placeholder to defeat attribute injection', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{subscribe_form placeholder=p}}')({
      p: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });

  test('output is shaped so the build-time transformSubscribeForms can rewrite action/name', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{subscribe_form}}')({});
    expect(html).toMatch(/<form\b[^>]*\bdata-members-form\b/);
    expect(html).toMatch(/<input\b[^>]*\bdata-members-email\b/);
  });
});

describe('input_email helper', () => {
  test('emits a default name="email" attribute so the bare input is a valid form field', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{input_email}}')({});
    expect(html).toMatch(/<input\b[^>]*\bname="email"/);
    expect(html).toMatch(/<input\b[^>]*\bdata-members-email\b/);
    expect(html).toMatch(/<input\b[^>]*\btype="email"/);
  });

  test('honors placeholder hash option and escapes it as an attribute', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const html = engine.hb.compile('{{input_email placeholder="jamie@example.com"}}')({});
    expect(html).toContain('placeholder="jamie@example.com"');
  });
});

describe('content helper', () => {
  test('returns an empty SafeString without throwing when html is missing', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const helper = engine.hb.helpers.content as HelperDelegate;

    const direct = helper.call({}, { hash: {}, data: {} } as HelperOptions);
    expect(direct).toBeInstanceOf(engine.hb.SafeString);
    expect(direct.toString()).toBe('');

    const out = engine.hb.compile('{{{content}}}')({});
    expect(out).toBe('');
  });

  test('downshifts body h1 to h2 so it does not collide with the layout title h1', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<h1 id="what-is-nectar">What is Nectar?</h1>',
    });
    expect(out).toBe('<h2 id="what-is-nectar">What is Nectar?</h2>');
  });

  test('leaves h2 and deeper headings untouched so the outline does not skip levels', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<h1>A</h1><h2>B</h2><h3 class="c">C</h3><h4>D</h4><h5>E</h5><h6>F</h6>',
    });
    expect(out).toBe('<h2>A</h2><h2>B</h2><h3 class="c">C</h3><h4>D</h4><h5>E</h5><h6>F</h6>');
  });

  test('leaves non-heading markup untouched', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      html: '<p>hello <strong>world</strong></p>',
    });
    expect(out).toBe('<p>hello <strong>world</strong></p>');
  });

  test('truncating excerpt via words still strips tags and skips heading shift', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content words=2}}}')({
      html: '<h1>one two three four</h1>',
    });
    expect(out).toBe('one two');
  });

  test('words=N strips paragraph markup before truncating', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content words=3}}}')({
      html: '<p>one two three four</p>',
    });
    expect(out).toBe('one two three');
  });

  // #436 — access gating for members/paid posts.
  // The loader (src/content/paywall.ts) is responsible for truncating body
  // HTML and appending the `.gh-paywall-stub` snippet *before* the renderer
  // ever sees it. `{{content}}` itself must not strip or rewrite that stub;
  // verify the pre-truncated HTML passes through (and the body h1 still
  // downshifts so it doesn't collide with the layout title).
  test('emits the loader-truncated paywall stub verbatim for members-only posts', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      visibility: 'members',
      html: '<p>Free preview.</p><div class="gh-paywall-stub" data-paywall-visibility="members"><h2 class="gh-paywall-stub-title">Subscribe to read</h2></div>',
    });
    expect(out).toContain('<p>Free preview.</p>');
    expect(out).toContain('class="gh-paywall-stub"');
    expect(out).toContain('data-paywall-visibility="members"');
    expect(out).toContain('<h2 class="gh-paywall-stub-title">Subscribe to read</h2>');
  });

  test('access helper stays false alongside a members-visibility post (themes still hit the inverse)', () => {
    // Belt-and-suspenders: the lock-icon flow uses `{{#unless access}}` so
    // even when content delivers a stub, themes that branch on `access`
    // continue to render the locked CTA. Confirms #436 doesn't accidentally
    // flip the `access` helper.
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{#unless access}}LOCKED{{/unless}}')({
      visibility: 'members',
      html: '<p>preview</p>',
    });
    expect(out).toBe('LOCKED');
  });

  // #207 — a theme-provided `partials/paywall.hbs` wins over the loader stub
  // when the body carries one. Without a theme override, the original stub
  // markup stays intact so existing CSS hooks keep working.
  test('swaps the loader stub for a theme-provided partials/paywall.hbs when present', () => {
    const engine = makeEngine({
      theme: {
        partials: {
          paywall: '<aside class="theme-paywall" data-vis="{{visibility}}">THEME CTA</aside>',
        },
      } as unknown as NectarEngine['theme'],
    });
    engine.hb.registerPartial(
      'paywall',
      '<aside class="theme-paywall" data-vis="{{visibility}}">THEME CTA</aside>',
    );
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      visibility: 'members',
      html: '<p>Free preview.</p><div class="gh-paywall-stub" data-paywall-visibility="members"><h2 class="gh-paywall-stub-title">Subscribe</h2></div>',
    });
    expect(out).toContain('<p>Free preview.</p>');
    expect(out).toContain('class="theme-paywall"');
    expect(out).toContain('data-vis="members"');
    expect(out).toContain('THEME CTA');
    expect(out).not.toContain('gh-paywall-stub');
  });

  test('leaves the loader stub untouched when the theme has no paywall partial', () => {
    const engine = makeEngine({
      theme: { partials: {} } as unknown as NectarEngine['theme'],
    });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{{content}}}')({
      visibility: 'members',
      html: '<p>Free preview.</p><div class="gh-paywall-stub" data-paywall-visibility="members"><h2 class="gh-paywall-stub-title">Subscribe</h2></div>',
    });
    expect(out).toContain('class="gh-paywall-stub"');
    expect(out).toContain('data-paywall-visibility="members"');
  });
});

describe('excerpt helper', () => {
  test('characters=N truncates the selected excerpt by characters', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{excerpt characters=50}}')({
      custom_excerpt: '01234567890123456789012345678901234567890123456789tail',
    });
    expect(out).toBe('01234567890123456789012345678901234567890123456789');
  });

  test('falls back from custom_excerpt to excerpt and then plaintext', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const tpl = engine.hb.compile('{{excerpt}}');

    expect(tpl({ excerpt: 'auto', plaintext: 'plain' })).toBe('auto');
    expect(tpl({ plaintext: 'plain' })).toBe('plain');
  });

  test('non-public posts only expose custom_excerpt', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const tpl = engine.hb.compile('{{excerpt}}');

    expect(
      tpl({
        visibility: 'members',
        custom_excerpt: 'Public teaser',
        excerpt: 'Paid generated excerpt',
        plaintext: 'Paid body text',
      }),
    ).toBe('Public teaser');
    expect(
      tpl({
        visibility: 'paid',
        excerpt: 'Paid generated excerpt',
        plaintext: 'Paid body text',
      }),
    ).toBe('');
  });
});

describe('reading_time helper', () => {
  test('uses the singular template for a 1-minute post', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{reading_time}}')({ reading_time: 1 });
    expect(out).toBe('1 min read');
  });

  test('uses the plural template for an n-minute post', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{reading_time}}')({ reading_time: 7 });
    expect(out).toBe('7 min read');
  });
});

describe('meta_title helper pagination', () => {
  test('post route returns the explicit post title and ignores pagination hash', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'Hello, Nectar', title: 'Hello, Nectar' },
      { data: { route: { kind: 'post' }, site: { title: 'Site' } } },
    );
    expect(out).toBe('Hello, Nectar');
  });

  test('static page route returns the explicit title without a page suffix', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'About', title: 'About' },
      { data: { route: { kind: 'page' }, site: { title: 'Site' } } },
    );
    expect(out).toBe('About');
  });

  test('home route page 1 returns the site title without a page suffix', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      {},
      { data: { route: { kind: 'home', data: {} }, site: { title: 'Site' } } },
    );
    expect(out).toBe('Site');
  });

  test('paginated index route appends the page suffix to the site title', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      {},
      {
        data: {
          route: { kind: 'index', data: { pagination: { page: 2 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('Site (Page 2)');
  });

  test('tag archive page 1 returns the precomposed meta_title without a suffix', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 1 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News | Site');
  });

  test('tag archive without an override falls back to tag.name before site title', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const tag = { name: 'News', slug: 'news' };
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { tag, meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { tag, pagination: { page: 1 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News');
  });

  test('paginated tag archive appends the page suffix to the tag meta_title', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 3 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News | Site (Page 3)');
  });

  test('paginated tag archive respects an explicit tag.meta_title override', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'Custom Tag Title' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 2 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('Custom Tag Title (Page 2)');
  });

  test('paginated tag archive without an override appends the page suffix to tag.name', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const tag = { name: 'News', slug: 'news' };
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { tag, meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { tag, pagination: { page: 3 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News (Page 3)');
  });

  test('paginated author archive appends the page suffix to the author meta_title', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'Jane Doe | Site' },
      {
        data: {
          route: { kind: 'author', data: { pagination: { page: 2 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('Jane Doe | Site (Page 2)');
  });

  test('author archive page 1 returns the precomposed meta_title without a suffix', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { meta_title: 'Jane Doe | Site' },
      {
        data: {
          route: { kind: 'author', data: { pagination: { page: 1 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('Jane Doe | Site');
  });

  test('author archive without an override falls back to author.name before site title', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const author = { name: 'Jane Doe', slug: 'jane' };
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      { author, meta_title: 'Jane Doe | Site' },
      {
        data: {
          route: { kind: 'author', data: { author, pagination: { page: 1 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('Jane Doe');
  });

  test('paginated route without a page= hash returns the base title unchanged', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title}}')(
      { meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 2 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News | Site');
  });

  test('locale-translated page suffix substitutes the % placeholder', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page="（%ページ目）"}}')(
      { meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 4 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News | Site（4ページ目）');
  });

  // Issue #869: lock in the canonical `{{meta_title page=(t " (Page %)")}}`
  // call shape themes use to opt into pagination-aware titles. The subexpr
  // form ensures the page= hash receives the *translated* suffix string,
  // not the literal "(Page %)". Wire a real i18n helper through so the
  // integration is end-to-end rather than asserting on the helper alone.
  test('`{{meta_title page=(t " (Page %)")}}` resolves to the translated suffix (issue #869)', () => {
    const engine = makeEngine({
      content: { site: { locale: 'ja' } } as unknown as NectarEngine['content'],
      theme: {
        locales: {
          en: { ' (Page %)': ' (Page %)' },
          ja: { ' (Page %)': '（%ページ目）' },
        },
      } as unknown as NectarEngine['theme'],
    });
    registerContentHelpers(engine);
    // Hand-register a minimal `t` helper mirroring the production lookup so
    // we don't pull every helper module into this test just for the suffix.
    engine.hb.registerHelper('t', function (this: unknown, key: unknown) {
      const k = String(key ?? '');
      const active = engine.theme.locales[engine.content.site.locale] ?? {};
      const fallback = engine.theme.locales.en ?? {};
      return active[k] || fallback[k] || k;
    });
    const out = engine.hb.compile('{{meta_title page=(t " (Page %)")}}')(
      { meta_title: 'News | Site' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 2 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News | Site（2ページ目）');
  });

  test('page hash without a `%` is appended verbatim regardless of pagination shape (issue #869)', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" -- archive"}}')(
      { meta_title: 'News' },
      {
        data: {
          route: { kind: 'tag', data: { pagination: { page: 3 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('News -- archive');
  });

  test('falls back to site title when neither meta_title nor title is set on a paginated archive', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{meta_title page=" (Page %)"}}')(
      {},
      {
        data: {
          route: { kind: 'index', data: { pagination: { page: 5 } } },
          site: { title: 'Site' },
        },
      },
    );
    expect(out).toBe('Site (Page 5)');
  });
});

describe('comments helper', () => {
  test('emits an empty placeholder when no config is wired', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{comments}}')({})).toBe('<div data-nectar-comments></div>');
  });

  test('off provider still emits the empty placeholder so theme markup is stable', () => {
    const engine = makeEngineWithComments({ provider: 'off' });
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{comments}}')({})).toBe('<div data-nectar-comments></div>');
  });

  test('hash params are exposed on the default comments container for client hooks', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments title="" count=false}}')({});
    expect(out).toBe(
      '<div data-nectar-comments data-comments-title="" data-comments-count="false"></div>',
    );
  });

  test('hash params are HTML-escaped when rendered as comments data attributes', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments title=title count=count}}')({
      title: '"<Comments>" & more',
      count: '"><script>alert(1)</script>',
    });
    expect(out).toContain('data-comments-title="&quot;&lt;Comments&gt;&quot; &amp; more"');
    expect(out).toContain('data-comments-count="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(out).not.toContain('<script>');
  });

  test('giscus renders the official script tag with sane defaults', () => {
    const engine = makeEngineWithComments({ provider: 'giscus', repo: 'acme/site' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain('<div data-nectar-comments></div>');
    expect(out).toContain('src="https://giscus.app/client.js"');
    expect(out).toContain('data-repo="acme/site"');
    expect(out).toContain('data-mapping="pathname"');
    expect(out).toContain('data-theme="preferred_color_scheme"');
    expect(out).toContain('data-reactions-enabled="1"');
    expect(out).toContain('crossorigin="anonymous"');
    expect(out).toContain('async');
  });

  test('configured providers receive comments hash params on their container', () => {
    const engine = makeEngineWithComments({ provider: 'giscus', repo: 'acme/site' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments title="Discussion" count=false}}')({});
    expect(out).toContain(
      '<div data-nectar-comments data-comments-title="Discussion" data-comments-count="false"></div>',
    );
    expect(out).toContain('src="https://giscus.app/client.js"');
  });

  test('giscus honors repo_id, category, category_id and overrides', () => {
    const engine = makeEngineWithComments({
      provider: 'giscus',
      repo: 'acme/site',
      repo_id: 'R_xyz',
      category: 'Announcements',
      category_id: 'DIC_abc',
      mapping: 'og:title',
      reactions_enabled: false,
      theme: 'dark',
      input_position: 'top',
    });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain('data-repo-id="R_xyz"');
    expect(out).toContain('data-category="Announcements"');
    expect(out).toContain('data-category-id="DIC_abc"');
    expect(out).toContain('data-mapping="og:title"');
    expect(out).toContain('data-reactions-enabled="0"');
    expect(out).toContain('data-theme="dark"');
    expect(out).toContain('data-input-position="top"');
  });

  test('giscus emits a hint comment when repo is missing (not a broken script)', () => {
    const engine = makeEngineWithComments({ provider: 'giscus' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain(
      '<!-- nectar comments: giscus provider requires components.comments.repo -->',
    );
    expect(out).not.toContain('giscus.app/client.js');
  });

  test('utterances renders the official script tag with defaults', () => {
    const engine = makeEngineWithComments({ provider: 'utterances', repo: 'acme/site' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain('src="https://utteranc.es/client.js"');
    expect(out).toContain('repo="acme/site"');
    expect(out).toContain('issue-term="pathname"');
    expect(out).toContain('theme="github-light"');
    expect(out).not.toContain('label=');
  });

  test('utterances honors issue_term, theme and label', () => {
    const engine = makeEngineWithComments({
      provider: 'utterances',
      repo: 'acme/site',
      issue_term: 'title',
      theme: 'github-dark',
      label: 'comment',
    });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain('issue-term="title"');
    expect(out).toContain('theme="github-dark"');
    expect(out).toContain('label="comment"');
  });

  test('utterances emits a hint comment when repo is missing', () => {
    const engine = makeEngineWithComments({ provider: 'utterances' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain(
      '<!-- nectar comments: utterances provider requires components.comments.repo -->',
    );
  });

  test('disqus emits an embed snippet that derives canonical URL from the active route', () => {
    const engine = makeEngineWithComments({ provider: 'disqus', shortname: 'mysite' });
    registerContentHelpers(engine);
    const tmpl = engine.hb.compile('{{comments}}');
    const out = tmpl({ id: 'post-42' }, { data: { route: { url: '/hello-world/' } } });
    expect(out).toContain('<div id="disqus_thread" data-nectar-comments></div>');
    expect(out).toContain('https://mysite.disqus.com/embed.js');
    expect(out).toContain('"https://example.com/hello-world/"');
    expect(out).toContain('"post-42"');
  });

  test('disqus identifier override wins over post id', () => {
    const engine = makeEngineWithComments({
      provider: 'disqus',
      shortname: 'mysite',
      identifier: 'custom-id',
    });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')(
      { id: 'post-42' },
      { data: { route: { url: '/p/' } } },
    );
    expect(out).toContain('"custom-id"');
    expect(out).not.toContain('"post-42"');
  });

  test('disqus rejects shortnames with characters outside the alphanumeric/dash set', () => {
    const engine = makeEngineWithComments({
      provider: 'disqus',
      shortname: 'evil";alert(1)//',
    });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain('alphanumeric/dash only');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('embed.js');
  });

  test('disqus emits a hint comment when shortname is missing', () => {
    const engine = makeEngineWithComments({ provider: 'disqus' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({});
    expect(out).toContain(
      '<!-- nectar comments: disqus provider requires components.comments.shortname -->',
    );
  });

  test('disqus inline <script> carries build.csp_nonce when configured', () => {
    const engine = makeEngineWithComments(
      { provider: 'disqus', shortname: 'mysite' },
      'https://example.com',
      { csp_nonce: 'rAnd0m+/=' },
    );
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')(
      { id: 'p1' },
      { data: { route: { url: '/p1/' } } },
    );
    expect(out).toContain('<script nonce="rAnd0m+/=">');
  });

  test('disqus inline <script> omits nonce when build.csp_nonce is unset', () => {
    const engine = makeEngineWithComments({ provider: 'disqus', shortname: 'mysite' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')(
      { id: 'p1' },
      { data: { route: { url: '/p1/' } } },
    );
    expect(out).toContain('<script>');
    expect(out).not.toMatch(/<script[^>]*nonce=/);
  });

  test('webmention.io renders a hookable container with canonical target', () => {
    const engine = makeEngineWithComments({
      provider: 'webmention.io',
      username: 'me.example.com',
    });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({}, { data: { route: { url: '/post/' } } });
    expect(out).toContain('class="webmentions"');
    expect(out).toContain('data-nectar-comments');
    expect(out).toContain('data-nectar-webmentions');
    expect(out).toContain('data-target="https://example.com/post/"');
    expect(out).toContain('data-username="me.example.com"');
  });

  test('webmention.io works without a username (target alone is sufficient)', () => {
    const engine = makeEngineWithComments({ provider: 'webmention.io' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({}, { data: { route: { url: '/post/' } } });
    expect(out).toContain('data-target="https://example.com/post/"');
    expect(out).not.toContain('data-username');
  });

  test('post.comments === false suppresses output entirely (no placeholder, no provider script)', () => {
    const engine = makeEngineWithComments({ provider: 'giscus', repo: 'acme/site' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({ comments: false });
    expect(out).toBe('');
  });

  test('post.comments === false suppresses hash-param comments output too', () => {
    const engine = makeEngineWithComments({ provider: 'giscus', repo: 'acme/site' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments title="Discussion" count=false}}')({
      comments: false,
    });
    expect(out).toBe('');
  });

  test('post.comments === false suppresses the default empty placeholder too', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{comments}}')({ comments: false })).toBe('');
  });

  test('post.comments === true falls through to the configured provider', () => {
    const engine = makeEngineWithComments({ provider: 'giscus', repo: 'acme/site' });
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{comments}}')({ comments: true });
    expect(out).toContain('data-repo="acme/site"');
  });

  test('post.comments undefined keeps the default placeholder so existing themes are unaffected', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    expect(engine.hb.compile('{{comments}}')({})).toBe('<div data-nectar-comments></div>');
  });
});

describe('authors helper', () => {
  const ctx = {
    authors: [
      { name: 'Ada', url: '/author/ada/' },
      { name: 'Grace', url: '/author/grace/' },
      { name: 'Linus', url: '/author/linus/' },
    ],
  };

  test('default inline output joins with ", " and autolinks', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors}}')(ctx);
    expect(out).toBe(
      '<a href="/author/ada/">Ada</a>, <a href="/author/grace/">Grace</a>, <a href="/author/linus/">Linus</a>',
    );
  });

  test('separator= overrides the join character', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors separator=" | " autolink=false}}')(ctx);
    expect(out).toBe('Ada | Grace | Linus');
  });

  test('autolink="false" (string) matches Ghost and disables linking', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors autolink="false"}}')(ctx);
    expect(out).toBe('Ada, Grace, Linus');
  });

  test('limit=1 renders only the first author', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors limit=1 autolink=false}}')(ctx);
    expect(out).toBe('Ada');
  });

  test('from= is 1-indexed (Ghost semantics) and skips earlier entries', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors from=2 autolink=false}}')(ctx);
    expect(out).toBe('Grace, Linus');
  });

  test('to= is 1-indexed inclusive', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors to=2 autolink=false}}')(ctx);
    expect(out).toBe('Ada, Grace');
  });

  test('limit= is applied before from/to (Ghost order)', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors limit=2 from=2 autolink=false}}')(ctx);
    expect(out).toBe('Grace');
  });

  test('prefix=/suffix= wrap a non-empty list', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors prefix="By " suffix="." autolink=false}}')(ctx);
    expect(out).toBe('By Ada, Grace, Linus.');
  });

  test('supports Liebling-style translated prefix with string from= hash', () => {
    const engine = makeEngine({
      content: { site: { locale: 'en' } } as unknown as NectarEngine['content'],
      theme: {
        locales: { en: { 'Among with...': 'Among with ' } },
      } as unknown as NectarEngine['theme'],
    });
    registerI18nHelpers(engine);
    registerContentHelpers(engine);
    const out = engine.hb.compile(
      '{{authors separator=", " prefix=(t "Among with...") from="2" autolink=false}}',
    )(ctx);
    expect(out).toBe('Among with Grace, Linus');
  });

  test('preserves SafeString hash output from subexpressions', () => {
    const engine = makeEngine();
    engine.hb.registerHelper('safePrefix', () => new engine.hb.SafeString('<span>By</span> '));
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors prefix=(safePrefix) autolink=false}}')(ctx);
    expect(out).toBe('<span>By</span> Ada, Grace, Linus');
  });

  test('prefix/suffix do not render against an empty list', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors prefix="By " suffix="."}}')({ authors: [] });
    expect(out).toBe('');
  });

  test('HTML-special author names are escaped in autolinked output', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors}}')({
      authors: [{ name: 'A&B<x>', url: '/u/a&b/' }],
    });
    expect(out).toBe('<a href="/u/a&amp;b/">A&amp;B&lt;x&gt;</a>');
  });

  // A corrupt author entry (e.g. authored before slug validation existed,
  // or smuggled past a custom loader) must not turn into a clickable XSS
  // vector. Collapse unknown schemes to `#` and ensure attribute-breaking
  // characters in the (now sanitized) href are HTML-escaped, not embedded raw.
  test('refuses javascript: author.url and falls back to "#"', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors}}')({
      authors: [{ name: 'Eve', url: 'javascript:alert(1)' }],
    });
    expect(out).toBe('<a href="#">Eve</a>');
    expect(out).not.toContain('javascript:');
  });

  test('block form still iterates with the original this context', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{#authors}}[{{name}}]{{/authors}}')(ctx);
    expect(out).toBe('[Ada][Grace][Linus]');
  });

  test('fallback= renders when the author list is empty', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors fallback="Anonymous"}}')({ authors: [] });
    expect(out).toBe('Anonymous');
  });

  test('fallback= still wraps with prefix/suffix when the list is empty', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors prefix="By " suffix="." fallback="Anonymous"}}')({
      authors: [],
    });
    expect(out).toBe('By Anonymous.');
  });

  test('visibility="public" mirrors the tags helper: keeps authors without an explicit visibility', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    // Nectar's loader does not stamp visibility on authors today, so the
    // default `public` filter must accept missing fields rather than wipe the
    // list — same convention as tags.
    const out = engine.hb.compile('{{authors visibility="public" autolink=false}}')({
      authors: [
        { name: 'Ada', url: '/author/ada/' },
        { name: 'Eve', url: '/author/eve/', visibility: 'internal' },
      ],
    });
    expect(out).toBe('Ada');
  });

  test('visibility="all" surfaces internal-tagged authors too', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors visibility="all" autolink=false}}')({
      authors: [
        { name: 'Ada', url: '/author/ada/' },
        { name: 'Eve', url: '/author/eve/', visibility: 'internal' },
      ],
    });
    expect(out).toBe('Ada, Eve');
  });
});

describe('tags helper', () => {
  const ctx = {
    tags: [
      { name: 'News', slug: 'news', url: '/tag/news/' },
      { name: 'R&D', slug: 'r-d', url: '/tag/r-d/' },
      { name: 'Ops', slug: 'ops', url: '/tag/ops/' },
    ],
  };

  test('default inline output joins with ", " and autolinks', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags}}')(ctx);
    expect(out).toBe(
      '<a href="/tag/news/">News</a>, <a href="/tag/r-d/">R&amp;D</a>, <a href="/tag/ops/">Ops</a>',
    );
  });

  test('separator= overrides the join character', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags separator=" | " autolink=false}}')(ctx);
    expect(out).toBe('News | R&amp;D | Ops');
  });

  test('autolink="false" (string) matches Ghost and disables linking', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags autolink="false"}}')(ctx);
    expect(out).toBe('News, R&amp;D, Ops');
  });

  test('limit= truncates from the start', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags limit=2 autolink=false}}')(ctx);
    expect(out).toBe('News, R&amp;D');
  });

  test('from= is 1-indexed (Ghost semantics) and skips earlier entries', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags from=2 autolink=false}}')(ctx);
    expect(out).toBe('R&amp;D, Ops');
  });

  test('to= is 1-indexed inclusive', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags to=2 autolink=false}}')(ctx);
    expect(out).toBe('News, R&amp;D');
  });

  test('limit= is applied before from/to (Ghost order)', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags limit=2 from=2 autolink=false}}')(ctx);
    expect(out).toBe('R&amp;D');
  });

  test('prefix=/suffix= wrap a non-empty list', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags prefix="Tagged: " suffix="." autolink=false}}')(ctx);
    expect(out).toBe('Tagged: News, R&amp;D, Ops.');
  });

  test('prefix/suffix do not render against an empty list', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags prefix="Tagged: " suffix="."}}')({ tags: [] });
    expect(out).toBe('');
  });

  test('HTML-special tag names are escaped in autolinked output', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags}}')({
      tags: [{ name: 'A&B<x>', slug: 'a-b-x', url: '/tag/a&b/' }],
    });
    expect(out).toBe('<a href="/tag/a&amp;b/">A&amp;B&lt;x&gt;</a>');
  });

  // Even though sanitizeUserSlug normalises slugs at load time, the rendered
  // href is the last line of defence: a corrupt tag.url (e.g. injected via a
  // custom content pipeline or unsafe theme partial) must not become a live
  // XSS sink. Both `javascript:` and attribute-breaking quote characters need
  // to collapse to `#` plus HTML-escaped output.
  test('refuses javascript: tag.url and falls back to "#"', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags}}')({
      tags: [{ name: 'News', slug: 'news', url: 'javascript:alert(1)' }],
    });
    expect(out).toBe('<a href="#">News</a>');
    expect(out).not.toContain('javascript:');
  });

  test('Handlebars escapeExpression covers attribute-breaking quote chars in tag.url', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags}}')({
      tags: [{ name: 'News', slug: 'news', url: '/tag/"><img src=x onerror=alert(1)>' }],
    });
    expect(out).not.toContain('"><img');
    expect(out).toContain('&quot;');
    expect(out).toContain('&gt;');
  });

  test('hides internal tags by default to match Ghost visibility', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags autolink=false}}')({
      tags: [
        { name: 'News', slug: 'news', url: '/tag/news/', visibility: 'public' },
        { name: 'Hidden', slug: 'hash-hidden', url: '/tag/hash-hidden/', visibility: 'internal' },
        { name: 'Ops', slug: 'ops', url: '/tag/ops/', visibility: 'public' },
      ],
    });
    expect(out).toBe('News, Ops');
  });

  test('visibility="all" surfaces internal tags too', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags visibility="all" autolink=false}}')({
      tags: [
        { name: 'News', slug: 'news', url: '/tag/news/', visibility: 'public' },
        { name: 'Hidden', slug: 'hash-hidden', url: '/tag/hash-hidden/', visibility: 'internal' },
      ],
    });
    expect(out).toBe('News, Hidden');
  });

  test('visibility="internal" returns only internal tags', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags visibility="internal" autolink=false}}')({
      tags: [
        { name: 'News', slug: 'news', url: '/tag/news/', visibility: 'public' },
        { name: 'Hidden', slug: 'hash-hidden', url: '/tag/hash-hidden/', visibility: 'internal' },
      ],
    });
    expect(out).toBe('Hidden');
  });

  test('block form still iterates with the original this context (filtered by visibility)', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{#tags}}[{{name}}]{{/tags}}')({
      tags: [
        { name: 'News', slug: 'news', url: '/tag/news/', visibility: 'public' },
        { name: 'Hidden', slug: 'hash-hidden', url: '/tag/hash-hidden/', visibility: 'internal' },
      ],
    });
    expect(out).toBe('[News]');
  });

  test('default visibility="public" omitted: hash- prefix slugs flagged internal are dropped', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    // Mirrors the loader output (slug.startsWith('hash-') -> visibility:'internal').
    const out = engine.hb.compile('{{tags autolink=false}}')({
      tags: [{ name: 'Hidden', slug: 'hash-x', url: '/tag/hash-x/', visibility: 'internal' }],
    });
    expect(out).toBe('');
  });

  test('fallback= renders when the tag list is empty', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags fallback="Untagged"}}')({ tags: [] });
    expect(out).toBe('Untagged');
  });

  test('fallback= still wraps with prefix/suffix when the list is empty', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags prefix="Tagged: " suffix="." fallback="None"}}')({
      tags: [],
    });
    expect(out).toBe('Tagged: None.');
  });

  test('fallback= escapes HTML special characters', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{tags fallback="<Untagged>"}}')({ tags: [] });
    expect(out).toBe('&lt;Untagged&gt;');
  });

  test('fallback= triggers when default visibility filters out every tag', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    // All tags are internal so the default `public` filter wipes the list,
    // forcing fallback to render rather than producing an empty string.
    const out = engine.hb.compile('{{tags fallback="Untagged"}}')({
      tags: [{ name: 'Hidden', slug: 'hash-x', url: '/tag/hash-x/', visibility: 'internal' }],
    });
    expect(out).toBe('Untagged');
  });
});

describe('post_class helper', () => {
  // The helper runs from `{{post_class}}` inside `{{#foreach posts}}` blocks
  // (Source's post-card.hbs is the canonical caller), so `this` is the
  // iterated post — not the root context. Regression coverage for #1119.
  test('emits `image` when the iterated post has a feature_image', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{post_class}}')({
      tags: [],
      feature_image: '/a.jpg',
      html: '<p>x</p>',
    });
    const tokens = out.split(' ');
    expect(tokens).toContain('post');
    expect(tokens).toContain('image');
    expect(tokens).not.toContain('no-image');
  });

  test('emits `no-image` and `no-content` when the iterated post is empty', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{post_class}}')({ tags: [], html: '' });
    const tokens = out.split(' ');
    expect(tokens).toContain('no-image');
    expect(tokens).toContain('no-content');
  });

  test('preserves tag-<slug> tokens alongside the new image/featured tokens', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{post_class}}')({
      tags: [{ slug: 'news' }],
      featured: true,
      feature_image: '/a.jpg',
      html: '<p>x</p>',
    });
    const tokens = out.split(' ');
    expect(tokens).toContain('tag-news');
    expect(tokens).toContain('featured');
    expect(tokens).toContain('image');
  });
});

describe('body_class helper', () => {
  test('falls back to the route-kind default when ctx.body_class is missing', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{body_class}}')({}, { data: { route: { kind: 'post' } } });
    expect(out).toBe('nectar-route-post');
  });

  test('ctx.body_class overrides the route-kind default', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{body_class}}')(
      { body_class: 'custom' },
      { data: { route: { kind: 'post' } } },
    );
    expect(out).toBe('custom');
  });

  test('post template fallback includes tag tokens for the current post', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{body_class}}')(
      { tags: [{ slug: 'news' }, { slug: 'sport' }] },
      { data: { route: { kind: 'post' } } },
    );
    const tokens = out.split(' ');
    expect(tokens).toContain('nectar-route-post');
    expect(tokens).toContain('tag-news');
    expect(tokens).toContain('tag-sport');
  });
});
