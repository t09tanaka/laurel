import type Handlebars from 'handlebars';
import { parseDocument } from 'htmlparser2';
import type { ThemeLocale, ThemeLocaleValue } from '~/theme/types.ts';
import type { NectarEngine } from '../engine.ts';

export function registerI18nHelpers(engine: NectarEngine): void {
  const fallback = engine.theme.locales.en ?? {};

  engine.hb.registerHelper('t', function tHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const locale = routeLocale(options, engine.content.site.locale);
    const active = engine.theme.locales[locale] ?? fallback;
    const key = String(args[0] ?? '');
    // Ghost treats an existing locale entry as authoritative even when its
    // value is ""; only an absent key falls through to en.json and then the key.
    let lookup: ThemeLocaleValue = key;
    if (hasLocaleEntry(active, key)) {
      lookup = active[key] ?? '';
    } else if (hasLocaleEntry(fallback, key)) {
      lookup = fallback[key] ?? '';
    }
    // Casper-family themes pass positional values for the legacy `%`
    // placeholder (e.g. `{{t "Powered by %" "Ghost"}}`). Hash values still win
    // on `{name}` placeholders, but positional args 1..n-1 (every argument
    // after the key, excluding the Handlebars options object at the tail)
    // feed `%` substitution so we don't ship a "%" literal to readers.
    const positional = args.slice(1, -1);
    return interpolate(String(lookup), options.hash as Record<string, unknown>, positional);
  });

  engine.hb.registerHelper('lang', function langHelper(options: Handlebars.HelperOptions) {
    return routeLocale(options, engine.content.site.locale);
  });
}

function routeLocale(options: Handlebars.HelperOptions, fallback: string): string {
  const route = options.data?.route as { locale?: unknown } | undefined;
  return typeof route?.locale === 'string' ? route.locale : fallback;
}

function hasLocaleEntry(locale: ThemeLocale, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(locale, key);
}

function interpolate(
  template: string,
  hash: Record<string, unknown>,
  positional: readonly unknown[] = [],
): string {
  let out = template;
  for (const [key, value] of Object.entries(hash)) {
    out = out.replaceAll(`{${key}}`, stringifyInterpolationValue(value));
  }
  // Ghost's `%` is a positional placeholder. Prefer explicit positional args
  // (`{{t "Powered by %" "Ghost"}}` -> `Powered by Ghost`) since that is how
  // Casper / Headline / Edition ship. Numbered placeholders (`%1`, `%2`) are
  // resolved before bare `%`; the latter must not fall through to an arbitrary
  // first hash value because hash ordering is not a meaningful i18n contract.
  if (out.includes('%')) {
    out = out.replace(/%([1-9]\d*)/g, (match, rawIndex: string) => {
      const value = positional[Number(rawIndex) - 1];
      return value === undefined ? match : stringifyInterpolationValue(value);
    });

    const firstPositional = positional.find((v) => v !== undefined);
    const value = firstPositional ?? barePercentHashValue(hash);
    if (value !== undefined) {
      out = out.replace(/%(?!\d)/g, stringifyInterpolationValue(value));
    }
  }
  return out;
}

function stringifyInterpolationValue(value: unknown): string {
  const raw = String(value);
  return textOnly(parseDocument(raw, { decodeEntities: false }).children as readonly DomNode[]);
}

type DomNode = {
  readonly type?: string;
  readonly name?: string;
  readonly data?: string;
  readonly children?: readonly DomNode[];
};

function textOnly(nodes: readonly DomNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.data ?? '';
      continue;
    }
    if (node.name === 'script' || node.name === 'style') {
      continue;
    }
    if (node.children) {
      out += textOnly(node.children);
    }
  }
  return out;
}

function barePercentHashValue(hash: Record<string, unknown>): unknown {
  for (const key of ['count', 'page', 'index', 'number', 'total']) {
    if (Object.prototype.hasOwnProperty.call(hash, key) && isPrimitive(hash[key])) {
      return hash[key];
    }
  }

  const entries = Object.entries(hash);
  if (entries.length === 1) {
    const value = entries[0]?.[1];
    return typeof value === 'number' || typeof value === 'bigint' ? value : undefined;
  }

  return undefined;
}

function isPrimitive(value: unknown): value is string | number | bigint | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  );
}
