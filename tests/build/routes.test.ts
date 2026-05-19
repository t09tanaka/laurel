import { describe, expect, test } from 'bun:test';
import { planRoutes } from '~/build/routes.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';

function makeSite(): SiteData {
  return {
    title: 'Example',
    description: 'desc',
    url: 'https://example.com',
    locale: 'en',
    direction: 'ltr',
    timezone: 'UTC',
    cover_image: undefined,
    logo: undefined,
    logo_width: undefined,
    logo_height: undefined,
    icon: undefined,
    accent_color: '#000',
    navigation: [],
    secondary_navigation: [],
    lang: 'en',
    twitter: undefined,
    facebook: undefined,
  };
}

function makeConfig(siteUrl = 'https://example.com'): NectarConfig {
  return {
    site: {
      title: 'Example',
      description: 'desc',
      url: siteUrl,
      locale: 'en',
      timezone: 'UTC',
      cover_image: undefined,
      logo: undefined,
      logo_width: undefined,
      logo_height: undefined,
      icon: undefined,
      accent_color: '#000',
      lang: 'en',
      navigation: [],
      secondary_navigation: [],
      twitter: undefined,
      facebook: undefined,
    },
    theme: { dir: 'themes', name: 'source', custom: {} },
    content: { dir: 'content' },
    build: { output_dir: 'dist', posts_per_page: 5, base_path: '' },
    components: {},
  } as unknown as NectarConfig;
}

function makePost(slug: string, overrides: Partial<Post> = {}): Post {
  return {
    id: slug,
    slug,
    title: slug,
    html: '',
    plaintext: '',
    excerpt: '',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    featured: false,
    page: false,
    published_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    reading_time: 0,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: `/${slug}/`,
    canonical_url: undefined,
    meta_title: undefined,
    meta_description: undefined,
    og_title: undefined,
    og_description: undefined,
    og_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    twitter_image: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    comments: false,
    prev: undefined,
    next: undefined,
    feed_html: '',
    feed_excerpt: '',
    ...overrides,
  };
}

function makePage(slug: string): Page {
  return {
    id: slug,
    slug,
    title: slug,
    html: '',
    plaintext: '',
    excerpt: '',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    page: true,
    published_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    reading_time: 0,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: `/${slug}/`,
    canonical_url: undefined,
    meta_title: undefined,
    meta_description: undefined,
    og_title: undefined,
    og_description: undefined,
    og_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    twitter_image: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    show_title_and_feature_image: true,
  };
}

function makeTag(slug: string): Tag {
  return {
    id: slug,
    slug,
    name: slug,
    description: '',
    feature_image: undefined,
    visibility: 'public',
    meta_title: undefined,
    meta_description: undefined,
    url: `/tag/${slug}/`,
    count: { posts: 0 },
  };
}

function makeAuthor(slug: string): Author {
  return {
    id: slug,
    slug,
    name: slug,
    bio: '',
    profile_image: undefined,
    cover_image: undefined,
    website: undefined,
    location: undefined,
    twitter: undefined,
    facebook: undefined,
    linkedin: undefined,
    bluesky: undefined,
    mastodon: undefined,
    threads: undefined,
    tiktok: undefined,
    youtube: undefined,
    instagram: undefined,
    meta_title: undefined,
    meta_description: undefined,
    url: `/author/${slug}/`,
  };
}

function makeGraph(opts: {
  posts?: Post[];
  pages?: Page[];
  tags?: Tag[];
  authors?: Author[];
}): ContentGraph {
  const posts = opts.posts ?? [];
  const pages = opts.pages ?? [];
  const tags = opts.tags ?? [];
  const authors = opts.authors ?? [];
  return {
    posts,
    pages,
    tags,
    authors,
    bySlug: {
      posts: new Map(posts.map((p) => [p.slug, p])),
      pages: new Map(pages.map((p) => [p.slug, p])),
      tags: new Map(tags.map((t) => [t.slug, t])),
      authors: new Map(authors.map((a) => [a.slug, a])),
    },
    site: makeSite(),
  };
}

function makeTheme(): ThemeBundle {
  // Template sources are non-empty placeholders. planRoutes checks `if
  // (theme.templates.tag)` etc., so an empty-string template would be skipped.
  return {
    name: 'source',
    rootDir: '/themes/source',
    templates: {
      index: '{{!index}}',
      home: '{{!home}}',
      post: '{{!post}}',
      page: '{{!page}}',
      tag: '{{!tag}}',
      author: '{{!author}}',
    },
    partials: {},
    pkg: {
      name: 'source',
      version: '1.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    },
    locales: {},
    assets: new Map(),
  };
}

describe('planRoutes — defaultMeta.canonical', () => {
  test('home canonical is the site root (not site.url verbatim, but resolved against it)', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a'), makePost('b')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    expect(home).toBeDefined();
    expect(home?.meta.canonical).toBe('https://example.com/');
  });

  test('post canonical is the post URL resolved against the site URL, not site root', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('hello-world')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const post = routes.find((r) => r.kind === 'post' && r.url === '/hello-world/');
    expect(post?.meta.canonical).toBe('https://example.com/hello-world/');
  });

  test('static page canonical reflects the page slug, not site root', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ pages: [makePage('about')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.meta.canonical).toBe('https://example.com/about/');
  });

  test('tag archive canonical points at the tag URL', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const content = makeGraph({
      posts: [makePost('a', { tags: [tag], primary_tag: tag })],
      tags: [tag],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tagRoute = routes.find((r) => r.kind === 'tag');
    expect(tagRoute?.meta.canonical).toBe('https://example.com/tag/news/');
  });

  test('author archive canonical points at the author URL', () => {
    const config = makeConfig('https://example.com');
    const author = makeAuthor('alice');
    const content = makeGraph({
      posts: [makePost('a', { authors: [author], primary_author: author })],
      authors: [author],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const authorRoute = routes.find((r) => r.kind === 'author');
    expect(authorRoute?.meta.canonical).toBe('https://example.com/author/alice/');
  });

  test('paginated index pages get a canonical pointing at the paginated URL', () => {
    const config = makeConfig('https://example.com');
    const posts = Array.from({ length: 12 }, (_, i) => makePost(`p${i}`));
    const content = makeGraph({ posts });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const page2 = routes.find((r) => r.kind === 'index' && r.url === '/page/2/');
    expect(page2?.meta.canonical).toBe('https://example.com/page/2/');
  });

  test('site URL with trailing slash composes correctly', () => {
    const config = makeConfig('https://example.com/');
    const content = makeGraph({ posts: [makePost('hello')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const post = routes.find((r) => r.kind === 'post');
    expect(post?.meta.canonical).toBe('https://example.com/hello/');
  });
});
