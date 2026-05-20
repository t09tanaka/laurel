import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

// `{{price tier currencyCode="USD"}}` -> Ghost-compatible tier price string.
//
// Ghost's `{{price}}` helper accepts a tier-like object with
// `{ amount, currency }` (amount in the currency's minor unit, e.g. cents).
// It formats the value via `Intl.NumberFormat` using the site locale, the
// tier currency, and optional `currencyCode` override. Trailing `.00`
// fractions are dropped so a $9 tier renders as `$9`, not `$9.00`, matching
// Ghost's behaviour.
//
// The helper also accepts a positional amount in minor units. That covers Ghost
// account templates such as `{{price plan.amount}}`, where the sibling
// `plan.currency` supplies the currency code.
export function registerPriceHelpers(engine: NectarEngine): void {
  const intlLocale = resolveIntlLocale(engine.content.site.locale);

  engine.hb.registerHelper('price', function priceHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const positional = args.slice(0, -1);
    const hash = options.hash as Record<string, unknown>;
    const resolved = resolvePrice(this, positional[0], hash);
    if (resolved === undefined) return '';

    const formatOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: resolved.currency,
      minimumFractionDigits: resolved.amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    };
    return new Intl.NumberFormat(intlLocale, formatOptions).format(resolved.amount);
  });
}

interface ResolvedPrice {
  amount: number;
  currency: string;
}

function resolvePrice(
  context: unknown,
  input: unknown,
  hash: Record<string, unknown>,
): ResolvedPrice | undefined {
  const overrideCurrency = pickCurrencyCode(hash);
  const contextCurrency = pickContextCurrency(context);
  if (typeof input === 'number' && Number.isFinite(input)) {
    const currency = overrideCurrency ?? contextCurrency;
    if (!currency) return undefined;
    return { amount: input / 100, currency };
  }
  if (typeof input === 'string') {
    const parsed = Number(input.trim());
    const currency = overrideCurrency ?? contextCurrency;
    if (Number.isFinite(parsed) && currency) {
      return { amount: parsed / 100, currency };
    }
    return undefined;
  }
  if (input && typeof input === 'object') {
    const tier = input as { amount?: unknown; currency?: unknown };
    const amount = toAmount(tier.amount);
    const currency = overrideCurrency ?? toCurrency(tier.currency);
    if (amount === undefined || !currency) return undefined;
    return { amount, currency };
  }
  return undefined;
}

// Ghost tiers store the price as an integer minor unit (e.g. 900 = $9.00).
// Whole-major-unit values come out cleanly because we drop trailing `.00`
// via `minimumFractionDigits` in the caller.
function toAmount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value / 100;
}

function toCurrency(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : undefined;
}

function pickCurrencyCode(hash: Record<string, unknown>): string | undefined {
  const raw = hash.currencyCode ?? hash.currency_code ?? hash.currency;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : undefined;
}

function pickContextCurrency(context: unknown): string | undefined {
  if (!context || typeof context !== 'object') return undefined;
  const record = context as Record<string, unknown>;
  const plan = record.plan;
  if (plan && typeof plan === 'object') {
    const currency = toCurrency((plan as Record<string, unknown>).currency);
    if (currency) return currency;
  }
  return toCurrency(record.currency);
}

function resolveIntlLocale(raw: string | undefined): string {
  if (!raw) return 'en';
  const normalized = raw.replace(/_/g, '-');
  const candidates = [normalized];
  const langOnly = normalized.split('-')[0];
  if (langOnly && langOnly !== normalized) candidates.push(langOnly);
  for (const tag of candidates) {
    try {
      const supported = Intl.NumberFormat.supportedLocalesOf([tag]);
      const first = supported[0];
      if (first) return first;
    } catch {
      // ill-formed tag; try next candidate
    }
  }
  return 'en';
}
