import { describe, expect, test } from 'bun:test';
import { sanitizeLocale } from '~/theme/loader.ts';

describe('sanitizeLocale', () => {
  test('keeps plain string entries', () => {
    const out = sanitizeLocale({ hello: 'Hello', bye: 'Goodbye' }, 'en.json');
    expect(out).toEqual({ hello: 'Hello', bye: 'Goodbye' });
  });

  test('preserves benign HTML such as <a> and <strong>', () => {
    const out = sanitizeLocale(
      {
        powered_by: 'Published with <a href="https://example.com">Ghost</a>',
        bold: '<strong>Hello</strong>',
      },
      'en.json',
    );
    expect(out.powered_by).toContain('<a href');
    expect(out.bold).toBe('<strong>Hello</strong>');
  });

  test('drops entries with <script>', () => {
    const out = sanitizeLocale({ safe: 'ok', evil: '<script>alert(1)</script>' }, 'en.json');
    expect(out).toEqual({ safe: 'ok' });
  });

  test('drops entries with closing script tags split across attributes', () => {
    const out = sanitizeLocale({ evil: 'foo</script><script>x</script>' }, 'en.json');
    expect(out).toEqual({});
  });

  test('drops entries with inline event handler attributes', () => {
    const out = sanitizeLocale(
      {
        evil_img: '<img src=x onerror="alert(1)">',
        evil_a: '<a href="#" onclick="steal()">click</a>',
      },
      'en.json',
    );
    expect(out).toEqual({});
  });

  test('drops entries with javascript: URLs', () => {
    const out = sanitizeLocale({ evil: '<a href="javascript:alert(1)">x</a>' }, 'en.json');
    expect(out).toEqual({});
  });

  test('drops <iframe>, <object>, <embed>, <svg>, <link>, <meta>', () => {
    const out = sanitizeLocale(
      {
        a: '<iframe src=x></iframe>',
        b: '<object data=x></object>',
        c: '<embed src=x>',
        d: '<svg><script>x</script></svg>',
        e: '<link rel=stylesheet href=x>',
        f: '<meta http-equiv=refresh content=0;url=x>',
        ok: 'normal text',
      },
      'en.json',
    );
    expect(out).toEqual({ ok: 'normal text' });
  });

  test('drops non-string values', () => {
    const out = sanitizeLocale(
      { ok: 'yes', num: 5, obj: { nested: 'x' }, arr: ['x'], nul: null },
      'en.json',
    );
    expect(out).toEqual({ ok: 'yes' });
  });

  test('caps value length', () => {
    const long = 'a'.repeat(5000);
    const out = sanitizeLocale({ ok: 'yes', long }, 'en.json');
    expect(out).toEqual({ ok: 'yes' });
  });

  test('caps key length', () => {
    const longKey = 'k'.repeat(300);
    const out = sanitizeLocale({ ok: 'yes', [longKey]: 'v' }, 'en.json');
    expect(out).toEqual({ ok: 'yes' });
  });

  test('returns empty object for non-object input', () => {
    expect(sanitizeLocale(null, 'en.json')).toEqual({});
    expect(sanitizeLocale([1, 2, 3], 'en.json')).toEqual({});
    expect(sanitizeLocale('a string', 'en.json')).toEqual({});
    expect(sanitizeLocale(42, 'en.json')).toEqual({});
  });
});
