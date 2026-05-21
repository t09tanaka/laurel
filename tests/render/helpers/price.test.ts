import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerPriceHelpers } from '~/render/helpers/price.ts';

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
  } as unknown as NectarEngine;
}

// Intl currency output uses locale-specific symbols and digit grouping. Strip
// everything except digits / period / minus for stability across ICU versions
// while still proving the helper produced a properly formatted price.
function digitsAndDecimal(value: string): string {
  return value.replace(/[^\d.]/g, '');
}

describe('price helper', () => {
  test('formats a Ghost tier object with amount in minor units', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price tier}}')({
      tier: { amount: 900, currency: 'USD' },
    });
    expect(html).toBe('$9');
  });

  test('formats a larger amount cleanly and drops trailing .00', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price tier}}')({
      tier: { amount: 9000, currency: 'USD' },
    });
    expect(html).toBe('$90');
  });

  test('keeps two fraction digits when the price is not a whole major unit', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price tier}}')({
      tier: { amount: 1299, currency: 'USD' },
    });
    expect(html).toBe('$12.99');
  });

  test('currencyCode= hash overrides the tier currency', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price tier currencyCode="EUR"}}')({
      tier: { amount: 900, currency: 'USD' },
    });
    // The currency symbol differs between locales but the digits are stable.
    expect(digitsAndDecimal(html)).toBe('9');
    expect(html).not.toContain('$');
  });

  test('accepts a positional amount in minor units plus currencyCode', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price 900 currencyCode="USD"}}')({});
    expect(html).toBe('$9');
  });

  test('formats plan.amount with sibling plan.currency from the current context', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price plan.amount}}')({
      plan: { amount: 1299, currency: 'usd' },
    });
    expect(html).toBe('$12.99');
  });

  test('formats amount with sibling currency when the current context is the plan', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{#with plan}}{{price amount}}{{/with}}')({
      plan: { amount: 900, currency: 'USD' },
    });
    expect(html).toBe('$9');
  });

  test('returns empty string when input cannot be resolved to a price', () => {
    const engine = makeEngine();
    registerPriceHelpers(engine);
    expect(engine.hb.compile('{{price tier}}')({})).toBe('');
    expect(engine.hb.compile('{{price tier}}')({ tier: { amount: 100 } })).toBe('');
    expect(engine.hb.compile('{{price tier}}')({ tier: { currency: 'USD' } })).toBe('');
    expect(engine.hb.compile('{{price plan.amount}}')({ plan: { amount: 900 } })).toBe('');
  });

  test('respects site locale when formatting', () => {
    const engine = makeEngine('ja-JP');
    registerPriceHelpers(engine);
    const html = engine.hb.compile('{{price tier}}')({
      // 90,000 JPY uses no minor units in Intl but our tier amount convention
      // is still "minor units / 100"; operators set Ghost-style amounts and
      // Intl picks the locale-appropriate fraction digits.
      tier: { amount: 90000, currency: 'JPY' },
    });
    expect(digitsAndDecimal(html)).toBe('900');
  });
});
