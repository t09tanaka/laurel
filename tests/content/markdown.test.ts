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

  test('Japanese reading_time uses characters-per-minute, not 275 wpm', async () => {
    // 13 reading-chars per sentence × 100 = 1300 chars. At 500 cpm that is
    // 2.6 → rounds to 3 minutes. Under the broken 275 wpm rule applied to
    // ICU word segments this same body's word_count is far higher and would
    // explode reading_time — the char-based rule is what tracks reading effort.
    const body = 'これは日本語のテストです。'.repeat(100);
    const { reading_time } = await renderMarkdown(body, { locale: 'ja' });
    expect(reading_time).toBe(3);
  });

  test('Chinese reading_time uses characters-per-minute', async () => {
    // 8 chars × 100 = 800 chars, at 500 cpm → 1.6 → rounds to 2 minutes.
    const body = '我喜欢学习编程。'.repeat(100);
    const { reading_time } = await renderMarkdown(body, { locale: 'zh' });
    expect(reading_time).toBe(2);
  });

  test('Korean reading_time uses characters-per-minute', async () => {
    // Single sentence is short — clamped to 1 min minimum.
    const md = '안녕하세요 저는 한국어를 공부합니다.';
    const { reading_time } = await renderMarkdown(md, { locale: 'ko' });
    expect(reading_time).toBe(1);
  });

  test('locale variants like ja-JP and zh-Hans-CN are recognised as CJK', async () => {
    const body = 'これは日本語のテストです。'.repeat(100);
    const ja = await renderMarkdown(body, { locale: 'ja-JP' });
    const zhHans = await renderMarkdown('我喜欢学习编程。'.repeat(100), { locale: 'zh-Hans-CN' });
    expect(ja.reading_time).toBe(3);
    expect(zhHans.reading_time).toBe(2);
  });

  test('English reading_time still uses 275 wpm', async () => {
    // 9 words × 100 = 900 words / 275 ≈ 3.27 → rounds to 3.
    const md = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
    const { reading_time } = await renderMarkdown(md, { locale: 'en' });
    expect(reading_time).toBe(3);
  });

  test('short content always reports at least 1 minute', async () => {
    const { reading_time: en } = await renderMarkdown('Hi.', { locale: 'en' });
    const { reading_time: ja } = await renderMarkdown('はい。', { locale: 'ja' });
    expect(en).toBe(1);
    expect(ja).toBe(1);
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

describe('renderMarkdown — callout shortcode expansion', () => {
  test('expands into a kg-callout-card div with emoji + text wrappers', async () => {
    const md = '{{< callout emoji="💡" color="blue" >}}\nHeads up.\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-callout-card kg-callout-card-blue"');
    expect(html).toContain('<div class="kg-callout-emoji">');
    expect(html).toContain('💡');
    expect(html).toContain('<div class="kg-callout-text">');
    expect(html).toContain('Heads up.');
    expect(html).not.toContain('{{< callout');
  });

  test('omits the color modifier class when color attr is absent', async () => {
    const md = '{{< callout emoji="i" >}}\nbody\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-callout-card"');
    expect(html).not.toContain('kg-callout-card-');
  });

  test('drops attacker-controlled color tokens (alphanumeric only)', async () => {
    const md = '{{< callout emoji="x" color="blue onclick=alert(1)" >}}\nbody\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    // Allow-list rejected the colour token, so neither the modifier class nor
    // the injection survives.
    expect(html).not.toContain('kg-callout-card-blue onclick');
    expect(html.toLowerCase()).not.toContain('onclick');
  });
});

describe('renderMarkdown — button shortcode expansion', () => {
  test('expands into a kg-button-card div with kg-btn anchor', async () => {
    const md = '{{< button href="https://example.com/buy" align="center" >}}Buy now{{< /button >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-button-card kg-align-center"');
    expect(html).toContain('href="https://example.com/buy"');
    expect(html).toContain('class="kg-btn kg-btn-accent"');
    expect(html).toContain('>Buy now</a>');
  });

  test('drops the shortcode silently when href is missing', async () => {
    const md = 'before\n\n{{< button >}}label{{< /button >}}\n\nafter';
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-button-card');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });
});

describe('renderMarkdown — gallery shortcode expansion', () => {
  test('expands into a kg-gallery-card with rows + images', async () => {
    const md = [
      '{{< gallery caption="Trio" >}}',
      '{{< gallery-row >}}',
      '{{< gallery-image src="https://cdn.test/a.jpg" alt="A" width="800" height="600" />}}',
      '{{< gallery-image src="https://cdn.test/b.jpg" alt="B" width="800" height="600" />}}',
      '{{< /gallery-row >}}',
      '{{< gallery-row >}}',
      '{{< gallery-image src="https://cdn.test/c.jpg" alt="C" width="800" height="600" />}}',
      '{{< /gallery-row >}}',
      '{{< /gallery >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figure class="kg-card kg-gallery-card">');
    expect(html).toContain('<div class="kg-gallery-container">');
    expect((html.match(/kg-gallery-row/g) ?? []).length).toBe(2);
    expect((html.match(/kg-gallery-image/g) ?? []).length).toBe(3);
    expect(html).toMatch(
      /<div class="kg-gallery-image"><img\b[^>]*\bsrc="https:\/\/cdn\.test\/a\.jpg"[^>]*\bwidth="800"[^>]*\bheight="600"[^>]*><\/div>/,
    );
    expect(html).toContain('src="https://cdn.test/a.jpg"');
    expect(html).toContain('alt="C"');
    expect(html).toContain('<figcaption>Trio</figcaption>');
  });

  test('emits nothing when no images are present (empty gallery)', async () => {
    const md = '{{< gallery >}}{{< /gallery >}}';
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-gallery-card');
  });
});
