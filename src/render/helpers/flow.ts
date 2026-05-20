import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

export function registerFlowHelpers(engine: NectarEngine): void {
  // Handlebars provides if/unless/each/with by default; expose a couple of
  // Ghost-flavoured aliases that themes occasionally use.

  engine.hb.registerHelper('or', function orHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const values = args.slice(0, -1);
    const matched = values.some(Boolean);
    if (options.fn) return matched ? options.fn(this) : options.inverse(this);
    return matched ? (values.find(Boolean) ?? '') : '';
  });

  engine.hb.registerHelper('and', function andHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const values = args.slice(0, -1);
    const matched = values.length > 0 && values.every(Boolean);
    if (options.fn) return matched ? options.fn(this) : options.inverse(this);
    return matched ? values[values.length - 1] : '';
  });

  engine.hb.registerHelper('not', function notHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const value = args.length > 1 ? !args[0] : false;
    if (options.fn) return value ? options.fn(this) : options.inverse(this);
    return value;
  });

  engine.hb.registerHelper(
    'eq',
    function eqHelper(this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
      if (options?.fn) {
        return a === b ? options.fn(this) : options.inverse(this);
      }
      return a === b;
    },
  );

  // Ghost's `{{access}}` returns whether the current viewer can read the full
  // post body. Themes use it to gate locked-content UI (e.g. `post-card.hbs`'s
  // padlock icon path, or `{{#unless access}}…{{/unless}}` wrappers around the
  // body). Nectar is members-out-of-scope (see CLAUDE.md), so there is no
  // viewer state to consult — every reader sees every post in full, which means
  // `access` is unconditionally truthy. Implementing it explicitly (rather than
  // relying on the missing-helper fallback) lets themes call it both inline and
  // as a block helper without crashing.
  engine.hb.registerHelper('access', function accessHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions | undefined;
    if (options?.fn) {
      return options.fn(this);
    }
    return true;
  });
}
