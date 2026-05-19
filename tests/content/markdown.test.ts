import { describe, expect, test } from 'bun:test';
import { renderMarkdown, sanitizeRenderedHtml } from '~/content/markdown.ts';

describe('renderMarkdown (default sanitisation)', () => {
  test('strips <script> tags from raw HTML in markdown', async () => {
    const { html } = await renderMarkdown('Hello\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('Hello');
  });

  test('strips <iframe>, <object>, and <embed>', async () => {
    const { html } = await renderMarkdown(
      '<iframe src="https://evil.test"></iframe>\n<object data="x"></object>\n<embed src="x">',
    );
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
  });

  test('drops event handler attributes', async () => {
    const { html } = await renderMarkdown('<a href="https://ok" onclick="alert(1)">click</a>');
    expect(html).toContain('<a');
    expect(html).toContain('https://ok');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html).not.toContain('alert(1)');
  });

  test('rejects javascript: URLs on href', async () => {
    const { html } = await renderMarkdown('[x](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  test('rejects data: URLs on img src', async () => {
    const { html } = await renderMarkdown(
      '<img src="data:text/html,<script>alert(1)</script>" alt="x">',
    );
    expect(html).not.toContain('data:');
    expect(html).not.toContain('alert(1)');
  });

  test('keeps safe formatting tags emitted by marked', async () => {
    const { html } = await renderMarkdown('# Title\n\n**bold** and `code`.\n');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  test('keeps http/https image and link sources', async () => {
    const { html } = await renderMarkdown(
      '![alt](https://cdn.test/img.png)\n\n[ok](https://ok.test)',
    );
    expect(html).toContain('https://cdn.test/img.png');
    expect(html).toContain('https://ok.test');
  });

  test('plaintext reflects sanitised output (no script payload leakage)', async () => {
    const { plaintext } = await renderMarkdown('Body\n\n<script>alert(1)</script>');
    expect(plaintext).not.toContain('alert(1)');
  });
});

describe('renderMarkdown (unsafe opt-out)', () => {
  test('passes raw HTML through when unsafe: true', async () => {
    const { html } = await renderMarkdown('<div data-x="1"><span>raw</span></div>', {
      unsafe: true,
    });
    expect(html).toContain('<div data-x="1">');
    expect(html).toContain('<span>raw</span>');
  });

  test('unsafe: true also preserves <script> (trusted author responsibility)', async () => {
    const { html } = await renderMarkdown('<script>1</script>', { unsafe: true });
    expect(html).toContain('<script>');
  });
});

describe('sanitizeRenderedHtml', () => {
  test('is the same sanitiser used by renderMarkdown', () => {
    const out = sanitizeRenderedHtml('<script>x</script><p>ok</p>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>ok</p>');
  });
});
