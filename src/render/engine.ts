import Handlebars from 'handlebars';
import { EMPTY_FAVICON_SET, type FaviconSet } from '~/build/favicons.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { sanitizeThemeCustomValues } from '~/theme/validate-custom.ts';
import { textColorClassFor } from '~/util/color.ts';
import type { FilterIndex } from './helpers/get-filter.ts';
import { registerHelpers } from './helpers/index.ts';
import { splitLayout } from './layouts.ts';
import type { RouteContext } from './types.ts';

export interface NectarEngine {
  hb: typeof Handlebars;
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  // Resolved at build time from theme assets + site.icon. Optional because
  // unit tests construct engines directly without going through createEngine
  // and have no need to set this up.
  favicons?: FaviconSet;
  templates: Record<string, Handlebars.TemplateDelegate>;
  layouts: Record<string, Handlebars.TemplateDelegate>;
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
}

export function createEngine(opts: {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  favicons?: FaviconSet;
}): NectarEngine {
  const hb = Handlebars.create();
  registerPartials(hb, opts.theme);
  const templates: Record<string, Handlebars.TemplateDelegate> = {};
  const layouts: Record<string, Handlebars.TemplateDelegate> = {};
  for (const [name, source] of Object.entries(opts.theme.templates)) {
    const split = splitLayout(source);
    templates[name] = hb.compile(split.body, { noEscape: false });
    if (split.layout) {
      // mark for later resolution
      templates[`${name}__layout`] = hb.compile(`{{__layout '${split.layout}'}}`, {
        noEscape: false,
      });
    }
    if (isLayoutName(name)) {
      layouts[name] = hb.compile(source, { noEscape: false });
    }
  }

  const engine: NectarEngine = {
    hb,
    config: opts.config,
    content: opts.content,
    theme: opts.theme,
    favicons: opts.favicons ?? EMPTY_FAVICON_SET,
    templates,
    layouts,
    sortedCache: new Map(),
    render(route) {
      return renderRoute(engine, route);
    },
  };

  registerHelpers(engine);
  return engine;
}

function isLayoutName(name: string): boolean {
  return name === 'default' || name.startsWith('layouts/');
}

function registerPartials(hb: typeof Handlebars, theme: ThemeBundle): void {
  for (const [name, source] of Object.entries(theme.partials)) {
    hb.registerPartial(name, source);
    if (!name.includes('/')) {
      hb.registerPartial(`partials/${name}`, source);
    }
  }
  // Templates are also reachable as partials under their bare name to allow
  // {{> "post"}} from custom layouts.
  for (const [name, source] of Object.entries(theme.templates)) {
    hb.registerPartial(name, source);
  }
}

function renderRoute(engine: NectarEngine, route: RouteContext): string {
  const template = engine.theme.templates[route.template];
  if (!template) {
    throw new Error(`Template '${route.template}' not found in theme '${engine.theme.name}'`);
  }
  const { layout, body } = splitLayout(template);
  const context = buildContext(engine, route);
  if (!layout) {
    const compiled = engine.hb.compile(body, { noEscape: false });
    return compiled(context, { data: buildRootData(engine, route) });
  }
  const layoutSource = engine.theme.templates[layout];
  if (!layoutSource) {
    throw new Error(`Layout '${layout}' referenced by '${route.template}' not found`);
  }
  const innerCompiled = engine.hb.compile(body, { noEscape: false });
  const innerHtml = innerCompiled(context, { data: buildRootData(engine, route) });
  const layoutCompiled = engine.hb.compile(layoutSource, { noEscape: false });
  return layoutCompiled(
    { ...context, body: new engine.hb.SafeString(innerHtml) },
    { data: buildRootData(engine, route) },
  );
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
  if (data.pagination) {
    ctx.pagination = data.pagination;
  }
  if (data.error) {
    ctx.statusCode = data.error.statusCode;
    ctx.message = data.error.message;
    ctx.error = data.error;
  }
  ctx.body_class = computeBodyClass(route);
  ctx.post_class = data.post ? computePostClass(data.post) : '';
  return ctx;
}

export function buildRootData(engine: NectarEngine, route: RouteContext): Record<string, unknown> {
  const custom = buildCustom(engine);
  const backgroundColor =
    typeof custom.site_background_color === 'string' ? custom.site_background_color : undefined;
  return {
    site: engine.content.site,
    blog: engine.content.site,
    config: buildGhostConfig(engine),
    custom,
    page: route.kind === 'page' ? route.data.page : undefined,
    route,
    locale: engine.content.site.locale,
    labs: {},
    member: undefined,
    text_color_class: textColorClassFor(backgroundColor),
  };
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

function buildCustom(engine: NectarEngine): Record<string, unknown> {
  const merged = {
    ...engine.theme.pkg.customDefaults,
    ...engine.config.theme.custom,
  };
  return sanitizeThemeCustomValues(merged, engine.theme.pkg.custom);
}

function computeBodyClass(route: RouteContext): string {
  const tokens = [`nectar-route-${route.kind}`];
  if (route.kind === 'home' || route.kind === 'index') {
    tokens.push('home-template');
  }
  if (route.kind === 'post') tokens.push('post-template');
  if (route.kind === 'page') tokens.push('page-template');
  if (route.kind === 'tag') tokens.push('tag-template', 'archive-template');
  if (route.kind === 'author') tokens.push('author-template', 'archive-template');
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

function computePostClass(post: { tags: { slug: string }[]; featured?: boolean }): string {
  const tokens = ['post'];
  for (const t of post.tags ?? []) tokens.push(`tag-${t.slug}`);
  if (post.featured) tokens.push('featured');
  return tokens.join(' ');
}
