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
// The helper is forgiving: a plain number argument is treated as the major
// unit and combined with `currencyCode="USD"`, so `{{price 9 currencyCode="USD"}}`
// also renders `$9`. This keeps the helper usable in themes that pass a
// hard-coded number rather than a tier object.
export function registerPriceHelpers(engine: NectarEngine): void {
  const intlLocale = resolveIntlLocale(engine.content.site.locale);

  engine.hb.registerHelper('price', function priceHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const positional = args.slice(0, -1);
    const hash = options.hash as Record<string, unknown>;
    const resolved = resolvePrice(positional[0], hash);
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

function resolvePrice(input: unknown, hash: Record<string, unknown>): ResolvedPrice | undefined {
  const overrideCurrency = pickCurrencyCode(hash);
  if (typeof input === 'number' && Number.isFinite(input)) {
    if (!overrideCurrency) return undefined;
    return { amount: input, currency: overrideCurrency };
  }
  if (typeof input === 'string') {
    const parsed = Number(input.trim());
    if (Number.isFinite(parsed) && overrideCurrency) {
      return { amount: parsed, currency: overrideCurrency };
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

function resolveIntlLocale(raw: string | undefined): string {
  if (!raw) return 'en';
  const normalized = raw.replace(/_/g, '-');
  const candidates = [normalized];
  const langOnly = normalized.split('-')[0];
  if (langOnly && langOnly !== normalized) candidates.push(langOnly);
  for (const tag of candidates) {
    try {
      const supported = Intl.NumberFormat.supportedLocalesOf([tag]);
      if (supported.length > 0) return supported[0];
    } catch {
      // ill-formed tag; try next candidate
    }
  }
  return 'en';
}
