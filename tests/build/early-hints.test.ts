import { describe, expect, test } from 'bun:test';
import {
  buildEarlyHintsHeaderRules,
  buildKnownEarlyHintHrefs,
  collectRouteEarlyHints,
  earlyHintsArtifactPath,
  formatLinkHeader,
} from '~/build/early-hints.ts';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';

const screenAsset: ThemeAsset = {
  logicalPath: 'assets/built/screen.css',
  fingerprintedPath: 'assets/built/screen.abc123def0.css',
  sourcePath: '/theme/assets/built/screen.css',
  hash: 'abc123def0',
  integrity: 'sha384-screen',
  size: 12,
};

const theme: ThemeBundle = {
  name: 'test',
  rootDir: '/theme',
  templates: {},
  partials: {},
  pkg: {
    name: 'test',
    version: '1.0.0',
    posts_per_page: 10,
    image_sizes: {},
    card_assets: true,
    custom: {},
    customDefaults: {},
  },
  locales: {},
  assets: new Map([['assets/built/screen.css', screenAsset]]),
};

describe('early hints artifacts', () => {
  test('collects conservative same-origin preloads for known built assets', () => {
    const knownHrefs = buildKnownEarlyHintHrefs(theme, '/blog/');
    const html = [
      '<link rel="preload" as="style" href="/blog/assets/built/screen.abc123def0.css" integrity="sha384-screen" crossorigin="anonymous">',
      '<link rel="preload" as="style" href="/blog/assets/built/unknown.css">',
      '<link rel="preload" as="style" href="https://cdn.example.com/remote.css">',
    ].join('\n');

    const hints = collectRouteEarlyHints({
      routeUrl: '/hello/',
      outputPath: 'hello/index.html',
      html,
      knownHrefs,
      maxLinks: 8,
    });

    expect(hints).toEqual({
      route: '/hello/',
      output_path: 'hello/index.html',
      links: [
        {
          href: '/blog/assets/built/screen.abc123def0.css',
          as: 'style',
          integrity: 'sha384-screen',
          crossorigin: 'anonymous',
        },
      ],
    });
  });

  test('maps route output paths to sibling early-hints.json artifacts', () => {
    expect(earlyHintsArtifactPath('index.html')).toBe('early-hints.json');
    expect(earlyHintsArtifactPath('hello/index.html')).toBe('hello/early-hints.json');
    expect(earlyHintsArtifactPath('404.html')).toBe('404.early-hints.json');
  });

  test('formats Link header values and applies base path to _headers patterns', () => {
    const rules = buildEarlyHintsHeaderRules(
      [
        {
          route: '/hello/',
          output_path: 'hello/index.html',
          links: [
            {
              href: '/blog/assets/built/screen.abc123def0.css',
              as: 'style',
              crossorigin: 'anonymous',
            },
          ],
        },
      ],
      '/blog/',
    );

    expect(rules).toEqual([
      {
        pattern: '/blog/hello/',
        headers: [
          {
            key: 'Link',
            value:
              '</blog/assets/built/screen.abc123def0.css>; rel=preload; as=style; crossorigin="anonymous"',
          },
        ],
      },
    ]);
    expect(
      formatLinkHeader({
        href: '/assets/font.woff2',
        as: 'font',
        crossorigin: '',
        type: 'font/woff2',
      }),
    ).toBe('</assets/font.woff2>; rel=preload; as=font; crossorigin; type="font/woff2"');
  });
});
