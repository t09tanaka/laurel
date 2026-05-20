import { describe, expect, test } from 'bun:test';
import {
  injectStylesheetPreload,
  injectSubresourceIntegrity,
  removeRedundantScriptPreload,
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
