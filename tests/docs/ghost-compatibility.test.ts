import { describe, expect, test } from 'bun:test';

describe('Ghost compatibility docs', () => {
  test('documents shared-theme-assets requirements for Ease load-more controls', async () => {
    const md = await Bun.file(new URL('../../docs/GHOST_COMPATIBILITY.md', import.meta.url)).text();

    expect(md).toContain('shared-theme-assets');
    expect(md).toContain('<button class="gh-loadmore">');
    expect(md).toContain('infinite-scroll JavaScript');
    expect(md).toContain('inert');
  });
});
