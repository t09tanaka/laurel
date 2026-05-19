import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Post } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import type { PaginationInfo, RouteContext } from '~/render/types.ts';

export function planRoutes(opts: {
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
}): RouteContext[] {
  const { config, content, theme } = opts;
  const routes: RouteContext[] = [];
  const perPage = theme.pkg.posts_per_page || config.build.posts_per_page;

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
        data: {
          posts: slice,
          pagination: paginationInfo(idx, pages, perPage, content.posts.length, '/'),
        },
        meta: defaultMeta(config, idx === 0 ? config.site.title : `${config.site.title} - Page ${idx + 1}`),
      });
    });
  }

  for (const post of content.posts) {
    routes.push({
      kind: 'post',
      url: `/${post.slug}/`,
      outputPath: `${post.slug}/index.html`,
      template: 'post',
      data: { post },
      meta: defaultMeta(config, post.meta_title ?? post.title, post.meta_description ?? post.excerpt, post.feature_image),
    });
  }

  if (theme.templates.page) {
    for (const page of content.pages) {
      routes.push({
        kind: 'page',
        url: `/${page.slug}/`,
        outputPath: `${page.slug}/index.html`,
        template: 'page',
        data: { page },
        meta: defaultMeta(config, page.meta_title ?? page.title, page.meta_description ?? page.excerpt, page.feature_image),
      });
    }
  }

  if (theme.templates.tag) {
    for (const tag of content.tags) {
      const tagPosts = content.posts.filter((p) => p.tags.some((t) => t.slug === tag.slug));
      const pages = paginatePosts(tagPosts, perPage);
      pages.forEach((slice, idx) => {
        const url = idx === 0 ? `/tag/${tag.slug}/` : `/tag/${tag.slug}/page/${idx + 1}/`;
        const outputPath = idx === 0
          ? `tag/${tag.slug}/index.html`
          : `tag/${tag.slug}/page/${idx + 1}/index.html`;
        routes.push({
          kind: 'tag',
          url,
          outputPath,
          template: 'tag',
          data: {
            tag,
            posts: slice,
            pagination: paginationInfo(idx, pages, perPage, tagPosts.length, `/tag/${tag.slug}/`),
          },
          meta: defaultMeta(config, tag.meta_title ?? tag.name, tag.meta_description ?? tag.description, tag.feature_image),
        });
      });
    }
  }

  if (theme.templates.author) {
    for (const author of content.authors) {
      const authorPosts = content.posts.filter((p) => p.authors.some((a) => a.slug === author.slug));
      const pages = paginatePosts(authorPosts, perPage);
      pages.forEach((slice, idx) => {
        const url = idx === 0 ? `/author/${author.slug}/` : `/author/${author.slug}/page/${idx + 1}/`;
        const outputPath = idx === 0
          ? `author/${author.slug}/index.html`
          : `author/${author.slug}/page/${idx + 1}/index.html`;
        routes.push({
          kind: 'author',
          url,
          outputPath,
          template: 'author',
          data: {
            author,
            posts: slice,
            pagination: paginationInfo(idx, pages, perPage, authorPosts.length, `/author/${author.slug}/`),
          },
          meta: defaultMeta(config, author.meta_title ?? author.name, author.meta_description ?? author.bio, author.cover_image),
        });
      });
    }
  }

  return routes;
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
  const prevUrl =
    prev === undefined ? undefined : prev === 1 ? baseUrl : `${baseUrl}page/${prev}/`;
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

function defaultMeta(
  config: NectarConfig,
  title: string,
  description?: string,
  image?: string,
) {
  return {
    title,
    description: description ?? config.site.description,
    canonical: config.site.url,
    image,
  };
}
