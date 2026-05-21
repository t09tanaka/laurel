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
const DEFAULT_DATE_FORMAT = 'll';
const DATE_FORMAT_CACHE_LIMIT = 4096;

type DateInput = Date | string | number;

export function registerDateHelpers(engine: NectarEngine): void {
  const dayjsLocale = loadDayjsLocale(engine.content.site.locale);
  const formattedDateCache = new Map<string, string>();

  engine.hb.registerHelper('date', function dateHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const inputs = args.slice(0, -1);
    const candidate = inputs[0];
    const activeLocale = resolveDateLocale(options.hash.locale, dayjsLocale);
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
      return dayjs(value).locale(activeLocale).fromNow();
    }
    const format =
      typeof options.hash.format === 'string' ? options.hash.format : DEFAULT_DATE_FORMAT;
    const cacheKey = buildDateFormatCacheKey(value, format, timezoneName, activeLocale);
    const cached = formattedDateCache.get(cacheKey);
    if (cached !== undefined) {
      formattedDateCache.delete(cacheKey);
      formattedDateCache.set(cacheKey, cached);
      return cached;
    }

    const formatted = dayjs(value).tz(timezoneName).locale(activeLocale).format(format);
    rememberFormattedDate(formattedDateCache, cacheKey, formatted);
    return formatted;
  });
}

function rememberFormattedDate(cache: Map<string, string>, key: string, value: string): void {
  if (cache.size >= DATE_FORMAT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

function buildDateFormatCacheKey(
  value: DateInput | undefined,
  format: string,
  timezoneName: string,
  locale: string,
): string {
  return `${serializeDateInput(value)}|${format}|${timezoneName}|${locale}`;
}

function serializeDateInput(value: DateInput | undefined): string {
  if (value instanceof Date) {
    return `date:${value.getTime()}`;
  }
  return `${typeof value}:${String(value)}`;
}

function resolveDateLocale(hashLocale: unknown, fallback: string): string {
  if (typeof hashLocale !== 'string') return fallback;
  const locale = hashLocale.trim();
  return locale ? loadDayjsLocale(locale) : fallback;
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
