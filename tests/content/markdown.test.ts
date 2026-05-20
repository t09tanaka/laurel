import { describe, expect, test } from 'bun:test';
import { renderMarkdown, sanitizeRenderedHtml, truncateByWords } from '~/content/markdown.ts';

function normalizeIntertagWhitespace(html: string): string {
  return html.replace(/>\s+</g, '><').trim();
}

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

  test('syntax-highlights fenced code blocks while keeping the language hint', async () => {
    const { html } = await renderMarkdown('```ts\nexport const answer = 42;\n```');
    expect(html).toContain('<pre class="shiki');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('<span style="color:');
    expect(html).toContain('export');
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

  test('English reading_time follows Ghost rounding rather than ceiling partial minutes', async () => {
    const md = `${'word '.repeat(401)}`;
    const { reading_time } = await renderMarkdown(md, { locale: 'en' });
    expect(reading_time).toBe(1);
  });

  test('body images add Ghost reading-time seconds before minute rounding', async () => {
    const md = `${'word '.repeat(400)}\n\n![cover](https://cdn.test/cover.jpg)`;
    const { reading_time } = await renderMarkdown(md, { locale: 'en' });
    expect(reading_time).toBe(2);
  });

  test('image adjustment decreases from 12 seconds to a 3 second floor', async () => {
    const images = Array.from(
      { length: 23 },
      (_, i) => `![image ${i}](https://cdn.test/${i}.jpg)`,
    ).join('\n\n');
    const { reading_time } = await renderMarkdown(images, { locale: 'en' });
    expect(reading_time).toBe(2);
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
  test('expands author-facing liquid bookmark shortcode syntax', async () => {
    const md =
      'Intro.\n\n{% bookmark url="https://example.com/post" title="Native Bookmark" description="Inline metadata only." publisher="Example" %}\n\nOutro.';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figure class="kg-card kg-bookmark-card kg-width-regular">');
    expect(html).toContain('<a class="kg-bookmark-container" href="https://example.com/post">');
    expect(html).toContain('<div class="kg-bookmark-title">Native Bookmark</div>');
    expect(html).toContain('<div class="kg-bookmark-description">Inline metadata only.</div>');
    expect(html).toContain('<span class="kg-bookmark-publisher">Example</span>');
    expect(html).not.toContain('{% bookmark');
  });

  test('expands full kg-bookmark-card metadata', async () => {
    const md =
      'Intro.\n\n{{< bookmark url="https://example.com/post" title="Title Here" description="A description." author="Jane" publisher="Example" icon="https://example.com/icon.png" thumbnail="https://example.com/thumb.jpg" />}}\n\nOutro.';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figure class="kg-card kg-bookmark-card kg-width-regular">');
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
    expect(html).toContain('<figure class="kg-card kg-bookmark-card kg-width-regular">');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('<div class="kg-bookmark-title">Only Title</div>');
    expect(html).not.toContain('kg-bookmark-description');
    expect(html).not.toContain('kg-bookmark-metadata');
    expect(html).not.toContain('kg-bookmark-thumbnail');
    expect(html).not.toContain('<figcaption>');
  });

  test('rejects bookmark shortcode when url is missing', async () => {
    const md = 'before\n\n{{< bookmark title="No URL" />}}\n\nafter';
    await expect(renderMarkdown(md)).rejects.toMatchObject({
      message: 'Invalid Koenig shortcode "bookmark": missing required attribute "url".',
      line: 3,
      col: 1,
      hint: 'Add attribute "url" to the shortcode or remove the card block.',
      code: 'content',
    });
  });

  test('suggests likely required attribute typos before shortcode text can leak', async () => {
    const md = 'before\n\n{{< bookmark urll="https://example.com/" title="Typo" />}}\n\nafter';
    await expect(renderMarkdown(md)).rejects.toMatchObject({
      message: 'Invalid Koenig shortcode "bookmark": missing required attribute "url".',
      line: 3,
      col: 1,
      hint: 'Did you mean "url" instead of "urll"?',
      code: 'content',
    });
  });

  test('rejects unknown shortcode names before rendering literal text', async () => {
    await expect(
      renderMarkdown('Intro.\n\n{{< bookmak url="https://example.com/" />}}'),
    ).rejects.toMatchObject({
      message: 'Unknown Koenig shortcode "bookmak".',
      line: 3,
      col: 1,
      hint: 'Did you mean "bookmark"?',
      code: 'content',
    });
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
    expect(html).toContain('class="kg-card kg-bookmark-card kg-width-regular kg-card-hascaption"');
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

describe('renderMarkdown — code shortcode expansion', () => {
  test('expands imported code shortcode into a captioned Koenig code card', async () => {
    const md = [
      '{{< code language="javascript" caption="Runnable example" line-number-class="line-numbers" >}}',
      '```javascript',
      'const msg = "hi";',
      'console.log(msg);',
      '```',
      '{{< /code >}}',
    ].join('\n');

    const { html } = await renderMarkdown(md);

    expect(html).toContain('<figure class="kg-card kg-code-card kg-card-hascaption line-numbers">');
    expect(html).toContain('<code class="language-javascript">');
    expect(html).toContain('msg');
    expect(html).toContain('<figcaption>Runnable example</figcaption>');
    expect(html).not.toContain('{{< code');
    expect(html).not.toContain('```javascript');
  });

  test('uses the fenced code info string when language attr is absent', async () => {
    const md = '{{< code >}}\n```ts\nconst answer: number = 42;\n```\n{{< /code >}}';

    const { html } = await renderMarkdown(md);

    expect(html).toContain('<figure class="kg-card kg-code-card">');
    expect(html).toContain('<code class="language-ts">');
    expect(html).not.toContain('<figcaption>');
  });
});

describe('renderMarkdown — toggle shortcode expansion', () => {
  test('expands toggle into a <details> element with Koenig class hooks', async () => {
    const md =
      'Intro.\n\n{{< toggle heading="Show details" >}}\nHidden paragraph.\n{{< /toggle >}}\n\nOutro.';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<details class="kg-card kg-toggle-card kg-width-regular">');
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

  test('expands nested block body content from import-emitted shortcodes', async () => {
    const md = [
      '{{< toggle heading="Nested content" >}}',
      '- First item',
      '- Second item',
      '',
      '```js',
      "console.log('nested')",
      '```',
      '',
      '{{< figure src="https://example.com/toggle.png" alt="Toggle image" caption="Inside toggle" />}}',
      '{{< /toggle >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>First item</li>');
    expect(html).toContain('<code class="language-js">');
    expect(html).toContain('console.');
    expect(html).toContain(
      '<figure class="kg-card kg-image-card kg-width-regular kg-card-hascaption">',
    );
    expect(html).toContain('src="https://example.com/toggle.png"');
    expect(html).toContain('alt="Toggle image"');
    expect(html).toContain('<figcaption>Inside toggle</figcaption>');
    expect(html).not.toContain('{{< figure');
  });

  test('omits the heading element when no heading attribute is provided', async () => {
    const md = '{{< toggle >}}\nBody only.\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<details class="kg-card kg-toggle-card kg-width-regular">');
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

  test('restores imported open-state toggles as open details', async () => {
    const md =
      '{{< toggle heading="Advanced options" width="wide" state="open" >}}\nUse **carefully**.\n{{< /toggle >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<details class="kg-card kg-toggle-card kg-width-wide" open>');
    expect(html).toContain('<h4 class="kg-toggle-heading-text">Advanced options</h4>');
    expect(html).toContain('<strong>carefully</strong>');
  });

  test('reports a clear line number for an unclosed toggle shortcode', async () => {
    await expect(
      renderMarkdown('Intro.\n\n{% toggle heading="Broken" %}\nHidden paragraph.'),
    ).rejects.toMatchObject({
      message: 'Malformed Koenig shortcode "toggle": missing closing shortcode "{% /toggle %}".',
      line: 3,
      code: 'content',
    });
  });
});

describe('renderMarkdown — callout shortcode expansion', () => {
  test('expands into a kg-callout-card div with emoji + text wrappers', async () => {
    const md = '{{< callout emoji="💡" color="blue" >}}\nHeads up.\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-callout-card kg-width-regular kg-callout-card-blue"');
    expect(html).toContain('<div class="kg-callout-emoji">');
    expect(html).toContain('💡');
    expect(html).toContain('<div class="kg-callout-text">');
    expect(html).toContain('Heads up.');
    expect(html).not.toContain('{{< callout');
  });

  test('omits the color modifier class when color attr is absent', async () => {
    const md = '{{< callout emoji="i" >}}\nbody\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-callout-card kg-width-regular"');
    expect(html).not.toContain('kg-callout-card-blue');
    expect(html).not.toContain('kg-callout-card-without-emoji');
  });

  test('marks iconless callouts without rendering an empty emoji slot', async () => {
    const md = '{{< callout color="grey" no-icon="true" >}}\nNo icon.\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain(
      'class="kg-card kg-callout-card kg-width-regular kg-callout-card-grey kg-callout-card-without-emoji"',
    );
    expect(html).not.toContain('<div class="kg-callout-emoji">');
    expect(html).toContain('No icon.');
  });

  test('parses rich markdown inside imported callout blocks', async () => {
    const md = [
      '{{< callout emoji="💡" color="blue" >}}',
      'Read the **bold note** and [guide](https://example.com/guide).',
      '{{< /callout >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-callout-card kg-width-regular kg-callout-card-blue"');
    expect(html).toContain('<div class="kg-callout-text">');
    expect(html).toContain('<strong>bold note</strong>');
    expect(html).toContain('<a href="https://example.com/guide">guide</a>');
    expect(html).not.toContain('**bold note**');
    expect(html).not.toContain('{{< callout');
  });

  test('supports liquid callout blocks for rich body content', async () => {
    const md = [
      '{% callout color="grey" no-icon="true" %}',
      'A [nested link](https://example.com) stays clickable.',
      '{% /callout %}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain(
      'class="kg-card kg-callout-card kg-width-regular kg-callout-card-grey kg-callout-card-without-emoji"',
    );
    expect(html).not.toContain('<div class="kg-callout-emoji">');
    expect(html).toContain('<a href="https://example.com">nested link</a>');
    expect(html).not.toContain('{% callout');
  });

  test('preserves custom callout emoji markup through the emoji slot', async () => {
    const md =
      '{{< callout emoji-html="<img class=\\"kg-callout-emoji-image\\" src=\\"https://example.com/icon.png\\" alt=\\"Custom\\">" color="pink" >}}\nCustom icon.\n{{< /callout >}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-callout-card kg-width-regular kg-callout-card-pink"');
    expect(html).toContain('<div class="kg-callout-emoji">');
    expect(html).toContain('src="https://example.com/icon.png"');
    expect(html).toContain('alt="Custom"');
    expect(html).not.toContain('kg-callout-card-without-emoji');
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
    const md =
      '{% button href="https://example.com/buy" text="Buy now" align="center" style="accent" %}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-button-card kg-width-regular kg-align-center"');
    expect(html).toContain('href="https://example.com/buy"');
    expect(html).toContain('class="kg-btn kg-btn-accent"');
    expect(html).toContain('>Buy now</a>');
    expect(html).not.toContain('{% button');
  });

  test('preserves left alignment for theme CSS fallbacks', async () => {
    const md = '{% button href="https://example.com/buy" text="Buy now" align="left" %}';
    const { html } = await renderMarkdown(md);

    expect(html).toContain('class="kg-card kg-button-card kg-width-regular kg-align-left"');
    expect(html).toContain('class="kg-btn kg-btn-accent"');
  });

  test('rejects button shortcode when href is missing', async () => {
    const md = 'before\n\n{{< button >}}label{{< /button >}}\n\nafter';
    await expect(renderMarkdown(md)).rejects.toMatchObject({
      message: 'Invalid Koenig shortcode "button": missing required attribute "href".',
      line: 3,
      col: 1,
      code: 'content',
    });
  });
});

describe('renderMarkdown — header shortcode expansion', () => {
  test('expands imported Ghost header card metadata into a kg-header-card div', async () => {
    const md =
      '{% header style="dark" background="https://cdn.test/header.jpg" title="Launch notes" subtitle="Everything that changed." cta-text="Get Started" cta-href="https://example.com/start" %}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-header-card kg-style-dark"');
    expect(html).toContain('data-kg-background-image="https://cdn.test/header.jpg"');
    expect(html).toContain('style="background-image:url(https://cdn.test/header.jpg)"');
    expect(html).toContain('<h2 class="kg-header-card-heading">Launch notes</h2>');
    expect(html).toContain('<h3 class="kg-header-card-subheading">Everything that changed.</h3>');
    expect(html).toContain(
      '<a class="kg-header-card-button" href="https://example.com/start">Get Started</a>',
    );
    expect(html).not.toContain('{% header');
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
    expect(html).toContain(
      '<figure class="kg-card kg-gallery-card kg-width-regular kg-card-hascaption">',
    );
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

  test('preserves gallery image responsive attributes', async () => {
    const md = [
      '{{< gallery >}}',
      '{{< gallery-row >}}',
      '{{< gallery-image src="/content/images/gallery/one.jpg" alt="One" width="1200" height="800" srcset="/content/images/size/w600/gallery/one.jpg 600w, /content/images/gallery/one.jpg 1200w" sizes="(min-width: 720px) 720px, 100vw" />}}',
      '{{< /gallery-row >}}',
      '{{< /gallery >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain(
      'srcset="/content/images/size/w600/gallery/one.jpg 600w, /content/images/gallery/one.jpg 1200w"',
    );
    expect(html).toContain('sizes="(min-width: 720px) 720px, 100vw"');
  });

  test('adds default gallery sizes when gallery image srcset lacks sizes', async () => {
    const md = [
      '{{< gallery >}}',
      '{{< gallery-row >}}',
      '{{< gallery-image src="/content/images/gallery/one.jpg" alt="One" srcset="/content/images/size/w600/gallery/one.jpg 600w" />}}',
      '{{< /gallery-row >}}',
      '{{< /gallery >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain('srcset="/content/images/size/w600/gallery/one.jpg 600w"');
    expect(html).toContain('sizes="(min-width: 720px) 720px, 100vw"');
  });

  test('preserves explicit Koenig width modifiers on gallery cards', async () => {
    const md = [
      '{{< gallery size="full" caption="Wide roll" >}}',
      '{{< gallery-row >}}',
      '{{< gallery-image src="https://cdn.test/a.jpg" alt="A" />}}',
      '{{< /gallery-row >}}',
      '{{< /gallery >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain(
      '<figure class="kg-card kg-gallery-card kg-width-full kg-card-hascaption">',
    );
  });

  test('emits nothing when no images are present (empty gallery)', async () => {
    const md = '{{< gallery >}}{{< /gallery >}}';
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-gallery-card');
  });
});

describe('renderMarkdown — imported Koenig media/product shortcode expansion', () => {
  test('applies Koenig width classes to every card shortcode and defaults to regular', async () => {
    const wideCases = [
      [
        'bookmark',
        '{{< bookmark url="https://example.com/post" title="Bookmark" width="wide" />}}',
        'class="kg-card kg-bookmark-card kg-width-wide"',
      ],
      [
        'figure',
        '{{< figure src="https://cdn.test/hero.jpg" alt="Hero" width="wide" />}}',
        'class="kg-card kg-image-card kg-width-wide"',
      ],
      [
        'embed',
        '{{< embed url="https://vimeo.com/76979871" provider="vimeo" width="wide" />}}',
        'class="kg-card kg-embed-card kg-width-wide"',
      ],
      [
        'toggle',
        '{{< toggle heading="Details" width="wide" >}}Body{{< /toggle >}}',
        'class="kg-card kg-toggle-card kg-width-wide"',
      ],
      [
        'callout',
        '{{< callout color="blue" width="wide" >}}Body{{< /callout >}}',
        'class="kg-card kg-callout-card kg-width-wide kg-callout-card-blue kg-callout-card-without-emoji"',
      ],
      [
        'button',
        '{{< button href="https://example.com/" width="wide" >}}Go{{< /button >}}',
        'class="kg-card kg-button-card kg-width-wide"',
      ],
      [
        'gallery',
        [
          '{{< gallery width="wide" >}}',
          '{{< gallery-row >}}',
          '{{< gallery-image src="https://cdn.test/a.jpg" alt="A" />}}',
          '{{< /gallery-row >}}',
          '{{< /gallery >}}',
        ].join('\n'),
        'class="kg-card kg-gallery-card kg-width-wide"',
      ],
      [
        'file',
        '{{< file src="https://cdn.test/resume.pdf" title="Resume" width="wide" />}}',
        'class="kg-card kg-file-card kg-width-wide"',
      ],
      [
        'audio',
        '{{< audio src="https://cdn.test/audio.mp3" title="Episode" width="wide" />}}',
        'class="kg-card kg-audio-card kg-width-wide"',
      ],
      [
        'video',
        '{{< video src="https://cdn.test/video.mp4" width="wide" />}}',
        'class="kg-card kg-video-card kg-width-wide"',
      ],
      [
        'product',
        '{{< product title="Widget" button-href="https://example.com/buy" width="wide" />}}',
        'class="kg-card kg-product-card kg-width-wide"',
      ],
    ] as const;

    for (const [name, markdown, expectedClass] of wideCases) {
      const { html } = await renderMarkdown(markdown);
      expect(html, name).toContain(expectedClass);
    }

    const defaultCases = [
      ['bookmark', '{{< bookmark url="https://example.com/post" title="Bookmark" />}}'],
      ['figure', '{{< figure src="https://cdn.test/hero.jpg" alt="Hero" />}}'],
      ['embed', '{{< embed url="https://vimeo.com/76979871" provider="vimeo" />}}'],
      ['toggle', '{{< toggle heading="Details" >}}Body{{< /toggle >}}'],
      ['callout', '{{< callout color="blue" >}}Body{{< /callout >}}'],
      ['button', '{{< button href="https://example.com/" >}}Go{{< /button >}}'],
      [
        'gallery',
        [
          '{{< gallery >}}',
          '{{< gallery-row >}}',
          '{{< gallery-image src="https://cdn.test/a.jpg" alt="A" />}}',
          '{{< /gallery-row >}}',
          '{{< /gallery >}}',
        ].join('\n'),
      ],
      ['file', '{{< file src="https://cdn.test/resume.pdf" title="Resume" />}}'],
      ['audio', '{{< audio src="https://cdn.test/audio.mp3" title="Episode" />}}'],
      ['video', '{{< video src="https://cdn.test/video.mp4" />}}'],
      ['product', '{{< product title="Widget" button-href="https://example.com/buy" />}}'],
    ] as const;

    for (const [name, markdown] of defaultCases) {
      const { html } = await renderMarkdown(markdown);
      expect(html, name).toContain('kg-width-regular');
    }
  });

  test('expands figure shortcode into a Koenig image card with width layout classes', async () => {
    const md =
      '{{< figure src="https://cdn.test/hero.jpg" alt="Hero" width="1600" height="900" size="wide" caption="Hero caption" href="https://example.com" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain(
      '<figure class="kg-card kg-image-card kg-width-wide kg-card-hascaption">',
    );
    expect(html).toContain('<a href="https://example.com"><img class="kg-image"');
    expect(html).toContain('src="https://cdn.test/hero.jpg"');
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('<figcaption>Hero caption</figcaption>');
  });

  test('keeps imported html card wrappers so theme width classes apply', async () => {
    const { html } = await renderMarkdown(
      '<div class="kg-card kg-html-card kg-width-wide"><div class="custom-embed">Wide HTML</div></div>',
    );
    expect(html).toContain('<div class="kg-card kg-html-card kg-width-wide">');
    expect(html).toContain('<div class="custom-embed">Wide HTML</div>');
  });

  test('expands figure shortcode source set into a picture-wrapped image', async () => {
    const md =
      '{{< figure src="https://media.tenor.com/fallback.gif" alt="Animated clip" width="640" height="360" source1_srcset="https://media.tenor.com/clip.mp4" source1_type="video/mp4" source1_media="(prefers-reduced-motion: no-preference)" source2_srcset="https://media.tenor.com/clip.gif" source2_type="image/gif" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('<figure class="kg-card kg-image-card kg-width-regular">');
    expect(html).toContain('<picture><source type="video/mp4"');
    expect(html).toContain('media="(prefers-reduced-motion: no-preference)"');
    expect(html).toContain('srcset="https://media.tenor.com/clip.mp4"');
    expect(html).toContain('<source type="image/gif" srcset="https://media.tenor.com/clip.gif">');
    expect(html).toContain('<img class="kg-image" src="https://media.tenor.com/fallback.gif"');
    expect(html).toContain('alt="Animated clip"');
    expect(html).toContain('width="640"');
    expect(html).toContain('height="360"');
    expect(html).toContain('</picture>');
  });

  test('defaults imported figure shortcodes to regular width and rejects unknown widths', async () => {
    const regular = await renderMarkdown('{{< figure src="https://cdn.test/a.jpg" />}}');
    expect(regular.html).toContain('class="kg-card kg-image-card kg-width-regular"');

    const invalid = await renderMarkdown(
      '{{< figure src="https://cdn.test/a.jpg" size="wide onclick=alert(1)" />}}',
    );
    expect(invalid.html).toContain('class="kg-card kg-image-card kg-width-regular"');
    expect(invalid.html).not.toContain('kg-width-wide onclick');
    expect(invalid.html).not.toContain('onclick');
  });

  test('expands file shortcode into a kg-file-card download scaffold', async () => {
    const md =
      '{{< file src="https://cdn.test/files/resume.pdf" title="Resume" caption="Short PDF download." name="resume.pdf" size="123 KB" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-file-card kg-width-regular"');
    expect(html).toContain('class="kg-file-card-container"');
    expect(html).toContain('href="https://cdn.test/files/resume.pdf"');
    expect(html).toContain('<div class="kg-file-card-title">Resume</div>');
    expect(html).toContain('<div class="kg-file-card-caption">Short PDF download.</div>');
    expect(html).toContain('<div class="kg-file-card-filename">resume.pdf</div>');
    expect(html).toContain('<div class="kg-file-card-filesize">123 KB</div>');
    expect(html).not.toContain('{{< file');
  });

  test('expands migrated file shortcode href and description aliases', async () => {
    const md =
      '{{< file href="https://cdn.test/files/resume.pdf" title="Resume" description="Short PDF download." name="resume.pdf" size="123 KB" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-file-card kg-width-regular"');
    expect(html).toContain('href="https://cdn.test/files/resume.pdf"');
    expect(html).toContain('<div class="kg-file-card-title">Resume</div>');
    expect(html).toContain('<div class="kg-file-card-caption">Short PDF download.</div>');
    expect(html).toContain('<div class="kg-file-card-filename">resume.pdf</div>');
    expect(html).toContain('<div class="kg-file-card-filesize">123 KB</div>');
  });

  test('matches Ghost file card DOM order for Source theme CSS hooks', async () => {
    const md =
      '{{< file src="https://cdn.test/files/resume.pdf" title="Resume" caption="Short PDF download." name="resume.pdf" size="123 KB" />}}';
    const { html } = await renderMarkdown(md);

    expect(normalizeIntertagWhitespace(html)).toBe(
      normalizeIntertagWhitespace(`
        <div class="kg-card kg-file-card kg-width-regular">
          <a class="kg-file-card-container" href="https://cdn.test/files/resume.pdf" download>
            <div class="kg-file-card-contents">
              <div class="kg-file-card-title">Resume</div>
              <div class="kg-file-card-caption">Short PDF download.</div>
              <div class="kg-file-card-metadata">
                <div class="kg-file-card-filename">resume.pdf</div>
                <div class="kg-file-card-filesize">123 KB</div>
              </div>
            </div>
            <div class="kg-file-card-icon">
              <svg viewbox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </div>
          </a>
        </div>
      `),
    );
  });

  test('expands audio shortcode into a kg-audio-card with player metadata', async () => {
    const md =
      '{{< audio src="https://cdn.test/audio/episode-1.mp3" title="Episode 1: pilot" duration="00:42:13" thumbnail="https://cdn.test/audio-thumb.jpg" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-audio-card kg-width-regular"');
    expect(html).toContain('class="kg-audio-thumbnail"');
    expect(html).toContain('<audio src="https://cdn.test/audio/episode-1.mp3"');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('controls');
    expect(html).toContain('<div class="kg-audio-title">Episode 1: pilot</div>');
    expect(html).toContain('<div class="kg-audio-duration">00:42:13</div>');
    expect(html).not.toContain('{{< audio');
  });

  test('expands video shortcode into a kg-video-card with track children', async () => {
    const md = [
      '{{< video src="https://cdn.test/video/clip.mp4" poster="https://cdn.test/video/clip-poster.jpg" width="1280" height="720" aspect="1.7777777777777777" preload="metadata" controls="true" size="full" caption="Sample video caption." >}}',
      '{{< video-track src="https://cdn.test/video/captions.vtt" kind="captions" srclang="en" label="English" default="true" />}}',
      '{{< /video >}}',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-video-card kg-width-full kg-card-hascaption"');
    expect(html).toContain('class="kg-video-container"');
    expect(html).toContain('style="--aspect-ratio:1.7777777777777777"');
    expect(html).toContain('<video src="https://cdn.test/video/clip.mp4"');
    expect(html).toContain('poster="https://cdn.test/video/clip-poster.jpg"');
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="720"');
    expect(html).toContain('controls');
    expect(html).toContain(
      '<track src="https://cdn.test/video/captions.vtt" kind="captions" srclang="en" label="English" default></track>',
    );
    expect(html).toContain('<figcaption>Sample video caption.</figcaption>');
    expect(html).not.toContain('{{< video');
  });

  test('expands product shortcode into a kg-product-card scaffold', async () => {
    const md =
      '{% product image="https://cdn.test/product.jpg" title="Sample widget" rating="5" description="A short product description." button="Buy now" href="https://example.com/buy" %}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-product-card kg-width-regular"');
    expect(html).toContain('class="kg-product-card-container"');
    expect(html).toContain('class="kg-product-card-image"');
    expect(html).toContain('src="https://cdn.test/product.jpg"');
    expect(html).toContain('<div class="kg-product-card-title">Sample widget</div>');
    expect(html).toContain(
      '<div class="kg-product-card-description"><p>A short product description.</p></div>',
    );
    expect(html).toContain('class="kg-product-card-rating"');
    expect(html).toContain('data-rating="5"');
    expect(html).toContain('class="kg-product-card-button kg-product-card-btn-accent"');
    expect(html).toContain('href="https://example.com/buy"');
    expect(html).toMatch(
      /kg-product-card-image[\s\S]*kg-product-card-title[\s\S]*kg-product-card-rating[\s\S]*kg-product-card-description[\s\S]*kg-product-card-button/,
    );
    expect(html).not.toContain('{{< product');
  });

  test('expands migrated v1 header shortcode without breaking the legacy DOM contract', async () => {
    const md =
      '{{< header version="v1" heading="A bold header card" subheading="Subheading text." style="dark" size="large" button_href="https://example.com/cta" button_text="Get started" />}}';
    const { html } = await renderMarkdown(md);
    expect(html).toContain('class="kg-card kg-header-card kg-style-dark kg-size-large"');
    expect(html).toContain('<h2 class="kg-header-card-heading">A bold header card</h2>');
    expect(html).toContain('<h3 class="kg-header-card-subheading">Subheading text.</h3>');
    expect(html).toContain(
      '<a class="kg-header-card-button" href="https://example.com/cta">Get started</a>',
    );
    expect(html).not.toContain('kg-v2');
    expect(html).not.toContain('{{< header');
  });

  test('expands migrated v2 header shortcode with alignment, background, colors, and accent button', async () => {
    const md =
      '{{< header version="v2" heading="Launch headline" subheading="Useful supporting copy." align="center" width="full" content_width="wide" style="image" background_image="https://cdn.test/header.jpg" background_image_width="1600" background_image_height="900" background_image_position="45% 35%" background_image_color="#101820" background_color="#101820" text_color="#ffffff" button_href="https://example.com/signup" button_text="Join now" button_color="#f6c344" button_text_color="#101820" button_style="accent" accent="#f6c344" />}}';
    const { html } = await renderMarkdown(md);

    expect(html).toContain(
      'class="kg-card kg-header-card kg-v2 kg-width-full kg-content-wide kg-align-center kg-style-image"',
    );
    expect(html).toContain(
      'style="--bg-image-position:45% 35%;--bg-image-color:#101820;background-color:#101820"',
    );
    expect(html).toContain('data-background-color="#101820"');
    expect(html).toContain('data-accent-color="#f6c344"');
    expect(html).toContain('<picture><img class="kg-header-card-image"');
    expect(html).toContain('src="https://cdn.test/header.jpg"');
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('<div class="kg-header-card-text kg-align-center">');
    expect(html).toContain(
      '<h2 class="kg-header-card-heading" style="color:#ffffff" data-text-color="#ffffff">Launch headline</h2>',
    );
    expect(html).toContain(
      '<p class="kg-header-card-subheading" style="color:#ffffff" data-text-color="#ffffff">Useful supporting copy.</p>',
    );
    expect(html).toContain(
      '<a class="kg-header-card-button kg-header-card-button-accent" href="https://example.com/signup" style="background-color:#f6c344;color:#101820" data-button-color="#f6c344" data-button-text-color="#101820">Join now</a>',
    );
    expect(html).not.toContain('{{< header');
  });
});
