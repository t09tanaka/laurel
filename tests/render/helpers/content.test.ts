import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerContentHelpers } from '~/render/helpers/content.ts';

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
): NectarEngine {
  return makeEngine({
    config: { components: { comments } } as unknown as NectarEngine['config'],
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
    expect(html).not.toContain('data-nectar-subscribe');
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

describe('content helper', () => {
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

  test('limit= truncates from the start', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{authors limit=2 autolink=false}}')(ctx);
    expect(out).toBe('Ada, Grace');
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

  test('block form still iterates with the original this context', () => {
    const engine = makeEngine();
    registerContentHelpers(engine);
    const out = engine.hb.compile('{{#authors}}[{{name}}]{{/authors}}')(ctx);
    expect(out).toBe('[Ada][Grace][Linus]');
  });
});
