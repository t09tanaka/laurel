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

  test('absolute=true resolves the url against the site origin', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url absolute=true}}');
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
});
