import Handlebars from 'handlebars';
import { EMPTY_FAVICON_SET, type FaviconSet } from '~/build/favicons.ts';
import type { Profiler } from '~/build/profile.ts';
import type { NavigationItem, NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { assetPublicUrl } from '~/theme/assets.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { sanitizeThemeCustomValues } from '~/theme/validate-custom.ts';
import { type TextColorClass, textColorClassFor } from '~/util/color.ts';
import { NectarError } from '~/util/errors.ts';
import { directionForLocale } from '~/util/locale.ts';
import { logger } from '~/util/logger.ts';
import { bodyClassToken } from './class-names.ts';
import { DEFAULT_PARTIALS } from './default-partials.ts';
import { recordEmbedProviderScripts } from './embed-provider-scripts.ts';
import type { FilterIndex } from './helpers/get-filter.ts';
import { registerHelpers } from './helpers/index.ts';
import { recordKoenigRuntimeCardTypes } from './koenig-runtime.ts';
import { resolveLayoutName, splitLayout } from './layouts.ts';
import {
  type Member,
  type MemberSubscription,
  createUnauthenticatedMember,
  wrapMemberStub,
} from './member-stub.ts';
import { withTrustedCaptionHtml, withTrustedCaptionHtmlArray } from './safe-context.ts';
import {
  compileThemeSource,
  installSourceAwareHelperErrors,
  layoutSourceInfo,
  partialSourceInfo,
  registerThemePartial,
  templatePartialSourceInfo,
  templateSourceInfo,
} from './source-errors.ts';
import type { RouteContext } from './types.ts';

const MISSING_PARTIAL_FALLBACK_NAME = 'missing-partial';
const MAX_PARTIAL_RENDER_DEPTH = 64;
const RESERVED_ROOT_CONTEXT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const customDataCache = new WeakMap<NectarEngine, Record<string, unknown>>();
const rootDataBaseCache = new WeakMap<NectarEngine, RootDataBase>();
const bodyClassCache = new WeakMap<NectarEngine, WeakMap<RouteContext, string>>();

interface RootDataBase {
  custom: Record<string, unknown>;
  config: Record<string, unknown>;
  member: Member;
  text_color_class: TextColorClass;
}

export interface NectarEngine {
  hb: typeof Handlebars;
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  // Project root used by helpers that need filesystem access (image_dimensions
  // resolves `/content/images/...` URLs to local files for intrinsic dimension
  // probing). Optional because unit tests build engines directly and most
  // helpers don't touch the filesystem.
  cwd?: string;
  // Resolved at build time from theme assets + site.icon. Optional because
  // unit tests construct engines directly without going through createEngine
  // and have no need to set this up.
  favicons?: FaviconSet;
  templates: Record<string, Handlebars.TemplateDelegate>;
  layouts: Record<string, Handlebars.TemplateDelegate>;
  // Layout name extracted from `{{!< name}}` per template, pre-computed in
  // createEngine so renderRoute can skip the splitLayout regex per route.
  // Optional for unit tests that mock the engine without going through
  // createEngine.
  templateLayoutNames?: Map<string, string | undefined>;
  render(route: RouteContext): string;
  // Cache for `{{#get resource order=...}}` sorted results, keyed by
  // `${resource}|${order}`. Without this, every page that calls
  // `{{#get "posts"}}` re-sorts the full post list — 10k pages × N log N
  // collapses fast on themes that use `get` in headers or sidebars.
  sortedCache: Map<string, readonly unknown[]>;
  // Lazy secondary indexes for `{{#get}}` filter clauses, keyed by resource.
  // Built on first filtered `get` against the resource; without this, every
  // call scans the full list per indexable key.
  filterIndexCache?: Map<string, FilterIndex>;
  // Engine-scoped cache for fully prepared `{{#get}}` query results. Themes
  // often repeat the same related/featured/latest-post query on every route;
  // caching after filtering, cloning, includes, and field projection avoids
  // redoing that work N times during a full build.
  getResultCache?: Map<string, unknown>;
  // Engine-scoped cache for the default `{{navigation}}` helper markup.
  // Navigation is site-level data, so the expensive escape/slug/href work can
  // be reused across route renders for equivalent output states.
  navigationHtmlCache?: Map<string, Handlebars.SafeString>;
  // Plugin-facing shortcut for `engine.hb.registerHelper(name, fn)`. Exposed
  // on the engine surface so plugin authors do not have to reach into the
  // Handlebars instance directly, and so we keep one canonical extension
  // point if the engine implementation ever swaps Handlebars out. Optional
  // for unit tests that construct mock engines without going through
  // `createEngine`; production builds always populate this.
  registerHelper?: (name: string, fn: (this: unknown, ...args: unknown[]) => unknown) => void;
}

export function createEngine(opts: {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  favicons?: FaviconSet;
  cwd?: string;
  profiler?: Profiler | null;
}): NectarEngine {
  const hb = Handlebars.create();
  installHelperProfiling(hb, opts.profiler ?? null);
  installSourceAwareHelperErrors(hb);
  const templateBodies: Record<string, string> = {};
  const templateBodyOffsets: Record<string, number> = {};
  const templates: Record<string, Handlebars.TemplateDelegate> = {};
  const layouts: Record<string, Handlebars.TemplateDelegate> = {};
  const templateLayoutNames = new Map<string, string | undefined>();
  for (const [name, source] of Object.entries(opts.theme.templates)) {
    const split = splitLayout(source);
    const bodyOffset = source.length - split.body.length;
    templateBodies[name] = split.body;
    templateBodyOffsets[name] = bodyOffset;
    templates[name] = compileThemeSource(
      hb,
      split.body,
      templateSourceInfo(opts.theme, name, bodyOffset),
    );
    const layout = split.layout
      ? resolveThemeLayoutName(opts.theme, split.layout, name)
      : undefined;
    templateLayoutNames.set(name, layout);
    if (layout) {
      // mark for later resolution
      templates[`${name}__layout`] = compileThemeSource(
        hb,
        `{{__layout '${layout}'}}`,
        templateSourceInfo(opts.theme, name, bodyOffset),
      );
    }
    // Compile every template's full source as a layout candidate too. Themes
    // can reference any template via `{{!< name}}`, not just default/layouts/*,
    // and renderRoute resolves layouts through this map. Compiling once at
    // engine init avoids recompiling the same layout source for every route
    // that extends it (N routes × M layouts otherwise re-runs hb.compile per
    // render).
    layouts[name] = compileThemeSource(hb, source, layoutSourceInfo(opts.theme, name));
  }
  for (const [name, source] of Object.entries(opts.theme.partials)) {
    const normalizedName = normalizePartialName(name);
    for (const layoutName of partialLayoutCandidateNames(normalizedName)) {
      if (layouts[layoutName]) continue;
      layouts[layoutName] = compileThemeSource(
        hb,
        source,
        partialSourceInfo(opts.theme, normalizedName),
      );
    }
  }
  registerPartials(hb, opts.theme, templateBodies, templateBodyOffsets);

  const engine: NectarEngine = {
    hb,
    config: opts.config,
    content: opts.content,
    theme: opts.theme,
    cwd: opts.cwd,
    favicons: opts.favicons ?? EMPTY_FAVICON_SET,
    templates,
    layouts,
    templateLayoutNames,
    sortedCache: new Map(),
    getResultCache: new Map(),
    navigationHtmlCache: new Map(),
    render(route) {
      return renderRoute(engine, route);
    },
    registerHelper(name, fn) {
      hb.registerHelper(name, fn as Handlebars.HelperDelegate);
    },
  };

  registerHelpers(engine);
  return engine;
}

function installHelperProfiling(hb: typeof Handlebars, profiler: Profiler | null): void {
  if (!profiler) return;
  const registerHelper = hb.registerHelper.bind(hb);
  hb.registerHelper = ((nameOrHash: string | Handlebars.HelperDeclareSpec, fn?: HelperFunction) => {
    if (typeof nameOrHash === 'string' && typeof fn === 'function') {
      return registerHelper(nameOrHash, wrapProfiledHelper(profiler, nameOrHash, fn));
    }
    if (nameOrHash && typeof nameOrHash === 'object' && fn === undefined) {
      const wrapped: Handlebars.HelperDeclareSpec = {};
      for (const [name, helper] of Object.entries(nameOrHash)) {
        wrapped[name] =
          typeof helper === 'function' ? wrapProfiledHelper(profiler, name, helper) : helper;
      }
      return registerHelper(wrapped);
    }
    if (typeof nameOrHash === 'string' && fn) return registerHelper(nameOrHash, fn);
    return registerHelper(nameOrHash as Handlebars.HelperDeclareSpec);
  }) as typeof hb.registerHelper;
}

function resolveThemeLayoutName(theme: ThemeBundle, layout: string, templateName: string): string {
  const resolved = resolveLayoutName(layout, templateName);
  if (Object.prototype.hasOwnProperty.call(theme.templates, resolved)) return resolved;
  const layoutTemplate = `layouts/${resolved}`;
  if (Object.prototype.hasOwnProperty.call(theme.templates, layoutTemplate)) return layoutTemplate;
  const layoutPartial = `partials/${resolved}`;
  if (Object.prototype.hasOwnProperty.call(theme.partials, layoutPartial)) return layoutPartial;
  if (Object.prototype.hasOwnProperty.call(theme.partials, resolved)) return resolved;
  return resolved;
}

type HelperFunction = Handlebars.HelperDelegate;

function wrapProfiledHelper(profiler: Profiler, name: string, fn: HelperFunction): HelperFunction {
  return function profiledHelper(this: unknown, ...args: unknown[]) {
    const stop = profiler.startHelper(name);
    try {
      return fn.apply(this, args as Parameters<HelperFunction>);
    } finally {
      stop();
    }
  };
}

function registerPartials(
  hb: typeof Handlebars,
  theme: ThemeBundle,
  templateBodies: Record<string, string>,
  templateBodyOffsets: Record<string, number>,
): void {
  // Defaults go in first so a theme's same-named partial overrides cleanly via
  // the subsequent `theme.partials` loop. Without this ordering, a theme that
  // ships `partials/search.hbs` would lose to Nectar's built-in markup (issue
  // #1135).
  for (const [name, source] of Object.entries(DEFAULT_PARTIALS)) {
    hb.registerPartial(name, source);
    if (!name.includes('/')) {
      hb.registerPartial(`partials/${name}`, source);
    }
  }
  for (const [name, source] of Object.entries(theme.partials)) {
    const normalizedName = normalizePartialName(name);
    for (const partialName of partialCandidateNames(normalizedName)) {
      registerThemePartial(hb, partialName, source, partialSourceInfo(theme, normalizedName));
    }
    const prefixedNames = partialCandidateNames(`partials/${normalizedName}`);
    if (!normalizedName.includes('/')) {
      for (const partialName of prefixedNames) {
        registerThemePartial(hb, partialName, source, partialSourceInfo(theme, normalizedName));
      }
    } else {
      for (const partialName of prefixedNames) {
        registerThemePartial(hb, partialName, source, partialSourceInfo(theme, normalizedName));
      }
    }
  }
  // Templates are also reachable as partials under their bare name to allow
  // `{{> "post"}}` from custom layouts. Register the layout-stripped body, not
  // the raw template source: themes that declare `{{!< default}}` at the top
  // of `post.hbs` would otherwise re-invoke the default layout from the
  // calling template's body, producing duplicated layout output or compile
  // surprises (issue #1131).
  //
  // Theme partials win on bare-name collisions: if a theme ships
  // `partials/index.hbs`, `{{> index}}` must resolve to the theme partial,
  // not the `index.hbs` template body. Skip the template-as-partial
  // registration whenever the bare name is already claimed by a theme partial,
  // and always expose the template body under the `__template__/<name>`
  // namespace as a stable escape hatch for callers that explicitly want the
  // template body (issue #552).
  const themePartialNames = new Set(
    Object.keys(theme.partials).flatMap((name) =>
      partialCandidateNames(normalizePartialName(name)),
    ),
  );
  const referencedPartialNames = staticPartialNames([
    ...Object.values(theme.templates),
    ...Object.values(theme.partials),
  ]);
  for (const name of Object.keys(templateBodies)) {
    const templatePartialName = `__template__/${name}`;
    const referencedByBareName = referencedPartialNames.has(name);
    const referencedByTemplateNamespace = referencedPartialNames.has(templatePartialName);
    if (referencedByBareName || referencedByTemplateNamespace) {
      registerTemplatePartial(hb, theme, name, templateBodies, templateBodyOffsets);
    }
    if (!referencedByBareName && !referencedByTemplateNamespace) {
      installLazyTemplatePartial(
        hb,
        theme,
        name,
        templateBodies,
        templateBodyOffsets,
        templatePartialName,
      );
    }
    if (themePartialNames.has(name)) continue;
    if (referencedByBareName) {
      registerTemplatePartial(hb, theme, name, templateBodies, templateBodyOffsets, name);
      continue;
    }
    installLazyTemplatePartial(hb, theme, name, templateBodies, templateBodyOffsets, name);
  }
  installMissingPartialFallback(hb, theme.name);
}

function registerTemplatePartial(
  hb: typeof Handlebars,
  theme: ThemeBundle,
  templateName: string,
  templateBodies: Record<string, string>,
  templateBodyOffsets: Record<string, number>,
  partialName = `__template__/${templateName}`,
): void {
  const body = templateBodies[templateName];
  if (body === undefined) return;
  registerThemePartial(
    hb,
    partialName,
    body,
    templatePartialSourceInfo(theme, templateName, templateBodyOffsets[templateName] ?? 0),
  );
}

function installLazyTemplatePartial(
  hb: typeof Handlebars,
  theme: ThemeBundle,
  templateName: string,
  templateBodies: Record<string, string>,
  templateBodyOffsets: Record<string, number>,
  partialName: string,
): void {
  const body = templateBodies[templateName];
  if (body === undefined) return;
  const partials = hb.partials as Record<string, unknown>;
  Object.defineProperty(partials, partialName, {
    configurable: true,
    enumerable: false,
    get() {
      const compiled = compileThemeSource(
        hb,
        body,
        templatePartialSourceInfo(theme, templateName, templateBodyOffsets[templateName] ?? 0),
      );
      Object.defineProperty(partials, partialName, {
        configurable: true,
        enumerable: false,
        value: compiled,
        writable: true,
      });
      return compiled;
    },
    set(value: unknown) {
      Object.defineProperty(partials, partialName, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    },
  });
}

function staticPartialNames(sources: string[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    try {
      collectStaticPartialNames(Handlebars.parse(source), names);
    } catch {
      // Let the existing source-aware compile/render path report parse errors
      // with the precise theme file and line instead of failing during this
      // best-effort optimisation scan.
    }
  }
  return names;
}

function collectStaticPartialNames(node: unknown, names: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStaticPartialNames(item, names);
    return;
  }
  if (!isRecord(node)) return;
  const type = node.type;
  if (type === 'PartialStatement' || type === 'PartialBlockStatement') {
    const name = staticPartialName(node.name);
    if (name !== undefined) names.add(normalizePartialName(name));
  }
  for (const value of Object.values(node)) {
    collectStaticPartialNames(value, names);
  }
}

function staticPartialName(node: unknown): string | undefined {
  if (!isRecord(node)) return undefined;
  if (node.type === 'StringLiteral' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'PathExpression' && typeof node.original === 'string') {
    return node.original;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type InvokePartial = (
  this: unknown,
  partial: unknown,
  context: unknown,
  options: MissingPartialRuntimeOptions,
) => unknown;

interface MissingPartialRuntimeOptions {
  name?: unknown;
  partials?: Record<string, unknown>;
}

function installMissingPartialFallback(hb: typeof Handlebars, themeName: string): void {
  const warned = new Set<string>();
  let partialRenderDepth = 0;
  hb.registerPartial(MISSING_PARTIAL_FALLBACK_NAME, function missingPartialFallback(
    _context: unknown,
    options?: MissingPartialRuntimeOptions,
  ) {
    const name = partialNameFromOptions(options);
    if (name !== undefined && !warned.has(name)) {
      warned.add(name);
      logger.warn(
        `Theme '${themeName}' references missing partial '${name}'; rendering an empty fallback.`,
      );
    }
    return '';
  } as unknown as Handlebars.TemplateDelegate);

  const vm = hb.VM as unknown as { invokePartial: InvokePartial };
  const invokePartial = vm.invokePartial;
  vm.invokePartial = function invokePartialWithMissingFallback(
    this: unknown,
    partial: unknown,
    context: unknown,
    options: MissingPartialRuntimeOptions,
  ) {
    partialRenderDepth += 1;
    try {
      if (partialRenderDepth > MAX_PARTIAL_RENDER_DEPTH) {
        const name = partialNameFromOptions(options);
        throw new NectarError({
          message: `Partial render depth exceeded while rendering${name ? ` '${name}'` : ''}`,
          hint: `Check theme partials for cyclic includes. Nectar stops partial rendering after ${MAX_PARTIAL_RENDER_DEPTH} nested partial calls to prevent unbounded recursion.`,
          docsUrl: 'docs/THEME_DEV.md#3-partials',
          code: 'theme',
        });
      }
      return invokePartial.call(this, partial, context, options);
    } catch (err) {
      const name = missingPartialName(err);
      if (name === undefined || hasParentPathSegment(name)) throw err;
      const fallback = lookupPartial(options?.partials, MISSING_PARTIAL_FALLBACK_NAME);
      return invokePartial.call(
        this,
        fallback ?? hb.partials[MISSING_PARTIAL_FALLBACK_NAME],
        context,
        {
          ...options,
          name,
        },
      );
    } finally {
      partialRenderDepth -= 1;
    }
  };
}

function lookupPartial(
  partials: Record<string, unknown> | undefined,
  name: string,
): unknown | undefined {
  if (partials === undefined) return undefined;
  return Object.prototype.hasOwnProperty.call(partials, name) ? partials[name] : undefined;
}

function partialNameFromOptions(
  options: MissingPartialRuntimeOptions | undefined,
): string | undefined {
  return typeof options?.name === 'string' ? options.name : undefined;
}

function missingPartialName(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const match = /^The partial (.+) could not be found$/.exec(err.message);
  return match?.[1];
}

function normalizePartialName(name: string): string {
  return name.replaceAll('\\', '/');
}

function partialCandidateNames(name: string): string[] {
  const names = [name];
  const alias = name.replace(/[._]+/g, '-');
  if (alias !== name) names.push(alias);
  return names;
}

function partialLayoutCandidateNames(name: string): string[] {
  const names = partialCandidateNames(name);
  if (!name.includes('/')) {
    names.push(...partialCandidateNames(`partials/${name}`));
  }
  return [...new Set(names)];
}

function renderRoute(engine: NectarEngine, route: RouteContext): string {
  const innerCompiled = engine.templates[route.template];
  if (!innerCompiled) {
    throw new NectarError({
      message: `Template '${route.template}' not found in theme '${engine.theme.name}'`,
      code: 'theme',
    });
  }
  const layout = engine.templateLayoutNames?.get(route.template);
  const context = buildContext(engine, route);
  const data = buildRootData(engine, route);
  // Per-render mutable bucket for `{{#contentFor "name"}}…{{/contentFor}}`
  // written by the inner template and read by the layout via `{{{block
  // "name"}}}`. Lives on the shared data frame so both renders see the same
  // object; reset per route so blocks never leak across pages.
  (data as { __blocks?: Record<string, string> }).__blocks = {};
  if (!layout) {
    return renderCompiled(innerCompiled, context, data);
  }
  const layoutCompiled = engine.layouts[layout];
  if (!layoutCompiled) {
    throw new NectarError({
      message: `Layout '${layout}' referenced by '${route.template}' not found`,
      code: 'theme',
    });
  }
  const innerHtml = renderCompiled(innerCompiled, context, data);
  recordKoenigRuntimeCardTypes(data, innerHtml);
  recordEmbedProviderScripts(data, innerHtml);
  return renderCompiled(
    layoutCompiled,
    { ...context, body: new engine.hb.SafeString(innerHtml) },
    data,
  );
}

function renderCompiled(
  template: Handlebars.TemplateDelegate,
  context: unknown,
  data: ReturnType<typeof buildRootData>,
): string {
  try {
    return template(context, { data });
  } catch (err) {
    const partialName = unsupportedParentPartialName(err);
    if (partialName !== undefined) {
      throw new NectarError({
        message: `Unsupported partial include '${partialName}': partial names are rooted at partials/ and cannot use ../ parent segments`,
        hint: 'Partial includes are rooted at the active theme partials/ directory and cannot use ../ parent segments. Move shared files under partials/ and include them by name, for example {{> "components/header"}}.',
        docsUrl: 'docs/THEME_DEV.md#3-partials',
        code: 'theme',
        cause: err,
      });
    }
    throw err;
  }
}

function unsupportedParentPartialName(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const match = /^The partial (.+) could not be found$/.exec(err.message);
  const name = match?.[1];
  if (name === undefined) return undefined;
  return hasParentPathSegment(name) ? name : undefined;
}

function hasParentPathSegment(name: string): boolean {
  return name.split(/[\\/]+/).includes('..');
}

export function buildContext(engine: NectarEngine, route: RouteContext): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  const data = route.data;
  if (route.locale) {
    ctx.locale = route.locale;
  }
  if (data.post) {
    const post = withTrustedCaptionHtml(engine.hb, data.post);
    assignRootFields(ctx, post);
    ctx.post = post;
  }
  if (data.page) {
    const page = withTrustedCaptionHtml(engine.hb, data.page);
    assignRootFields(ctx, page, 'page');
    ctx.page = page;
    // Ghost renders static pages through the same `{{#post}}` block shape as
    // posts. Source's page.hbs depends on this alias for the body to render.
    ctx.post = page;
  }
  if (route.kind === 'home') {
    ctx.meta_title = route.meta.title;
  }
  if (data.tag) {
    ctx.tag = data.tag;
    ctx.meta_title = route.meta.title;
    ctx.meta_description = route.meta.description;
    ctx.canonical_url = data.tag.canonical_url;
    ctx.feature_image = data.tag.feature_image;
    ctx.accent_color = data.tag.accent_color;
    ctx.og_title = data.tag.og_title;
    ctx.og_description = data.tag.og_description;
    ctx.og_image = data.tag.og_image;
    ctx.twitter_title = data.tag.twitter_title;
    ctx.twitter_description = data.tag.twitter_description;
    ctx.twitter_image = data.tag.twitter_image;
    ctx.codeinjection_head = data.tag.codeinjection_head;
    ctx.codeinjection_foot = data.tag.codeinjection_foot;
  }
  if (data.author) {
    ctx.author = data.author;
    ctx.meta_title = route.meta.title;
    ctx.meta_description = route.meta.description;
    ctx.feature_image = data.author.cover_image;
    ctx.accent_color = data.author.accent_color;
    ctx.og_title = data.author.og_title;
    ctx.og_description = data.author.og_description;
    ctx.og_image = data.author.og_image;
    ctx.twitter_title = data.author.twitter_title;
    ctx.twitter_description = data.author.twitter_description;
    ctx.twitter_image = data.author.twitter_image;
    ctx.codeinjection_head = data.author.codeinjection_head;
    ctx.codeinjection_foot = data.author.codeinjection_foot;
  }
  if (data.posts) {
    ctx.posts = withTrustedCaptionHtmlArray(engine.hb, data.posts);
  }
  // Ghost themes often probe `pagination.page` directly even on non-listing
  // routes (for example Dawn's `{{#match pagination.page 2}}`). Keep the
  // template root shaped like page 1 when the route has no real pagination
  // object, without mutating `route.data.pagination` that helpers use to
  // decide whether to render paginated navigation.
  ctx.pagination = data.pagination ?? defaultPaginationContext();
  if (data.error) {
    ctx.statusCode = data.error.statusCode;
    ctx.message = data.error.message;
    ctx.error = data.error;
  }
  ctx.body_class = cachedBodyClass(engine, route);
  const postOrPage = data.post ?? data.page;
  ctx.post_class = postOrPage?.post_class ?? '';
  // Ghost gates locked content with `{{#unless access}}` (and reads `{{access}}`
  // inline for icon paths). Handlebars resolves the bare `access` token as a
  // context lookup before falling through to the helper registry, so the
  // `access` helper alone wouldn't make `{{#unless access}}` evaluate truthy.
  // Nectar is members-out-of-scope (see CLAUDE.md), so seed `access: true` on
  // every route's root context. The dedicated `access` helper still handles
  // inline / block invocations and stays the canonical entry point.
  ctx.access = true;
  // Ghost sets `is_popup` only while rendering the subscribe iframe popup.
  // Nectar has no popup iframe renderer, so keep the root context explicitly
  // false instead of undefined. Themes such as Wave guard `.popup` classes
  // with `{{#if is_popup}}` and should deterministically take the static path.
  ctx.is_popup = false;
  return ctx;
}

function assignRootFields(ctx: Record<string, unknown>, value: object, skipKey?: string): void {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === skipKey) continue;
    if (RESERVED_ROOT_CONTEXT_KEYS.has(key)) continue;
    ctx[key] = record[key];
  }
}

