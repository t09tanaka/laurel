import { describe, expect, test } from 'bun:test';
import {
  injectStylesheetPreload,
  injectSubresourceIntegrity,
  normalizeResourceTagAttributes,
  removeRedundantScriptPreload,
  syncPriorityImagePreload,
} from '~/build/perf-hints.ts';
import type { ThemeAsset } from '~/theme/types.ts';

describe('removeRedundantScriptPreload', () => {
  test('drops a script preload that has a matching <script src>', () => {
    const html = [
      '<head>',
      '<link rel="preload" as="script" href="/built/source.js">',
      '</head><body>',
      '<script src="/built/source.js"></script>',
      '</body>',
    ].join('\n');
    const out = removeRedundantScriptPreload(html);
    expect(out).not.toContain('rel="preload" as="script"');
    expect(out).toContain('<script src="/built/source.js">');
  });

  test('keeps a script preload that has no matching <script src>', () => {
    const html = [
      '<head>',
      '<link rel="preload" as="script" href="/built/lazy.js">',
      '</head><body>',
      '<script src="/built/source.js"></script>',
      '</body>',
    ].join('\n');
    const out = removeRedundantScriptPreload(html);
    expect(out).toContain('rel="preload" as="script" href="/built/lazy.js"');
  });

  test('matches across single quotes and ignores hash fragments', () => {
    const html = [
      "<link rel='preload' as='script' href='/built/source.js#v1'>",
      '<script src="/built/source.js"></script>',
    ].join('\n');
    const out = removeRedundantScriptPreload(html);
    expect(out).not.toContain("rel='preload'");
    expect(out).toContain('<script src="/built/source.js">');
  });

  test('leaves style / font preloads untouched', () => {
    const html = [
      '<link rel="preload" as="style" href="/built/screen.css">',
      '<link rel="preload" as="font" href="/fonts/x.woff2" crossorigin>',
      '<link rel="stylesheet" href="/built/screen.css">',
    ].join('\n');
    const out = removeRedundantScriptPreload(html);
    expect(out).toBe(html);
  });

  test('is a no-op when no scripts and no preloads are present', () => {
    const html = '<html><body><p>x</p></body></html>';
    expect(removeRedundantScriptPreload(html)).toBe(html);
  });
});

