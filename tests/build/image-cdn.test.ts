import { describe, expect, test } from 'bun:test';
import { rewriteImageCdnUrls } from '~/build/image-cdn.ts';
import type { NectarConfig } from '~/config/schema.ts';

function makeConfig(overrides: Partial<NectarConfig['image_cdn']> = {}): NectarConfig {
  return {
    site: { url: 'https://example.com' },
    build: { base_path: '/' },
    image_cdn: {
      enabled: true,
      adapter: 'cloudflare',
      quality: 85,
      format: 'auto',
      path_prefixes: ['/content/images/'],
      signature: 'insecure',
      ...overrides,
    },
  } as NectarConfig;
}

describe('rewriteImageCdnUrls', () => {
  test('leaves HTML unchanged when image_cdn is disabled', () => {
    const config = makeConfig({ enabled: false });
    const html = '<img src="/content/images/cover.jpg">';

    expect(rewriteImageCdnUrls(html, { config })).toBe(html);
  });

  test('rewrites local image attributes through Cloudflare shape', () => {
    const config = makeConfig();
    const html = [
      '<link rel="preload" as="image" href="/content/images/hero.jpg">',
      '<meta property="og:image" content="/content/images/hero.jpg">',
      '<picture>',
      '<source srcset="/content/images/hero.jpg 600w, /content/images/hero@2x.jpg 1200w">',
      '<img src="/content/images/hero.jpg" width="800">',
      '</picture>',
    ].join('');

    const out = rewriteImageCdnUrls(html, { config });

    expect(out).toContain('href="/cdn-cgi/image/format=auto,quality=85/content/images/hero.jpg"');
    expect(out).toContain(
      'content="/cdn-cgi/image/format=auto,quality=85/content/images/hero.jpg"',
    );
    expect(out).toContain(
      'srcset="/cdn-cgi/image/format=auto,quality=85,width=600/content/images/hero.jpg 600w, /cdn-cgi/image/format=auto,quality=85,width=1200/content/images/hero@2x.jpg 1200w"',
    );
    expect(out).toContain(
      'src="/cdn-cgi/image/format=auto,quality=85,width=800/content/images/hero.jpg"',
    );
  });

  test('skips external protocol-relative data and non-image paths', () => {
    const config = makeConfig();
    const html = [
      '<img src="https://cdn.example.net/content/images/remote.jpg">',
      '<img src="//example.com/content/images/protocol.jpg">',
      '<img src="data:image/png;base64,AAAA">',
      '<img src="/assets/built/screen.css">',
    ].join('');

    expect(rewriteImageCdnUrls(html, { config })).toBe(html);
  });

  test('accepts same-site absolute URLs and base_path-prefixed image paths', () => {
    const config = makeConfig({ base_url: 'https://images.example.com' });
    config.build.base_path = '/blog/';
    const html = [
      '<img src="https://example.com/content/images/a.jpg">',
      '<img src="/blog/content/images/b.jpg">',
    ].join('');

    const out = rewriteImageCdnUrls(html, { config });

    expect(out).toContain(
      'src="https://images.example.com/cdn-cgi/image/format=auto,quality=85/content/images/a.jpg"',
    );
    expect(out).toContain(
      'src="https://images.example.com/cdn-cgi/image/format=auto,quality=85/blog/content/images/b.jpg"',
    );
  });

  test('emits Netlify and Vercel query adapter shapes', () => {
    const netlify = rewriteImageCdnUrls('<img src="/content/images/a.jpg" width="640">', {
      config: makeConfig({ adapter: 'netlify' }),
    });
    const vercel = rewriteImageCdnUrls('<source srcset="/content/images/a.jpg 640w">', {
      config: makeConfig({ adapter: 'vercel' }),
    });

    expect(netlify).toBe(
      '<img src="/.netlify/images?url=%2Fcontent%2Fimages%2Fa.jpg&amp;w=640&amp;q=85" width="640">',
    );
    expect(vercel).toBe(
      '<source srcset="/_vercel/image?url=%2Fcontent%2Fimages%2Fa.jpg&amp;w=640&amp;q=85 640w">',
    );
  });

  test('skips Vercel single URLs without width unless default_width is configured', () => {
    const skipped = rewriteImageCdnUrls('<img src="/content/images/a.jpg">', {
      config: makeConfig({ adapter: 'vercel' }),
    });
    const rewritten = rewriteImageCdnUrls('<img src="/content/images/a.jpg">', {
      config: makeConfig({ adapter: 'vercel', default_width: 1200 }),
    });

    expect(skipped).toBe('<img src="/content/images/a.jpg">');
    expect(rewritten).toBe(
      '<img src="/_vercel/image?url=%2Fcontent%2Fimages%2Fa.jpg&amp;w=1200&amp;q=85">',
    );
  });

  test('emits Cloudinary and imgproxy fetch shapes from absolute site URLs', () => {
    const cloudinary = rewriteImageCdnUrls('<img src="/content/images/a.jpg" width="640">', {
      config: makeConfig({
        adapter: 'cloudinary',
        base_url: 'https://res.cloudinary.com/demo',
        format: 'webp',
      }),
    });
    const imgproxy = rewriteImageCdnUrls('<img src="/content/images/a.jpg" width="640">', {
      config: makeConfig({
        adapter: 'imgproxy',
        base_url: 'https://imgproxy.example.com',
        format: 'webp',
        signature: 'signed',
      }),
    });

    expect(cloudinary).toBe(
      '<img src="https://res.cloudinary.com/demo/image/fetch/f_webp,q_85,w_640/https%3A%2F%2Fexample.com%2Fcontent%2Fimages%2Fa.jpg" width="640">',
    );
    expect(imgproxy).toBe(
      '<img src="https://imgproxy.example.com/signed/rs:fit:640:0/q:85/f:webp/plain/https%3A%2F%2Fexample.com%2Fcontent%2Fimages%2Fa.jpg" width="640">',
    );
  });
});
