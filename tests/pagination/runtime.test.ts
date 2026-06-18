import { describe, expect, test } from 'bun:test';
import { renderPaginationEnhanceShim } from '~/pagination/runtime.ts';

describe('renderPaginationEnhanceShim', () => {
  test('bakes the mode and selectors into the emitted JS', () => {
    const js = renderPaginationEnhanceShim({
      mode: 'infinite',
      containerSelector: '.post-feed',
      itemSelector: '.post-card',
    });
    expect(js).toContain('var MODE = "infinite"');
    expect(js).toContain('var CONTAINER_SELECTOR = ".post-feed"');
    expect(js).toContain('var ITEM_SELECTOR = ".post-card"');
  });

  test('guards on fetch and DOMParser availability for progressive enhancement', () => {
    const js = renderPaginationEnhanceShim({
      mode: 'load-more',
      containerSelector: '.post-feed',
      itemSelector: '.post-card',
    });
    expect(js).toContain("typeof window.fetch !== 'function'");
    expect(js).toContain("typeof window.DOMParser !== 'function'");
  });

  test('resolves the next URL against the live page so parsed relative hrefs stay correct', () => {
    const js = renderPaginationEnhanceShim({
      mode: 'infinite',
      containerSelector: '.post-feed',
      itemSelector: '.post-card',
    });
    // The fetched document has no base URL, so hrefs must be resolved against
    // window.location.href — this is the base_path-safety guarantee.
    expect(js).toContain('new URL(href, window.location.href)');
    expect(js).toContain('link[rel="next"]');
  });

  test('JSON-encodes selectors so quotes cannot break out of the JS string', () => {
    const js = renderPaginationEnhanceShim({
      mode: 'infinite',
      containerSelector: '.feed[data-x="y"]',
      itemSelector: '.post-card',
    });
    expect(js).toContain('var CONTAINER_SELECTOR = ".feed[data-x=\\"y\\"]"');
  });
});
