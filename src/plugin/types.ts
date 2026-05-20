import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import type { NectarEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';

// Runtime context that plugin / theme hooks receive. Treat these values as
// live-shared references for one build; plugins may mutate `content` /
// `engine` during early hooks (beforeBuild / afterContentLoad) to inject
// helpers, register transforms, or stitch in extra data. Once the build
// reaches the render fan-out the pipeline assumes the graph is frozen, so
// late-hook mutations (afterRender / afterEmit) are undefined behaviour.
export interface BuildContext {
  readonly cwd: string;
  readonly outputDir: string;
  readonly config: NectarConfig;
  readonly content: ContentGraph;
  readonly theme: ThemeBundle;
  // Render engine handed to plugins so `beforeBuild` can call
  // `ctx.engine.registerHelper("stripe_button", () => ...)`. Optional because
  // very early hooks (before engine creation) may receive a context without an
  // engine; production builds always populate this by the time the first
  // plugin hook fires (`beforeBuild` runs after engine construction).
  readonly engine: NectarEngine;
}

// Markdown transform context handed to `transformMarkdown` hooks. `kind` lets
// a plugin opt into transforming only posts / pages without inspecting the
// caller. `frontmatter` is the parsed YAML so transforms can branch on custom
// keys (e.g. only transform when `frontmatter.callouts !== false`). Note that
// markdown transforms run during content load — before the render engine is
// built — so this context intentionally omits `BuildContext` to keep the API
// honest about what's actually available at this point. Use `beforeRender`
// for hooks that need the full build context.
export interface MarkdownTransformContext {
  readonly kind: 'post' | 'page';
  readonly path: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

// Minimal route shape plugins may return from `routes()`. The build pipeline
// will fold these into the planned routes after the built-in planner runs.
// Plugin authors must supply a valid template name (resolved against the
// theme's templates) and an `outputPath` ending in `.html`.
export type PluginRoute = RouteContext;

// Public Plugin interface. Every hook is optional; a plugin can pick the
// subset of lifecycle points it needs. Hooks may be sync or async — the
// pipeline awaits them sequentially in plugin registration order. Throwing
// from a hook by default aborts the build, but the loader applies a
// warn-and-skip policy on load errors so a broken plugin never bricks the
// site (see `loadPlugins`).
export interface Plugin {
  // Human-readable plugin name. Surfaced in error / warning messages so the
  // operator can tell which plugin misbehaved. Required.
  readonly name: string;

  // Runs once at the very start of the build, after config + theme + content
  // are loaded and the render engine has been created. Use this hook to:
  //   - Register custom Handlebars helpers via `ctx.engine.registerHelper`.
  //   - Register markdown transforms (see `transformMarkdown`).
  //   - Mutate `ctx.config` / `ctx.content` before routes are planned.
  beforeBuild?: (ctx: BuildContext) => void | Promise<void>;

  // Runs after the content loader has built the graph but before the render
  // engine fans out. The `graph` argument is the same object as `ctx.content`
  // (passed explicitly for ergonomics). Mutations here are visible to every
  // subsequent hook and every render.
  afterContentLoad?: (ctx: BuildContext, graph: ContentGraph) => void | Promise<void>;

  // Runs once per planned route immediately before that route is rendered.
  // Use this to tweak `route.data` (e.g. inject extra context) or short-circuit
  // by throwing if the route should be aborted.
  beforeRender?: (ctx: BuildContext, route: RouteContext) => void | Promise<void>;

  // Runs once per planned route immediately after the route HTML is produced.
  // The return value, if any, replaces the HTML that downstream steps (minify,
  // write, manifest) will see. Returning `undefined` or `void` keeps the HTML
  // untouched. Plugins composing afterRender hooks chain in registration order,
  // each seeing the previous plugin's transformed HTML.
  afterRender?: (
    ctx: BuildContext,
    route: RouteContext,
    html: string,
  ) => string | undefined | Promise<string | undefined>;

  // Runs once after every file has been written and assets copied. Use for
  // generators that consume the final on-disk site (e.g. emit additional
  // reports, post-process emitted JSON, push to external indexes).
  afterEmit?: (ctx: BuildContext) => void | Promise<void>;

  // Returns extra routes to merge into the build's route plan. Called after
  // `planRoutes()` runs; returned routes are appended in the order the
  // plugins are registered. Use this to materialise generator-driven pages
  // (custom feed formats, hand-rolled `/archive/` indexes, etc.). Returned
  // RouteContext values must satisfy the same shape the built-in planner
  // emits; the engine renders them through the regular pipeline.
  routes?: (ctx: BuildContext) => readonly PluginRoute[] | Promise<readonly PluginRoute[]>;

  // Transform markdown source before the markdown loader parses it. Receives
  // the raw markdown body (with frontmatter already stripped) and returns the
  // transformed body. Multiple plugins composing this hook chain in
  // registration order, so each sees the previous plugin's output.
  transformMarkdown?: (input: string, ctx: MarkdownTransformContext) => string | Promise<string>;
}

// Module shape Nectar accepts when dynamic-importing a plugin path. The
// loader accepts either a `default` export or a named `plugin` export; both
// may be a factory function or a plain object satisfying the `Plugin` shape.
export type PluginModuleShape =
  | Plugin
  | { default: Plugin | PluginFactory }
  | { plugin: Plugin | PluginFactory };

// Factory form so plugin authors can return a fresh Plugin object per build
// (useful for stateful plugins that maintain per-build counters / caches).
export type PluginFactory = () => Plugin | Promise<Plugin>;

// Signature for a Handlebars helper registered via the engine's
// `registerHelper` shortcut. Mirrors Handlebars' own `HelperDelegate` shape
// without dragging the full handlebars type signature into plugin code.
export type NectarHelper = (this: unknown, ...args: unknown[]) => unknown;

// Legacy plugin shape published before the full hook surface existed. Kept
// alive as an alias because downstream code already imports it from
// `nectar/types`. The new `Plugin` interface is a structural superset (every
// `NectarPlugin` is a valid `Plugin` if its `setup` is renamed to
// `beforeBuild`), but we keep the legacy name resolvable so existing code
// keeps compiling.
export interface NectarPlugin {
  readonly name: string;
  setup?: (ctx: BuildContext) => void | Promise<void>;
}
