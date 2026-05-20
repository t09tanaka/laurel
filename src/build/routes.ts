import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import type { PaginationInfo, RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { NectarError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { absoluteUrlWithBasePath, withBasePath } from '~/util/url.ts';
import { assignPostUrls } from './permalinks.ts';
import {
  type ResolvedCollection,
  type RoutesYaml,
  applyTaxonomyTemplate,
  emptyRoutesYaml,
  resolveCollections,
  resolveRouteEntries,
  resolveTaxonomies,
  routeUrlToOutputPath,
} from './routes-yaml.ts';

export function planRoutes(opts: {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  routesYaml?: RoutesYaml;
}): RouteContext[] {
  const { config, content, theme } = opts;
  const routesYaml = opts.routesYaml ?? emptyRoutesYaml();
  const taxonomies = resolveTaxonomies(routesYaml);
  const collections = resolveCollections(routesYaml);
  const postAssignments = assignPostUrls(content.posts, collections);
  const pickPostTemplate = makePostTemplatePicker(theme);
  const routes: RouteContext[] = [];
  const perPage = config.build.posts_per_page || theme.pkg.posts_per_page;
  const basePath = config.build.base_path || '/';

  const homeTemplate = theme.templates.home ? 'home' : 'index';
  const indexTemplate = theme.templates.index ?? theme.templates.home;
  if (indexTemplate) {
    const pages = paginatePosts(content.posts, perPage);
    pages.forEach((slice, idx) => {
      const url = idx === 0 ? '/' : `/page/${idx + 1}/`;
      const outputPath = idx === 0 ? 'index.html' : `page/${idx + 1}/index.html`;
      routes.push({
        kind: idx === 0 ? 'home' : 'index',
        url,
        outputPath,
        template: idx === 0 ? homeTemplate : 'index',
        lastmod: latestPostTimestamp(slice),
        // `/page/N/` is a paginated view of the same posts already reachable
        // from `/`; listing it in the sitemap duplicates the index without
        // giving crawlers a canonical landing target. Only the first slice
        // (the home itself) is indexable. See #781.
        indexable: idx === 0,
        data: {
          posts: slice,
          pagination: paginationInfo(idx, pages, perPage, content.posts.length, '/', basePath),
        },
        meta: defaultMeta(
          config,
          url,
          idx === 0 ? homeTitle(config) : `${config.site.title} - Page ${idx + 1}`,
        ),
      });
    });
  }

  for (const post of content.posts) {
    const assignment = postAssignments.get(post.id);
    const url = assignment?.urlPath ?? `/${post.slug}/`;
    // Per-collection `template:` field opts a bucket of posts into a custom
    // theme template (`{template}.hbs`). Fall back to the warned template if
    // the theme doesn't ship the requested file — same UX as `routes:`
    // entries with a missing template, but applied to the entire bucket.
    const template = pickPostTemplate(assignment?.collection);
    routes.push({
      kind: 'post',
      url,
      outputPath: routeUrlToOutputPath(url),
      template,
      lastmod: post.updated_at ?? post.published_at,
      data: { post },
      meta: defaultMeta(
        config,
        url,
        post.meta_title ?? post.title,
        post.meta_description ?? post.excerpt,
        post.feature_image,
      ),
    });
  }

  if (theme.templates.page) {
    for (const page of content.pages) {
      const url = `/${page.slug}/`;
      routes.push({
        kind: 'page',
        url,
        outputPath: `${page.slug}/index.html`,
        template: resolvePageTemplate(page, theme),
        lastmod: page.updated_at ?? page.published_at,
        data: { page },
        meta: defaultMeta(
          config,
          url,
          page.meta_title ?? page.title,
          page.meta_description ?? page.excerpt,
          page.feature_image,
        ),
      });
    }
  }

  if (theme.templates.tag && taxonomies.tag !== undefined) {
    const tagTemplate = taxonomies.tag;
    for (const tag of content.tags) {
      const tagPosts = content.postsByTag.get(tag.slug) ?? [];
      const pages = paginatePosts(tagPosts, perPage);
      const base = applyTaxonomyTemplate(tagTemplate, tag.slug);
      pages.forEach((slice, idx) => {
        const url = idx === 0 ? base : `${base}page/${idx + 1}/`;
        const outputPath = routeUrlToOutputPath(url);
        routes.push({
          kind: 'tag',
          url,
          outputPath,
          template: 'tag',
          lastmod: latestPostTimestamp(slice),
          // Tag archive pagination tails (`/tag/<slug>/page/N/`) are
          // duplicates of the canonical tag landing with offset posts; keep
          // only the first slice in sitemap to avoid crawl-budget churn. See #781.
          indexable: idx === 0,
          data: {
            tag,
            posts: slice,
            pagination: paginationInfo(idx, pages, perPage, tagPosts.length, base, basePath),
          },
          meta: defaultMeta(
            config,
            url,
            tag.meta_title ?? `${tag.name} | ${config.site.title}`,
            tag.meta_description ?? tag.description,
            tag.feature_image,
          ),
        });
      });
    }
  }

  // `routes:` section from `routes.yaml` — pin a URL to a template that
  // renders with only the global context (no post/page/collection data).
  // Collections and taxonomies are intentionally not applied here yet;
  // `warnUnappliedSections` flags them at the pipeline boundary so authors
  // see the gap at build time instead of silent misbehaviour.
  const seenCustomUrls = new Set<string>();
  for (const entry of resolveRouteEntries(routesYaml)) {
    if (seenCustomUrls.has(entry.url)) {
      logger.warn(
        `routes.yaml: duplicate route '${entry.url}'; keeping the first occurrence and ignoring the rest.`,
      );
      continue;
    }
    seenCustomUrls.add(entry.url);
    if (!theme.templates[entry.template]) {
      logger.warn(
        `routes.yaml: route '${entry.url}' references template '${entry.template}' but the active theme has no '${entry.template}.hbs'; skipping.`,
      );
      continue;
    }
    if (entry.data !== undefined) {
      logger.warn(
        `routes.yaml: route '${entry.url}' uses 'data: ${entry.data}' which is parsed but not yet applied; the template will render without that data binding.`,
      );
    }
    if (entry.content_type !== 'html') {
      logger.warn(
        `routes.yaml: route '${entry.url}' requests content_type '${entry.content_type}' which is parsed but not yet applied; the route will be emitted as HTML.`,
      );
    }
    routes.push({
      kind: 'custom',
      url: entry.url,
      outputPath: routeUrlToOutputPath(entry.url),
      template: entry.template,
      data: {},
      meta: defaultMeta(config, entry.url, config.site.title),
    });
  }

  const errorTemplate = theme.templates['error-404']
    ? 'error-404'
    : theme.templates.error
      ? 'error'
      : undefined;
  if (errorTemplate) {
    const url = '/404.html';
    routes.push({
      kind: 'error',
      url,
      outputPath: '404.html',
      template: errorTemplate,
      // The 404 page is reachable as a static asset for hosts that serve it
      // as the not-found target, but it should never appear in discovery
      // surfaces (sitemap, RSS, link checkers). See #781.
      indexable: false,
      data: { error: { statusCode: 404, message: 'Page not found' } },
      meta: defaultMeta(config, url, `Page not found — ${config.site.title}`),
    });
  }

  if (theme.templates.author && taxonomies.author !== undefined) {
    const authorTemplate = taxonomies.author;
    for (const author of content.authors) {
      const authorPosts = content.postsByAuthor.get(author.slug) ?? [];
      const pages = paginatePosts(authorPosts, perPage);
      const base = applyTaxonomyTemplate(authorTemplate, author.slug);
      pages.forEach((slice, idx) => {
        const url = idx === 0 ? base : `${base}page/${idx + 1}/`;
        const outputPath = routeUrlToOutputPath(url);
        routes.push({
          kind: 'author',
          url,
          outputPath,
          template: 'author',
          lastmod: latestPostTimestamp(slice),
          // Author archive pagination tails (`/author/<slug>/page/N/`) are
          // duplicates of the canonical author landing with offset posts;
          // keep only the first slice in sitemap. See #781.
          indexable: idx === 0,
          data: {
            author,
            posts: slice,
            pagination: paginationInfo(idx, pages, perPage, authorPosts.length, base, basePath),
          },
          meta: defaultMeta(
            config,
            url,
            author.meta_title ?? `${author.name} | ${config.site.title}`,
            author.meta_description ?? author.bio,
            author.cover_image,
          ),
        });
      });
    }
  }

  assertNoRouteCollisions(routes);

  return routes;
}

// Two routes writing the same file path silently overwrites the loser at the
// `Bun.write` boundary — the user has no way to tell which version made it into
// `dist/`. The classic case is `content/posts/about.md` plus
// `content/pages/about.md` both emitting `about/index.html`. Fail the build
// with both colliders surfaced so the author can rename one before deploy.
function assertNoRouteCollisions(routes: readonly RouteContext[]): void {
  const byOutputPath = new Map<string, RouteContext[]>();
  for (const route of routes) {
    const bucket = byOutputPath.get(route.outputPath);
    if (bucket) bucket.push(route);
    else byOutputPath.set(route.outputPath, [route]);
  }
  const collisions: { outputPath: string; routes: RouteContext[] }[] = [];
  for (const [outputPath, bucket] of byOutputPath) {
    if (bucket.length > 1) collisions.push({ outputPath, routes: bucket });
  }
  if (collisions.length === 0) return;

  const lines = collisions.map(({ outputPath, routes: bucket }) => {
    const origins = bucket.map((r) => `${r.kind} ${r.url}`).join(' and ');
    return `  ${outputPath} <- ${origins}`;
  });
  const headline =
    collisions.length === 1
      ? 'route output path collision detected:'
      : `route output path collisions detected (${collisions.length}):`;
  throw new NectarError({
    message: `${headline}\n${lines.join('\n')}`,
    hint: 'Each route must emit a unique output path. Rename the conflicting post/page slug or routes.yaml entry.',
    code: 'content',
  });
}

// Per-collection template override from `routes.yaml`: when a `collections:`
// entry sets `template: foo`, render every post in that bucket through
// `foo.hbs` if the active theme ships one; otherwise fall back to `post.hbs`
// and warn once so the misconfiguration is visible at build time. The
// dedupe Set is captured per-build via a closure (see `planRoutes`) so warn
// noise doesn't leak across invocations or tests.
function makePostTemplatePicker(
  theme: ThemeBundle,
): (collection: ResolvedCollection | undefined) => string {
  const warned = new Set<string>();
  return (collection) => {
    if (!collection?.template) return 'post';
    const requested = collection.template;
    if (theme.templates[requested]) return requested;
    if (!warned.has(requested)) {
      warned.add(requested);
      logger.warn(
        `routes.yaml: collections '${collection.url}' requests template '${requested}' but the active theme has no '${requested}.hbs'; falling back to post.hbs.`,
      );
    }
    return 'post';
  };
}

// Mirrors Ghost's per-page template override: when a page's frontmatter declares
// `template: foo`, render through `custom-foo.hbs` if the active theme ships
// one; otherwise fall back to `page.hbs` and warn so the misconfiguration is
// visible at build time. The frontmatter loader has already normalized the
// value to the `custom-<slug>` form.
function resolvePageTemplate(page: Page, theme: ThemeBundle): string {
  const requested = page.custom_template;
  if (!requested) return 'page';
  if (theme.templates[requested]) return requested;
  logger.warn(
    `Page "${page.slug}" requested template "${requested}" but theme has no matching .hbs; falling back to page.hbs.`,
  );
  return 'page';
}

function latestPostTimestamp(posts: Post[]): string | undefined {
  let max: string | undefined;
  for (const p of posts) {
    const ts = p.updated_at ?? p.published_at;
    if (!ts) continue;
    if (max === undefined || ts > max) max = ts;
  }
  return max;
}

function paginatePosts(posts: Post[], perPage: number): Post[][] {
  if (perPage <= 0) return [posts];
  const pages: Post[][] = [];
  for (let i = 0; i < posts.length; i += perPage) {
    pages.push(posts.slice(i, i + perPage));
  }
  if (pages.length === 0) pages.push([]);
  return pages;
}

function paginationInfo(
  index: number,
  pages: Post[][],
  perPage: number,
  total: number,
  baseUrl: string,
  basePath: string,
): PaginationInfo {
  const page = index + 1;
  const numPages = pages.length;
  const prev = page > 1 ? page - 1 : undefined;
  const next = page < numPages ? page + 1 : undefined;
  // `prev_url` / `next_url` / `base_url` are emitted as raw `href` attributes
  // by the `{{pagination}}` helper (and `<link rel="prev/next">` from
  // ghost-head), so they must already include the configured `base_path`.
  // The slug-relative shape (`/tag/foo/`, `/page/2/`) survives across base
  // paths because `withBasePath` strips the leading slash before joining.
  const prefixed = (raw: string): string => withBasePath(basePath, raw);
  const prevUrl =
    prev === undefined
      ? undefined
      : prev === 1
        ? prefixed(baseUrl)
        : prefixed(`${baseUrl}page/${prev}/`);
  const nextUrl = next === undefined ? undefined : prefixed(`${baseUrl}page/${next}/`);
  return {
    page,
    pages: numPages,
    prev,
    next,
    total,
    limit: perPage,
    prev_url: prevUrl,
    next_url: nextUrl,
    base_url: prefixed(baseUrl),
  };
}

function homeTitle(config: NectarConfig): string {
  const desc = config.site.description?.trim();
  return desc ? `${config.site.title} — ${desc}` : config.site.title;
}

function defaultMeta(
  config: NectarConfig,
  routeUrl: string,
  title: string,
  description?: string,
  image?: string,
) {
  // `route.url` and `outputPath` stay root-relative (no base_path) so the
  // emit path lands at `dist/<slug>/index.html` regardless of where the site
  // is served from. Canonical is the user-facing absolute URL, so it must
  // include `base_path` (e.g. `https://host/blog/post-slug/`).
  return {
    title,
    description: description ?? config.site.description,
    canonical: absoluteUrlWithBasePath(config.site.url, config.build.base_path, routeUrl),
    image,
  };
}