function defaultPaginationContext(): { page: number; pages: number; total: number } {
  return { page: 1, pages: 1, total: 0 };
}

export function buildRootData(engine: NectarEngine, route: RouteContext): Record<string, unknown> {
  const base = rootDataBase(engine);
  const routeLocale = normalizeLocale(route.locale ?? engine.content.site.locale);
  const siteUrl = normalizeThemeSiteUrl(engine.content.site.url);
  // Per-route enrichment of `@site.navigation` so themes that iterate
  // `{{#foreach @site.navigation}}{{slug}}{{#if current}}…{{/if}}{{/foreach}}`
  // see `slug` (derived from `label`) and `current` (URL match vs. route.url,
  // trailing-slash normalised) without each theme having to recompute them.
  const site = enrichSiteNavigation(
    {
      ...engine.content.site,
      url: siteUrl,
      admin_url: adminUrl(siteUrl),
      locale: routeLocale,
      lang: shortLang(routeLocale),
      direction: directionForLocale(routeLocale),
      icon: engine.content.site.icon ?? engine.config.site?.icon,
      members_support_address: engine.content.site.members_support_address ?? '',
      allow_self_signup:
        engine.content.site.allow_self_signup ?? engine.content.site.members_invite_only !== true,
    },
    route,
  );
  const pagination = route.data.pagination ?? defaultPaginationContext();
  const pageData: Record<string, unknown> = {
    number: pagination.page,
    page: pagination.page,
    pages: pagination.pages,
    total: pagination.total,
  };
  if (route.kind === 'page' && route.data.page) {
    pageData.show_title_and_feature_image = route.data.page.show_title_and_feature_image;
  }
  return {
    site,
    blog: site,
    setting: site,
    config: base.config,
    custom: base.custom,
    page: pageData,
    route,
    locale: routeLocale,
    labs: buildLegacyLabs(site),
    // Static builds have no logged-in viewer, so default `@member` is a safe
    // falsy stub. Source-style themes branch on `{{#unless @member}}`
    // (header/footer/CTA) and probe `{{@member.paid}}` / `{{@member.name}}`.
    // The stub preserves that unauthenticated branch while avoiding
    // property-of-undefined failures in strict/theme helper contexts. Keep the
    // key present so the data frame is shaped the same across every route.
    // Docs: docs/MEMBERS.md §2 "@member.*" and §5 "No per-user state".
    //
    // `[components.preview].member` is the documented opt-in override: when set
    // we inject a synthetic member so designers can preview Casper / Edition
    // signed-in / paid branches against a static build. Production builds leave
    // it unset and `@member` stays an unauthenticated safe stub.
    member: base.member,
    text_color_class: base.text_color_class,
  };
}

