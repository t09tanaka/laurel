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

  test('injects size segment into external-host URLs whose path contains /content/images/ (issue #463 — Ghost CDN host support)', () => {
    const engine = makeEngine({
      imageSizes: { m: { width: 600 } },
      siteUrl: 'https://example.com',
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    // Ghost CDN with a different host still understands /content/images/size/wXXX/...
    // so we MUST inject the size segment for resize to take effect.
    expect(tpl({ feature_image: 'https://cdn.example.com/content/images/2024/01/foo.jpg' })).toBe(
      'https://cdn.example.com/content/images/size/w600/2024/01/foo.jpg',
    );
  });

  test('injects size segment into protocol-relative URLs whose path contains /content/images/ (issue #463)', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: '//cdn.example.com/content/images/x.jpg' })).toBe(
      '//cdn.example.com/content/images/size/w600/x.jpg',
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

  test('extracts url from a generic media object', () => {
    const engine = makeEngine({});
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url obj}}');
    expect(tpl({ obj: { url: 'https://cdn.example.com/x.png' } })).toBe(
      'https://cdn.example.com/x.png',
    );
  });

  test('returns empty string when no image source is available', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url undef size="m"}}');
    expect(tpl({})).toBe('');
  });

  test('SVG sources skip size segment rewriting (issues #49 / #140 / #534)', () => {
    // SVG is vector — there is no raster variant to point at, and the resize
    // pipeline (generateThemeImageSizeVariants) intentionally skips SVG. If
    // img_url still rewrote the URL we would emit srcsets full of 404s; the
    // browser would fall back to the original anyway, just after a wasted
    // round trip and a Lighthouse CLS hit. Easier to just return the original.
    const engine = makeEngine({
      imageSizes: {
        s: { width: 320 },
        m: { width: 600 },
        xxl: { width: 2000 },
      },
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile(
      [
        '{{img_url cover size="s"}}',
        '{{img_url cover size="m"}}',
        '{{img_url cover size="xxl"}}',
      ].join('|'),
    );
    const result = tpl({ cover: '/content/images/welcome-cover.svg' });
    expect(result).toBe(
      '/content/images/welcome-cover.svg|/content/images/welcome-cover.svg|/content/images/welcome-cover.svg',
    );
  });

  test('SVG sources skip format segment too', () => {
    // Re-encoding an SVG to webp/avif would defeat the point of vector. Even
    // if a theme template asks for `size="m" format="webp"` on an SVG, return
    // the original — sharp cannot produce the requested variant anyway.
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url cover size="m" format="webp"}}');
    expect(tpl({ cover: '/content/images/logo.svg' })).toBe('/content/images/logo.svg');
  });

  test('SVG detection survives query strings and fragments', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    // Use triple-stash to bypass Handlebars HTML escaping when asserting the
    // raw URL — we are checking the helper's output, not what Handlebars does
    // to `=` characters in attribute context.
    const tpl = engine.hb.compile('{{{img_url cover size="m"}}}');
    expect(tpl({ cover: '/content/images/logo.svg?v=2' })).toBe('/content/images/logo.svg?v=2');
  });

  test('SVG detection is case-insensitive on extension', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url cover size="m"}}');
    expect(tpl({ cover: '/content/images/LOGO.SVG' })).toBe('/content/images/LOGO.SVG');
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

  // The following test cases are explicit completion-criteria checks for
  // issue #463 (img_url should inject /content/images/size/wXXX/ on absolute
  // Ghost CDN URLs).
  test('issue #463: relative /content/images/foo.jpg with size="s" -> /content/images/size/w300/foo.jpg', () => {
    const engine = makeEngine({ imageSizes: { s: { width: 300 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="s"}}');
    expect(tpl({ feature_image: '/content/images/foo.jpg' })).toBe(
      '/content/images/size/w300/foo.jpg',
    );
  });

  test('issue #463: absolute CDN URL with size="m" gets size segment injected, host preserved', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: 'https://cdn.example.com/content/images/2024/01/foo.jpg' })).toBe(
      'https://cdn.example.com/content/images/size/w600/2024/01/foo.jpg',
    );
  });

  test('issue #463: absolute CDN URL that already has size segment is not re-injected', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(
      tpl({ feature_image: 'https://cdn.example.com/content/images/size/w300/2024/01/foo.jpg' }),
    ).toBe('https://cdn.example.com/content/images/size/w300/2024/01/foo.jpg');
  });

  test('issue #463: non-Ghost URL (no /content/images/) is left untouched', () => {
    const engine = makeEngine({ imageSizes: { m: { width: 600 } } });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{img_url feature_image size="m"}}');
    expect(tpl({ feature_image: 'https://images.unsplash.com/photo.jpg' })).toBe(
      'https://images.unsplash.com/photo.jpg',
    );
  });
});

