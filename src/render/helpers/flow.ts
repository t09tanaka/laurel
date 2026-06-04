import type Handlebars from 'handlebars';
import type { LaurelEngine } from '../engine.ts';
import { isUnauthenticatedMember } from '../member-stub.ts';

interface HelperOptionsWithContextPath extends Handlebars.HelperOptions {
  ids?: string[];
  data?: Handlebars.HelperOptions['data'] & { contextPath?: string };
}

interface HandlebarsRuntimeUtils {
  appendContextPath?: (contextPath: string | undefined, id: string | undefined) => string;
  blockParams(values: unknown[], paths?: unknown[]): unknown[];
  createFrame<T extends object>(object: T): T;
  isFunction(value: unknown): value is (...args: unknown[]) => unknown;
}

export function registerFlowHelpers(engine: LaurelEngine): void {
  // Handlebars provides if/unless/each/with by default; expose a couple of
  // Ghost-flavoured aliases that themes occasionally use.
  engine.hb.registerHelper('if', function ifHelper(this: unknown, ...args: unknown[]) {
    if (args.length !== 2) {
      throw new Error('#if requires exactly one argument');
    }
    const [conditional, options] = args as [unknown, Handlebars.HelperOptions];
    const value = engine.hb.Utils.isFunction(conditional)
      ? (conditional as () => unknown).call(this)
      : conditional;
    return isTruthyForHandlebars(engine, value, options) ? options.fn(this) : options.inverse(this);
  });

  engine.hb.registerHelper('unless', function unlessHelper(this: unknown, ...args: unknown[]) {
    if (args.length !== 2) {
      throw new Error('#unless requires exactly one argument');
    }
    const [conditional, options] = args as [unknown, Handlebars.HelperOptions];
    const value = engine.hb.Utils.isFunction(conditional)
      ? (conditional as () => unknown).call(this)
      : conditional;
    return isTruthyForHandlebars(engine, value, options) ? options.inverse(this) : options.fn(this);
  });

  engine.hb.registerHelper('with', function withHelper(this: unknown, ...args: unknown[]) {
    if (args.length !== 2) {
      throw new Error('#with requires exactly one argument');
    }
    const [context, options] = args as [unknown, HelperOptionsWithContextPath];
    const utils = engine.hb.Utils as unknown as HandlebarsRuntimeUtils;
    const value = engine.hb.Utils.isFunction(context)
      ? (context as () => unknown).call(this)
      : context;
    if (!isTruthyForHandlebars(engine, value, options)) return options.inverse(this);

    let data = options.data;
    if (options.data && options.ids && utils.appendContextPath) {
      data = utils.createFrame(options.data);
      data.contextPath = utils.appendContextPath(options.data.contextPath, options.ids[0]);
    }

    return options.fn(value, {
      data,
      blockParams: utils.blockParams([value], [data?.contextPath]),
    });
  });

  engine.hb.registerHelper('or', function orHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const values = args.slice(0, -1);
    const matched = values.some((value) => isTruthyForHandlebars(engine, value, options));
    if (options.fn) return matched ? options.fn(this) : options.inverse(this);
    return matched
      ? (values.find((value) => isTruthyForHandlebars(engine, value, options)) ?? '')
      : '';
  });

  engine.hb.registerHelper('and', function andHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const values = args.slice(0, -1);
    const matched =
      values.length > 0 && values.every((value) => isTruthyForHandlebars(engine, value, options));
    if (options.fn) return matched ? options.fn(this) : options.inverse(this);
    return matched ? values[values.length - 1] : '';
  });

  engine.hb.registerHelper('not', function notHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const value = args.length > 1 ? !isTruthyForHandlebars(engine, args[0], options) : false;
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
  // body). Laurel is members-out-of-scope (see CLAUDE.md), so there is no
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

function isTruthyForHandlebars(
  engine: LaurelEngine,
  value: unknown,
  options: Handlebars.HelperOptions,
): boolean {
  if (isUnauthenticatedMember(value)) return false;
  if (!options.hash.includeZero && !value) return false;
  return !engine.hb.Utils.isEmpty(value);
}
