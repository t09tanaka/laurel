import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerHelpers } from '~/render/helpers/index.ts';
import { registerMemberHelpers } from '~/render/helpers/members.ts';

function makeEngine(overrides: Partial<NectarEngine> = {}): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {
      build: { base_path: '/' },
      components: {
        subscribe: { provider: 'none', method: 'post' },
      },
      theme: { custom: {} },
    } as unknown as NectarEngine['config'],
    content: {
      site: {
        title: 'Example',
        url: 'https://example.test',
        locale: 'en',
        timezone: 'UTC',
      },
      posts: [],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
    } as unknown as NectarEngine['content'],
    theme: {
      name: 'test',
      partials: {},
      assets: new Map(),
      pkg: {
        image_sizes: {},
        posts_per_page: 5,
        card_assets: true,
        custom: {},
        customDefaults: {},
      },
      locales: {},
    } as unknown as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map(),
    render() {
      throw new Error('not used');
    },
    ...overrides,
  };
}

describe('member helpers', () => {
  test('registerHelpers installs member helper names alongside comment_count and price', () => {
    const engine = makeEngine();
    registerHelpers(engine);
    for (const name of [
      'cancel_link',
      'comment_count',
      'member_count',
      'signup',
      'tiers',
      'price',
    ]) {
      expect(typeof engine.hb.helpers[name]).toBe('function');
    }
  });

  test('cancel_link renders a static cancellation placeholder outside a subscription context', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{cancel_link}}')({})).toBe(
      '<a data-cancel-subscription class="gh-subscription-cancel">Cancel subscription</a>',
    );
  });

  test('cancel_link escapes placeholder class and errorClass hash values', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    const html = engine.hb.compile('{{cancel_link class=cls errorClass=err}}')({
      id: 'sub_1',
      cancel_at_period_end: false,
      cls: 'x"><script>',
      err: "err' onclick='alert(1)",
    });
    expect(html).toBe(
      '<a data-cancel-subscription class="x&quot;&gt;&lt;script&gt;">Cancel subscription</a><span data-cancel-subscription-error class="err&#39; onclick=&#39;alert(1)"></span>',
    );
  });

  test('member_count safely falls back to zero and rounds configured counts', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{member_count}}')({})).toBe('0');
    expect(engine.hb.compile('{{member_count}}')({ member_count: 1234 })).toBe('1,200+');
    expect(engine.hb.compile('{{member_count paid=true}}')({ paid: 87 })).toBe('80+');
  });

  test('signup emits a provider-resolved members form', () => {
    const engine = makeEngine({
      config: {
        build: { base_path: '/' },
        components: {
          subscribe: { provider: 'buttondown', username: 'letters', method: 'post' },
        },
        theme: { custom: {} },
      } as unknown as NectarEngine['config'],
    });
    registerMemberHelpers(engine);
    const html = engine.hb.compile('{{signup buttonText="Join <today>"}}')({});
    expect(html).toBe(
      '<form class="gh-signup-form" data-members-form="signup" action="https://buttondown.email/api/emails/embed-subscribe/letters" method="post"><input class="gh-signup-input" type="email" name="email" placeholder="Email address" autocomplete="email" required data-members-email><button class="gh-signup-button" type="submit" data-members-submit>Join &lt;today&gt;</button></form>',
    );
  });

  test('signup keeps provider=none forms disabled but present', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    const html = engine.hb.compile('{{signup name=true}}')({});
    expect(html).toBe(
      '<form class="gh-signup-form" data-members-form="signup" action="#" method="post" onsubmit="event.preventDefault();return false;"><input class="gh-signup-input" type="text" name="name" autocomplete="name" data-members-name><input class="gh-signup-input" type="email" name="email" placeholder="Email address" autocomplete="email" required data-members-email><button class="gh-signup-button" type="submit" data-members-submit>Subscribe</button></form>',
    );
  });

  test('tiers formats context tiers with escaped names and separators', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    const html = engine.hb.compile('{{tiers prefix=prefix separator=" | " lastSeparator=" | "}}')({
      prefix: 'Access <with>: ',
      tiers: [{ name: 'Bronze' }, { name: 'Gold <Plus>' }],
    });
    expect(html).toBe('Access &lt;with&gt;: Bronze | Gold &lt;Plus&gt; tiers');
  });

  test('tiers can format configured site tiers when called outside a post/page context', () => {
    const engine = makeEngine({
      content: {
        site: { title: 'Example', url: 'https://example.test', locale: 'en', timezone: 'UTC' },
        posts: [],
        pages: [],
        tags: [],
        authors: [],
        tiers: [{ id: 'free', slug: 'free', name: 'Free' }],
      } as unknown as NectarEngine['content'],
    });
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{tiers}}')({})).toBe('Free tier');
    expect(engine.hb.compile('{{tiers}}')({ id: 'p1', title: 'Post' })).toBe('');
  });
});
