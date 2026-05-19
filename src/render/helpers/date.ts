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

export function registerDateHelpers(engine: NectarEngine): void {
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
    const format = typeof options.hash.format === 'string' ? options.hash.format : 'DD MMM YYYY';
    const timezoneName = engine.content.site.timezone ?? 'UTC';
    if (options.hash.timeago === true || options.hash.timeago === 'true') {
      return dayjs(value).fromNow();
    }
    return dayjs(value).tz(timezoneName).format(format);
  });
}
