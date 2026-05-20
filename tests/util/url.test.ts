import { describe, expect, test } from 'bun:test';
import { absoluteUrl, absoluteUrlWithBasePath, withBasePath } from '~/util/url.ts';

describe('absoluteUrl', () => {
  test('joins a root-relative path against a trailing-slash base', () => {
    expect(absoluteUrl('https://example.com/', '/about/')).toBe('https://example.com/about/');
  });

  test('joins a root-relative path against a slashless base', () => {
    expect(absoluteUrl('https://example.com', '/about/')).toBe('https://example.com/about/');
  });

  test('returns absolute http URLs unchanged', () => {
    expect(absoluteUrl('https://example.com', 'https://other.example/x/')).toBe(
      'https://other.example/x/',
    );
  });

  test('returns the input unchanged when base is missing', () => {
    expect(absoluteUrl(undefined, '/about/')).toBe('/about/');
    expect(absoluteUrl('', '/about/')).toBe('/about/');
  });
});

describe('withBasePath', () => {
  test('prepends a non-root basePath to a root-relative path', () => {
    expect(withBasePath('/blog/', '/post-slug/')).toBe('/blog/post-slug/');
    expect(withBasePath('/repo/', '/tag/foo/')).toBe('/repo/tag/foo/');
  });

  test('is a no-op for the default `/` basePath', () => {
    expect(withBasePath('/', '/post-slug/')).toBe('/post-slug/');
  });

  test('treats undefined / empty basePath like `/`', () => {
    expect(withBasePath(undefined, '/x/')).toBe('/x/');
    expect(withBasePath('', '/x/')).toBe('/x/');
  });

  test('normalises a missing leading slash on the input path', () => {
    // Callers occasionally hand us a bare filename (e.g. `rss.xml`); the helper
    // should still produce a root-relative URL the browser can resolve.
    expect(withBasePath('/blog/', 'rss.xml')).toBe('/blog/rss.xml');
    expect(withBasePath('/', 'rss.xml')).toBe('/rss.xml');
  });

  test('returns absolute http(s) URLs unchanged', () => {
    expect(withBasePath('/blog/', 'https://cdn.example/foo.jpg')).toBe(
      'https://cdn.example/foo.jpg',
    );
    expect(withBasePath('/blog/', 'http://cdn.example/foo.jpg')).toBe('http://cdn.example/foo.jpg');
  });

  test('does not double-slash even when basePath lacks the conventional trailing slash', () => {
    // `normalizeBasePath` enforces a trailing slash upstream, but the helper
    // shouldn't crumble if a caller skips that step.
    expect(withBasePath('/blog', '/x/')).toBe('/blog/x/');
  });
});

describe('absoluteUrlWithBasePath', () => {
  test('composes site + base_path + path into a full external URL', () => {
    expect(absoluteUrlWithBasePath('https://example.com', '/blog/', '/post-slug/')).toBe(
      'https://example.com/blog/post-slug/',
    );
  });

  test('passes absolute http(s) URLs through untouched', () => {
    expect(
      absoluteUrlWithBasePath('https://example.com', '/blog/', 'https://other.example/x/'),
    ).toBe('https://other.example/x/');
  });

  test('matches absoluteUrl for the default `/` base_path (regression)', () => {
    expect(absoluteUrlWithBasePath('https://example.com', '/', '/post-slug/')).toBe(
      'https://example.com/post-slug/',
    );
    expect(absoluteUrlWithBasePath('https://example.com', undefined, '/post-slug/')).toBe(
      'https://example.com/post-slug/',
    );
  });
});
