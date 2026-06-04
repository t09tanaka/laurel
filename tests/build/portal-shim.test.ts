import { describe, expect, test } from 'bun:test';
import { rewritePortalLinks, rewriteRecommendationsButton } from '~/build/portal-shim.ts';

describe('rewriteRecommendationsButton', () => {
  test('rewrites a Source-style button to an anchor deep-linking into /recommendations/', () => {
    const html = '<button data-portal="recommendations">See all <svg class="arrow"></svg></button>';
    const out = rewriteRecommendationsButton({ html, basePath: '/', enabled: true });
    expect(out).toContain('<a');
    expect(out).toContain('href="/recommendations/#all-recommendations"');
    expect(out).toContain('See all <svg class="arrow"></svg>');
    expect(out).toContain('</a>');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('</button>');
  });

  test('preserves non-portal attributes already on the button (class, id, aria-*)', () => {
    const html =
      '<button class="gh-button see-all" id="see-all" data-portal="recommendations" aria-label="See all">More</button>';
    const out = rewriteRecommendationsButton({ html, basePath: '/', enabled: true });
    expect(out).toContain('class="gh-button see-all"');
    expect(out).toContain('id="see-all"');
    expect(out).toContain('aria-label="See all"');
    expect(out).toContain('role="button"');
    expect(out).toContain('data-laurel-recommendations-link');
  });

  test('honours non-root build.base_path', () => {
    const html = '<button data-portal="recommendations">x</button>';
    const out = rewriteRecommendationsButton({ html, basePath: '/blog/', enabled: true });
    expect(out).toContain('href="/blog/recommendations/#all-recommendations"');
  });

  test('does not touch unrelated data-portal buttons (signin, signup, upgrade)', () => {
    const html = [
      '<button data-portal="signin">Sign in</button>',
      '<button data-portal="signup">Subscribe</button>',
      '<button data-portal="upgrade">Upgrade</button>',
    ].join('');
    const out = rewriteRecommendationsButton({ html, basePath: '/', enabled: true });
    expect(out).toBe(html);
  });

  test('no-ops when recommendations are not enabled even if the button is present', () => {
    const html = '<button data-portal="recommendations">x</button>';
    expect(rewriteRecommendationsButton({ html, basePath: '/', enabled: false })).toBe(html);
  });

  test('rewrites multiple buttons on the same page', () => {
    const html = [
      '<aside><button data-portal="recommendations">A</button></aside>',
      '<footer><button data-portal="recommendations">B</button></footer>',
    ].join('');
    const out = rewriteRecommendationsButton({ html, basePath: '/', enabled: true });
    const matches = out.match(/data-laurel-recommendations-link/g) ?? [];
    expect(matches.length).toBe(2);
    expect(out).not.toContain('<button');
  });

  test('leaves the surrounding markup untouched when no portal button is present', () => {
    const html = '<main><p>hi</p></main>';
    expect(rewriteRecommendationsButton({ html, basePath: '/', enabled: true })).toBe(html);
  });

  test('leaves trailing markup intact when a button is malformed (no closing tag)', () => {
    const html = '<button data-portal="recommendations">never closed';
    expect(rewriteRecommendationsButton({ html, basePath: '/', enabled: true })).toBe(html);
  });
});