function rootDataBase(engine: NectarEngine): RootDataBase {
  const cached = rootDataBaseCache.get(engine);
  if (cached) return cached;
  const custom = buildCustom(engine);
  const resolved: RootDataBase = {
    custom,
    config: buildGhostConfig(engine),
    member: buildPreviewMember(engine) ?? createUnauthenticatedMember(),
    text_color_class: resolveTextColorClass(engine, custom),
  };
  rootDataBaseCache.set(engine, resolved);
  return resolved;
}

function cachedBodyClass(engine: NectarEngine, route: RouteContext): string {
  let perEngine = bodyClassCache.get(engine);
  if (!perEngine) {
    perEngine = new WeakMap();
    bodyClassCache.set(engine, perEngine);
  }
  const cached = perEngine.get(route);
  if (cached !== undefined) return cached;
  const resolved = computeBodyClass(route, resolveTextColorClass(engine));
  perEngine.set(route, resolved);
  return resolved;
}

function normalizeLocale(locale: string | undefined): string {
  return (locale || 'en').toLowerCase();
}

function shortLang(locale: string): string {
  return locale.split('-')[0] ?? locale;
}

function adminUrl(siteUrl: string): string {
  return `${siteUrl}/ghost/`;
}

// `[components.preview].member` lets the operator inject a synthetic `@member`
// (paid / free / named) so themes that branch on `{{@member.paid}}` or
// `{{#unless @member}}` can be previewed against the static build. Default is
// `undefined` everywhere; only set keys land on the emitted object so themes
// that probe `{{@member.email}}` see "missing" (Handlebars-empty) rather than
// the literal string "undefined". Static builds never authenticate anyone, so
// this is a designer-preview affordance, not a delivery gate.
function buildPreviewMember(engine: NectarEngine): Member | undefined {
  const preview = engine.config.components?.preview;
  const member = preview?.member;
  if (!member) return undefined;
  const out: Member = { paid: member.paid === true };
  if (typeof member.name === 'string') out.name = member.name;
  if (typeof member.email === 'string') out.email = member.email;
  if (typeof member.default_payment_card_last4 === 'string') {
    out.default_payment_card_last4 = member.default_payment_card_last4;
  }
  if (Array.isArray(member.subscriptions)) {
    out.subscriptions = member.subscriptions.map(normalizePreviewSubscription);
  }
  // Wrap in a Proxy so themes that probe richer Ghost shape (`@member.tier.name`,
  // `@member.subscriptions.0.status`) get a safe falsy chain instead of an
  // `undefined` that crashes any JS-side helper that does non-null-safe access.
  // Handlebars chains on undefined are already safe; this wrapper extends that
  // safety to plugin helpers written in plain TS. See `member-stub.ts` for the
  // full design rationale.
  return wrapMemberStub(out);
}

