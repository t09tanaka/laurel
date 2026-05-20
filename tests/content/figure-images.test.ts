import { describe, expect, test } from 'bun:test';
import { promoteImagesToFigures } from '~/content/figure-images.ts';
import { renderMarkdown } from '~/content/markdown.ts';

describe('promoteImagesToFigures', () => {
  test('wraps a single-image paragraph in <figure class="kg-card kg-image-card kg-width-regular">', () => {
    const out = promoteImagesToFigures('<p><img src="/a.png" alt="x"></p>');
    expect(out).toContain('<figure class="kg-card kg-image-card kg-width-regular">');
    expect(out).toContain('<img class="kg-image"');
    expect(out).toContain('src="/a.png"');
    expect(out).not.toContain('<p><img');
  });

  test('leaves a paragraph with text alongside the image untouched', () => {
    const input = '<p>Hello <img src="/a.png" alt="x"></p>';
    expect(promoteImagesToFigures(input)).toBe(input);
  });

  test('leaves a paragraph with two images untouched', () => {
    const input = '<p><img src="/a.png" alt="a"><img src="/b.png" alt="b"></p>';
    expect(promoteImagesToFigures(input)).toBe(input);
  });

  test('promotes a linked image and preserves the wrapping anchor', () => {
    const input = '<p><a href="https://ex.test/"><img src="/a.png" alt="x"></a></p>';
    const out = promoteImagesToFigures(input);
    expect(out).toContain('<figure class="kg-card kg-image-card kg-width-regular">');
    expect(out).toContain('<a href="https://ex.test/">');
    expect(out).toContain('<img class="kg-image"');
    expect(out).toContain('</a>');
  });

  test('uses a following blockquote paragraph as <figcaption>', () => {
    const input =
      '<p><img src="/a.png" alt="x"></p>\n<blockquote>\n<p>Hello caption</p>\n</blockquote>';
    const out = promoteImagesToFigures(input);
    expect(out).toContain(
      '<figure class="kg-card kg-image-card kg-width-regular kg-card-hascaption">',
    );
    expect(out).toContain('<figcaption>Hello caption</figcaption>');
    expect(out).not.toContain('<blockquote>');
  });

  test('uses a following italic-only paragraph as <figcaption>', () => {
    const input = '<p><img src="/a.png" alt="x"></p>\n<p><em>The caption</em></p>';
    const out = promoteImagesToFigures(input);
    expect(out).toContain(
      '<figure class="kg-card kg-image-card kg-width-regular kg-card-hascaption">',
    );
    expect(out).toContain('<figcaption>The caption</figcaption>');
    expect(out).not.toMatch(/<p>\s*<em>/);
  });

  test('does not consume a following plain paragraph as a caption', () => {
    const input = '<p><img src="/a.png" alt="x"></p>\n<p>Next body paragraph.</p>';
    const out = promoteImagesToFigures(input);
    expect(out).toContain('<figure');
    expect(out).not.toContain('<figcaption>');
    expect(out).toContain('<p>Next body paragraph.</p>');
  });

  test('does not consume an italic paragraph that has extra trailing text', () => {
    const input = '<p><img src="/a.png" alt="x"></p>\n<p><em>partly italic</em> tail</p>';
    const out = promoteImagesToFigures(input);
    expect(out).not.toContain('<figcaption>');
    expect(out).toContain('<p><em>partly italic</em> tail</p>');
  });

  test('preserves existing class on the img and adds kg-image', () => {
    const out = promoteImagesToFigures('<p><img class="existing" src="/a.png" alt="x"></p>');
    expect(out).toMatch(/class="existing kg-image"/);
  });

  test('does not duplicate kg-image when already present', () => {
    const out = promoteImagesToFigures('<p><img class="kg-image" src="/a.png" alt="x"></p>');
    const occurrences = out.match(/kg-image\b/g) ?? [];
    // Once on the img, once in the figure-card class string.
    expect(occurrences.filter((c) => c === 'kg-image').length).toBe(2);
  });

  test('returns input unchanged when no <img> is present', () => {
    expect(promoteImagesToFigures('<p>just text</p>')).toBe('<p>just text</p>');
  });

  test('promotes multiple image paragraphs in the same document', () => {
    const input =
      '<p><img src="/a.png" alt="a"></p>\n<p>text</p>\n<p><img src="/b.png" alt="b"></p>';
    const out = promoteImagesToFigures(input);
    const figureCount = (out.match(/<figure class="kg-card kg-image-card/g) ?? []).length;
    expect(figureCount).toBe(2);
  });

  test('preserves self-closing img tags', () => {
    const out = promoteImagesToFigures('<p><img src="/a.png" alt="x" /></p>');
    expect(out).toContain('<figure');
    expect(out).toMatch(/<img class="kg-image"[^>]*\/>/);
  });
});

describe('renderMarkdown — image figure promotion', () => {
  test('promotes bare ![alt](src) to a kg-image figure', async () => {
    const { html } = await renderMarkdown('![alt text](https://cdn.test/x.png)');
    expect(html).toContain('<figure class="kg-card kg-image-card kg-width-regular">');
    expect(html).toContain('<img class="kg-image"');
    expect(html).toContain('src="https://cdn.test/x.png"');
    expect(html).toContain('alt="alt text"');
  });

  test('attaches a following blockquote as figcaption', async () => {
    const { html } = await renderMarkdown('![alt](https://cdn.test/x.png)\n\n> Caption text');
    expect(html).toContain('class="kg-card kg-image-card kg-width-regular kg-card-hascaption"');
    expect(html).toContain('<figcaption>Caption text</figcaption>');
    expect(html).not.toContain('<blockquote');
  });

  test('attaches a following italic-only paragraph as figcaption', async () => {
    const { html } = await renderMarkdown('![alt](https://cdn.test/x.png)\n\n*The caption*');
    expect(html).toContain('class="kg-card kg-image-card kg-width-regular kg-card-hascaption"');
    expect(html).toContain('<figcaption>The caption</figcaption>');
  });

  test('promotes a linked image markdown into figure with anchor preserved', async () => {
    const { html } = await renderMarkdown('[![alt](https://cdn.test/x.png)](https://ex.test/)');
    expect(html).toContain('<figure class="kg-card kg-image-card kg-width-regular">');
    expect(html).toContain('href="https://ex.test/"');
    expect(html).toContain('<img class="kg-image"');
  });

  test('does not promote when the paragraph has surrounding text', async () => {
    const { html } = await renderMarkdown('Hello ![alt](https://cdn.test/x.png) world');
    expect(html).not.toContain('<figure');
    expect(html).toContain('<img');
  });

  test('plaintext extraction still reflects the image alt context (caption preserved)', async () => {
    const { plaintext } = await renderMarkdown(
      '![alt](https://cdn.test/x.png)\n\n> Caption text here',
    );
    expect(plaintext).toContain('Caption text here');
  });
});
