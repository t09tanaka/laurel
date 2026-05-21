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

  engine.hb.registerHelper('encode', function encodeHelper(...args: unknown[]) {
    const options = args[args.length - 1];
    const values = isHelperOptions(options) ? args.slice(0, -1) : args;
    const value = values[0];
    const mode = typeof values[1] === 'string' ? values[1] : ':component';
    const raw = String(value ?? '');
    const encoded = mode === ':full' ? encodeURI(raw) : encodeURIComponent(raw);
    return new engine.hb.SafeString(encoded);
  });

  engine.hb.registerHelper('upper', (value: unknown) => String(value ?? '').toUpperCase());
  engine.hb.registerHelper('lower', (value: unknown) => String(value ?? '').toLowerCase());

  engine.hb.registerHelper('plural', function pluralHelper(...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const hasPositional = args.length > 1 && !isHelperOptions(args[0]);
    const count = hasPositional ? args[0] : options.hash.count;
    const n = Number(count ?? 0);
    const empty = String(options.hash.empty ?? '');
    const singular = String(options.hash.singular ?? options.hash.one ?? '');
    const plural = String(options.hash.plural ?? options.hash.other ?? '');
    let template = plural;
    if (n === 0) template = empty || plural;
    else if (n === 1) template = singular;
    return template.replace(/%/g, String(n));
  });

  engine.hb.registerHelper('json', function jsonHelper(value: unknown) {
    return new engine.hb.SafeString(escapeJsonForHtml(JSON.stringify(value ?? null)));
  });

  engine.hb.registerHelper('log', function logHelper() {
    return '';
  });

  engine.hb.registerHelper('split', function splitHelper(value: unknown, separator: unknown) {
    const sep = typeof separator === 'string' ? separator : ',';
    return String(value ?? '')
      .split(sep)
      .map((part) => part.trim())
      .filter(Boolean);
  });
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

function escapeJsonForHtml(value: string): string {
  return value
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
