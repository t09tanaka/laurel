import { describe, expect, test } from 'bun:test';
import { absolutizeHtmlUrls } from '~/build/feeds.ts';

describe('absolutizeHtmlUrls', () => {
  const base = 'https://example.com';

  test('rewrites root-relative href to absolute URL', () => {
    expect(absolutizeHtmlUrls('<a href="/about">about</a>', base)).toBe(
      '<a href="https://example.com/about">about</a>',
    );
  });

  test('rewrites root-relative src to absolute URL', () => {
    expect(absolutizeHtmlUrls('<img src="/content/images/foo.png">', base)).toBe(
      '<img src="https://example.com/content/images/foo.png">',
    );
  });

  test('handles single-quoted attribute values', () => {
    expect(absolutizeHtmlUrls("<a href='/x'>x</a>", base)).toBe(
      "<a href='https://example.com/x'>x</a>",
    );
  });

  test('rewrites video poster attribute', () => {
    expect(absolutizeHtmlUrls('<video poster="/media/p.jpg"></video>', base)).toBe(
      '<video poster="https://example.com/media/p.jpg"></video>',
    );
  });

  test('leaves absolute http(s) URLs untouched', () => {
    const html =
      '<a href="https://other.example/post">link</a><img src="http://cdn.example/x.png">';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves protocol-relative URLs untouched', () => {
    const html = '<img src="//cdn.example/x.png">';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves mailto: and tel: URLs untouched', () => {
    const html = '<a href="mailto:a@b.com">m</a><a href="tel:+1234">t</a>';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves anchor-only hrefs untouched', () => {
    const html = '<a href="#section">jump</a>';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('leaves relative (non-root) URLs untouched', () => {
    const html = '<a href="next-post/">next</a>';
    expect(absolutizeHtmlUrls(html, base)).toBe(html);
  });

  test('rewrites srcset entries that are root-relative', () => {
    const html = '<img srcset="/a.png 1x, /b.png 2x">';
    expect(absolutizeHtmlUrls(html, base)).toBe(
      '<img srcset="https://example.com/a.png 1x, https://example.com/b.png 2x">',
    );
  });

  test('mixed srcset rewrites only relative entries', () => {
    const html = '<img srcset="https://cdn.example/x.png 1x, /y.png 2x">';
    expect(absolutizeHtmlUrls(html, base)).toBe(
      '<img srcset="https://cdn.example/x.png 1x, https://example.com/y.png 2x">',
    );
  });

  test('strips trailing slash on base before joining', () => {
    expect(absolutizeHtmlUrls('<a href="/x">x</a>', 'https://example.com/')).toBe(
      '<a href="https://example.com/x">x</a>',
    );
  });

  test('returns original html when base is empty', () => {
    const html = '<a href="/x">x</a>';
    expect(absolutizeHtmlUrls(html, '')).toBe(html);
  });

  test('returns original html when html is empty', () => {
    expect(absolutizeHtmlUrls('', base)).toBe('');
  });

  test('rewrites multiple attributes within the same tag', () => {
    expect(absolutizeHtmlUrls('<a href="/p"><img src="/i.png"></a>', base)).toBe(
      '<a href="https://example.com/p"><img src="https://example.com/i.png"></a>',
    );
  });
});
