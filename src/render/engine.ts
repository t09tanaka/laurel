import Handlebars from 'handlebars';
import { EMPTY_FAVICON_SET, type FaviconSet } from '~/build/favicons.ts';
import type { NavigationItem, NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { sanitizeThemeCustomValues } from '~/theme/validate-custom.ts';
import { textColorClassFor } from '~/util/color.ts';
import { NectarError } from '~/util/errors.ts';
import { DEFAULT_PARTIALS } from './default-partials.ts';
import type { FilterIndex } from './helpers/get-filter.ts';
import { registerHelpers } from './helpers/index.ts';
import { recordKoenigRuntimeCardTypes } from './koenig-runtime.ts';
import { splitLayout } from './layouts.ts';
import { wrapMemberStub } from './member-stub.ts';
import type { RouteContext } from './types.ts';

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
}): NectarEngine {
  const hb = Handlebars.create();
  const templateBodies: Record<string, string> = {};
  const templates: Record<string, Handlebars.TemplateDelegate> = {};
  const layouts: Record<string, Handlebars.TemplateDelegate> = {};
  const templateLayoutNames = new Map<string, string | undefined>();
  for (const [name, source] of Object.entries(opts.theme.templates)) {
    const split = splitLayout(source);
    templateBodies[name] = split.body;
    templates[name] = hb.compile(split.body, { noEscape: false });
    templateLayoutNames.set(name, split.layout);
    if (split.layout) {
      // mark for later resolution
      templates[`${name}__layout`] = hb.compile(`{{__layout '${split.layout}'}}`, {
        noEscape: false,
      });
    }
    // Compile every template's full source as a layout candidate too. Themes
    // can reference any template via `{{!< name}}`, not just default/layouts/*,
    // and renderRoute resolves layouts through this map. Compiling once at
    // engine init avoids recompiling the same layout source for every route
    // that extends it (N routes × M layouts otherwise re-runs hb.compile per
    // render).
    layouts[name] = hb.compile(source, { noEscape: false });
  }
  registerPartials(hb, opts.theme, templateBodies);

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

function registerPartials(
  hb: typeof Handlebars,
  theme: ThemeBundle,
  templateBodies: Record<string, string>,
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
    hb.registerPartial(name, source);
    if (!name.includes('/')) {
      hb.registerPartial(`partials/${name}`, source);
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
  const themePartialNames = new Set(Object.keys(theme.partials));
  for (const [name, body] of Object.entries(templateBodies)) {
    hb.registerPartial(`__template__/${name}`, body);
    if (themePartialNames.has(name)) continue;
    hb.registerPartial(name, body);
  }
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

export function buildContext(_engine: NectarEngine, route: RouteContext): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  const data = route.data;
  if (data.post) {
    Object.assign(ctx, data.post);
    ctx.post = data.post;
  }
  if (data.page) {
    Object.assign(ctx, data.page);
    ctx.page = data.page;
  }
  if (route.kind === 'home') {
    ctx.meta_title = route.meta.title;
  }
  if (data.tag) {
    ctx.tag = data.tag;
    ctx.meta_title = route.meta.title;
    ctx.meta_description = route.meta.description;
    ctx.feature_image = data.tag.feature_image;
  }
  if (data.author) {
    ctx.author = data.author;
    ctx.meta_title = route.meta.title;
    ctx.meta_description = route.meta.description;
    ctx.feature_image = data.author.cover_image;
  }
  if (data.posts) {
    ctx.posts = data.posts;
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
  ctx.body_class = computeBodyClass(route);
  const postOrPage = data.post ?? data.page;
  ctx.post_class = postOrPage ? computePostClass(postOrPage) : '';
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

function defaultPaginationContext(): { page: number; pages: number } {
  return { page: 1, pages: 1 };
}

export function buildRootData(engine: NectarEngine, route: RouteContext): Record<string, unknown> {
  const custom = buildCustom(engine);
  const backgroundColor =
    typeof custom.site_background_color === 'string' ? custom.site_background_color : undefined;
  // Per-route enrichment of `@site.navigation` so themes that iterate
  // `{{#foreach @site.navigation}}{{slug}}{{#if current}}…{{/if}}{{/foreach}}`
  // see `slug` (derived from `label`) and `current` (URL match vs. route.url,
  // trailing-slash normalised) without each theme having to recompute them.
  const site = enrichSiteNavigation(
    {
      ...engine.content.site,
      icon: engine.content.site.icon ?? engine.config.site?.icon,
    },
    route,
  );
  return {
    site,
    blog: site,
    setting: site,
    config: buildGhostConfig(engine),
    custom,
    page: route.kind === 'page' ? route.data.page : undefined,
    route,
    locale: engine.content.site.locale,
    labs: {},
    // Static builds have no logged-in viewer, so `@member` is always undefined.
    // Source-style themes branch on `{{#unless @member}}` (header/footer/CTA)
    // and probe `{{@member.paid}}` / `{{@member.name}}`. Handlebars treats
    // undefined as falsy and yields empty for missing property access, so the
    // unauthenticated branch is what every visitor sees. Keep this key present
    // (set to undefined) so the data frame is shaped the same across every
    // route — never absent, never partially populated. Docs: docs/MEMBERS.md
    // §2 "@member.*" and §5 "No per-user state".
    //
    // `[components.preview].member` is the documented opt-in override: when set
    // we inject a synthetic member so designers can preview Casper / Edition
    // signed-in / paid branches against a static build. Production builds leave
    // it unset and `@member` stays undefined.
    member: buildPreviewMember(engine),
    text_color_class: textColorClassFor(backgroundColor),
  };
}

// `[components.preview].member` lets the operator inject a synthetic `@member`
// (paid / free / named) so themes that branch on `{{@member.paid}}` or
// `{{#unless @member}}` can be previewed against the static build. Default is
// `undefined` everywhere; only set keys land on the emitted object so themes
// that probe `{{@member.email}}` see "missing" (Handlebars-empty) rather than
// the literal string "undefined". Static builds never authenticate anyone, so
// this is a designer-preview affordance, not a delivery gate.
function buildPreviewMember(engine: NectarEngine): Record<string, unknown> | undefined {
  const preview = engine.config.components?.preview;
  const member = preview?.member;
  if (!member) return undefined;
  const out: Record<string, unknown> = { paid: member.paid === true };
  if (typeof member.name === 'string') out.name = member.name;
  if (typeof member.email === 'string') out.email = member.email;
  // Wrap in a Proxy so themes that probe richer Ghost shape (`@member.tier.name`,
  // `@member.subscriptions.0.status`) get a safe falsy chain instead of an
  // `undefined` that crashes any JS-side helper that does non-null-safe access.
  // Handlebars chains on undefined are already safe; this wrapper extends that
  // safety to plugin helpers written in plain TS. See `member-stub.ts` for the
  // full design rationale.
  return wrapMemberStub(out);
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

function buildCustom(engine: NectarEngine): Record<string, unknown> {
  const merged = {
    ...engine.theme.pkg.customDefaults,
    ...engine.config.theme.custom,
  };
  return sanitizeThemeCustomValues(merged, engine.theme.pkg.custom);
}

function computeBodyClass(route: RouteContext): string {
  const tokens = [`nectar-route-${route.kind}`];
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
  if (route.kind === 'post') tokens.push('post-template');
  if (route.kind === 'page') tokens.push('page-template');
  if (route.kind === 'tag') tokens.push('tag-template', 'archive-template');
  if (route.kind === 'author') tokens.push('author-template', 'archive-template');
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
  if (route.data.pagination && route.data.pagination.page > 1) {
    tokens.push('paged');
  }
  if (route.data.tag) tokens.push(`tag-${route.data.tag.slug}`);
  if (route.data.author) tokens.push(`author-${route.data.author.slug}`);
  // Ghost emits `tag-<slug>` for every tag on the current post, including
  // internal tags. Internal tag slugs already carry the `hash-` prefix
  // (see content/loader.ts), so they surface here as `tag-hash-<name>`
  // without a separate code path. De-duplicate against an existing
  // `tag-<slug>` token (the tag-archive route already added one).
  if (route.kind === 'post' && route.data.post) {
    const seen = new Set(tokens);
    for (const tag of route.data.post.tags ?? []) {
      const token = `tag-${tag.slug}`;
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens.join(' ');
}

// Ghost's `post_class` emits more than just tag/featured tokens — themes
// (Source included) hook layout into `no-image`/`image` and `page`, so a
// minimal "post tag-x" output drops styles that depend on these tokens. We
// also surface `no-content` for empty bodies; that lets themes hide the
// content shell on stub posts without inspecting the body themselves.
export function computePostClass(post: {
  tags?: { slug: string }[];
  featured?: boolean;
  feature_image?: string | undefined;
  html?: string;
  page?: boolean;
}): string {
  const tokens = ['post'];
  for (const t of post.tags ?? []) tokens.push(`tag-${t.slug}`);
  if (post.featured) tokens.push('featured');
  // Both `image` (Ghost legacy) and `feature-image` (Casper / Source variant)
  // markers are emitted together so theme CSS that hooks either selector
  // keeps working. `image-cover` is the Source-specific layout hook for
  // posts that should fill the hero band. Posts without a feature image
  // fall back to `no-image` so themes can collapse the cover slot.
  if (post.feature_image) {
    tokens.push('image', 'feature-image', 'image-cover');
  } else {
    tokens.push('no-image');
  }
  if (!post.html || post.html.trim() === '') tokens.push('no-content');
  if (post.page) tokens.push('page');
  return tokens.join(' ');
}
