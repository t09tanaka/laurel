import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerAssetHelpers } from '~/render/helpers/assets.ts';
import type { ThemeImageSize } from '~/theme/types.ts';

function makeEngine(opts: {
  imageSizes?: Record<string, ThemeImageSize>;
  siteUrl?: string;
  basePath?: string;
}): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {
      build: { base_path: opts.basePath ?? '/' },
    } as NectarEngine['config'],
    content: {
      site: { url: opts.siteUrl ?? 'https://example.com' },
    } as unknown as NectarEngine['content'],
    theme: {
      assets: new Map(),
      pkg: { image_sizes: opts.imageSizes ?? {} },
    } as unknown as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

describe('img_url helper', () => {
  test('emits unique URLs for each size when path matches /content/images/', () => {
    const engine = makeEngine({
      imageSizes: {
        xs: { width: 160 },
        s: { width: 320 },
        m: { width: 600 },
      },
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size=size}}');
    const ctx = { feature_image: '/content/images/cover.jpg' };
    expect(tpl({ ...ctx, size: 'xs' })).toBe('/content/images/size/w160/cover.jpg');
    expect(tpl({ ...ctx, size: 's' })).toBe('/content/images/size/w320/cover.jpg');
    expect(tpl({ ...ctx, size: 'm' })).toBe('/content/images/size/w600/cover.jpg');
  });

  test('srcset entries differ across sizes (regression for issue #159)', () => {
    const engine = makeEngine({
      imageSizes: {
        xs: { width: 160 },
        s: { width: 320 },
        m: { width: 600 },
        l: { width: 960 },
        xl: { width: 1200 },
        xxl: { width: 2000 },
      },
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile(
      [
        '{{img_url feature_image size="xs"}}',
        '{{img_url feature_image size="s"}}',
        '{{img_url feature_image size="m"}}',
        '{{img_url feature_image size="l"}}',
        '{{img_url feature_image size="xl"}}',
        '{{img_url feature_image size="xxl"}}',
      ].join('|'),
    );
    const result = tpl({ feature_image: '/content/images/2026/05/hero.jpg' });
    const urls = result.split('|');
    expect(new Set(urls).size).toBe(6);
    expect(urls).toEqual([
      '/content/images/size/w160/2026/05/hero.jpg',
      '/content/images/size/w320/2026/05/hero.jpg',
      '/content/images/size/w600/2026/05/hero.jpg',
      '/content/images/size/w960/2026/05/hero.jpg',
      '/content/images/size/w1200/2026/05/hero.jpg',
      '/content/images/size/w2000/2026/05/hero.jpg',
    ]);
  });

  test('encodes width+height as wXhY when both are set', () => {
    const engine = makeEngine({
      imageSizes: { square: { width: 400, height: 400 } },
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="square"}}');
    expect(tpl({ feature_image: '/content/images/avatar.jpg' })).toBe(
      '/content/images/size/w400h400/avatar.jpg',
    );
  });

  test('returns original URL when no size requested', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe('/content/images/cover.jpg');
  });

  test('unknown size key falls through to original URL', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="bogus"}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe('/content/images/cover.jpg');
  });

  test('passes external URLs through unchanged (no /content/images/)', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: 'https://images.unsplash.com/photo.jpg' })).toBe(
      'https://images.unsplash.com/photo.jpg',
    );
  });

  test('injects size segment into same-host absolute URLs that contain /content/images/', () => {
    const engine = makeEngine({
      imageSizes: { m: { width: 600 } },
      siteUrl: 'https://blog.example.com',
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: 'https://blog.example.com/content/images/x.jpg' })).toBe(
      'https://blog.example.com/content/images/size/w600/x.jpg',
    );
  });

  test('passes external-host URLs through unchanged even when they contain /content/images/ (issue #1132)', () => {
    const engine = makeEngine({
      imageSizes: { m: { width: 600 } },
      siteUrl: 'https://example.com',
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: 'https://other.example.com/content/images/x.jpg' })).toBe(
      'https://other.example.com/content/images/x.jpg',
    );
  });

  test('passes protocol-relative URLs through unchanged (issue #1132)', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: '//cdn.example.com/content/images/x.jpg' })).toBe(
      '//cdn.example.com/content/images/x.jpg',
    );
  });

  test('passes data: URIs through unchanged (issue #1132)', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    // Use {{{ }}} to bypass Handlebars HTML escaping when asserting the raw URL.
    const tpl = engine.hb.compile('{{{img_url feature_image size="m"}}}');
    expect(tpl({ feature_image: 'data:image/png;base64,iVBORw0KGgo=' })).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });

  test('absolute=true leaves external URLs unchanged (no re-resolution via siteUrl, issue #1132)', () => {
    const engine = makeEngine({
      imageSizes: { m: { width: 600 } },
      siteUrl: 'https://blog.example.com',
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image absolute=true}}');
    expect(tpl({ feature_image: 'https://images.unsplash.com/photo.jpg' })).toBe(
      'https://images.unsplash.com/photo.jpg',
    );
  });

  test('does not double-inject when URL already contains a size segment', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: '/content/images/size/w160/cover.jpg' })).toBe(
      '/content/images/size/w160/cover.jpg',
    );
  });

  test('absolute=true resolves against site URL after size injection', () => {
    const engine = makeEngine({
      imageSizes: { m: { width: 600 } },
      siteUrl: 'https://blog.example.com',
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m" absolute=true}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(
      'https://blog.example.com/content/images/size/w600/cover.jpg',
    );
  });

  test('extracts feature_image from a post-like object', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url post size="m"}}');
    expect(tpl({ post: { feature_image: '/content/images/p.jpg' } })).toBe(
      '/content/images/size/w600/p.jpg',
    );
  });

  test('returns empty string when no image source is available', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url undef size="m"}}');
    expect(tpl({})).toBe('');
  });

  test('appends format segment after size when format="webp" (issue #112)', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m" format="webp"}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(
      '/content/images/size/w600/format/webp/cover.jpg',
    );
  });

  test('applies format segment without size when only format is provided', () => {
    const engine = makeEngine({});
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image format="webp"}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(
      '/content/images/format/webp/cover.jpg',
    );
  });

  test('supports avif, jpg, png, gif format values', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const cases = [
      ['avif', '/content/images/size/w600/format/avif/cover.jpg'],
      ['jpg', '/content/images/size/w600/format/jpg/cover.jpg'],
      ['png', '/content/images/size/w600/format/png/cover.jpg'],
      ['gif', '/content/images/size/w600/format/gif/cover.jpg'],
    ] as const;
    for (const [fmt, expected] of cases) {
      const tpl = engine.hb.compile(`{{img_url feature_image size="m" format="${fmt}"}}`);
      expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(expected);
    }
  });

  test('unknown format value is ignored (no segment injected)', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m" format="bmp"}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(
      '/content/images/size/w600/cover.jpg',
    );
  });

  test('does not double-inject format segment when URL already contains it', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m" format="webp"}}');
    expect(tpl({ feature_image: '/content/images/size/w600/format/webp/cover.jpg' })).toBe(
      '/content/images/size/w600/format/webp/cover.jpg',
    );
  });

  test('format works with absolute=true and resolves against site URL', () => {
    const engine = makeEngine({
      imageSizes: { m: { width: 600 } },
      siteUrl: 'https://blog.example.com',
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m" format="webp" absolute=true}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(
      'https://blog.example.com/content/images/size/w600/format/webp/cover.jpg',
    );
  });

  test('format is case-insensitive ("WEBP" -> "webp")', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m" format="WEBP"}}');
    expect(tpl({ feature_image: '/content/images/cover.jpg' })).toBe(
      '/content/images/size/w600/format/webp/cover.jpg',
    );
  });

  test('format ignored when URL does not contain /content/images/', () => {
    const engine = makeEngine({});
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image format="webp"}}');
    expect(tpl({ feature_image: 'https://images.unsplash.com/photo.jpg' })).toBe(
      'https://images.unsplash.com/photo.jpg',
    );
  });
});
