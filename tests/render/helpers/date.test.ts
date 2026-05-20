import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerDateHelpers } from '~/render/helpers/date.ts';

function makeEngine(locale: string, timezone = 'UTC'): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: { site: { locale, timezone } } as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  };
}

describe('date helper', () => {
  test('default format follows Intl.DateTimeFormat for locale=en (US-style)', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe(
      new Intl.DateTimeFormat('en', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(new Date('2026-05-05T00:00:00Z')),
    );
  });

  test('default format honours en-GB ordering (DD MMM YYYY)', () => {
    const engine = makeEngine('en-GB');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe('05 May 2026');
  });

  test('default format is locale-aware for locale=ja (no explicit format hash)', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe(
      new Intl.DateTimeFormat('ja', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(new Date('2026-05-05T00:00:00Z')),
    );
    // Sanity: month digit and year/era marker should appear.
    expect(out).toContain('2026');
    expect(out).toContain('5');
  });

  test('default format uses timezone from site config', () => {
    const engine = makeEngine('en-GB', 'Asia/Tokyo');
    registerDateHelpers(engine);
    // 2026-05-04T20:00:00Z is 2026-05-05T05:00:00+09:00 in Tokyo.
    const out = engine.hb.compile('{{date "2026-05-04T20:00:00Z"}}')({});
    expect(out).toBe('05 May 2026');
  });

  test('underscore-separated locale tags resolve via Intl fallback', () => {
    const engine = makeEngine('ja_JP');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toContain('2026');
    expect(out).toContain('5');
  });

  test('uses Japanese month names when locale=ja with a localized format', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="YYYY年M月D日"}}')({});
    expect(out).toBe('2026年5月5日');
  });

  test('accepts a Date object as a positional argument', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date dateObj format="YYYY"}}')({
      dateObj: new Date('2026-05-05T00:00:00Z'),
    });
    expect(out).toBe('2026');
  });

  test('invalid date strings render without throwing', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const template = engine.hb.compile('{{date "not-a-date"}}');

    expect(() => template({})).not.toThrow();
    expect(['Invalid Date', '']).toContain(template({}));
  });

  test('falls back to the current date when the context has no dates', () => {
    const engine = makeEngine('en', 'UTC');
    registerDateHelpers(engine);
    const template = engine.hb.compile('{{date format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"}}');

    const before = Date.now();
    const out = template({});
    const after = Date.now();
    const rendered = Date.parse(out);

    expect(Number.isNaN(rendered)).toBe(false);
    expect(rendered).toBeGreaterThanOrEqual(before);
    expect(rendered).toBeLessThanOrEqual(after);
  });

  test('localized "MMMM" month token uses locale-specific month names', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="MMMM"}}')({});
    expect(out).toBe('5月');
  });

  test('localized "LL" token resolves to the locale-defined long date pattern', () => {
    // dayjs's ja locale defines LL as YYYY年M月D日 via the localizedFormat plugin.
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="LL"}}')({});
    expect(out).toBe('2026年5月5日');
  });

  test('falls back to language code when full locale tag is unavailable', () => {
    // dayjs does not ship a ja-jp locale file; should degrade to ja.
    const engine = makeEngine('ja-JP');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="MMMM"}}')({});
    expect(out).toBe('5月');
  });

  test('region variants load the region-specific file when available', () => {
    const engine = makeEngine('pt-BR');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="MMMM"}}')({});
    // pt-br ships its own locale; month name should be Portuguese.
    expect(out.toLowerCase()).toBe('maio');
  });

  test('unsupported locale silently falls back to English', () => {
    const engine = makeEngine('zz');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe(
      new Intl.DateTimeFormat('en', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        timeZone: 'UTC',
      }).format(new Date('2026-05-05T00:00:00Z')),
    );
  });

  test('timeago output is localized', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const out = engine.hb.compile('{{date ts timeago=true}}')({ ts: past });
    expect(out).toMatch(/前$/);
  });
});
