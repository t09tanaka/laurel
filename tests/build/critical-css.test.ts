import { describe, expect, test } from 'bun:test';
import {
  type CriticalCssContext,
  applyCriticalCss,
  extractCriticalCss,
  extractUsedTokens,
  prepareStylesheet,
} from '~/build/critical-css.ts';

describe('extractUsedTokens', () => {
  test('collects tags, classes, ids, and attribute names', () => {
    const html =
      '<body class="home"><main id="content"><a class="btn primary" data-track href="#">x</a></main></body>';
    const used = extractUsedTokens(html);
    expect(used.tags.has('body')).toBe(true);
    expect(used.tags.has('main')).toBe(true);
    expect(used.tags.has('a')).toBe(true);
    expect(used.classes.has('home')).toBe(true);
    expect(used.classes.has('btn')).toBe(true);
    expect(used.classes.has('primary')).toBe(true);
    expect(used.ids.has('content')).toBe(true);
    expect(used.attrs.has('data-track')).toBe(true);
    expect(used.attrs.has('href')).toBe(true);
  });
});

describe('extractCriticalCss', () => {
  const prepare = (css: string, url = '/assets/built/screen.abc.css') =>
    prepareStylesheet({ cssText: css, publicUrl: url });

  test('keeps rules whose selectors are present and drops unused ones', () => {
    const sheet = prepare('.home{color:red}.unused{color:blue}body{margin:0}');
    const used = extractUsedTokens('<body class="home"></body>');
    const out = extractCriticalCss(sheet, used);
    expect(out).toContain('.home');
    expect(out).toContain('body');
    expect(out).not.toContain('.unused');
  });

  test('requires all tokens in a descendant selector to be present', () => {
    const sheet = prepare('.a .b{color:red}.a .c{color:blue}');
    const used = extractUsedTokens('<div class="a"><span class="b"></span></div>');
    const out = extractCriticalCss(sheet, used);
    expect(out).toContain('.a .b');
    expect(out).not.toContain('.a .c');
  });

  test('always keeps @font-face and @keyframes', () => {
    const sheet = prepare(
      '@font-face{font-family:x;src:url(../fonts/x.woff2)}@keyframes spin{from{opacity:0}to{opacity:1}}.unused{x:y}',
    );
    const used = extractUsedTokens('<body></body>');
    const out = extractCriticalCss(sheet, used);
    expect(out).toContain('@font-face');
    expect(out).toContain('@keyframes spin');
  });

  test('rewrites relative url() to absolute against the stylesheet directory', () => {
    const sheet = prepare(
      '@font-face{font-family:x;src:url("../fonts/x.woff2")}',
      '/assets/built/screen.abc.css',
    );
    const out = extractCriticalCss(sheet, extractUsedTokens('<body></body>'));
    expect(out).toContain('/assets/fonts/x.woff2');
    expect(out).not.toContain('../fonts');
  });

  test('leaves absolute, data, and remote url() untouched', () => {
    const sheet = prepare(
      'body{background:url(/img/a.png)}.home{background:url(data:image/png;base64,AA)}.x{background:url(https://cdn/x.png)}',
    );
    const used = extractUsedTokens('<body class="home x"></body>');
    const out = extractCriticalCss(sheet, used);
    expect(out).toContain('url(/img/a.png)');
    expect(out).toContain('data:image/png;base64,AA');
    expect(out).toContain('https://cdn/x.png');
  });

  test('keeps a @media block only when an inner rule matches', () => {
    const sheet = prepare('@media (min-width:700px){.home{x:y}.unused{x:y}}');
    const used = extractUsedTokens('<body class="home"></body>');
    const out = extractCriticalCss(sheet, used);
    expect(out).toContain('@media (min-width:700px)');
    expect(out).toContain('.home');
    expect(out).not.toContain('.unused');
  });

  test('drops a @media block entirely when nothing inside matches', () => {
    const sheet = prepare('@media (min-width:700px){.unused{x:y}}');
    const out = extractCriticalCss(sheet, extractUsedTokens('<body></body>'));
    expect(out.trim()).toBe('');
  });

  test('strips pseudo-classes/elements when matching the base selector', () => {
    const sheet = prepare('.btn:hover{color:red}.btn::before{content:""}.gone:hover{x:y}');
    const used = extractUsedTokens('<a class="btn"></a>');
    const out = extractCriticalCss(sheet, used);
    expect(out).toContain('.btn:hover');
    expect(out).toContain('.btn::before');
    expect(out).not.toContain('.gone');
  });

  test('honours the safelist regardless of HTML presence', () => {
    const sheet = prepare('.dynamic-js-class{color:red}');
    const out = extractCriticalCss(sheet, extractUsedTokens('<body></body>'), {
      safelist: [/dynamic-/],
    });
    expect(out).toContain('.dynamic-js-class');
  });
});

