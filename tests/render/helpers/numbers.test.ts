import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerNumberHelpers } from '~/render/helpers/numbers.ts';

function makeEngine(locale = 'en'): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as NectarEngine['config'],
    content: { site: { locale } } as NectarEngine['content'],
    theme: {} as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map(),
    render() {
      throw new Error('not used');
    },
  };
}

// Intl format output contains locale-specific separators (commas, narrow no-break
// space, etc.) that vary subtly between ICU versions. Strip the digits so tests
// stay stable while still proving the helper produced a properly formatted
// number for the requested locale.
function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, '');
}

describe('number helper', () => {
  test('formats integers with grouping in the active locale', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{number value}}')({ value: 1234567 });
    expect(out).toBe(new Intl.NumberFormat('en-US').format(1234567));
  });

  test('respects locale-driven grouping (de-DE uses dot separators)', () => {
    const engine = makeEngine('de-DE');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{number value}}')({ value: 1234567 });
    expect(out).toBe(new Intl.NumberFormat('de-DE').format(1234567));
    expect(digitsOnly(out)).toBe('1234567');
  });

  test('falls back to "en" when locale is unsupported', () => {
    const engine = makeEngine('xx-ZZ');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{number 1000}}')({});
    expect(out).toBe(new Intl.NumberFormat('en').format(1000));
  });

  test('parses string numbers', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{number "2500"}}')({});
    expect(out).toBe(new Intl.NumberFormat('en-US').format(2500));
  });

  test('returns empty string for missing or non-numeric values', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    expect(engine.hb.compile('{{number value}}')({})).toBe('');
    expect(engine.hb.compile('{{number "not a number"}}')({})).toBe('');
  });

  test('honours minimumFractionDigits / maximumFractionDigits hash', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile(
      '{{number value minimumFractionDigits=2 maximumFractionDigits=2}}',
    )({ value: Math.PI });
    expect(out).toBe(
      new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.PI),
    );
  });

  test('supports compact notation via hash', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{number 1500 notation="compact"}}')({});
    expect(out).toBe(new Intl.NumberFormat('en-US', { notation: 'compact' }).format(1500));
  });
});

describe('currency helper', () => {
  test('formats USD with $ in en-US', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{currency value cur="USD"}}')({ value: 1234.5 });
    expect(out).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5),
    );
    expect(out).toContain('$');
  });

  test('accepts the long form `currency=` hash key', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{currency 99 currency="EUR"}}')({});
    expect(out).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(99),
    );
  });

  test('formats JPY in ja-JP with the correct symbol and no decimals', () => {
    const engine = makeEngine('ja-JP');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{currency 1500 cur="JPY"}}')({});
    expect(out).toBe(
      new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(1500),
    );
  });

  test('falls back to plain decimal formatting when no currency is given', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{currency 1234}}')({});
    expect(out).toBe(new Intl.NumberFormat('en-US').format(1234));
  });

  test('returns empty string for missing values', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    expect(engine.hb.compile('{{currency value cur="USD"}}')({})).toBe('');
  });

  test('honours currencyDisplay=code', () => {
    const engine = makeEngine('en-US');
    registerNumberHelpers(engine);
    const out = engine.hb.compile('{{currency 10 cur="USD" currencyDisplay="code"}}')({});
    expect(out).toBe(
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'code',
      }).format(10),
    );
    expect(out).toContain('USD');
  });
});
