import { describe, expect, test } from 'bun:test';
import { injectSkipLink } from '~/build/a11y.ts';

describe('injectSkipLink', () => {
  test('inserts a skip link as the first node inside <body>', () => {
    const input =
      '<!doctype html><html><head><title>t</title></head><body class="x"><h1>hi</h1></body></html>';
    const out = injectSkipLink(input);
    const bodyOpen = out.indexOf('<body class="x">') + '<body class="x">'.length;
    const skipPos = out.indexOf('class="nectar-skip-link');
    const h1Pos = out.indexOf('<h1>');
    expect(skipPos).toBeGreaterThan(bodyOpen);
    expect(skipPos).toBeLessThan(h1Pos);
  });

  test('emits an anchor targeting #main with visible text', () => {
    const out = injectSkipLink('<body><main id="main"></main></body>');
    expect(out).toMatch(/<a [^>]*class="nectar-skip-link[^"]*"[^>]*href="#main"[^>]*>/);
    expect(out).toContain('>Skip to content</a>');
  });

  test('targets the existing first <main> id when a theme uses a non-main id', () => {
    const out = injectSkipLink('<body><main id="site-main"></main></body>');
    expect(out).toMatch(/<a [^>]*class="nectar-skip-link[^"]*"[^>]*href="#site-main"[^>]*>/);
  });

  test('falls back to #main when the document has no <main> id', () => {
    const out = injectSkipLink('<body><main></main></body>');
    expect(out).toMatch(/<a [^>]*class="nectar-skip-link[^"]*"[^>]*href="#main"[^>]*>/);
  });

  test('includes inline styles so the link is offscreen until focused', () => {
    const out = injectSkipLink('<body></body>');
    expect(out).toContain('id="nectar-skip-link-style"');
    expect(out).toMatch(/\.nectar-skip-link\s*\{[^}]*position:absolute/);
    expect(out).toMatch(/\.nectar-skip-link:focus\s*\{[^}]*position:fixed/);
  });

  test('is idempotent — does not double-inject when already present', () => {
    const once = injectSkipLink('<body><p>x</p></body>');
    const twice = injectSkipLink(once);
    const occurrences = twice.match(/class="nectar-skip-link/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(twice).toBe(once);
  });

  test('handles uppercase BODY and arbitrary attributes', () => {
    const input = '<HTML><BODY ID="root" data-x="1"><span>y</span></BODY></HTML>';
    const out = injectSkipLink(input);
    expect(out).toContain('class="nectar-skip-link');
    expect(out.indexOf('class="nectar-skip-link')).toBeLessThan(out.indexOf('<span>'));
  });

  test('returns input unchanged when no <body> tag is present', () => {
    const input = '<div>fragment only</div>';
    expect(injectSkipLink(input)).toBe(input);
  });

  test('stamps the configured CSP nonce onto the skip-link <style> tag', () => {
    const out = injectSkipLink('<body></body>', 'abc123');
    expect(out).toMatch(
      /<style id="nectar-skip-link-style" nonce="abc123">[^<]*\.nectar-skip-link\{/,
    );
  });

  test('omits nonce attribute when no CSP nonce is configured', () => {
    const out = injectSkipLink('<body></body>');
    expect(out).toContain('<style id="nectar-skip-link-style">');
    expect(out).not.toMatch(/<style[^>]*nonce=/);
  });
});