describe('applyCriticalCss', () => {
  const ctx = (css: string, overrides?: Partial<CriticalCssContext>): CriticalCssContext => ({
    sheets: new Map([
      [
        'screen.abc.css',
        prepareStylesheet({ cssText: css, publicUrl: '/assets/built/screen.abc.css' }),
      ],
    ]),
    safelist: [],
    maxInlineBytes: 100_000,
    ...overrides,
  });

  const link = '<link rel="stylesheet" href="/assets/built/screen.abc.css">';

  test('inlines critical CSS and makes the stylesheet load async with a noscript fallback', () => {
    const html = `<head>${link}</head><body class="home"></body>`;
    const out = applyCriticalCss(html, ctx('.home{color:red}.unused{x:y}'));
    expect(out).toContain('<style>.home{color:red}</style>');
    expect(out).not.toContain('.unused');
    expect(out).toContain(`media="print" onload="this.media='all'"`);
    expect(out).toContain(
      '<noscript><link rel="stylesheet" href="/assets/built/screen.abc.css"></noscript>',
    );
  });

  test('stamps a nonce on the inline style when provided', () => {
    const html = `<head>${link}</head><body class="home"></body>`;
    const out = applyCriticalCss(html, ctx('.home{color:red}', { nonce: 'abc123' }));
    expect(out).toContain('<style nonce="abc123">');
  });

  test('leaves the link untouched when no rule matches', () => {
    const html = `<head>${link}</head><body></body>`;
    const out = applyCriticalCss(html, ctx('.never{color:red}'));
    expect(out).toBe(html);
  });

  test('leaves the link blocking when critical CSS exceeds maxInlineBytes', () => {
    const html = `<head>${link}</head><body class="home"></body>`;
    const out = applyCriticalCss(html, ctx('.home{color:red}', { maxInlineBytes: 5 }));
    expect(out).toBe(html);
  });

  test('skips an already non-blocking (media=print) link', () => {
    const printLink = '<link rel="stylesheet" href="/assets/built/screen.abc.css" media="print">';
    const html = `<head>${printLink}</head><body class="home"></body>`;
    expect(applyCriticalCss(html, ctx('.home{color:red}'))).toBe(html);
  });

  test('ignores a preload link (rel=preload, not stylesheet)', () => {
    const preload = '<link rel="preload" as="style" href="/assets/built/screen.abc.css">';
    const html = `<head>${preload}</head><body class="home"></body>`;
    expect(applyCriticalCss(html, ctx('.home{color:red}'))).toBe(html);
  });

  test('matches the link by fingerprinted basename even with a base-path prefix', () => {
    const prefixed = '<link rel="stylesheet" href="/blog/assets/built/screen.abc.css">';
    const html = `<head>${prefixed}</head><body class="home"></body>`;
    const out = applyCriticalCss(html, ctx('.home{color:red}'));
    expect(out).toContain('<style>.home{color:red}</style>');
  });
});
