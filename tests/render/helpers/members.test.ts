import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { SUBSCRIBE_NOOP_REASON, SUBSCRIBE_NOOP_RUNTIME_WARNING } from '~/members/noop.ts';
import type { LaurelEngine } from '~/render/engine.ts';
import { registerHelpers } from '~/render/helpers/index.ts';
import { registerMemberHelpers } from '~/render/helpers/members.ts';

function makeEngine(overrides: Partial<LaurelEngine> = {}): LaurelEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {
      build: { base_path: '/' },
      components: {
        portal: { provider: 'none', paid: false, invite_only: false },
        subscribe: { provider: 'none', method: 'post' },
      },
      theme: { custom: {} },
    } as unknown as LaurelEngine['config'],
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
    } as unknown as LaurelEngine['content'],
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
    } as unknown as LaurelEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map(),
    render() {
      throw new Error('not used');
    },
    ...overrides,
  } as unknown as LaurelEngine;
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
      'signup_url',
      'tier',
      'tiers',
      'total_members',
      'total_paid_members',
      'price',
    ]) {
      expect(typeof engine.hb.helpers[name]).toBe('function');
    }
  });

  test('cancel_link is empty in static builds', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{cancel_link}}')({})).toBe('');
  });

  test('cancel_link ignores presentation hash values because cancellation is unavailable', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    const html = engine.hb.compile('{{cancel_link class=cls errorClass=err}}')({
      id: 'sub_1',
      cancel_at_period_end: false,
      cls: 'x"><script>',
      err: "err' onclick='alert(1)",
    });
    expect(html).toBe('');
  });

  test('signup_url is empty when portal signup has no static URL', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{signup_url}}')({})).toBe('');
  });

  test('signup_url resolves the configured portal provider signup URL', () => {
    const engine = makeEngine({
      config: {
        build: { base_path: '/' },
        components: {
          portal: {
            provider: 'buttondown',
            paid: false,
            invite_only: false,
            publication: 'letters',
          },
          subscribe: { provider: 'none', method: 'post' },
        },
        theme: { custom: {} },
      } as unknown as LaurelEngine['config'],
    });
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{signup_url}}')({})).toBe('https://buttondown.email/letters');
  });

  test('signup_url uses explicit portal signup_url overrides', () => {
    const engine = makeEngine({
      config: {
        build: { base_path: '/' },
        components: {
          portal: {
            provider: 'custom',
            paid: false,
            invite_only: false,
            signup_url: 'https://example.test/join?plan=free&ref=<theme>',
          },
          subscribe: { provider: 'none', method: 'post' },
        },
        theme: { custom: {} },
      } as unknown as LaurelEngine['config'],
    });
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{signup_url}}')({})).toBe(
      'https://example.test/join?plan&#x3D;free&amp;ref&#x3D;&lt;theme&gt;',
    );
  });

  test('member_count defaults to empty and rounds explicit counts', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{member_count}}')({})).toBe('');
    expect(engine.hb.compile('{{member_count}}')({ member_count: 1234 })).toBe('1,200+');
    expect(engine.hb.compile('{{member_count paid=true}}')({ paid: 87 })).toBe('80+');
  });

  test('member_count reads the static portal override from @site', () => {
    const engine = makeEngine({
      content: {
        site: {
          title: 'Example',
          url: 'https://example.test',
          locale: 'en',
          timezone: 'UTC',
          member_count: 1234,
        },
        posts: [],
        pages: [],
        tags: [],
        authors: [],
        tiers: [],
      } as unknown as LaurelEngine['content'],
    });
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{member_count}}')({})).toBe('1,200+');
  });

  test('total_members and total_paid_members alias member_count sources', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    const tpl = engine.hb.compile('{{total_members}}|{{total_paid_members}}');
    expect(tpl({ total_members: 1234, total_paid_members: 87 })).toBe('1,200+|80+');
  });

  test('signup emits a provider-resolved members form', () => {
    const engine = makeEngine({
      config: {
        build: { base_path: '/' },
        components: {
          portal: { provider: 'none', paid: false, invite_only: false },
          subscribe: { provider: 'buttondown', username: 'letters', method: 'post' },
        },
        theme: { custom: {} },
      } as unknown as LaurelEngine['config'],
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
    expect(html).toContain(`data-laurel-noop="${SUBSCRIBE_NOOP_REASON}"`);
    expect(html).toContain('window.console.warn');
    expect(html).toContain(SUBSCRIBE_NOOP_RUNTIME_WARNING);
    expect(html).toContain('onsubmit=');
    expect(html).toContain('<input class="gh-signup-input" type="text" name="name"');
    expect(html).toContain('data-members-email');
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
      } as unknown as LaurelEngine['content'],
    });
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{tiers}}')({})).toBe('Free tier');
    expect(engine.hb.compile('{{tiers}}')({ id: 'p1', title: 'Post' })).toBe('');
  });

  test('tier formats the first context tier name', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    expect(engine.hb.compile('{{tier}}')({ tiers: [{ name: 'Gold <Plus>' }] })).toBe(
      'Gold &lt;Plus&gt;',
    );
  });

  test('products and product alias legacy Ghost tier helpers', () => {
    const engine = makeEngine();
    registerMemberHelpers(engine);
    const ctx = { tiers: [{ name: 'Gold' }] };
    expect(engine.hb.compile('{{products}}|{{product}}')(ctx)).toBe('Gold tier|Gold');
  });
});
