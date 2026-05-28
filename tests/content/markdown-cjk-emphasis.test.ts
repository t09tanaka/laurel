import { describe, expect, test } from 'bun:test';
import MarkdownIt from 'markdown-it';
import markdownItCjkFriendly from 'markdown-it-cjk-friendly';
import { Marked } from 'marked';
import { cjkFriendlyEmphasis } from '~/content/markdown-cjk-emphasis.ts';
import { renderMarkdown } from '~/content/markdown.ts';

function render(src: string): string {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use(cjkFriendlyEmphasis());
  return marked.parseInline(src) as string;
}

describe('cjkFriendlyEmphasis — English emphasis is unchanged', () => {
  test.each([
    ['**bold** text', '<strong>bold</strong> text'],
    ['an *em* word', 'an <em>em</em> word'],
    ['an _em_ word', 'an <em>em</em> word'],
    ['__strong__ word', '<strong>strong</strong> word'],
    ['***both*** here', '<em><strong>both</strong></em> here'],
  ])('%p', (src, expected) => {
    expect(render(src)).toBe(expected);
  });

  test('intraword underscore stays literal', () => {
    expect(render('foo_bar_baz')).toBe('foo_bar_baz');
  });
});

describe('cjkFriendlyEmphasis — CJK emphasis adjacent to punctuation', () => {
  test('closing delimiter after full-width close paren', () => {
    expect(render('この「**日本の電話番号の回線（主回線）**が海外で」')).toBe(
      'この「<strong>日本の電話番号の回線（主回線）</strong>が海外で」',
    );
  });

  test('opening delimiter before full-width open bracket', () => {
    expect(render('ように**「日本の主回線」が絶対条件**になる')).toBe(
      'ように<strong>「日本の主回線」が絶対条件</strong>になる',
    );
  });

  test('emphasis whose content is wrapped in full-width parens', () => {
    expect(render('これは**（主回線）**が大事')).toBe('これは<strong>（主回線）</strong>が大事');
  });

  test('italic adjacent to full-width punctuation', () => {
    expect(render('これは*（主回線）*が大事')).toBe('これは<em>（主回線）</em>が大事');
  });

  test('CJK bold between word characters keeps working', () => {
    expect(render('その**SMSを受信可能**です')).toBe('その<strong>SMSを受信可能</strong>です');
  });

  test('triple delimiter on CJK', () => {
    expect(render('日本***強調***です')).toBe('日本<em><strong>強調</strong></em>です');
  });
});

describe('cjkFriendlyEmphasis — things that must NOT become emphasis', () => {
  test('asterisks inside a code span are literal', () => {
    expect(render('literal `**not bold**` here')).toBe('literal <code>**not bold**</code> here');
  });

  test('escaped asterisks stay literal across CJK', () => {
    // Mirrors what Turndown emits for a genuine literal `*` in the source.
    expect(render('上述のように\\*\\*「日本の主回線」\\*\\*は')).toBe(
      '上述のように**「日本の主回線」**は',
    );
  });

  test('underscore adjacent to full-width punctuation is NOT emphasis', () => {
    // markdown-it-cjk-friendly only relaxes `*`/`**`, leaving `_` at standard
    // CommonMark; the build must match (no `<em>`/`<strong>` here).
    expect(render('これは_（主回線）_が大事')).toBe('これは_（主回線）_が大事');
    expect(render('これは__（主回線）__が大事')).toBe('これは__（主回線）__が大事');
  });
});

describe('renderMarkdown end-to-end keeps CJK bold through sanitisation', () => {
  test('full-width-paren bold survives the build pipeline', async () => {
    const { html } = await renderMarkdown(
      '海外でSMSが利用できるかどうかも、この「**日本の電話番号の回線（主回線）**が海外で使える状態か」によって決まります。',
    );
    expect(html).toContain('<strong>日本の電話番号の回線（主回線）</strong>');
  });
});

describe('marked output matches the editor (markdown-it-cjk-friendly) for realistic prose', () => {
  const mdit = MarkdownIt('commonmark', { html: false }).use(markdownItCjkFriendly);

  function skeleton(html: string): string {
    return html
      .replace(/<strong>/g, '[B]')
      .replace(/<\/strong>/g, '[/B]')
      .replace(/<em>/g, '[I]')
      .replace(/<\/em>/g, '[/I]')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
  }

  test.each([
    'この「**日本の電話番号の回線（主回線）**が海外で」',
    'ように**「日本の主回線」が絶対条件**になる',
    'これは**（主回線）**が大事',
    'その**SMSを受信可能**です',
    '日本***強調***です',
    '**bold** and *em* and _under_',
    '日本の主回線をオンにして**SMSを受信するだけであれば、無料のため大きな心配はありません。**',
    'これは_（主回線）_が大事',
    'これは__（主回線）__が大事',
    '半角A**強調**B と 全角Ａ**強調**Ｂ',
  ])('parity: %p', (src) => {
    expect(skeleton(render(src))).toBe(skeleton(mdit.renderInline(src)));
  });
});
