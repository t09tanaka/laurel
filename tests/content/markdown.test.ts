import { describe, expect, test } from 'bun:test';
import { renderMarkdown, sanitizeRenderedHtml, truncateByWords } from '~/content/markdown.ts';

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

describe('renderMarkdown — word_count and reading_time across scripts', () => {
  test('whitespace split would return 1 for Japanese — segmenter returns many words', async () => {
    const md = 'これは日本語のテストです。これは日本語のテストです。';
    const { word_count } = await renderMarkdown(md, { locale: 'ja' });
    expect(word_count).toBeGreaterThan(5);
  });

  test('Chinese essay gets a word_count proportional to length, not 1', async () => {
    const body = '我喜欢学习编程。'.repeat(20);
    const { word_count } = await renderMarkdown(body, { locale: 'zh' });
    expect(word_count).toBeGreaterThan(20);
  });

  test('Korean text segments by word with locale ko', async () => {
    const md = '안녕하세요 저는 한국어를 공부합니다.';
    const { word_count } = await renderMarkdown(md, { locale: 'ko' });
    expect(word_count).toBeGreaterThan(3);
  });

  test('English word_count matches whitespace tokens', async () => {
    const md = 'The quick brown fox jumps over the lazy dog.';
    const { word_count } = await renderMarkdown(md, { locale: 'en' });
    expect(word_count).toBe(9);
  });

  test('reading_time grows with CJK content instead of staying at 1 minute', async () => {
    const longJa = 'これは日本語のテストです。'.repeat(200);
    const { reading_time, word_count } = await renderMarkdown(longJa, { locale: 'ja' });
    expect(word_count).toBeGreaterThan(275);
    expect(reading_time).toBeGreaterThan(1);
  });

  test('omitting locale still segments meaningfully (does not regress to 1 word)', async () => {
    const md = 'これは日本語のテストです。';
    const { word_count } = await renderMarkdown(md);
    expect(word_count).toBeGreaterThan(1);
  });
});

describe('truncateByWords', () => {
  test('returns first N word-like segments for English with spaces', () => {
    expect(truncateByWords('one two three four', 2, 'en')).toBe('one two');
  });

  test('returns first N word-like segments for Japanese without spaces', () => {
    const result = truncateByWords('これは日本語のテストです。', 3, 'ja');
    expect(result).toBe('これは日本語');
  });

  test('returns empty string for zero or negative word counts', () => {
    expect(truncateByWords('hello world', 0, 'en')).toBe('');
    expect(truncateByWords('hello world', -1, 'en')).toBe('');
  });

  test('returns full text when requested word count exceeds available', () => {
    expect(truncateByWords('one two', 99, 'en')).toBe('one two');
  });

  test('handles empty text', () => {
    expect(truncateByWords('', 5, 'en')).toBe('');
  });
});