function normalizePreviewSubscription(subscription: {
  cancel_at_period_end?: boolean;
  current_period_end?: string;
  plan?: { currency_symbol?: string; interval?: string };
}): MemberSubscription {
  const out: MemberSubscription = {};
  if (typeof subscription.cancel_at_period_end === 'boolean') {
    out.cancel_at_period_end = subscription.cancel_at_period_end;
  }
  if (typeof subscription.current_period_end === 'string') {
    out.current_period_end = subscription.current_period_end;
  }
  if (subscription.plan) {
    out.plan = {};
    if (typeof subscription.plan.currency_symbol === 'string') {
      out.plan.currency_symbol = subscription.plan.currency_symbol;
    }
    if (typeof subscription.plan.interval === 'string') {
      out.plan.interval = subscription.plan.interval;
    }
  }
  return out;
}

// Ghost themes read `@config.posts_per_page` (flat keys from the theme's
// `package.json` `config` block), not Nectar's nested `[build]` config. Source
// theme's `{{#get "posts" limit=@config.posts_per_page}}` would silently fall
// back to the helper's default if we exposed the raw NectarConfig here.
function buildGhostConfig(engine: NectarEngine): Record<string, unknown> {
  return {
    posts_per_page: engine.theme.pkg.posts_per_page,
    image_sizes: engine.theme.pkg.image_sizes,
    card_assets: engine.theme.pkg.card_assets,
  };
}

