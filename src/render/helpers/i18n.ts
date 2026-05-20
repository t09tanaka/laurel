import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

export function registerI18nHelpers(engine: NectarEngine): void {
  const locale = engine.content.site.locale;
  const fallback = engine.theme.locales.en ?? {};
  const active = engine.theme.locales[locale] ?? fallback;

  engine.hb.registerHelper('t', function tHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const key = String(args[0] ?? '');
    // Ghost locale files use "" as a sentinel for "no translation; use the key
    // as the English label." Using `||` (rather than `??`) treats both
    // undefined and "" as "missing", so an empty active-locale entry falls
    // through to the English fallback and finally to the key itself.
    // Otherwise aria-labels and other UI text would render as "".
    const lookup = active[key] || fallback[key] || key;
    return interpolate(lookup, options.hash as Record<string, unknown>);
  });

  engine.hb.registerHelper('lang', function langHelper() {
    return locale;
  });
}

function interpolate(template: string, hash: Record<string, unknown>): string {
  let out = template;
  for (const [key, value] of Object.entries(hash)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  // Ghost uses `%` as a positional placeholder; substitute the first hash
  // value if a `%` is present.
  if (out.includes('%')) {
    const firstValue = Object.values(hash)[0];
    if (firstValue !== undefined) {
      out = out.replace(/%/g, String(firstValue));
    }
  }
  return out;
}
