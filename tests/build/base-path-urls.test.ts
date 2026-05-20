import { describe, expect, test } from 'bun:test';
import { rewriteBasePathUrls } from '~/build/base-path-urls.ts';

describe('rewriteBasePathUrls', () => {
  test('prefixes root-relative URL attributes with build.base_path', () => {
    const html = [
      '<a href="/">Home</a>',
      '<img src="/content/images/photo.jpg" poster="/content/images/poster.jpg">',
      '<img data-src="/content/images/lazy.jpg">',
      '<svg><use xlink:href="/assets/icons.svg#search"></use></svg>',
      '<form action="/members/api/send-magic-link/">',
    ].join('');

    expect(rewriteBasePathUrls(html, '/blog/')).toBe(
      [
        '<a href="/blog/">Home</a>',
        '<img src="/blog/content/images/photo.jpg" poster="/blog/content/images/poster.jpg">',
        '<img data-src="/blog/content/images/lazy.jpg">',
        '<svg><use xlink:href="/blog/assets/icons.svg#search"></use></svg>',
        '<form action="/blog/members/api/send-magic-link/">',
      ].join(''),
    );
  });

  test('prefixes srcset candidates without touching descriptors', () => {
    const html =
      '<img srcset="/content/images/s.jpg 320w, /content/images/m.jpg 600w, https://cdn.test/x.jpg 900w">';

    expect(rewriteBasePathUrls(html, '/blog/')).toBe(
      '<img srcset="/blog/content/images/s.jpg 320w, /blog/content/images/m.jpg 600w, https://cdn.test/x.jpg 900w">',
    );
  });

  test('prefixes root-relative CSS url() values in style attributes', () => {
    const html =
      '<div style="background-image: url(\'/content/images/bg.jpg\'); mask: url(/assets/mask.svg)"></div>';

    expect(rewriteBasePathUrls(html, '/blog/')).toBe(
      '<div style="background-image: url(\'/blog/content/images/bg.jpg\'); mask: url(/blog/assets/mask.svg)"></div>',
    );
  });

  test('prefixes URL-shaped meta content values', () => {
    const html =
      '<meta property="og:image" content="/content/images/og.jpg"><meta name="description" content="/not-a-url">';

    expect(rewriteBasePathUrls(html, '/blog/')).toBe(
      '<meta property="og:image" content="/blog/content/images/og.jpg"><meta name="description" content="/not-a-url">',
    );
  });

  test('does not rewrite absolute, protocol-relative, anchor, or already-prefixed URLs', () => {
    const html = [
      '<a href="#main"></a>',
      '<a href="//cdn.test/file.css"></a>',
      '<a href="https://example.com/content/images/x.jpg"></a>',
      '<img src="/.netlify/images?url=%2Fblog%2Fcontent%2Fimages%2Fx.jpg&w=640">',
      '<img src="/blog/content/images/already.jpg">',
    ].join('');

    expect(rewriteBasePathUrls(html, '/blog/')).toBe(html);
  });

  test('returns root deploy HTML unchanged', () => {
    const html = '<img src="/content/images/photo.jpg">';
    expect(rewriteBasePathUrls(html, '/')).toBe(html);
  });
});
