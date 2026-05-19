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
}
