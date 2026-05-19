import { describe, expect, test } from 'bun:test';
import { rewriteRecommendationsButton } from '~/build/portal-shim.ts';

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
    expect(out).toContain('data-nectar-recommendations-link');
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
    const matches = out.match(/data-nectar-recommendations-link/g) ?? [];
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
