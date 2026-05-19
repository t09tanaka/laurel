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
