import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import type { PaginationInfo, RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { logger } from '~/util/logger.ts';
import { absoluteUrl } from '~/util/url.ts';
import {
  type RoutesYaml,
  applyTaxonomyTemplate,
  emptyRoutesYaml,
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
  const routes: RouteContext[] = [];
  const perPage = config.build.posts_per_page || theme.pkg.posts_per_page;

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
        data: {
          posts: slice,
          pagination: paginationInfo(idx, pages, perPage, content.posts.length, '/'),
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
    const url = `/${post.slug}/`;
    routes.push({
      kind: 'post',
      url,
      outputPath: `${post.slug}/index.html`,
      template: 'post',
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
          data: {
            tag,
            posts: slice,
            pagination: paginationInfo(idx, pages, perPage, tagPosts.length, base),
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

  if (theme.templates['error-404']) {
    const url = '/404.html';
    routes.push({
      kind: 'error',
      url,
      outputPath: '404.html',
      template: 'error-404',
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
          data: {
            author,
            posts: slice,
            pagination: paginationInfo(idx, pages, perPage, authorPosts.length, base),
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

  return routes;
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
): PaginationInfo {
  const page = index + 1;
  const numPages = pages.length;
  const prev = page > 1 ? page - 1 : undefined;
  const next = page < numPages ? page + 1 : undefined;
  const prevUrl = prev === undefined ? undefined : prev === 1 ? baseUrl : `${baseUrl}page/${prev}/`;
  const nextUrl = next === undefined ? undefined : `${baseUrl}page/${next}/`;
  return {
    page,
    pages: numPages,
    prev,
    next,
    total,
    limit: perPage,
    prev_url: prevUrl,
    next_url: nextUrl,
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
  return {
    title,
    description: description ?? config.site.description,
    canonical: absoluteUrl(config.site.url, routeUrl),
    image,
  };
}
