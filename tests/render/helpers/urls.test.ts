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
  } as unknown as NectarEngine;
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

  test('absolute=true on the home URL matches Ghost without a trailing slash', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url absolute=true}}');
    expect(tpl({ url: '/' })).toBe('https://blog.example.com');
  });

  test('absolute="true" resolves the url against the site origin', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url absolute="true"}}');
    expect(tpl({ url: '/hello/' })).toBe('https://blog.example.com/hello/');
  });

  test('secure=true resolves the canonical url with an https scheme', () => {
    const engine = makeEngine('http://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url secure=true}}');
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

  test('returns an empty string when there is no root context', () => {
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

  test('absolute=true resolves a base-path model URL exactly once', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url author.url absolute=true}}');
    expect(tpl({ author: { url: '/blog/author/casper/' } })).toBe(
      'https://blog.example.com/blog/author/casper/',
    );
  });

  test('uses a positional object url over the current context url', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url tag}}');
    expect(tpl({ url: '/ignored/', tag: { url: '/tag/news/' } })).toBe('/tag/news/');
  });

  test('absolute=true resolves a positional object url against the site origin', () => {
    const engine = makeEngine('https://blog.example.com');
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{url tag absolute=true}}');
    expect(tpl({ tag: { url: '/tag/news/' } })).toBe('https://blog.example.com/tag/news/');
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

  test('builds supported social URLs from handles', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      [
        '{{social_url type="bluesky"}}',
        '{{social_url type="facebook"}}',
        '{{social_url type="instagram"}}',
        '{{social_url type="linkedin"}}',
        '{{social_url type="threads"}}',
        '{{social_url type="tiktok"}}',
        '{{social_url type="youtube"}}',
      ].join('|'),
    );
    expect(
      tpl({
        bluesky: 'alice.example',
        facebook: 'alice.page',
        instagram: '@alice',
        linkedin: 'alice-writes',
        threads: '@alice',
        tiktok: '@alice',
        youtube: '@alice',
      }),
    ).toBe(
      [
        'https://bsky.app/profile/alice.example',
        'https://facebook.com/alice.page',
        'https://www.instagram.com/alice',
        'https://www.linkedin.com/in/alice-writes',
        'https://www.threads.net/@alice',
        'https://www.tiktok.com/@alice',
        'https://www.youtube.com/alice',
      ].join('|'),
    );
  });

  test('accepts positional @site and author targets', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      '{{social_url @site type="twitter"}}|{{social_url author type="github"}}',
    );
    expect(
      tpl({ author: { github: 'nectar-dev' } }, { data: { site: { twitter: '@nectar' } } }),
    ).toBe('https://twitter.com/nectar|https://github.com/nectar-dev');
  });

  test('supports Ghost social aliases for x, youtube_channel, github, and mailto', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      [
        '{{social_url type="x"}}',
        '{{social_url type="youtube_channel"}}',
        '{{social_url type="github"}}',
        '{{social_url type="mailto"}}',
      ].join('|'),
    );
    expect(
      tpl({
        twitter: '@nectar',
        youtube_channel: '@nectarvideo',
        github: 'nectar-dev',
        mailto: 'hello@example.com',
      }),
    ).toBe(
      'https://twitter.com/nectar|https://www.youtube.com/@nectarvideo|https://github.com/nectar-dev|mailto:hello@example.com',
    );
  });

  test('returns an empty string for a Mastodon handle without a host', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{social_url type="mastodon"}}');
    expect(tpl({ mastodon: 'alice' })).toBe('');
    expect(tpl({ mastodon: '@alice' })).toBe('');
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

