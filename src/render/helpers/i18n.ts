import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

export function registerI18nHelpers(engine: NectarEngine): void {
  const locale = engine.content.site.locale;
  const fallback = engine.theme.locales.en ?? {};
  const active = engine.theme.locales[locale] ?? fallback;

  engine.hb.registerHelper('t', function tHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const key = String(args[0] ?? '');
    // Ghost treats an existing locale entry as authoritative even when its
    // value is ""; only an absent key falls through to en.json and then the key.
    let lookup = key;
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
    return interpolate(lookup, options.hash as Record<string, unknown>, positional);
  });

  engine.hb.registerHelper('lang', function langHelper() {
    return locale;
  });
}

function hasLocaleEntry(locale: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(locale, key);
}

function interpolate(
  template: string,
  hash: Record<string, unknown>,
  positional: readonly unknown[] = [],
): string {
  let out = template;
  for (const [key, value] of Object.entries(hash)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  // Ghost's `%` is a positional placeholder. Prefer explicit positional args
  // (`{{t "Powered by %" "Ghost"}}` → `Powered by Ghost`) since that is how
  // Casper / Headline / Edition ship; fall back to the first hash value for
  // older themes that wrote `{{t "Powered by %" name="Ghost"}}` to keep
  // back-compat with the previous behaviour.
  if (out.includes('%')) {
    const firstPositional = positional.find((v) => v !== undefined);
    const fallbackHash = Object.values(hash)[0];
    const value = firstPositional ?? fallbackHash;
    if (value !== undefined) {
      out = out.replace(/%/g, String(value));
    }
  }
  return out;
}
