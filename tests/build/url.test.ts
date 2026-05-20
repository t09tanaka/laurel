import { describe, expect, test } from 'bun:test';
import { absoluteContentUrl, absoluteUrl } from '~/build/url.ts';
import { configSchema } from '~/config/schema.ts';

describe('absoluteUrl', () => {
  test('composes a route against site.url and build.base_path', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { base_path: '/blog/' },
    });

    expect(absoluteUrl('/hello-world/', config)).toBe('https://example.com/blog/hello-world/');
  });

  test('preserves a path embedded in site.url before build.base_path', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://preview.example.com/site-root/' },
      build: { base_path: '/blog/' },
    });

    expect(absoluteUrl('/hello-world/', config)).toBe(
      'https://preview.example.com/site-root/blog/hello-world/',
    );
  });

  test('applies trailing_slash = never before composing the public URL', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { base_path: '/blog/', trailing_slash: 'never' },
    });

    expect(absoluteUrl('/hello-world/', config)).toBe('https://example.com/blog/hello-world');
  });

  test('preserves literal file routes regardless of trailing_slash policy', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { base_path: '/blog/', trailing_slash: 'always' },
    });

    expect(absoluteUrl('sitemap-posts.xml', config)).toBe(
      'https://example.com/blog/sitemap-posts.xml',
    );
  });

  test('composes the deployed homepage for a subpath build', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { base_path: '/blog/' },
    });

    expect(absoluteUrl('/', config)).toBe('https://example.com/blog/');
  });

  test('passes external absolute URLs through unchanged', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { base_path: '/blog/', trailing_slash: 'always' },
    });

    expect(absoluteUrl('https://cdn.example.org/image.png', config)).toBe(
      'https://cdn.example.org/image.png',
    );
  });

  test('does not apply build.base_path twice for content URLs that already include it', () => {
    const config = configSchema.parse({
      site: { title: 'T', url: 'https://example.com/' },
      build: { base_path: '/blog/' },
    });

    expect(absoluteContentUrl('/blog/hello-world/', config)).toBe(
      'https://example.com/blog/hello-world/',
    );
  });
});
