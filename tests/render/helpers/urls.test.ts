import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerUrlHelpers } from '~/render/helpers/urls.ts';

function makeEngine(siteUrl = 'https://example.com'): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: { site: { url: siteUrl } } as unknown as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map<string, readonly unknown[]>(),
    render() {
      throw new Error('not used');
    },
  };
}

describe('url helper', () => {
  test('returns the relative url from the context by default', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url}}');
    expect(tpl({ url: '/hello/' })).toBe('/hello/');
  });

  test('returns ctx.url unchanged when absolute is not requested', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url}}');
    expect(tpl({ url: '/welcome/' })).toBe('/welcome/');
  });

  test('absolute=true resolves the url against the site origin', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url absolute=true}}');
    expect(tpl({ url: '/hello/' })).toBe('https://blog.example.com/hello/');
  });

  test('absolute="true" resolves the url against the site origin', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url absolute="true"}}');
    expect(tpl({ url: '/hello/' })).toBe('https://blog.example.com/hello/');
  });

  test('returns the input unchanged when the site URL is invalid (URL parser throws)', () => {
    const engine = makeEngine('not a url');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url absolute=true}}');
    expect(tpl({ url: '/hello/' })).toBe('/hello/');
  });

  test('returns an empty string when the context has no url', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url}}');
    expect(tpl({})).toBe('');
  });

  // Issue #470: Ghost's {{url}} accepts an optional positional argument so a
  // theme can write `{{url "/about/"}}` or `{{url post.url absolute=true}}`
  // without switching context. When supplied, the positional value wins over
  // `this.url`.
  test('uses the positional argument when one is supplied', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url "/about/"}}');
    expect(tpl({ url: '/ignored/' })).toBe('/about/');
  });

  test('absolute=true resolves the positional argument against the site origin', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url "/about/" absolute=true}}');
    expect(tpl({})).toBe('https://blog.example.com/about/');
  });

  test('falls back to this.url when the positional argument resolves to undefined', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    // `{{url missing}}` resolves to `undefined`; treat that as "no positional"
    // rather than empty so the context url still wins.
    const tpl = engine.hb.compile('{{url missing}}');
    expect(tpl({ url: '/fallback/' })).toBe('/fallback/');
  });
});

describe('social_url helper', () => {
  test('builds a Twitter URL and strips a leading "@"', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="twitter"}}');
    expect(tpl({ twitter: '@nectar' })).toBe('https://twitter.com/nectar');
  });

  test('builds a Mastodon URL from a user@host handle by routing to the host', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: '@alice@hachyderm.io' })).toBe('https://hachyderm.io/@alice');
  });

  test('Mastodon handle without a host falls back to mastodon.social', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'alice' })).toBe('https://mastodon.social/@alice');
  });

  test('returns an empty string when the requested handle is missing', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="twitter"}}');
    expect(tpl({})).toBe('');
  });

  test('returns an empty string when the network type is unknown', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="myspace"}}');
    expect(tpl({ myspace: 'tom' })).toBe('');
  });

  test('returns a Mastodon profile URL unchanged when the value is already a URL', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'https://hachyderm.io/@alice' })).toBe('https://hachyderm.io/@alice');
  });

  test('passes a full URL through for networks without a handle builder (e.g. discord)', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="discord"}}');
    expect(tpl({ discord: 'https://discord.gg/nectar' })).toBe('https://discord.gg/nectar');
  });

  test('returns a Twitter profile URL unchanged when the value is already a URL', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="twitter"}}');
    expect(tpl({ twitter: 'https://twitter.com/nectar' })).toBe('https://twitter.com/nectar');
  });

  test('rejects a Mastodon handle whose host contains attribute-breaking characters', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'me@evil.example/?" onmouseover=alert(1) x="' })).toBe('');
  });

  test('rejects a Mastodon handle whose host has a path segment', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'alice@hachyderm.io/extra' })).toBe('');
  });

  test('rejects a Mastodon handle whose host is a bare label without a dot', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'alice@localhost' })).toBe('');
  });

  test('rejects a Mastodon handle with more than one inner "@"', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'alice@evil@hachyderm.io' })).toBe('');
  });

  test('rejects a Mastodon handle whose user contains unsafe characters', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'al"ice@hachyderm.io' })).toBe('');
  });

  test('rejects a host-less Mastodon handle that contains unsafe characters', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'al ice' })).toBe('');
  });
});
