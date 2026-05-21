import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

const STRING_PASSTHROUGH = [
  'style',
  'currencyDisplay',
  'currencySign',
  'notation',
  'compactDisplay',
  'signDisplay',
  'unit',
  'unitDisplay',
  'numberingSystem',
] as const;

const NUMBER_PASSTHROUGH = [
  'minimumIntegerDigits',
  'minimumFractionDigits',
  'maximumFractionDigits',
  'minimumSignificantDigits',
  'maximumSignificantDigits',
] as const;

export function registerNumberHelpers(engine: NectarEngine): void {
  const intlLocale = resolveIntlLocale(engine.content.site.locale);

  engine.hb.registerHelper('number', function numberHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const value = toNumber(args[0]);
    if (value === undefined) return '';
    const formatOptions = pickNumberFormatOptions(options.hash as Record<string, unknown>);
    return new Intl.NumberFormat(intlLocale, formatOptions).format(value);
  });

  engine.hb.registerHelper('currency', function currencyHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const hash = options.hash as Record<string, unknown>;
    const value = toNumber(args[0]);
    if (value === undefined) return '';
    const currency = pickCurrency(hash);
    // Without a currency code, Intl.NumberFormat({ style: 'currency' }) throws.
    // Fall back to plain decimal formatting so themes that omit `cur=` still render.
    const baseOptions = pickNumberFormatOptions(hash);
    const formatOptions: Intl.NumberFormatOptions = currency
      ? { ...baseOptions, style: 'currency', currency }
      : baseOptions;
    return new Intl.NumberFormat(intlLocale, formatOptions).format(value);
  });
}

function toNumber(input: unknown): number | undefined {
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickCurrency(hash: Record<string, unknown>): string | undefined {
  const raw = hash.currency ?? hash.cur;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw;
}

function pickNumberFormatOptions(hash: Record<string, unknown>): Intl.NumberFormatOptions {
  const out: Record<string, unknown> = {};
  for (const key of STRING_PASSTHROUGH) {
    const v = hash[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }
  for (const key of NUMBER_PASSTHROUGH) {
    const v = hash[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
    } else if (typeof v === 'string') {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) out[key] = parsed;
    }
  }
  const grouping = hash.useGrouping;
  if (typeof grouping === 'boolean') {
    out.useGrouping = grouping;
  }
  return out as Intl.NumberFormatOptions;
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
      if (supported[0]) return supported[0];
    } catch {
      // ill-formed tag; try next candidate
    }
  }
  return 'en';
}