describe('renderMarkdown — bookmark shortcode expansion', () => {
  test('expands full kg-bookmark-card metadata', async () => {
    const md =
      'Intro.\n\n{{< bookmark url="https://example.com/post" title="Title Here" description="A description." author="Jane" publisher="Example" icon="https://example.com/icon.png" thumbnail="https://example.com/thumb.jpg" />}}\n\nOutro.';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figure class="kg-card kg-bookmark-card">');
    expect(html).toContain('<a class="kg-bookmark-container" href="https://example.com/post">');
    expect(html).toContain('<div class="kg-bookmark-title">Title Here</div>');
    expect(html).toContain('<div class="kg-bookmark-description">A description.</div>');
    expect(html).toContain('<div class="kg-bookmark-metadata">');
    expect(html).toContain('<img class="kg-bookmark-icon" src="https://example.com/icon.png"');
    expect(html).toContain('<span class="kg-bookmark-author">Jane</span>');
    expect(html).toContain('<span class="kg-bookmark-publisher">Example</span>');
    expect(html).toContain(
      '<div class="kg-bookmark-thumbnail"><img src="https://example.com/thumb.jpg"',
    );
    expect(html).not.toContain('{{< bookmark');
  });

  test('omits optional pieces when absent', async () => {
    const md = '{{< bookmark url="https://example.com/" title="Only Title" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figure class="kg-card kg-bookmark-card">');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('<div class="kg-bookmark-title">Only Title</div>');
    expect(html).not.toContain('kg-bookmark-description');
    expect(html).not.toContain('kg-bookmark-metadata');
    expect(html).not.toContain('kg-bookmark-thumbnail');
    expect(html).not.toContain('<figcaption>');
  });

  test('drops bookmark shortcode silently when url is missing', async () => {
    const md = 'before\n\n{{< bookmark title="No URL" />}}\n\nafter';
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-bookmark-card');
    expect(html).not.toContain('{{< bookmark');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  test('decodes escaped quotes and backslashes in attributes', async () => {
    const md =
      '{{< bookmark url="https://example.com/q?x=1" title="Quotes \\"and\\" backslashes \\\\ live here" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('Quotes "and" backslashes \\ live here');
    expect(html).not.toContain('\\"');
  });

  test('renders optional figcaption when caption attr is present', async () => {
    const md = '{{< bookmark url="https://example.com/" title="T" caption="Source: Example" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figcaption>Source: Example</figcaption>');
  });

  test('expands multiple bookmark shortcodes independently', async () => {
    const md =
      '{{< bookmark url="https://a.test/" title="A" />}}\n\n{{< bookmark url="https://b.test/" title="B" />}}';
    const { html } = await renderMarkdown(md);
    expect(html.match(/kg-bookmark-card/g)?.length).toBe(2);
    expect(html).toContain('href="https://a.test/"');
    expect(html).toContain('href="https://b.test/"');
  });

  test('escapes HTML-significant characters in attribute values', async () => {
    const md =
      '{{< bookmark url="https://example.com/?a=1&b=2" title="<script>x</script>" description="A & B" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('A &amp; B');
  });
});

describe('renderMarkdown — toggle shortcode expansion', () => {
  test('expands toggle into a <details> element with Koenig class hooks', async () => {
    const md =
      'Intro.\n\n{{< toggle heading="Show details" >}}\nHidden paragraph.\n{{< /toggle >}}\n\nOutro.';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<details class="kg-card kg-toggle-card">');
    expect(html).toContain('<summary class="kg-toggle-heading">');
    expect(html).toContain('<h4 class="kg-toggle-heading-text">Show details</h4>');
    expect(html).toContain('<div class="kg-toggle-content">');
    expect(html).toContain('Hidden paragraph.');
    expect(html).toContain('</details>');
    expect(html).not.toContain('{{< toggle');
    expect(html).not.toContain('{{< /toggle');
  });

  test('parses inner body as markdown', async () => {
    const md =
      '{{< toggle heading="More" >}}\nSee **bold** and [a link](https://example.com/).\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com/">a link</a>');
  });

  test('omits the heading element when no heading attribute is provided', async () => {
    const md = '{{< toggle >}}\nBody only.\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<details class="kg-card kg-toggle-card">');
    expect(html).toContain('<summary class="kg-toggle-heading">');
    expect(html).not.toContain('kg-toggle-heading-text');
    expect(html).toContain('Body only.');
  });

  test('expands multiple toggles independently', async () => {
    const md =
      '{{< toggle heading="One" >}}\nfirst body\n{{< /toggle >}}\n\n{{< toggle heading="Two" >}}\nsecond body\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html.match(/kg-toggle-card/g)?.length).toBe(2);
    expect(html).toContain('>One</h4>');
    expect(html).toContain('>Two</h4>');
    expect(html).toContain('first body');
    expect(html).toContain('second body');
  });

  test('escapes HTML-significant characters in heading attribute', async () => {
    const md = '{{< toggle heading="<script>x</script> & more" >}}\nbody\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; more');
    expect(html).not.toContain('<script>x</script>');
  });

  test('preserves multi-paragraph body markdown', async () => {
    const md = '{{< toggle heading="H" >}}\nFirst paragraph.\n\nSecond paragraph.\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('First paragraph.');
    expect(html).toContain('Second paragraph.');
    expect(html.match(/<p>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