// Compute slug + current per nav item without mutating the shared ContentGraph
// site object. Returns a shallow-cloned site whose `navigation` /
// `secondary_navigation` arrays are new objects with `slug` / `current`
// attached. Slug is derived from `label` so themes can emit `nav-{{slug}}`;
// current uses trailing-slash-normalised URL comparison against `route.url`.
function enrichSiteNavigation(
  site: ContentGraph['site'],
  route: { url?: string },
): ContentGraph['site'] {
  const currentUrl = route.url;
  // Primary navigation defaults to `[]` for templates that iterate
  // `{{#each navigation}}` (the empty list renders nothing, which is correct).
  const enrichPrimary = (items: ContentGraph['site']['navigation'] | undefined) =>
    Array.isArray(items)
      ? items.map((item) => ({
          ...item,
          slug: navSlug(item.label),
          current:
            currentUrl !== undefined &&
            (currentUrl === item.url || normaliseNavUrl(currentUrl) === normaliseNavUrl(item.url)),
        }))
      : [];
  // Secondary navigation collapses an empty list to `undefined` so theme
  // guards like `{{#unless @site.secondary_navigation}}` evaluate as expected.
  // Handlebars treats `[]` as truthy (it is an object), so keeping the empty
  // array would silently never render those branches. See issue #324.
  const enrichSecondary = (
    items: ContentGraph['site']['secondary_navigation'],
  ): NavigationItem[] | undefined => {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    return items.map((item) => ({
      ...item,
      slug: navSlug(item.label),
      current:
        currentUrl !== undefined &&
        (currentUrl === item.url || normaliseNavUrl(currentUrl) === normaliseNavUrl(item.url)),
    }));
  };
  return {
    ...site,
    navigation: enrichPrimary(site.navigation),
    secondary_navigation: enrichSecondary(site.secondary_navigation),
  };
}

function navSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

function normaliseNavUrl(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

function normalizeThemeSiteUrl(url: string | undefined): string {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : '';
}

function buildCustom(engine: NectarEngine): Record<string, unknown> {
  const cached = customDataCache.get(engine);
  if (cached) return cached;
  const merged = {
    ...(engine.theme?.pkg?.customDefaults ?? {}),
    ...(engine.config?.theme?.custom ?? {}),
  };
  const sanitized = sanitizeThemeCustomValues(merged, engine.theme?.pkg?.custom ?? {});
  const resolved = resolveCustomImageValues(engine, sanitized);
  customDataCache.set(engine, resolved);
  return resolved;
}

function buildLegacyLabs(site: ContentGraph['site']): Record<string, boolean> {
  return {
    members: site.members_enabled,
    subscribers: site.members_enabled,
  };
}

function resolveCustomImageValues(
  engine: NectarEngine,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const defs = engine.theme?.pkg?.custom ?? {};
  const out = { ...custom };
  for (const [key, def] of Object.entries(defs)) {
    if (def.type !== 'image') continue;
    const raw = out[key];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const logical = raw.replace(/^\//, '');
    const asset = engine.theme.assets.get(logical) ?? engine.theme.assets.get(`assets/${logical}`);
    if (asset) {
      out[key] = assetPublicUrl(asset, engine.config.build.base_path);
    }
  }
  return out;
}

function resolveTextColorClass(
  engine: NectarEngine,
  custom: Record<string, unknown> = buildCustom(engine),
): TextColorClass {
  return textColorClassFor(resolveTextColorSource(engine, custom));
}

function resolveTextColorSource(
  engine: NectarEngine,
  custom: Record<string, unknown>,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(custom, 'site_background_color')) {
    return typeof custom.site_background_color === 'string'
      ? custom.site_background_color
      : undefined;
  }
  return (
    pickString(engine.config?.site?.accent_color) ?? pickString(engine.content?.site?.accent_color)
  );
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function computeBodyClass(route: RouteContext, textColorClass: TextColorClass): string {
  const tokens = [`nectar-route-${route.kind}`, textColorClass];
  const paginationPage = route.data.pagination?.page ?? 1;
  // Ghost limits `home-template` to the actual home root (page 1 of the home
  // index). Paginated home archives switch to `paged` + `archive-template`
  // instead so theme CSS that targets `body.home-template` (the index hero)
  // does not bleed onto `/page/2/`. The bare `home` route kind without
  // pagination still counts as page 1 here so themes that build the home
  // route without a pagination object (synthetic tests, custom routes) keep
  // the home-template marker.
  if ((route.kind === 'home' || route.kind === 'index') && paginationPage === 1) {
    tokens.push('home-template');
  }
  if (route.kind === 'post') {
    tokens.push('post-template');
    pushBodyClassToken(tokens, 'post-template', route.data.post?.slug);
  }
  if (route.kind === 'page') {
    tokens.push('page-template');
    pushBodyClassToken(tokens, 'page-template', route.data.page?.slug);
  }
  if (route.kind === 'tag') {
    tokens.push('tag-template', 'archive-template');
    pushBodyClassToken(tokens, 'tag-template', route.data.tag?.slug);
  }
  if (route.kind === 'author') {
    tokens.push('author-template', 'archive-template');
    pushBodyClassToken(tokens, 'author-template', route.data.author?.slug);
  }
  // Paginated home / index archives are aggregated listings too; Ghost's
  // Source theme styles `body.archive-template` regardless of which archive
  // kind it is. Surface the marker on every page > 1 of a home archive so
  // theme CSS picks up consistent layout for both tag/author archives and
  // paginated home archives.
  if ((route.kind === 'home' || route.kind === 'index') && paginationPage > 1) {
    tokens.push('archive-template');
  }
  // Ghost emits `error-template` for 404 / 500 / generic error routes so
  // themes can style the error page without inspecting the status code.
  if (route.kind === 'error') tokens.push('error-template');
  if (isMembersRoute(route)) tokens.push('members-template');
  if (route.data.pagination && route.data.pagination.page > 1) {
    tokens.push('paged');
  }
  if (route.data.tag) pushBodyClassToken(tokens, 'tag', route.data.tag.slug);
  if (route.data.author) pushBodyClassToken(tokens, 'author', route.data.author.slug);
  // Ghost emits `tag-<slug>` for every tag on the current post, including
  // internal tags. Internal tag slugs already carry the `hash-` prefix
  // (see content/loader.ts), so they surface here as `tag-hash-<name>`
  // without a separate code path. De-duplicate against an existing
  // `tag-<slug>` token (the tag-archive route already added one).
  if (route.kind === 'post' && route.data.post) {
    const seen = new Set(tokens);
    for (const tag of route.data.post.tags ?? []) {
      const token = bodyClassToken('tag', tag.slug);
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens.join(' ');
}

function isMembersRoute(route: RouteContext): boolean {
  return route.kind === 'custom' && /^\/members(?:\/|$)/.test(route.url);
}

function pushBodyClassToken(tokens: string[], prefix: string, slug: unknown): void {
  const token = bodyClassToken(prefix, slug);
  if (token) tokens.push(token);
}