describe('twitter_url / facebook_url helpers', () => {
  test('builds a Twitter URL from a positional handle', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{twitter_url @site.twitter}}');
    expect(tpl({}, { data: { site: { twitter: '@nectar' } } })).toBe('https://twitter.com/nectar');
  });

  test('builds a Facebook URL from a positional handle', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{facebook_url @site.facebook}}');
    expect(tpl({}, { data: { site: { facebook: 'nectar.blog' } } })).toBe(
      'https://facebook.com/nectar.blog',
    );
  });

  test('passes full social URLs through unchanged', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{twitter_url twitter}} {{facebook_url facebook}}');
    expect(
      tpl({
        twitter: 'https://twitter.com/nectar',
        facebook: 'https://facebook.com/nectar.blog',
      }),
    ).toBe('https://twitter.com/nectar https://facebook.com/nectar.blog');
  });

  test('returns an empty string when the positional value is missing or not a string', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{twitter_url missing}}|{{facebook_url facebook}}');
    expect(tpl({ facebook: 42 })).toBe('|');
  });
});

describe('readable_url helper', () => {
  test('strips the scheme, leading www, and trailing slash from a bookmark URL', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{readable_url url}}');
    expect(tpl({ url: 'https://www.example.com/' })).toBe('example.com');
  });

  test('preserves meaningful paths while removing only the final slash', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{readable_url url}}');
    expect(tpl({ url: 'http://www.example.com/articles/hello-world/' })).toBe(
      'example.com/articles/hello-world',
    );
  });

  test('preserves query strings and fragments after normalising the path', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{{readable_url url}}}');
    expect(tpl({ url: 'https://www.example.com/search/?q=ghost#top' })).toBe(
      'example.com/search?q=ghost#top',
    );
  });

  test('keeps ports and non-www hosts intact', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{readable_url url}}');
    expect(tpl({ url: 'https://docs.example.com:8443/guides/' })).toBe(
      'docs.example.com:8443/guides',
    );
  });

  test('falls back to this.url when no positional value is supplied', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{readable_url}}');
    expect(tpl({ url: 'https://www.example.com/from-context/' })).toBe('example.com/from-context');
  });

  test('returns an empty string for missing or blank values', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile('{{readable_url missing}}|{{readable_url blank}}');
    expect(tpl({ blank: '   ' })).toBe('|');
  });
});

describe('social_accounts helper', () => {
  test('iterates site social accounts in Ghost platform order', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#social_accounts @site}}{{@number}}:{{type}}/{{name}}/{{username}}/{{href}}{{#if @last}}!{{else}}|{{/if}}{{/social_accounts}}',
    );

    expect(
      tpl(
        {},
        {
          data: {
            site: {
              twitter: '@nectar',
              facebook: 'nectar.blog',
              instagram: 'nectargram',
            },
          },
        },
      ),
    ).toBe(
      [
        '1:x/X/@nectar/https://twitter.com/nectar|',
        '2:facebook/Facebook/nectar.blog/https://facebook.com/nectar.blog|',
        '3:instagram/Instagram/nectargram/https://www.instagram.com/nectargram!',
      ].join(''),
    );
  });

  test('iterates author social accounts from the current context when no source is passed', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#social_accounts}}{{type}}={{href}};{{else}}EMPTY{{/social_accounts}}',
    );

    expect(
      tpl({
        linkedin: 'alice-writes',
        mastodon: '@alice@hachyderm.io',
        threads: 'alice_threads',
      }),
    ).toBe(
      [
        'linkedin=https://www.linkedin.com/in/alice-writes;',
        'threads=https://www.threads.net/@alice_threads;',
        'mastodon=https://hachyderm.io/@alice;',
      ].join(''),
    );
  });

  test('passes full profile URLs through and skips handles that cannot be normalised', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#social_accounts author}}{{type}}:{{href}}|{{/social_accounts}}',
    );

    expect(
      tpl({
        author: {
          bluesky: 'https://bsky.app/profile/alice.example',
          mastodon: 'alice',
          tiktok: '@alice',
        },
      }),
    ).toBe('bluesky:https://bsky.app/profile/alice.example|tiktok:https://www.tiktok.com/@alice|');
  });

  test('renders the inverse block when there are no connected accounts', () => {
    const engine = makeEngine();
    registerUrlHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#social_accounts author}}HIT{{else}}EMPTY{{/social_accounts}}',
    );

    expect(tpl({ author: { name: 'Alice' } })).toBe('EMPTY');
  });
});
