import { describe, expect, test } from 'bun:test';
import { collectImageAltWarnings, formatImageAltWarning } from '~/build/image-alt-lint.ts';

const context = {
  outputPath: 'posts/hello/index.html',
  routeUrl: '/hello/',
};

describe('image alt linter', () => {
  test('flags image tags without alt text', () => {
    const warnings = collectImageAltWarnings(
      '<figure class="kg-card kg-image-card"><img src="/content/images/cover.jpg"></figure>',
      context,
    );

    expect(warnings).toEqual([
      {
        issue: 'missing-alt',
        outputPath: context.outputPath,
        routeUrl: context.routeUrl,
        src: '/content/images/cover.jpg',
      },
    ]);
    const [warning] = warnings;
    expect(warning).toBeDefined();
    if (!warning) return;
    expect(formatImageAltWarning(warning)).toContain('is missing alt text');
  });

  test('flags empty alt text on non-decorative Ghost card images', () => {
    const html = [
      '<figure class="kg-card kg-gallery-card">',
      '<div class="kg-gallery-image"><img src="/content/images/one.jpg" alt=""></div>',
      '</figure>',
      '<div class="kg-product-card"><img class="kg-product-card-image" src="/product.jpg" alt=""></div>',
      '<img class="kg-header-card-image" src="/header.jpg" alt="">',
    ].join('');

    const warnings = collectImageAltWarnings(html, context);

    expect(warnings.map((warning) => warning.src)).toEqual([
      '/content/images/one.jpg',
      '/product.jpg',
      '/header.jpg',
    ]);
    expect(warnings.every((warning) => warning.issue === 'empty-alt')).toBe(true);
  });

  test('allows explicit decorative images with empty alt text', () => {
    const html = [
      '<img src="/divider.svg" alt="" role="presentation">',
      '<img src="/spacer.svg" alt="" aria-hidden="true">',
      '<img class="kg-bookmark-icon" src="/favicon.ico" alt="">',
    ].join('');

    expect(collectImageAltWarnings(html, context)).toEqual([]);
  });

  test('allows meaningful alt text', () => {
    const warnings = collectImageAltWarnings(
      '<img src="/content/images/cover.jpg" alt="Cover image">',
      context,
    );

    expect(warnings).toEqual([]);
  });
});