describe('injectStylesheetPreload', () => {
  test('inserts a preload sibling before a bare stylesheet link', () => {
    const html = ['<head>', '<link rel="stylesheet" href="/built/screen.css">', '</head>'].join('');
    const out = injectStylesheetPreload(html);
    const preloadAt = out.indexOf('rel="preload" as="style" href="/built/screen.css"');
    const stylesheetAt = out.indexOf('rel="stylesheet"');
    expect(preloadAt).toBeGreaterThanOrEqual(0);
    expect(preloadAt).toBeLessThan(stylesheetAt);
  });

  test('does not double-inject when the preload already exists', () => {
    const html = [
      '<link rel="preload" as="style" href="/built/screen.css">',
      '<link rel="stylesheet" href="/built/screen.css">',
    ].join('');
    const out = injectStylesheetPreload(html);
    const matches = out.match(/rel="preload" as="style"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test('only injects once even for repeated stylesheet entries pointing at the same href', () => {
    const html = [
      '<link rel="stylesheet" href="/a.css">',
      '<link rel="stylesheet" href="/a.css">',
    ].join('');
    const out = injectStylesheetPreload(html);
    const preloads = out.match(/rel="preload" as="style"/g) ?? [];
    expect(preloads.length).toBe(1);
  });

  test('escapes HTML-sensitive characters in the href', () => {
    const html = '<link rel="stylesheet" href="/a.css?x=1&y=2">';
    const out = injectStylesheetPreload(html);
    expect(out).toContain('rel="preload" as="style" href="/a.css?x=1&amp;y=2"');
  });

  test('does not preload non-rendering alternate or print stylesheets', () => {
    const html = [
      '<link rel="stylesheet" href="/print.css" media="print">',
      '<link rel="alternate stylesheet" href="/contrast.css">',
      '<link rel="stylesheet" href="/screen.css" media="screen">',
    ].join('');

    const out = injectStylesheetPreload(html);

    expect(out).not.toContain('as="style" href="/print.css"');
    expect(out).not.toContain('as="style" href="/contrast.css"');
    expect(out).toContain('as="style" href="/screen.css"');
  });
});

describe('syncPriorityImagePreload', () => {
  test('aligns the high-priority image preload with the rendered LCP image candidate', () => {
    const html = [
      '<head>',
      '<link rel="preload" as="image" href="https://example.com/content/images/hero.jpg" fetchpriority="high">',
      '</head><body>',
      '<img src="/content/images/size/w1200/hero.jpg" srcset="/content/images/size/w600/hero.jpg 600w, /content/images/size/w1200/hero.jpg 1200w" sizes="(min-width: 720px) 720px" fetchpriority="high">',
      '</body>',
    ].join('');

    const out = syncPriorityImagePreload(html);

    expect(out).toContain(
      '<link rel="preload" as="image" href="/content/images/size/w1200/hero.jpg" fetchpriority="high" imagesrcset="/content/images/size/w600/hero.jpg 600w, /content/images/size/w1200/hero.jpg 1200w" imagesizes="(min-width: 720px) 720px">',
    );
  });

  test('preserves explicit image preload candidates', () => {
    const html = [
      '<link rel="preload" as="image" href="/manual.jpg" fetchpriority="high" imagesrcset="/manual-small.jpg 600w" imagesizes="100vw">',
      '<img src="/rendered.jpg" srcset="/rendered-small.jpg 600w" sizes="50vw" fetchpriority="high">',
    ].join('');

    expect(syncPriorityImagePreload(html)).toBe(html);
  });

  test('aligns the preload with the <picture> <source> when the LCP image is wrapped', () => {
    const html = [
      '<head>',
      '<link rel="preload" as="image" href="/content/images/cover.jpg" fetchpriority="high" type="image/jpeg">',
      '</head><body>',
      '<picture>',
      '<source type="image/webp" srcset="/content/images/size/w320/format/webp/cover.jpg 320w, /content/images/size/w600/format/webp/cover.jpg 600w" sizes="100vw">',
      '<img src="/content/images/size/w1200/cover.jpg" srcset="/content/images/size/w320/cover.jpg 320w, /content/images/size/w600/cover.jpg 600w" sizes="100vw" fetchpriority="high">',
      '</picture>',
      '</body>',
    ].join('');

    const out = syncPriorityImagePreload(html);

    // href stays the <img> fallback; type/imagesrcset switch to the WebP source.
    expect(out).toContain('href="/content/images/size/w1200/cover.jpg"');
    expect(out).toContain('type="image/webp"');
    expect(out).toContain(
      'imagesrcset="/content/images/size/w320/format/webp/cover.jpg 320w, /content/images/size/w600/format/webp/cover.jpg 600w"',
    );
    expect(out).toContain('imagesizes="100vw"');
    expect(out).not.toContain('type="image/jpeg"');
  });

  test('aligns the preload to a picture feature image the theme did not flag fetchpriority (Casper)', () => {
    // Casper's post.hbs feature <img> has no fetchpriority="high", but
    // renderLcpPreload still emits the high-priority preload. The preload must
    // align with the WebP <source> via href matching so the LCP image is not
    // preloaded as JPEG while rendered as WebP.
    const html = [
      '<head>',
      '<link rel="preload" as="image" href="/content/images/cover.jpg" fetchpriority="high" type="image/jpeg">',
      '</head><body>',
      '<figure class="article-image">',
      '<picture>',
      '<source type="image/webp" srcset="/content/images/size/w300/format/webp/cover.jpg 300w, /content/images/size/w600/format/webp/cover.jpg 600w" sizes="92vw">',
      '<img srcset="/content/images/size/w300/cover.jpg 300w, /content/images/cover.jpg 2000w" sizes="92vw" src="/content/images/cover.jpg">',
      '</picture>',
      '</figure>',
      '</body>',
    ].join('');

    const out = syncPriorityImagePreload(html);

    expect(out).toContain('type="image/webp"');
    expect(out).toContain(
      'imagesrcset="/content/images/size/w300/format/webp/cover.jpg 300w, /content/images/size/w600/format/webp/cover.jpg 600w"',
    );
    expect(out).toContain('imagesizes="92vw"');
    expect(out).not.toContain('type="image/jpeg"');
  });

  test('leaves the preload untouched when the feature image is a plain (non-picture) img', () => {
    const html = [
      '<link rel="preload" as="image" href="/content/images/cover.jpg" fetchpriority="high" type="image/jpeg">',
      '<img src="/content/images/cover.jpg" alt="x">',
    ].join('');
    // No fetchpriority img and no <picture>: nothing to align to.
    expect(syncPriorityImagePreload(html)).toBe(html);
  });

  test('syncs only the first bare high-priority image preload', () => {
    const html = [
      '<link rel="preload" as="image" href="/full-size-a.jpg" fetchpriority="high">',
      '<link rel="preload" as="image" href="/manual-b.jpg" fetchpriority="high">',
      '<img src="/resized-a.jpg" fetchpriority="high">',
    ].join('');

    const out = syncPriorityImagePreload(html);

    expect(out).toContain(
      '<link rel="preload" as="image" href="/resized-a.jpg" fetchpriority="high">',
    );
    expect(out).toContain(
      '<link rel="preload" as="image" href="/manual-b.jpg" fetchpriority="high">',
    );
  });
});

describe('injectSubresourceIntegrity', () => {
  const screenAsset: ThemeAsset = {
    logicalPath: 'assets/built/screen.css',
    fingerprintedPath: 'assets/built/screen.abc123def0.css',
    sourcePath: '/theme/assets/built/screen.css',
    hash: 'abc123def0',
    integrity: 'sha384-screen',
    size: 12,
  };

  const sourceAsset: ThemeAsset = {
    logicalPath: 'assets/built/source.js',
    fingerprintedPath: 'assets/built/source.0123456789.js',
    sourcePath: '/theme/assets/built/source.js',
    hash: '0123456789',
    integrity: 'sha384-source',
    size: 10,
  };

  test('adds integrity and anonymous CORS to fingerprinted style and script assets', () => {
    const html = [
      '<link rel="preload" as="style" href="/assets/built/screen.abc123def0.css">',
      '<link rel="stylesheet" href="/assets/built/screen.abc123def0.css">',
      '<script src="/assets/built/source.0123456789.js"></script>',
    ].join('\n');

    const out = injectSubresourceIntegrity(html, [screenAsset, sourceAsset], '/');

    expect(out).toContain(
      '<link rel="preload" as="style" href="/assets/built/screen.abc123def0.css" integrity="sha384-screen" crossorigin="anonymous">',
    );
    expect(out).toContain(
      '<link rel="stylesheet" href="/assets/built/screen.abc123def0.css" integrity="sha384-screen" crossorigin="anonymous">',
    );
    expect(out).toContain(
      '<script src="/assets/built/source.0123456789.js" integrity="sha384-source" crossorigin="anonymous"></script>',
    );
  });

  test('ignores non-fingerprinted and external asset URLs', () => {
    const fontAsset: ThemeAsset = {
      logicalPath: 'assets/fonts/inter.woff2',
      fingerprintedPath: 'assets/fonts/inter.woff2',
      sourcePath: '/theme/assets/fonts/inter.woff2',
      hash: 'ffffffffff',
      integrity: 'sha384-font',
      size: 10,
    };
    const html = [
      '<link rel="preload" as="font" href="/assets/fonts/inter.woff2" crossorigin="anonymous">',
      '<link rel="stylesheet" href="https://cdn.example.com/screen.abc123def0.css">',
    ].join('\n');

    const out = injectSubresourceIntegrity(html, [screenAsset, fontAsset], '/');

    expect(out).toBe(html);
  });
});

describe('normalizeResourceTagAttributes', () => {
  test('adds stylesheet type and defers classic scripts without changing explicit attrs', () => {
    const html = [
      '<link rel="stylesheet" href="/built/screen.css">',
      '<script src="/built/source.js"></script>',
      '<script async src="/built/analytics.js"></script>',
      '<script type="application/json" src="/data/config.json"></script>',
    ].join('\n');

    const out = normalizeResourceTagAttributes(html);

    expect(out).toContain('<link rel="stylesheet" href="/built/screen.css" type="text/css">');
    expect(out).toContain('<script src="/built/source.js" defer></script>');
    expect(out).toContain('<script async src="/built/analytics.js"></script>');
    expect(out).toContain('<script type="application/json" src="/data/config.json"></script>');
  });

  test('marks .mjs scripts as modules and leaves nomodule fallbacks alone', () => {
    const html = [
      '<script src="/built/app.mjs"></script>',
      '<script nomodule src="/built/legacy.js"></script>',
    ].join('\n');

    const out = normalizeResourceTagAttributes(html);

    expect(out).toContain('<script src="/built/app.mjs" type="module"></script>');
    expect(out).toContain('<script nomodule src="/built/legacy.js"></script>');
  });

  test('does not treat images as scripts', () => {
    const html = '<img src="/hero.jpg" alt="Hero">';

    expect(normalizeResourceTagAttributes(html)).toBe(html);
  });

  test('does not defer external scripts followed by a classic inline script', () => {
    const html = [
      '<script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>',
      '<script src="/built/casper.js"></script>',
      '<script>$(document).ready(function () {});</script>',
    ].join('\n');

    const out = normalizeResourceTagAttributes(html);

    expect(out).not.toContain('defer');
    expect(out).toBe(html);
  });

  test('still defers external scripts when the only later inline script is data', () => {
    const html = [
      '<script src="/built/source.js"></script>',
      '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
    ].join('\n');

    const out = normalizeResourceTagAttributes(html);

    expect(out).toContain('<script src="/built/source.js" defer></script>');
  });

  test('a later module inline script does not block deferring earlier classic scripts', () => {
    const html = [
      '<script src="/built/source.js"></script>',
      '<script type="module">import "./x.js";</script>',
    ].join('\n');

    const out = normalizeResourceTagAttributes(html);

    expect(out).toContain('<script src="/built/source.js" defer></script>');
  });

  test('only the scripts preceding a classic inline are left untouched', () => {
    const html = [
      '<script src="/built/lib.js"></script>',
      '<script>useLib();</script>',
      '<script src="/built/late.js"></script>',
    ].join('\n');

    const out = normalizeResourceTagAttributes(html);

    expect(out).toContain('<script src="/built/lib.js"></script>');
    expect(out).toContain('<script src="/built/late.js" defer></script>');
  });
});