describe('rewritePortalLinks', () => {
  test('no-ops when no URLs are configured', () => {
    const html = '<a href="#/portal/signin" data-portal="signin">Sign in</a>';
    expect(rewritePortalLinks({ html, urls: {} })).toBe(html);
  });

  test('rewrites <a data-portal="signin"> href to the configured URL', () => {
    const html = '<a href="#/portal/signin" data-portal="signin">Sign in</a>';
    const out = rewritePortalLinks({ html, urls: { signin: 'https://example.test/login' } });
    expect(out).toContain('href="https://example.test/login"');
    expect(out).toContain('data-portal="signin"');
    expect(out).not.toContain('#/portal/signin');
    expect(out).toContain('>Sign in</a>');
  });

  test('rewrites <button data-portal="signup"> to <a href="..." role="button">', () => {
    const html = '<button class="gh-button" data-portal="signup">Subscribe</button>';
    const out = rewritePortalLinks({
      html,
      urls: { signup: 'https://buttondown.email/my-newsletter' },
    });
    expect(out).toContain('<a class="gh-button"');
    expect(out).toContain('href="https://buttondown.email/my-newsletter"');
    expect(out).toContain('role="button"');
    expect(out).toContain('>Subscribe</a>');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('</button>');
  });

  test('rewrites multiple triggers independently in the same HTML', () => {
    const html = [
      '<a href="#/portal/signin" data-portal="signin">Sign in</a>',
      '<a class="gh-button" href="#/portal/signup" data-portal="signup">Subscribe</a>',
      '<button data-portal="upgrade">Upgrade</button>',
    ].join('');
    const out = rewritePortalLinks({
      html,
      urls: {
        signin: 'https://example.test/login',
        signup: 'https://example.test/subscribe',
        upgrade: 'https://example.test/checkout',
      },
    });
    expect(out).toContain('href="https://example.test/login"');
    expect(out).toContain('href="https://example.test/subscribe"');
    expect(out).toContain('href="https://example.test/checkout"');
    expect(out).not.toContain('<button');
  });

  test('leaves triggers untouched when no URL is configured for that trigger', () => {
    const html = [
      '<a href="#/portal/signin" data-portal="signin">Sign in</a>',
      '<a href="#/portal/account" data-portal="account">Account</a>',
    ].join('');
    const out = rewritePortalLinks({
      html,
      urls: { signin: 'https://example.test/login' },
    });
    expect(out).toContain('href="https://example.test/login"');
    // account stays put because no account URL was configured.
    expect(out).toContain('href="#/portal/account"');
  });

  test('does not touch data-portal="recommendations" (owned by rewriteRecommendationsButton)', () => {
    const html = '<button data-portal="recommendations">See all</button>';
    const out = rewritePortalLinks({
      html,
      urls: {
        signup: 'https://example.test/subscribe',
        signin: 'https://example.test/login',
      },
    });
    expect(out).toBe(html);
  });

  test('preserves unrelated attributes on the rewritten element', () => {
    const html =
      '<a id="signin-link" class="gh-button" aria-label="Sign in" href="#/portal/signin" data-portal="signin">Sign in</a>';
    const out = rewritePortalLinks({ html, urls: { signin: 'https://example.test/login' } });
    expect(out).toContain('id="signin-link"');
    expect(out).toContain('class="gh-button"');
    expect(out).toContain('aria-label="Sign in"');
    expect(out).toContain('href="https://example.test/login"');
    expect(out).toContain('data-portal="signin"');
  });

  test('escapes special characters in the injected URL', () => {
    const html = '<a href="#/portal/signin" data-portal="signin">x</a>';
    const out = rewritePortalLinks({
      html,
      urls: { signin: 'https://example.test/login?next="/account"&utm=a' },
    });
    expect(out).toContain('https://example.test/login?next=&quot;/account&quot;&amp;utm=a');
  });

  test('leaves trailing markup intact when a button is malformed (no closing tag)', () => {
    const html = '<button data-portal="signup">never closed';
    expect(rewritePortalLinks({ html, urls: { signup: 'https://example.test/x' } })).toBe(html);
  });

  test('invite-only removes signup/subscribe CTAs while keeping sign-in links rewriteable', () => {
    const html = [
      '<nav>',
      '<a class="signin" href="#/portal/signin" data-portal="signin">Sign In</a>',
      '<a class="subscribe" href="#/portal/signup" data-portal="signup">Subscribe</a>',
      '<button class="subscribe-button" data-portal="subscribe">Subscribe</button>',
      '<form class="signup" data-members-form="signup"><button>Subscribe</button></form>',
      '</nav>',
    ].join('');
    const out = rewritePortalLinks({
      html,
      urls: {
        signup: 'https://example.test/subscribe',
        signin: 'https://example.test/signin',
      },
      inviteOnly: true,
    });

    expect(out).toContain('href="https://example.test/signin"');
    expect(out).toContain('data-portal="signin"');
    expect(out).toContain('>Sign In</a>');
    expect(out).not.toContain('data-portal="signup"');
    expect(out).not.toContain('data-portal="subscribe"');
    expect(out).not.toContain('data-members-form');
    expect(out).not.toContain('Subscribe');
  });
});