describe('asset helper (issue #1137 — context-aware encoding)', () => {
  test('does not break out of an href="…" attribute when the filename contains quotes/angle brackets', () => {
    const engine = makeEngine({});
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('<link href="{{asset "a\\"><script>x</script>.css"}}">');
    const out = tpl({});
    // URL construction percent-encodes path characters before the helper marks
    // the URL safe for href usage.
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('"><');
    expect(out).toBe('<link href="/assets/a%22%3E%3Cscript%3Ex%3C/script%3E.css">');
  });

  test('basic URL emits without HTML-significant characters when filename is safe', () => {
    const engine = makeEngine({ basePath: '/' });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "built/screen.css"}}');
    expect(tpl({})).toBe('/assets/built/screen.css');
  });

  test('resolves a bare logical path when only the assets-prefixed key is registered', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/built/source.js', {
      logicalPath: 'assets/built/source.js',
      fingerprintedPath: 'assets/built/source.abc123def0.js',
      sourcePath: '/theme/assets/built/source.js',
      hash: 'abc123def0',
      integrity: 'sha384-source',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "built/source.js"}}');
    expect(tpl({})).toBe('/assets/built/source.abc123def0.js');
  });

  test('prefers a minified asset map entry when hasMinFile is truthy', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/built/screen.css', {
      logicalPath: 'assets/built/screen.css',
      fingerprintedPath: 'assets/built/screen.abc123.css',
      sourcePath: '/theme/assets/built/screen.css',
      hash: 'abc123',
      integrity: 'sha384-screen',
      size: 42,
    });
    engine.theme.assets.set('assets/built/screen.min.css', {
      logicalPath: 'assets/built/screen.min.css',
      fingerprintedPath: 'assets/built/screen.min.def456.css',
      sourcePath: '/theme/assets/built/screen.min.css',
      hash: 'def456',
      integrity: 'sha384-screen-min',
      size: 21,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile(
      '{{asset "built/screen.css"}}|{{asset "built/screen.css" hasMinFile=true}}',
    );
    expect(tpl({})).toBe('/assets/built/screen.abc123.css|/assets/built/screen.min.def456.css');
  });

  test('falls back to the requested asset when hasMinFile has no minified match', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/built/screen.css', {
      logicalPath: 'assets/built/screen.css',
      fingerprintedPath: 'assets/built/screen.abc123.css',
      sourcePath: '/theme/assets/built/screen.css',
      hash: 'abc123',
      integrity: 'sha384-screen',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "built/screen.css" hasMinFile=true}}');
    expect(tpl({})).toBe('/assets/built/screen.abc123.css');
  });

  test('resolves a fingerprinted path for a known assets-prefixed key with build base_path', () => {
    const engine = makeEngine({ basePath: '/blog' });
    engine.theme.assets.set('assets/css/screen.css', {
      logicalPath: 'assets/css/screen.css',
      fingerprintedPath: 'assets/css/screen.abc123.css',
      sourcePath: '/theme/assets/css/screen.css',
      hash: 'abc123',
      integrity: 'sha384-screen',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "css/screen.css"}}');
    expect(tpl({})).toBe('/blog/assets/css/screen.abc123.css');
  });

  test('does not double slash when build base_path has a trailing slash', () => {
    const engine = makeEngine({ basePath: '/blog/' });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "app.js"}}');
    expect(tpl({})).toBe('/blog/assets/app.js');
  });

  test('adds a cache-busting query for known non-fingerprinted assets', () => {
    const engine = makeEngine({ basePath: '/blog' });
    engine.theme.assets.set('assets/images/icon.svg', {
      logicalPath: 'assets/images/icon.svg',
      fingerprintedPath: 'assets/images/icon.svg',
      sourcePath: '/theme/assets/images/icon.svg',
      hash: 'abc123def0',
      integrity: 'sha384-icon',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "images/icon.svg"}}');
    expect(tpl({})).toBe('/blog/assets/images/icon.svg?v=abc123def0');
  });

  test('encodes non-fingerprinted asset paths without escaping the cache-busting query', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/images/100% legit%20icon.svg', {
      logicalPath: 'assets/images/100% legit%20icon.svg',
      fingerprintedPath: 'assets/images/100% legit%20icon.svg',
      sourcePath: '/theme/assets/images/100% legit%20icon.svg',
      hash: 'abc123def0',
      integrity: 'sha384-icon',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "images/100% legit%20icon.svg"}}');
    expect(tpl({})).toBe('/assets/images/100%25%20legit%20icon.svg?v=abc123def0');
  });

  test('known non-fingerprinted asset URLs remain attribute-safe after query injection', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/images/a"><script>x</script>.svg', {
      logicalPath: 'assets/images/a"><script>x</script>.svg',
      fingerprintedPath: 'assets/images/a"><script>x</script>.svg',
      sourcePath: '/theme/assets/images/a"><script>x</script>.svg',
      hash: 'abc123def0',
      integrity: 'sha384-icon',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('<img src="{{asset "images/a\\"><script>x</script>.svg"}}">');
    const out = tpl({});
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('"><');
    expect(out).toBe(
      '<img src="/assets/images/a%22%3E%3Cscript%3Ex%3C/script%3E.svg?v=abc123def0">',
    );
  });

  test('does not double-encode already encoded URL path segments', () => {
    const engine = makeEngine({ basePath: '/' });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "images/hero%20image.css"}}');
    expect(tpl({})).toBe('/assets/images/hero%20image.css');
  });

  test('encodes literal percent signs without double-encoding existing escapes', () => {
    const engine = makeEngine({ basePath: '/blog' });
    engine.theme.assets.set('assets/images/100% legit%20image.css', {
      logicalPath: 'assets/images/100% legit%20image.css',
      fingerprintedPath: 'assets/images/100% legit%20image.abc123.css',
      sourcePath: '/theme/assets/images/100% legit%20image.css',
      hash: 'abc123',
      integrity: 'sha384-image',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset "images/100% legit%20image.css"}}');
    expect(tpl({})).toBe('/blog/assets/images/100%25%20legit%20image.abc123.css');
  });

  test('keeps query ampersands raw inside href attributes (issue #1032)', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/built/screen.css', {
      logicalPath: 'assets/built/screen.css',
      fingerprintedPath: 'assets/built/screen.css?v=abc123&mode=dark',
      sourcePath: '/theme/assets/built/screen.css',
      hash: 'abc123',
      integrity: 'sha384-screen',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('<link href="{{asset "built/screen.css"}}">');
    const out = tpl({});
    expect(out).toBe('<link href="/assets/built/screen.css?v=abc123&mode=dark">');
    expect(out).not.toContain('&amp;');
  });

  test('triple-stash {{{asset}}} returns the raw URL (user explicitly opts out of escape)', () => {
    const engine = makeEngine({ basePath: '/' });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{{asset "built/screen.css"}}}');
    expect(tpl({})).toBe('/assets/built/screen.css');
  });

  test('asset_attrs emits SRI attributes for a known fingerprinted asset', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/built/source.js', {
      logicalPath: 'assets/built/source.js',
      fingerprintedPath: 'assets/built/source.abc123def0.js',
      sourcePath: '/theme/assets/built/source.js',
      hash: 'abc123def0',
      integrity: 'sha384-source',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile(
      '<script src="{{asset "built/source.js"}}" {{asset_attrs "built/source.js"}}></script>',
    );
    expect(tpl({})).toBe(
      '<script src="/assets/built/source.abc123def0.js" integrity="sha384-source" crossorigin="anonymous"></script>',
    );
  });

  test('asset_attrs prefers the minified fingerprinted asset when hasMinFile is truthy', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/built/screen.css', {
      logicalPath: 'assets/built/screen.css',
      fingerprintedPath: 'assets/built/screen.abc123.css',
      sourcePath: '/theme/assets/built/screen.css',
      hash: 'abc123',
      integrity: 'sha384-screen',
      size: 42,
    });
    engine.theme.assets.set('assets/built/screen.min.css', {
      logicalPath: 'assets/built/screen.min.css',
      fingerprintedPath: 'assets/built/screen.min.def456.css',
      sourcePath: '/theme/assets/built/screen.min.css',
      hash: 'def456',
      integrity: 'sha384-screen-min',
      size: 21,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile('{{asset_attrs "built/screen.css" hasMinFile=true}}');
    expect(tpl({})).toBe('integrity="sha384-screen-min" crossorigin="anonymous"');
  });

  test('asset_attrs omits attributes for unknown or non-fingerprinted assets', () => {
    const engine = makeEngine({ basePath: '/' });
    engine.theme.assets.set('assets/images/icon.svg', {
      logicalPath: 'assets/images/icon.svg',
      fingerprintedPath: 'assets/images/icon.svg',
      sourcePath: '/theme/assets/images/icon.svg',
      hash: 'abc123def0',
      integrity: 'sha384-icon',
      size: 42,
    });
    registerAssetHelpers(engine);
    const tpl = engine.hb.compile(
      '{{asset_attrs "images/icon.svg"}}|{{asset_attrs "built/missing.js"}}',
    );
    expect(tpl({})).toBe('|');
  });
});
