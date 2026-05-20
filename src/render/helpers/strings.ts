import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

export function registerStringHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper('concat', function concatHelper(...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const separator = stringifyConcatValue(options.hash.separator);
    return new engine.hb.SafeString(args.slice(0, -1).map(stringifyConcatValue).join(separator));
  });

  engine.hb.registerHelper('raw', function rawHelper(this: unknown, ...args: unknown[]) {
    const value = args.length > 1 ? args[0] : undefined;
    const options = args[args.length - 1];
    if (isHelperOptions(options) && typeof options.fn === 'function') {
      return new engine.hb.SafeString(options.fn(this));
    }
    return new engine.hb.SafeString(String(value ?? ''));
  });

  engine.hb.registerHelper('encode', function encodeHelper(value: unknown) {
    return encodeURIComponent(String(value ?? ''));
  });

  engine.hb.registerHelper('upper', (value: unknown) => String(value ?? '').toUpperCase());
  engine.hb.registerHelper('lower', (value: unknown) => String(value ?? '').toLowerCase());

  engine.hb.registerHelper(
    'plural',
    function pluralHelper(count: unknown, options: Handlebars.HelperOptions) {
      const n = Number(count ?? 0);
      const empty = String(options.hash.empty ?? '');
      const singular = String(options.hash.singular ?? '');
      const plural = String(options.hash.plural ?? '');
      let template = plural;
      if (n === 0) template = empty || plural;
      else if (n === 1) template = singular;
      return template.replace(/%/g, String(n));
    },
  );
}

function isHelperOptions(value: unknown): value is Handlebars.HelperOptions {
  return typeof value === 'object' && value !== null && 'hash' in value;
}

function stringifyConcatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isHandlebarsSafeString(value)) return value.toHTML();
  return String(value);
}

function isHandlebarsSafeString(value: unknown): value is { toHTML(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toHTML' in value &&
    typeof value.toHTML === 'function'
  );
}
