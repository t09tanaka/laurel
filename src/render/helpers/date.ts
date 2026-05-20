import { createRequire } from 'node:module';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import localizedFormat from 'dayjs/plugin/localizedFormat.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

dayjs.extend(advancedFormat);
dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

const requireDayjsLocale = createRequire(import.meta.url);

const DEFAULT_INTL_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
};

export function registerDateHelpers(engine: NectarEngine): void {
  const dayjsLocale = loadDayjsLocale(engine.content.site.locale);
  const intlLocale = resolveIntlLocale(engine.content.site.locale);

  engine.hb.registerHelper('date', function dateHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const inputs = args.slice(0, -1);
    const candidate = inputs[0];
    const ctx = this as { published_at?: string; updated_at?: string; created_at?: string };
    let value: Date | string | number | undefined;
    if (
      typeof candidate === 'string' ||
      candidate instanceof Date ||
      typeof candidate === 'number'
    ) {
      value = candidate;
    } else if (candidate && typeof candidate === 'object') {
      value = (candidate as { date?: string }).date;
    } else {
      value = ctx.published_at ?? ctx.updated_at ?? ctx.created_at ?? new Date().toISOString();
    }
    const timezoneName = engine.content.site.timezone ?? 'UTC';
    if (options.hash.timeago === true || options.hash.timeago === 'true') {
      return dayjs(value).locale(dayjsLocale).fromNow();
    }
    if (typeof options.hash.format === 'string') {
      return dayjs(value).tz(timezoneName).locale(dayjsLocale).format(options.hash.format);
    }
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) {
      return dayjs(value).locale(dayjsLocale).format();
    }
    return new Intl.DateTimeFormat(intlLocale, {
      ...DEFAULT_INTL_OPTIONS,
      timeZone: timezoneName,
    }).format(date);
  });
}

function toDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  return new Date();
}

function loadDayjsLocale(raw: string | undefined): string {
  if (!raw) return 'en';
  const normalized = raw.toLowerCase().replace(/_/g, '-');
  // 'en' is dayjs's built-in default and doesn't ship as a side-effect import.
  if (normalized === 'en') return 'en';
  const candidates = [normalized];
  const langOnly = normalized.split('-')[0];
  if (langOnly && langOnly !== normalized) candidates.push(langOnly);
  for (const code of candidates) {
    try {
      requireDayjsLocale(`dayjs/locale/${code}.js`);
      return code;
    } catch {
      // try next candidate; dayjs locale file may not exist for this code
    }
  }
  return 'en';
}

function resolveIntlLocale(raw: string | undefined): string {
  if (!raw) return 'en';
  const normalized = raw.replace(/_/g, '-');
  const candidates = [normalized];
  const langOnly = normalized.split('-')[0];
  if (langOnly && langOnly !== normalized) candidates.push(langOnly);
  for (const tag of candidates) {
    try {
      const supported = Intl.DateTimeFormat.supportedLocalesOf([tag]);
      if (supported.length > 0) return supported[0];
    } catch {
      // ill-formed tag; try next candidate
    }
  }
  return 'en';
}
