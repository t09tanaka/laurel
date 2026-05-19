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
  test('defaults to English month names for locale=en', () => {
    const engine = makeEngine('en');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z"}}')({});
    expect(out).toBe('05 May 2026');
  });

  test('uses Japanese month names when locale=ja with a localized format', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const out = engine.hb.compile('{{date "2026-05-05T00:00:00Z" format="YYYY年M月D日"}}')({});
    expect(out).toBe('2026年5月5日');
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
    expect(out).toBe('05 May 2026');
  });

  test('timeago output is localized', () => {
    const engine = makeEngine('ja');
    registerDateHelpers(engine);
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const out = engine.hb.compile('{{date ts timeago=true}}')({ ts: past });
    expect(out).toMatch(/前$/);
  });
});
