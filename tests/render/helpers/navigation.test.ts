import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerNavigationHelpers } from '~/render/helpers/navigation.ts';

interface NavItem {
  label: string;
  url: string;
}

function makeEngine(): NectarEngine {
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
});
