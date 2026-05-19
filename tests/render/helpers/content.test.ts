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
