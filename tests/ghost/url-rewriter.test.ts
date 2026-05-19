import { describe, expect, test } from 'bun:test';
import { GhostUrlRewriter } from '~/ghost/url-rewriter.ts';

describe('GhostUrlRewriter', () => {
  test('rewrites absolute URLs on the source host to site-relative paths', () => {
    const r = new GhostUrlRewriter('https://oldblog.com');
    expect(r.rewriteUrl('https://oldblog.com/foo')).toBe('/foo');
    expect(r.rewriteUrl('https://oldblog.com/')).toBe('/');
    expect(r.rewriteUrl('https://oldblog.com')).toBe('/');
  });

  test('leaves other hosts and non-http(s) URLs untouched', () => {
    const r = new GhostUrlRewriter('https://oldblog.com');
    expect(r.rewriteUrl('https://example.com/foo')).toBe('https://example.com/foo');
    expect(r.rewriteUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(r.rewriteUrl('/already/relative')).toBe('/already/relative');
    expect(r.rewriteUrl('#anchor')).toBe('#anchor');
  });

  test('rewrites markdown links but leaves image markdown alone', () => {
    const r = new GhostUrlRewriter('https://oldblog.com');
    const out = r.rewriteText(
      '[link](https://oldblog.com/a) and ![alt](https://oldblog.com/b.jpg)',
    );
    expect(out).toContain('[link](/a)');
    expect(out).toContain('![alt](https://oldblog.com/b.jpg)');
  });

  test('rewrites <a href> in raw HTML', () => {
    const r = new GhostUrlRewriter('https://oldblog.com');
    const out = r.rewriteText('<a href="https://oldblog.com/x" class="c">x</a>');
    expect(out).toBe('<a href="/x" class="c">x</a>');
  });

  test('preserves query strings, fragments, and link titles', () => {
    const r = new GhostUrlRewriter('https://oldblog.com');
    expect(r.rewriteUrl('https://oldblog.com/a?b=1#c')).toBe('/a?b=1#c');
    const out = r.rewriteText('[t](https://oldblog.com/a "title")');
    expect(out).toBe('[t](/a "title")');
  });

  test('matches http and https variants of the source host', () => {
    const r = new GhostUrlRewriter('https://oldblog.com');
    expect(r.rewriteUrl('http://oldblog.com/p')).toBe('/p');
    expect(r.rewriteUrl('https://oldblog.com/p')).toBe('/p');
  });

  test('hostname comparison is case-insensitive', () => {
    const r = new GhostUrlRewriter('https://OldBlog.com');
    expect(r.rewriteUrl('https://oldblog.com/x')).toBe('/x');
    expect(r.rewriteUrl('https://OLDBLOG.COM/y')).toBe('/y');
  });

  test('throws on invalid source URL', () => {
    expect(() => new GhostUrlRewriter('not a url')).toThrow(/Invalid --source-url/);
    expect(() => new GhostUrlRewriter('ftp://oldblog.com')).toThrow(/Only http\(s\)/);
  });
});
