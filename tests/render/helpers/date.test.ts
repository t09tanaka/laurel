import { describe, expect, test } from 'bun:test';
import dayjs from 'dayjs';
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
    sortedCache: new Map(),
  } as unknown as NectarEngine;
}

describe('date helper', () => {
  test('restores timezone plugin methods if module ordering drops them (#1626)', () => {
    const originalTz = dayjs.tz;
    try {
      (dayjs as unknown as { tz?: unknown }).tz = undefined;
      const engine = makeEngine('en', 'UTC');
      registerDateHelpers(engine);
      const out = engine.hb.compile('{{date published_at format="YYYY-MM-DD"}}')({
        published_at: '2026-01-02T00:00:00Z',
      });

      expect(out).toBe('2026-01-02');
      expect(typeof dayjs.tz).toBe('function');
    } finally {
      (dayjs as unknown as { tz?: typeof originalTz }).tz = originalTz;
    }
  });

  test('default format uses Ghost localized short date token for locale=en', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe('May 5, 2026');
  });

  test('default format matches explicit localized ll format', () => {
    const engine = makeEngine('en-GB');
    registerDateHelpers(engine);
    const out = engine.hb.compile(
      '{{date "2026-05-05T00:00:00Z"}}|{{date "2026-05-05T00:00:00Z" format="ll"}}',
    )({});
    expect(out).toBe('5 May 2026|5 May 2026');
  });

  test('default format is locale-aware for locale=ja (no explicit format hash)', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe('2026年5月5日');
  });

  test('locale hash overrides the site locale for one date call', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile(
      '{{date "2026-05-05T00:00:00Z" format="MMMM Do, YYYY" locale="fr-fr"}}|{{date "2026-05-05T00:00:00Z" format="MMMM"}}',
    )({});
    expect(out).toBe('mai 5, 2026|May');
  });

  test('locale hash applies to the default ll format', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" locale="ja-JP"}}')({});
    expect(out).toBe('2026年5月5日');
  });

  test('default format uses timezone from site config', () => {
    const engine = makeEngine('en-GB', 'Asia/Tokyo');
    registerDateHelpers(engine);
    // 2026-05-04T20:00:00Z is 2026-05-05T05:00:00+09:00 in Tokyo.
    const out = engine.hb.compile('{{date "2026-05-04T20:00:00Z"}}')({});
    expect(out).toBe('5 May 2026');
  });

  test('underscore-separated locale tags resolve via dayjs locale fallback', () => {
    const engine = makeEngine('ja_JP');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe('2026年5月5日');
  });

  test('uses Japanese month names when locale=ja with a localized format', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="YYYY年M月D日"}}')({});
    expect(out).toBe('2026年5月5日');
  });

  test('falls back to the default format for unsafe format strings', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile(
      '{{date "2026-05-05T00:00:00Z" format="YYYY<script>alert(1)</script>"}}',
    )({});
    expect(out).toBe('May 5, 2026');
  });

  test('accepts a Date object as a positional argument', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date dateObj format="YYYY"}}')({
      dateObj: new Date('2026-05-05T00:00:00Z'),
    });
    expect(out).toBe('2026');
  });

  test('explicit string positional argument overrides the post context date', () => {
    const engine = makeEngine('en', 'America/Los_Angeles');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2020-01-01" format="YYYY"}}')({
      published_at: '2026-05-05T00:00:00Z',
    });
    expect(out).toBe('2020');
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

  test('localized "MMM" month token uses site locale when date comes from context', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date format="MMM"}}')({
      published_at: '2026-05-05T00:00:00Z',
    });
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
    expect(out).toBe('May 5, 2026');
  });

  test('reuses formatted output for repeated identical format calls', () => {
    const engine = makeEngine('en', 'Asia/Tokyo');
    registerDateHelpers(engine);
    const template = engine.hb.compile(
      '{{date ts format="YYYY-MM-DD"}}|{{date ts format="YYYY-MM-DD"}}|{{date ts format="YYYY-MM-DD"}}',
    );
    const originalTz = dayjs.prototype.tz;
    let timezoneConversions = 0;
    dayjs.prototype.tz = function patchedTz(
      this: dayjs.Dayjs,
      ...args: Parameters<typeof originalTz>
    ) {
      timezoneConversions += 1;
      return originalTz.apply(this, args);
    };

    try {
      const out = template({ ts: '2026-05-04T20:00:00Z' });

      expect(out).toBe('2026-05-05|2026-05-05|2026-05-05');
      expect(timezoneConversions).toBe(1);
    } finally {
      dayjs.prototype.tz = originalTz;
    }
  });

  test('date format cache keys include format, locale, and timezone', () => {
    const engine = makeEngine('en', 'UTC');
    registerDateHelpers(engine);
    const defaultTemplate = engine.hb.compile('{{date ts format="YYYY-MM-DD"}}');
    const formatTemplate = engine.hb.compile('{{date ts format="MMMM"}}');
    const localeTemplate = engine.hb.compile('{{date ts format="MMMM" locale="ja"}}');
    const originalTz = dayjs.prototype.tz;
    let timezoneConversions = 0;
    dayjs.prototype.tz = function patchedTz(
      this: dayjs.Dayjs,
      ...args: Parameters<typeof originalTz>
    ) {
      timezoneConversions += 1;
      return originalTz.apply(this, args);
    };

    try {
      expect(defaultTemplate({ ts: '2026-05-04T20:00:00Z' })).toBe('2026-05-04');
      expect(defaultTemplate({ ts: '2026-05-04T20:00:00Z' })).toBe('2026-05-04');
      expect(formatTemplate({ ts: '2026-05-04T20:00:00Z' })).toBe('May');
      expect(localeTemplate({ ts: '2026-05-04T20:00:00Z' })).toBe('5月');

      engine.content.site.timezone = 'Asia/Tokyo';
      expect(defaultTemplate({ ts: '2026-05-04T20:00:00Z' })).toBe('2026-05-05');
      expect(defaultTemplate({ ts: '2026-05-04T20:00:00Z' })).toBe('2026-05-05');
      expect(timezoneConversions).toBe(4);
    } finally {
      dayjs.prototype.tz = originalTz;
    }
  });

  test('timeago returns Day.js relative unit text', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const out = engine.hb.compile('{{date ts timeago=true}}')({ ts: past });
    expect(out).toBe('a day ago');
  });

  test('timeago returns future phrasing for future dates', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const out = engine.hb.compile('{{date ts timeago=true}}')({ ts: future });
    expect(out).toBe('in 2 hours');
  });

  test('timeago output is localized', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const out = engine.hb.compile('{{date ts timeago=true}}')({ ts: past });
    expect(out).toMatch(/前$/);
  });

  test('timeago hash without a value enables relative time', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const out = engine.hb.compile('{{date ts timeago}}')({ ts: past });
    expect(out).toBe('a day ago');
  });

  test('timezone hash overrides the site timezone for one call', () => {
    const engine = makeEngine('en', 'UTC');
    registerDateHelpers(engine);
    const out = engine.hb.compile(
      '{{date "2026-05-04T20:00:00Z" format="YYYY-MM-DD" timezone="Asia/Tokyo"}}|{{date "2026-05-04T20:00:00Z" format="YYYY-MM-DD"}}',
    )({});
    expect(out).toBe('2026-05-05|2026-05-04');
  });

  test('common IANA timezone names convert from UTC predictably', () => {
    const engine = makeEngine('en', 'UTC');
    registerDateHelpers(engine);
    const tpl = engine.hb.compile(
      [
        '{{date "2026-01-15T12:00:00Z" format="YYYY-MM-DD HH:mm" timezone="Europe/Paris"}}',
        '{{date "2026-01-15T12:00:00Z" format="YYYY-MM-DD HH:mm" timezone="America/New_York"}}',
        '{{date "2026-01-15T12:00:00Z" format="YYYY-MM-DD HH:mm" timezone="Asia/Tokyo"}}',
      ].join('|'),
    );
    expect(tpl({})).toBe('2026-01-15 13:00|2026-01-15 07:00|2026-01-15 21:00');
  });

  test('invalid date strings render as empty strings', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    expect(engine.hb.compile('{{date "not-a-date"}}')({})).toBe('');
  });
});

describe('time helper', () => {
  test('aliases the date helper with the same formatting semantics', () => {
    const engine = makeEngine('en', 'UTC');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{time "2026-05-04T20:30:00Z" format="HH:mm"}}')({});
    expect(out).toBe('20:30');
  });
});
