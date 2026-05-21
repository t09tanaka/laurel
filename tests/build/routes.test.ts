import { describe, expect, test } from 'bun:test';
import { type RoutesYaml, emptyRoutesYaml } from '~/build/routes-yaml.ts';
import { planRoutes } from '~/build/routes.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';
import { createEngine } from '~/render/engine.ts';
import type { ThemeBundle } from '~/theme/types.ts';

function routesYamlWith(routes: RoutesYaml['routes']): RoutesYaml {
  return { ...emptyRoutesYaml(), routes };
}

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
    members_enabled: false,
    paid_members_enabled: false,
    members_invite_only: false,
    comments_enabled: false,
    comments_access: 'all',
    recommendations_enabled: false,
    meta_title: undefined,
    meta_description: undefined,
    og_image: undefined,
    og_title: undefined,
    og_description: undefined,
    twitter_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
  } as unknown as SiteData;
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
    email_only: false,
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
    custom_template: undefined,
    comments: false,
    prev: undefined,
    next: undefined,
    feed_html: '',
    feed_excerpt: '',
    ...overrides,
  } as Post;
}

function makePage(slug: string, overrides: Partial<Page> = {}): Page {
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
    custom_template: undefined,
    ...overrides,
  } as unknown as Page;
}

function makeTag(slug: string): Tag {
  return {
    id: slug,
    slug,
    name: slug,
    description: '',
    feature_image: undefined,
    accent_color: undefined,
    og_title: undefined,
    og_description: undefined,
    og_image: undefined,
    twitter_title: undefined,
    twitter_description: undefined,
    twitter_image: undefined,
    codeinjection_head: undefined,
    codeinjection_foot: undefined,
    visibility: 'public',
    canonical_url: undefined,
    meta_title: undefined,
    meta_description: undefined,
    url: `/tag/${slug}/`,
    count: { posts: 0 },
  } as unknown as Tag;
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
    accent_color: undefined,
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
    url: `/author/${slug}/`,
    count: { posts: 0 },
  } as unknown as Author;
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
  const postsByTag = new Map<string, Post[]>();
  for (const tag of tags) {
    postsByTag.set(
      tag.slug,
      posts.filter((p) => p.tags.some((t) => t.slug === tag.slug)),
    );
  }
  const postsByAuthor = new Map<string, Post[]>();
  for (const author of authors) {
    postsByAuthor.set(
      author.slug,
      posts.filter((p) => p.authors.some((a) => a.slug === author.slug)),
    );
  }
  return {
    posts,
    pages,
    tags,
    authors,
    tiers: [],
    bySlug: {
      posts: new Map(posts.map((p) => [p.slug, p])),
      pages: new Map(pages.map((p) => [p.slug, p])),
      tags: new Map(tags.map((t) => [t.slug, t])),
      authors: new Map(authors.map((a) => [a.slug, a])),
    },
    postsByTag,
    postsByAuthor,
    emailOnlyPosts: [],
    site: makeSite(),
  } as unknown as ContentGraph;
}

function makeTheme(): ThemeBundle {
  // Template sources are non-empty placeholders so individual tests can
  // overwrite a template with "" only when pinning empty-file behavior.
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

function makeDigestTheme(): ThemeBundle {
  const theme = makeTheme();
  theme.name = 'digest';
  theme.rootDir = '/themes/digest';
  theme.templates = {
    ...theme.templates,
    default: '{{{body}}}',
    home: '{{!< default}}',
    index: '{{!< default}}\n<main data-digest-index>{{#foreach posts}}{{title}}{{/foreach}}</main>',
  };
  theme.pkg = {
    ...theme.pkg,
    name: 'digest',
  };
  return theme;
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

  test('tag archive canonical uses tag canonical_url override', () => {
    const config = makeConfig('https://example.com');
    const tag = { ...makeTag('news'), canonical_url: '/topics/news/' };
    const content = makeGraph({
      posts: [makePost('a', { tags: [tag], primary_tag: tag })],
      tags: [tag],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tagRoute = routes.find((r) => r.kind === 'tag');
    expect(tagRoute?.meta.canonical).toBe('https://example.com/topics/news/');
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

  test('author archive meta prefers author social SEO fields', () => {
    const config = makeConfig('https://example.com');
    const author = makeAuthor('alice');
    author.og_title = 'Alice OG';
    author.og_description = 'Alice OG description';
    author.og_image = '/content/images/alice-og.jpg';
    author.twitter_title = 'Alice Twitter';
    author.twitter_description = 'Alice Twitter description';
    author.twitter_image = '/content/images/alice-twitter.jpg';
    const content = makeGraph({
      posts: [makePost('a', { authors: [author], primary_author: author })],
      authors: [author],
    });
    const routes = planRoutes({ config, content, theme: makeTheme() });
    const authorRoute = routes.find((r) => r.kind === 'author');

    expect(authorRoute?.meta.title).toBe('Alice OG');
    expect(authorRoute?.meta.description).toBe('Alice OG description');
    expect(authorRoute?.meta.image).toBe('/content/images/alice-og.jpg');
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

  test('build.trailing_slash = never emits slashless canonical route URLs and flat HTML files', () => {
    const config = makeConfig('https://example.com');
    config.build.trailing_slash = 'never';
    const content = makeGraph({
      posts: [makePost('hello')],
      pages: [makePage('about')],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    const post = routes.find((r) => r.kind === 'post');
    const page = routes.find((r) => r.kind === 'page');

    expect(home?.url).toBe('/');
    expect(home?.outputPath).toBe('index.html');
    expect(home?.meta.canonical).toBe('https://example.com/');
    expect(post?.url).toBe('/hello');
    expect(post?.outputPath).toBe('hello.html');
    expect(post?.meta.canonical).toBe('https://example.com/hello');
    expect(page?.url).toBe('/about');
    expect(page?.outputPath).toBe('about.html');
    expect(page?.meta.canonical).toBe('https://example.com/about');
  });
});

describe('planRoutes — multi-locale route prefixes', () => {
  test('emits a per-locale route tree and alternate links for matching localized posts', () => {
    const config = makeConfig();
    const en = makePost('hello', {
      id: 'en-hello',
      locale: 'en',
      title: 'Hello',
      url: '/en/hello/',
    });
    const ja = makePost('hello', {
      id: 'ja-hello',
      locale: 'ja',
      title: 'こんにちは',
      url: '/ja/hello/',
    });
    const content = {
      ...makeGraph({ posts: [en, ja] }),
      locales: ['en', 'ja'],
      localeRouting: true,
      site: { ...makeSite(), locales: ['en', 'ja'], localeRouting: true },
    };

    const routes = planRoutes({ config, content, theme: makeTheme() });

    expect(routes.find((r) => r.kind === 'home' && r.locale === 'en')?.url).toBe('/en/');
    expect(routes.find((r) => r.kind === 'home' && r.locale === 'ja')?.url).toBe('/ja/');
    expect(routes.find((r) => r.kind === 'home' && r.locale === 'en')?.data.posts).toEqual([en]);
    expect(routes.find((r) => r.kind === 'home' && r.locale === 'ja')?.data.posts).toEqual([ja]);

    const enPost = routes.find((r) => r.kind === 'post' && r.locale === 'en');
    const jaPost = routes.find((r) => r.kind === 'post' && r.locale === 'ja');
    expect(enPost?.url).toBe('/en/hello/');
    expect(enPost?.outputPath).toBe('en/hello/index.html');
    expect(jaPost?.url).toBe('/ja/hello/');
    expect(jaPost?.outputPath).toBe('ja/hello/index.html');
    expect(enPost?.alternates).toEqual([
      { locale: 'en', url: '/en/hello/', href: 'https://example.com/en/hello/' },
      { locale: 'ja', url: '/ja/hello/', href: 'https://example.com/ja/hello/' },
    ]);
    expect(jaPost?.alternates).toEqual(enPost?.alternates);
  });
});

describe('planRoutes — home meta title includes site description', () => {
  test('home meta.title combines site.title and site.description with em dash', () => {
    const config = makeConfig('https://example.com');
    config.site.title = 'Nectar Example';
    config.site.description = 'A demo blog built with Nectar against the Ghost Source theme';
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    expect(home?.meta.title).toBe(
      'Nectar Example — A demo blog built with Nectar against the Ghost Source theme',
    );
  });

  test('home meta.title falls back to site.title when description is empty', () => {
    const config = makeConfig('https://example.com');
    config.site.title = 'Nectar Example';
    config.site.description = '';
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    expect(home?.meta.title).toBe('Nectar Example');
  });

  test('home meta.title trims whitespace-only description before falling back', () => {
    const config = makeConfig('https://example.com');
    config.site.title = 'Nectar Example';
    config.site.description = '   ';
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    expect(home?.meta.title).toBe('Nectar Example');
  });

  test('paginated index pages do not include site.description in title', () => {
    const config = makeConfig('https://example.com');
    config.site.title = 'Nectar Example';
    config.site.description = 'Demo blog';
    config.build.posts_per_page = 2;
    const posts = Array.from({ length: 5 }, (_, i) => makePost(`p${i}`));
    const content = makeGraph({ posts });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const page2 = routes.find((r) => r.kind === 'index' && r.url === '/page/2/');
    expect(page2?.meta.title).toBe('Nectar Example - Page 2');
  });
});

describe('planRoutes — error-404 route', () => {
  test('emits /404.html route when theme has error-404 template', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    theme.templates['error-404'] = '{{!error-404}}';
    const routes = planRoutes({ config, content, theme });
    const errorRoute = routes.find((r) => r.kind === 'error');
    expect(errorRoute).toBeDefined();
    expect(errorRoute?.kind).toBe('error');
    expect(errorRoute?.url).toBe('/404.html');
    expect(errorRoute?.outputPath).toBe('404.html');
    expect(errorRoute?.template).toBe('error-404');
    expect(errorRoute?.meta.title).toBe('Page not found — Example');
  });

  test('populates data.error with statusCode and message (issue #1006)', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    theme.templates['error-404'] = '{{!error-404}}';
    const routes = planRoutes({ config, content, theme });
    const errorRoute = routes.find((r) => r.kind === 'error');
    expect(errorRoute?.data.error).toEqual({ statusCode: 404, message: 'Page not found' });
  });

  test('does not emit error route when theme lacks error-404 template', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    expect(routes.find((r) => r.kind === 'error')).toBeUndefined();
  });

  test('falls back to error.hbs when error-404 is absent (issue #225)', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    theme.templates.error = '{{!error}}';
    const routes = planRoutes({ config, content, theme });
    const errorRoute = routes.find((r) => r.kind === 'error');
    expect(errorRoute).toBeDefined();
    expect(errorRoute?.outputPath).toBe('404.html');
    expect(errorRoute?.template).toBe('error');
    expect(errorRoute?.data.error).toEqual({ statusCode: 404, message: 'Page not found' });
  });

  test('prefers error-404 over error.hbs when both exist', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    theme.templates['error-404'] = '{{!error-404}}';
    theme.templates.error = '{{!error}}';
    const routes = planRoutes({ config, content, theme });
    const errorRoute = routes.find((r) => r.kind === 'error');
    expect(errorRoute?.template).toBe('error-404');
  });
});

describe('planRoutes — home template precedence (#706)', () => {
  test('uses home.hbs for / and index.hbs for paginated index tails when both exist (#785)', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    const content = makeGraph({
      posts: Array.from({ length: 5 }, (_, idx) => makePost(`post-${idx + 1}`)),
    });
    const theme = makeTheme();

    const routes = planRoutes({ config, content, theme });

    const home = routes.find((route) => route.url === '/');
    const page2 = routes.find((route) => route.url === '/page/2/');

    expect(home).toMatchObject({
      kind: 'home',
      outputPath: 'index.html',
      template: 'home',
    });
    expect(page2).toMatchObject({
      kind: 'index',
      outputPath: 'page/2/index.html',
      template: 'index',
    });
  });

  test('Digest home.hbs overrides index.hbs for the root home route', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: Array.from({ length: 6 }, (_, idx) => makePost(`digest-${idx + 1}`)),
    });
    const routes = planRoutes({ config, content, theme: makeDigestTheme() });

    const home = routes.find((route) => route.kind === 'home');
    const page2 = routes.find((route) => route.kind === 'index' && route.url === '/page/2/');

    expect(home?.template).toBe('home');
    expect(page2?.template).toBe('index');
  });
});

describe('planRoutes — page custom_template (issue #1005)', () => {
  test('renders page through custom-* template when theme provides one', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      pages: [makePage('about', { custom_template: 'custom-about' })],
    });
    const theme = makeTheme();
    theme.templates['custom-about'] = '{{!custom-about}}';
    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.template).toBe('custom-about');
  });

  test('falls back to page.hbs when requested custom-* template is absent', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      pages: [makePage('about', { custom_template: 'custom-missing' })],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.template).toBe('page');
  });

  test('defaults to page.hbs when frontmatter declares no custom template', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ pages: [makePage('about')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.template).toBe('page');
  });

  test('uses page-{slug}.hbs for Liebling-style authors and newsletter pages', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      pages: [makePage('authors'), makePage('newsletter')],
    });
    const theme = makeTheme();
    theme.templates['page-authors'] = '{{!liebling authors}}';
    theme.templates['page-newsletter'] = '{{!liebling newsletter}}';

    const routes = planRoutes({ config, content, theme });

    expect(routes.find((r) => r.kind === 'page' && r.url === '/authors/')?.template).toBe(
      'page-authors',
    );
    expect(routes.find((r) => r.kind === 'page' && r.url === '/newsletter/')?.template).toBe(
      'page-newsletter',
    );
  });

  test('custom page template takes precedence over page-{slug}.hbs', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      pages: [makePage('newsletter', { custom_template: 'custom-signup' })],
    });
    const theme = makeTheme();
    theme.templates['custom-signup'] = '{{!custom signup}}';
    theme.templates['page-newsletter'] = '{{!liebling newsletter}}';

    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.template).toBe('custom-signup');
  });

  test('supports Dawn no-feature-image alternate page layout', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      pages: [makePage('about', { custom_template: 'custom-no-feature-image' })],
    });
    const theme = makeTheme();
    theme.templates['custom-no-feature-image'] = '{{!dawn page alt}}';
    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.template).toBe('custom-no-feature-image');
  });

  test('treats Headline empty custom-wide-feature-image.hbs as a selectable page variant', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      pages: [makePage('about', { custom_template: 'custom-wide-feature-image' })],
    });
    const theme = makeTheme();
    theme.templates['custom-wide-feature-image'] = '';
    const routes = planRoutes({ config, content, theme });
    const pageRoute = routes.find((r) => r.kind === 'page');
    expect(pageRoute?.template).toBe('custom-wide-feature-image');
  });
});

describe('planRoutes — post custom_template alternate layouts (issue #704)', () => {
  test('renders post through custom-* template when theme provides one', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('hello', { custom_template: 'custom-narrow-feature-image' })],
    });
    const theme = makeTheme();
    theme.templates['custom-narrow-feature-image'] = '{{!dawn post alt}}';
    const routes = planRoutes({ config, content, theme });
    const postRoute = routes.find((r) => r.kind === 'post');
    expect(postRoute?.template).toBe('custom-narrow-feature-image');
  });

  test('falls back to post.hbs when requested custom-* template is absent', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('hello', { custom_template: 'custom-missing' })],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const postRoute = routes.find((r) => r.kind === 'post');
    expect(postRoute?.template).toBe('post');
  });

  test('post custom_template takes precedence over routes.yaml collection template', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('hello', { custom_template: 'custom-no-feature-image' })],
    });
    const theme = makeTheme();
    theme.templates['custom-no-feature-image'] = '{{!dawn post alt}}';
    theme.templates['blog-post'] = '{{!collection}}';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: { '/': { permalink: '/{slug}/', template: 'blog-post' } },
      },
    });
    const postRoute = routes.find((r) => r.kind === 'post');
    expect(postRoute?.template).toBe('custom-no-feature-image');
  });

  test('missing post custom_template falls back to collection template when present', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('hello', { custom_template: 'custom-missing' })],
    });
    const theme = makeTheme();
    theme.templates['blog-post'] = '{{!collection}}';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: { '/': { permalink: '/{slug}/', template: 'blog-post' } },
      },
    });
    const postRoute = routes.find((r) => r.kind === 'post');
    expect(postRoute?.template).toBe('blog-post');
  });

  test('treats Headline empty custom-full-feature-image.hbs as a selectable post variant', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('hello', { custom_template: 'custom-full-feature-image' })],
    });
    const theme = makeTheme();
    theme.templates['custom-full-feature-image'] = '';
    const routes = planRoutes({ config, content, theme });
    const postRoute = routes.find((r) => r.kind === 'post');
    expect(postRoute?.template).toBe('custom-full-feature-image');
  });
});

describe('planRoutes — resource-specific templates (issue #1014)', () => {
  test('uses post-{slug}.hbs over post.hbs when no explicit post template is set', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('welcome')] });
    const theme = makeTheme();
    theme.templates['post-welcome'] = '{{!welcome post}}';

    const routes = planRoutes({ config, content, theme });

    expect(routes.find((r) => r.kind === 'post')?.template).toBe('post-welcome');
  });

  test('keeps explicit post custom_template ahead of post-{slug}.hbs', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('welcome', { custom_template: 'custom-feature' })],
    });
    const theme = makeTheme();
    theme.templates['custom-feature'] = '{{!custom feature}}';
    theme.templates['post-welcome'] = '{{!welcome post}}';

    const routes = planRoutes({ config, content, theme });

    expect(routes.find((r) => r.kind === 'post')?.template).toBe('custom-feature');
  });

  test('keeps collection post templates ahead of post-{slug}.hbs', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('welcome')] });
    const theme = makeTheme();
    theme.templates['blog-post'] = '{{!collection post}}';
    theme.templates['post-welcome'] = '{{!welcome post}}';

    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: { '/': { permalink: '/{slug}/', template: 'blog-post' } },
      },
    });

    expect(routes.find((r) => r.kind === 'post')?.template).toBe('blog-post');
  });

  test('uses tag-{slug}.hbs and author-{slug}.hbs over generic archive templates', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const author = makeAuthor('alice');
    const post = makePost('hello', {
      tags: [tag],
      primary_tag: tag,
      authors: [author],
      primary_author: author,
    });
    const content = makeGraph({ posts: [post], tags: [tag], authors: [author] });
    const theme = makeTheme();
    theme.templates['tag-news'] = '{{!news tag}}';
    theme.templates['author-alice'] = '{{!alice author}}';

    const routes = planRoutes({ config, content, theme });

    expect(routes.find((r) => r.kind === 'tag')?.template).toBe('tag-news');
    expect(routes.find((r) => r.kind === 'author')?.template).toBe('author-alice');
  });
});

describe('planRoutes — posts_per_page precedence', () => {
  test('user config posts_per_page overrides theme pkg.json posts_per_page', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 3;
    const posts = Array.from({ length: 10 }, (_, i) => makePost(`p${i}`));
    const content = makeGraph({ posts });
    const theme = makeTheme();
    theme.pkg.posts_per_page = 5;
    const routes = planRoutes({ config, content, theme });
    const indexPages = routes.filter((r) => r.kind === 'home' || r.kind === 'index');
    expect(indexPages).toHaveLength(Math.ceil(10 / 3));
  });

  test('route pagination exposes numeric Ghost-compatible page and total fields', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 3;
    const posts = Array.from({ length: 10 }, (_, i) => makePost(`p${i}`));
    const content = makeGraph({ posts });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const page2 = routes.find((r) => r.kind === 'index' && r.url === '/page/2/');

    expect(page2?.data.pagination).toMatchObject({
      page: 2,
      pages: 4,
      total: 10,
      limit: 3,
      prev: 1,
      next: 3,
    });
    expect(typeof page2?.data.pagination?.page).toBe('number');
    expect(typeof page2?.data.pagination?.total).toBe('number');
  });
});

describe('planRoutes — routes.yaml taxonomies (issue #233)', () => {
  test('omitting taxonomies in routes.yaml still emits the default /tag/{slug}/ archives', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const content = makeGraph({
      posts: [makePost('a', { tags: [tag], primary_tag: tag })],
      tags: [tag],
    });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: { ...emptyRoutesYaml(), routes: { '/featured/': 'featured' } },
    });
    const tagRoute = routes.find((r) => r.kind === 'tag');
    expect(tagRoute?.url).toBe('/tag/news/');
    expect(tagRoute?.outputPath).toBe('tag/news/index.html');
  });

  test('an explicit empty taxonomies block disables both tag and author archives', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const author = makeAuthor('alice');
    const content = makeGraph({
      posts: [makePost('a', { tags: [tag], primary_tag: tag, authors: [author] })],
      tags: [tag],
      authors: [author],
    });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: { ...emptyRoutesYaml(), taxonomies: {} },
    });
    expect(routes.find((r) => r.kind === 'tag')).toBeUndefined();
    expect(routes.find((r) => r.kind === 'author')).toBeUndefined();
  });

  test('listing only `tag:` disables author archives (block is authoritative)', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const author = makeAuthor('alice');
    const content = makeGraph({
      posts: [makePost('a', { tags: [tag], primary_tag: tag, authors: [author] })],
      tags: [tag],
      authors: [author],
    });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        taxonomies: { tag: '/tag/{slug}/' },
      },
    });
    expect(routes.find((r) => r.kind === 'tag')).toBeDefined();
    expect(routes.find((r) => r.kind === 'author')).toBeUndefined();
  });

  test('null taxonomy value is equivalent to omitting the key', () => {
    const config = makeConfig('https://example.com');
    const author = makeAuthor('alice');
    const content = makeGraph({
      posts: [makePost('a', { authors: [author] })],
      authors: [author],
    });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        taxonomies: { author: null },
      },
    });
    expect(routes.find((r) => r.kind === 'author')).toBeUndefined();
  });

  test('custom tag path replaces the default /tag/{slug}/ in URL and outputPath', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const posts = Array.from({ length: 7 }, (_, i) =>
      makePost(`p${i}`, { tags: [tag], primary_tag: tag }),
    );
    const content = makeGraph({ posts, tags: [tag] });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        taxonomies: { tag: '/category/{slug}/', author: '/author/{slug}/' },
      },
    });
    const first = routes.find((r) => r.kind === 'tag' && r.url === '/category/news/');
    expect(first).toBeDefined();
    expect(first?.outputPath).toBe('category/news/index.html');
    expect(first?.meta.canonical).toBe('https://example.com/category/news/');

    const second = routes.find((r) => r.kind === 'tag' && r.url === '/category/news/page/2/');
    expect(second).toBeDefined();
    expect(second?.outputPath).toBe('category/news/page/2/index.html');

    const paginationOnFirst = first?.data.pagination as { next_url?: string } | undefined;
    expect(paginationOnFirst?.next_url).toBe('/category/news/page/2/');
  });

  test('custom author path replaces the default /author/{slug}/ everywhere', () => {
    const config = makeConfig('https://example.com');
    const author = makeAuthor('alice');
    const content = makeGraph({
      posts: [makePost('a', { authors: [author], primary_author: author })],
      authors: [author],
    });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        taxonomies: { tag: '/tag/{slug}/', author: '/writer/{slug}/' },
      },
    });
    const route = routes.find((r) => r.kind === 'author');
    expect(route?.url).toBe('/writer/alice/');
    expect(route?.outputPath).toBe('writer/alice/index.html');
    expect(route?.meta.canonical).toBe('https://example.com/writer/alice/');
  });
});

describe('planRoutes — output path collisions (issue #230)', () => {
  test('throws when a post slug and page slug both emit the same output path', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('about')],
      pages: [makePage('about')],
    });
    const theme = makeTheme();
    expect(() => planRoutes({ config, content, theme })).toThrow(/route output path collision/i);
  });

  test('collision error names both output path and both route origins', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('about')],
      pages: [makePage('about')],
    });
    const theme = makeTheme();
    let caught: Error | undefined;
    try {
      planRoutes({ config, content, theme });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    const msg = caught?.message ?? '';
    expect(msg).toContain('about/index.html');
    expect(msg).toContain('post /about/');
    expect(msg).toContain('page /about/');
  });

  test('throws when a routes.yaml entry collides with a page output path', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ pages: [makePage('about')] });
    const theme = makeTheme();
    theme.templates.featured = '{{!featured}}';
    expect(() =>
      planRoutes({
        config,
        content,
        theme,
        routesYaml: routesYamlWith({ '/about/': 'featured' }),
      }),
    ).toThrow(/route output path collision/i);
  });

  test('no error when post and page slugs are distinct', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('hello')],
      pages: [makePage('about')],
    });
    const theme = makeTheme();
    expect(() => planRoutes({ config, content, theme })).not.toThrow();
  });

  test('reports every colliding pair when multiple collisions occur', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({
      posts: [makePost('about'), makePost('contact')],
      pages: [makePage('about'), makePage('contact')],
    });
    const theme = makeTheme();
    let caught: Error | undefined;
    try {
      planRoutes({ config, content, theme });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    const msg = caught?.message ?? '';
    expect(msg).toContain('about/index.html');
    expect(msg).toContain('contact/index.html');
    expect(msg).toMatch(/2\)/);
  });
});

describe('planRoutes — routes.yaml routes section', () => {
  test('emits a custom route for a string-form entry that resolves to a real theme template', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({});
    const theme = makeTheme();
    theme.templates.featured = '{{!featured}}';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({ '/featured/': 'featured' }),
    });
    const custom = routes.find((r) => r.kind === 'custom' && r.url === '/featured/');
    expect(custom).toBeDefined();
    expect(custom?.template).toBe('featured');
    expect(custom?.outputPath).toBe('featured/index.html');
    expect(custom?.meta.canonical).toBe('https://example.com/featured/');
  });

  test('maps non-HTML custom route content_type to output path and content type metadata', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({});
    const theme = makeTheme();
    theme.templates.feed = '<rss></rss>';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({ '/custom-feed/': { template: 'feed', content_type: 'rss' } }),
    });
    const custom = routes.find((r) => r.kind === 'custom' && r.url === '/custom-feed/');
    expect(custom?.outputPath).toBe('custom-feed.xml');
    expect(custom?.outputContentType).toBe('application/rss+xml');
  });

  test('object-form entries pass their template through and skip routes whose template is absent', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({});
    const theme = makeTheme();
    theme.templates.about = '{{!about}}';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({
        '/about/': { template: 'about' },
        '/missing/': { template: 'never-exists' },
      }),
    });
    const customs = routes.filter((r) => r.kind === 'custom');
    expect(customs.map((r) => r.url).sort()).toEqual(['/about/']);
  });

  test('data: post.slug and data: page.slug inject a single resource into custom route renders', () => {
    const config = makeConfig('https://example.com');
    const post = makePost('source-news', {
      title: 'Source News',
      meta_title: 'Source SEO',
      meta_description: 'Source summary',
      feature_image: '/content/images/source.jpg',
    });
    const page = makePage('about-us', {
      title: 'About Us',
      meta_title: 'About SEO',
      meta_description: 'About summary',
      feature_image: '/content/images/about.jpg',
    });
    const content = makeGraph({ posts: [post], pages: [page] });
    const theme = makeTheme();
    theme.templates.landing = '{{title}}|{{post.slug}}|{{page.slug}}';

    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({
        '/campaign/': { template: 'landing', data: 'post.source-news' },
        '/about-custom/': { template: 'landing', data: 'page.about-us' },
      }),
    });

    const campaign = routes.find((r) => r.kind === 'custom' && r.url === '/campaign/');
    const about = routes.find((r) => r.kind === 'custom' && r.url === '/about-custom/');
    expect(campaign?.data.post).toBe(post);
    expect(campaign?.meta).toMatchObject({
      title: 'Source SEO',
      description: 'Source summary',
      image: '/content/images/source.jpg',
      canonical: 'https://example.com/campaign/',
    });
    expect(about?.data.page).toBe(page);
    expect(about?.meta).toMatchObject({
      title: 'About SEO',
      description: 'About summary',
      image: '/content/images/about.jpg',
      canonical: 'https://example.com/about-custom/',
    });

    const engine = createEngine({ config, content, theme });
    if (!campaign || !about) throw new Error('Expected custom routes to be planned');
    expect(engine.render(campaign)).toBe('Source News|source-news|');
    expect(engine.render(about)).toBe('About Us||about-us');
  });

  test('emits no custom routes when routes.yaml has no `routes:` section', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({});
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    expect(routes.some((r) => r.kind === 'custom')).toBe(false);
  });

  test('Wave-style /blog/ channel falls back to index.hbs when blog.hbs is missing', () => {
    const config = makeConfig('https://example.com');
    const posts = [makePost('hello'), makePost('world')];
    const content = makeGraph({ posts });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({ '/blog/': 'blog' }),
    });
    const blog = routes.find((r) => r.kind === 'custom' && r.url === '/blog/');
    expect(blog).toBeDefined();
    expect(blog?.template).toBe('index');
    expect(blog?.data.posts?.map((p) => p.slug)).toEqual(['hello', 'world']);
    expect(blog?.data.pagination?.base_url).toBe('/blog/');
    expect(blog?.outputPath).toBe('blog/index.html');
  });

  test('Wave-style /blog/ channel falls back to index.hbs when blog.hbs is empty', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('hello')] });
    const theme = makeTheme();
    theme.templates.blog = '';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({ '/blog/': 'blog' }),
    });
    const blog = routes.find((r) => r.kind === 'custom' && r.url === '/blog/');
    expect(blog?.template).toBe('index');
    expect(blog?.data.posts?.map((p) => p.slug)).toEqual(['hello']);
  });

  test('Wave-style /blog/ channel uses blog.hbs when the theme ships a body', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('hello')] });
    const theme = makeTheme();
    theme.templates.blog = '{{#foreach posts}}{{slug}}{{/foreach}}';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({ '/blog/': 'blog' }),
    });
    const blog = routes.find((r) => r.kind === 'custom' && r.url === '/blog/');
    expect(blog?.template).toBe('blog');
    expect(blog?.data.posts?.map((p) => p.slug)).toEqual(['hello']);
  });

  test('controller: channel routes render a filtered, paginated post list', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    const iphone = makeTag('iphone');
    const ipad = makeTag('ipad');
    const mac = makeTag('mac');
    const android = makeTag('android');
    const posts = [
      makePost('iphone-17', { tags: [iphone], primary_tag: iphone }),
      makePost('ipad-pro', { tags: [ipad], primary_tag: ipad }),
      makePost('pixel-news', { tags: [android], primary_tag: android }),
      makePost('macbook-air', { tags: [mac], primary_tag: mac }),
    ];
    const content = makeGraph({ posts, tags: [iphone, ipad, mac, android] });
    const theme = makeTheme();
    theme.templates['apple-news'] = '{{#foreach posts}}{{slug}}|{{/foreach}}';

    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: routesYamlWith({
        '/apple-news/': {
          controller: 'channel',
          template: 'apple-news',
          filter: 'tag:[iphone,ipad,mac]',
        },
      }),
    });

    const firstPage = routes.find((r) => r.kind === 'custom' && r.url === '/apple-news/');
    const secondPage = routes.find((r) => r.kind === 'custom' && r.url === '/apple-news/page/2/');
    expect(firstPage).toBeDefined();
    expect(secondPage).toBeDefined();
    if (!firstPage || !secondPage) throw new Error('Expected channel route pages to be planned');
    expect(firstPage?.template).toBe('apple-news');
    expect(firstPage?.outputPath).toBe('apple-news/index.html');
    expect(firstPage?.data.posts?.map((p) => p.slug)).toEqual(['iphone-17', 'ipad-pro']);
    expect(firstPage?.data.pagination).toMatchObject({
      page: 1,
      pages: 2,
      total: 3,
      next: 2,
      base_url: '/apple-news/',
      next_url: '/apple-news/page/2/',
    });
    expect(secondPage?.data.posts?.map((p) => p.slug)).toEqual(['macbook-air']);
    expect(secondPage?.indexable).toBe(false);

    const engine = createEngine({ config, content, theme });
    expect(engine.render(firstPage)).toBe('iphone-17|ipad-pro|');
    expect(engine.render(secondPage)).toBe('macbook-air|');
  });
});

describe('planRoutes — AMP routes', () => {
  test('emits per-post AMP routes when the theme ships amp.hbs', () => {
    const config = makeConfig('https://example.com');
    const post = makePost('hello-amp');
    const content = makeGraph({ posts: [post] });
    const theme = makeTheme();
    theme.templates.amp = '<html amp>{{title}}</html>';

    const routes = planRoutes({ config, content, theme });
    const amp = routes.find((route) => route.url === '/hello-amp/amp/');

    expect(amp).toMatchObject({
      kind: 'post',
      variant: 'amp',
      outputPath: 'hello-amp/amp/index.html',
      template: 'amp',
      indexable: false,
      data: { post },
    });
    expect(amp?.meta.canonical).toBe('https://example.com/hello-amp/');
  });
});

describe('planRoutes — routes.yaml collections', () => {
  test('post URL uses the matched collection permalink and outputPath mirrors it', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('hello-world')] });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: { '/blog/': { permalink: '/blog/{slug}/' } },
      },
    });
    const post = routes.find((r) => r.kind === 'post');
    expect(post?.url).toBe('/blog/hello-world/');
    expect(post?.outputPath).toBe('blog/hello-world/index.html');
    expect(post?.meta.canonical).toBe('https://example.com/blog/hello-world/');
  });

  test('multiple collections: the longer URL prefix wins regardless of declaration order', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('blog');
    const tagged = makePost('a', { tags: [tag], primary_tag: tag });
    const untagged = makePost('b');
    const content = makeGraph({ posts: [tagged, untagged], tags: [tag] });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        // Authored with the catch-all first to confirm sorting kicks in.
        collections: {
          '/': { permalink: '/{slug}/' },
          '/blog/': { permalink: '/blog/{slug}/', filter: 'tag:blog' },
        },
      },
    });
    const taggedRoute = routes.find((r) => r.kind === 'post' && r.url === '/blog/a/');
    const untaggedRoute = routes.find((r) => r.kind === 'post' && r.url === '/b/');
    expect(taggedRoute).toBeDefined();
    expect(untaggedRoute).toBeDefined();
    expect(taggedRoute?.outputPath).toBe('blog/a/index.html');
    expect(untaggedRoute?.outputPath).toBe('b/index.html');
  });

  test('filter:tag:blog restricts a collection to posts carrying that tag', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('blog');
    const tagged = makePost('a', { tags: [tag], primary_tag: tag });
    const untagged = makePost('b');
    const content = makeGraph({ posts: [tagged, untagged], tags: [tag] });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: {
          '/blog/': { permalink: '/blog/{slug}/', filter: 'tag:blog' },
        },
      },
    });
    // The tagged post lands at /blog/a/. The untagged post matches no
    // collection, so it keeps the legacy /b/ slug-based URL.
    expect(routes.find((r) => r.kind === 'post' && r.url === '/blog/a/')).toBeDefined();
    expect(routes.find((r) => r.kind === 'post' && r.url === '/b/')).toBeDefined();
  });

  test('permalink with {primary_tag} substitutes the post primary tag slug', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('news');
    const post = makePost('hello', { tags: [tag], primary_tag: tag });
    const content = makeGraph({ posts: [post], tags: [tag] });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: { '/': { permalink: '/{primary_tag}/{slug}/' } },
      },
    });
    const route = routes.find((r) => r.kind === 'post');
    expect(route?.url).toBe('/news/hello/');
    expect(route?.outputPath).toBe('news/hello/index.html');
  });

  test('per-collection template: overrides post.hbs for matched posts when the theme has one', () => {
    const config = makeConfig('https://example.com');
    const tag = makeTag('blog');
    const tagged = makePost('a', { tags: [tag], primary_tag: tag });
    const content = makeGraph({ posts: [tagged], tags: [tag] });
    const theme = makeTheme();
    theme.templates['blog-post'] = '{{!blog-post}}';
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: {
          '/blog/': {
            permalink: '/blog/{slug}/',
            filter: 'tag:blog',
            template: 'blog-post',
          },
        },
      },
    });
    const route = routes.find((r) => r.kind === 'post');
    expect(route?.template).toBe('blog-post');
  });

  test('missing per-collection template falls back to post.hbs and does not throw', () => {
    const config = makeConfig('https://example.com');
    const post = makePost('a');
    const content = makeGraph({ posts: [post] });
    const theme = makeTheme();
    // theme.templates['blog-post'] is intentionally absent
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        collections: { '/': { permalink: '/{slug}/', template: 'blog-post' } },
      },
    });
    const route = routes.find((r) => r.kind === 'post');
    expect(route?.template).toBe('post');
  });

  test('unknown permalink token falls back to the slug-based URL (skip + try next collection)', () => {
    const config = makeConfig('https://example.com');
    const post = makePost('a');
    const content = makeGraph({ posts: [post] });
    const theme = makeTheme();
    const routes = planRoutes({
      config,
      content,
      theme,
      routesYaml: {
        ...emptyRoutesYaml(),
        // The first collection references an unknown token, so it is skipped.
        // No other collection matches, so the post keeps `/a/`.
        collections: { '/a/': { permalink: '/{whatever}/{slug}/' } },
      },
    });
    const route = routes.find((r) => r.kind === 'post');
    expect(route?.url).toBe('/a/');
  });

  test('emits no collection effects when routes.yaml is omitted (back-compat)', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('hello')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const route = routes.find((r) => r.kind === 'post');
    expect(route?.url).toBe('/hello/');
    expect(route?.outputPath).toBe('hello/index.html');
    expect(route?.template).toBe('post');
  });
});

// #781 — `indexable` marks routes that should be excluded from public
// discovery surfaces (sitemap, RSS, link checkers) even though they exist on
// disk. Pagination tails and 404 are the current users.
describe('planRoutes — indexable flag (#781)', () => {
  test('home (/ first slice) is indexable', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    expect(home?.indexable).toBe(true);
  });

  test('paginated /page/N/ tails are marked indexable=false', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    const posts = Array.from({ length: 5 }, (_, i) => makePost(`p${i}`));
    const content = makeGraph({ posts });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tails = routes.filter((r) => r.kind === 'index');
    expect(tails.length).toBeGreaterThan(0);
    for (const tail of tails) {
      expect(tail.indexable).toBe(false);
      expect(tail.url.startsWith('/page/')).toBe(true);
    }
  });

  test('tag archive first slice is indexable, /page/N/ tails are not', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    const tag = makeTag('news');
    const posts = Array.from({ length: 5 }, (_, i) =>
      makePost(`p${i}`, { tags: [tag], primary_tag: tag }),
    );
    const content = makeGraph({ posts, tags: [tag] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tagRoutes = routes.filter((r) => r.kind === 'tag');
    const head = tagRoutes.find((r) => r.url === '/tag/news/');
    const tail = tagRoutes.find((r) => r.url.startsWith('/tag/news/page/'));
    expect(head?.indexable).toBe(true);
    expect(tail?.indexable).toBe(false);
  });

  test('author archive first slice is indexable, /page/N/ tails are not', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    const author = makeAuthor('alice');
    const posts = Array.from({ length: 5 }, (_, i) =>
      makePost(`p${i}`, { authors: [author], primary_author: author }),
    );
    const content = makeGraph({ posts, authors: [author] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const authorRoutes = routes.filter((r) => r.kind === 'author');
    const head = authorRoutes.find((r) => r.url === '/author/alice/');
    const tail = authorRoutes.find((r) => r.url.startsWith('/author/alice/page/'));
    expect(head?.indexable).toBe(true);
    expect(tail?.indexable).toBe(false);
  });

  test('/404.html error route is indexable=false', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('a')] });
    const theme = makeTheme();
    theme.templates['error-404'] = '{{!error-404}}';
    const routes = planRoutes({ config, content, theme });
    const errorRoute = routes.find((r) => r.kind === 'error');
    expect(errorRoute?.indexable).toBe(false);
  });

  test('post and page routes default to indexable (undefined treated as true)', () => {
    const config = makeConfig('https://example.com');
    const content = makeGraph({ posts: [makePost('hello')], pages: [makePage('about')] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const post = routes.find((r) => r.kind === 'post');
    const page = routes.find((r) => r.kind === 'page');
    // The flag is left absent on regular content (the sitemap filter treats
    // `r.indexable !== false` as indexable, so omitting it is equivalent to
    // marking it true — and keeps the route shape minimal). See #781.
    expect(post?.indexable).toBeUndefined();
    expect(page?.indexable).toBeUndefined();
  });
});

describe('planRoutes — pagination URL prefix (#788)', () => {
  function makePosts(n: number): Post[] {
    return Array.from({ length: n }, (_, i) => makePost(`p${i + 1}`));
  }

  test('default prefix "page" matches Ghost: /page/N/, /tag/foo/page/N/, /author/bar/page/N/', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    const tag = makeTag('news');
    const author = makeAuthor('alice');
    const posts = makePosts(5).map((p) =>
      makePost(p.slug, {
        tags: [tag],
        primary_tag: tag,
        authors: [author],
        primary_author: author,
      }),
    );
    const content = makeGraph({ posts, tags: [tag], authors: [author] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });

    const indexUrls = routes.filter((r) => r.kind === 'index').map((r) => r.url);
    const tagUrls = routes.filter((r) => r.kind === 'tag').map((r) => r.url);
    const authorUrls = routes.filter((r) => r.kind === 'author').map((r) => r.url);

    expect(indexUrls).toEqual(['/page/2/', '/page/3/']);
    expect(tagUrls).toContain('/tag/news/page/2/');
    expect(authorUrls).toContain('/author/alice/page/2/');
  });

  test('configured prefix swaps every paginated tail (index + tag + author)', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    config.components = {
      ...(config.components ?? {}),
      pagination: { prefix: 'seite' },
    } as NectarConfig['components'];
    const tag = makeTag('news');
    const author = makeAuthor('alice');
    const posts = makePosts(5).map((p) =>
      makePost(p.slug, {
        tags: [tag],
        primary_tag: tag,
        authors: [author],
        primary_author: author,
      }),
    );
    const content = makeGraph({ posts, tags: [tag], authors: [author] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });

    const indexUrls = routes.filter((r) => r.kind === 'index').map((r) => r.url);
    const tagUrls = routes.filter((r) => r.kind === 'tag').map((r) => r.url);
    const authorUrls = routes.filter((r) => r.kind === 'author').map((r) => r.url);
    const indexOutputs = routes.filter((r) => r.kind === 'index').map((r) => r.outputPath);

    expect(indexUrls).toEqual(['/seite/2/', '/seite/3/']);
    expect(indexOutputs).toEqual(['seite/2/index.html', 'seite/3/index.html']);
    expect(tagUrls).toContain('/tag/news/seite/2/');
    expect(authorUrls).toContain('/author/alice/seite/2/');
    // No leftover `/page/` URLs anywhere.
    for (const r of routes) {
      expect(r.url).not.toContain('/page/');
    }
  });

  test('pagination prev_url / next_url honor the configured prefix', () => {
    const config = makeConfig('https://example.com');
    config.build.posts_per_page = 2;
    config.components = {
      ...(config.components ?? {}),
      pagination: { prefix: 'p' },
    } as NectarConfig['components'];
    const content = makeGraph({ posts: makePosts(5) });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const middle = routes.find((r) => r.url === '/p/2/');
    expect(middle).toBeDefined();
    const pagination = middle?.data?.pagination as { prev_url?: string; next_url?: string };
    expect(pagination.prev_url).toBe('/');
    expect(pagination.next_url).toBe('/p/3/');
  });
});

describe('planRoutes — min_posts_per_tag / min_posts_per_author (#152)', () => {
  test('default (=1) skips empty tag archives', () => {
    // A `hash-` style internal tag plus a legacy unused tag both end up with
    // 0 posts via the loader's inverse index. The default `min_posts_per_tag`
    // of 1 should suppress their `/tag/<slug>/` route while letting the
    // populated tag through.
    const config = makeConfig('https://example.com');
    const populated = makeTag('news');
    const empty = makeTag('legacy');
    const hashTag = makeTag('hash-internal');
    const content = makeGraph({
      posts: [makePost('a', { tags: [populated], primary_tag: populated })],
      tags: [populated, empty, hashTag],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tagSlugs = routes
      .filter((r) => r.kind === 'tag')
      .map((r) => (r.data?.tag as Tag | undefined)?.slug);
    expect(tagSlugs).toEqual(['news']);
  });

  test('default (=1) skips empty author archives', () => {
    const config = makeConfig('https://example.com');
    const populated = makeAuthor('alice');
    const empty = makeAuthor('bob');
    const content = makeGraph({
      posts: [makePost('a', { authors: [populated], primary_author: populated })],
      authors: [populated, empty],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const authorSlugs = routes
      .filter((r) => r.kind === 'author')
      .map((r) => (r.data?.author as Author | undefined)?.slug);
    expect(authorSlugs).toEqual(['alice']);
  });

  test('min_posts_per_tag = 0 keeps empty tag archives (back-compat)', () => {
    const config = makeConfig('https://example.com');
    config.components = {
      ...(config.components ?? {}),
      tags: { min_posts_per_tag: 0 },
    } as NectarConfig['components'];
    const populated = makeTag('news');
    const empty = makeTag('legacy');
    const content = makeGraph({
      posts: [makePost('a', { tags: [populated], primary_tag: populated })],
      tags: [populated, empty],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tagSlugs = routes
      .filter((r) => r.kind === 'tag')
      .map((r) => (r.data?.tag as Tag | undefined)?.slug);
    expect(tagSlugs.sort()).toEqual(['legacy', 'news']);
  });

  test('min_posts_per_tag = 2 suppresses single-post tags', () => {
    const config = makeConfig('https://example.com');
    config.components = {
      ...(config.components ?? {}),
      tags: { min_posts_per_tag: 2 },
    } as NectarConfig['components'];
    const popular = makeTag('news');
    const oneOff = makeTag('typo');
    const content = makeGraph({
      posts: [
        makePost('a', { tags: [popular], primary_tag: popular }),
        makePost('b', { tags: [popular], primary_tag: popular }),
        makePost('c', { tags: [oneOff], primary_tag: oneOff }),
      ],
      tags: [popular, oneOff],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const tagSlugs = routes
      .filter((r) => r.kind === 'tag')
      .map((r) => (r.data?.tag as Tag | undefined)?.slug);
    expect(tagSlugs).toEqual(['news']);
  });

  test('min_posts_per_author = 0 keeps empty author archives', () => {
    const config = makeConfig('https://example.com');
    config.components = {
      ...(config.components ?? {}),
      authors: { min_posts_per_author: 0 },
    } as NectarConfig['components'];
    const populated = makeAuthor('alice');
    const empty = makeAuthor('bob');
    const content = makeGraph({
      posts: [makePost('a', { authors: [populated], primary_author: populated })],
      authors: [populated, empty],
    });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const authorSlugs = routes
      .filter((r) => r.kind === 'author')
      .map((r) => (r.data?.author as Author | undefined)?.slug);
    expect(authorSlugs.sort()).toEqual(['alice', 'bob']);
  });
});

describe('planRoutes — postsByTag / postsByAuthor index parity (#151)', () => {
  // Regression guard: planRoutes consumes the loader-built indices instead of
  // re-scanning `content.posts` for every tag/author. Confirm the routes
  // produced match what an O(T·P) filter would have produced.
  test('indexed lookup matches naive filter for tag archives', () => {
    const config = makeConfig('https://example.com');
    const a = makeTag('a');
    const b = makeTag('b');
    const c = makeTag('c');
    const posts = [
      makePost('p1', { tags: [a, b], primary_tag: a }),
      makePost('p2', { tags: [b, c], primary_tag: b }),
      makePost('p3', { tags: [a], primary_tag: a }),
    ];
    const content = makeGraph({ posts, tags: [a, b, c] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const indexed = new Map<string, string[]>();
    for (const r of routes) {
      if (r.kind !== 'tag') continue;
      const tag = r.data?.tag as Tag;
      const tagPosts = (r.data?.posts as Post[]) ?? [];
      if (!indexed.has(tag.slug)) indexed.set(tag.slug, []);
      for (const p of tagPosts) indexed.get(tag.slug)?.push(p.slug);
    }
    // Reproduce via naive filter so a future regression in the index keeps
    // failing here.
    const naive = new Map<string, string[]>();
    for (const tag of [a, b, c]) {
      naive.set(
        tag.slug,
        posts.filter((p) => p.tags.some((t) => t.slug === tag.slug)).map((p) => p.slug),
      );
    }
    for (const [slug, slugs] of indexed) {
      expect(slugs.sort()).toEqual((naive.get(slug) ?? []).sort());
    }
  });

  test('indexed lookup matches naive filter for author archives', () => {
    const config = makeConfig('https://example.com');
    const alice = makeAuthor('alice');
    const bob = makeAuthor('bob');
    const posts = [
      makePost('p1', { authors: [alice], primary_author: alice }),
      makePost('p2', { authors: [alice, bob], primary_author: alice }),
      makePost('p3', { authors: [bob], primary_author: bob }),
    ];
    const content = makeGraph({ posts, authors: [alice, bob] });
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const indexed = new Map<string, string[]>();
    for (const r of routes) {
      if (r.kind !== 'author') continue;
      const author = r.data?.author as Author;
      const authorPosts = (r.data?.posts as Post[]) ?? [];
      if (!indexed.has(author.slug)) indexed.set(author.slug, []);
      for (const p of authorPosts) indexed.get(author.slug)?.push(p.slug);
    }
    const naive = new Map<string, string[]>();
    for (const author of [alice, bob]) {
      naive.set(
        author.slug,
        posts.filter((p) => p.authors.some((a) => a.slug === author.slug)).map((p) => p.slug),
      );
    }
    for (const [slug, slugs] of indexed) {
      expect(slugs.sort()).toEqual((naive.get(slug) ?? []).sort());
    }
  });
});

describe('planRoutes — email_only posts (#505)', () => {
  // Posts with `email_only: true` ship via newsletter only. The loader
  // partitions them into `content.emailOnlyPosts`, so `content.posts` already
  // excludes them by the time `planRoutes` runs. These tests exercise the
  // route-planner contract directly by populating `emailOnlyPosts` on the
  // graph and asserting that no public route is emitted unless the operator
  // opts in via `[build].emit_email_only_stub`.

  function graphWithEmailOnly(emailOnly: Post[], visible: Post[] = []): ContentGraph {
    const graph = makeGraph({ posts: visible });
    graph.emailOnlyPosts = emailOnly;
    return graph;
  }

  test('email_only posts do not produce a /<slug>/ route by default', () => {
    const config = makeConfig('https://example.com');
    const post = makePost('newsletter-only', { email_only: true });
    const content = graphWithEmailOnly([post]);
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    expect(routes.find((r) => r.url === '/newsletter-only/')).toBeUndefined();
    expect(routes.find((r) => r.url === '/email-only/newsletter-only/')).toBeUndefined();
  });

  test('with emit_email_only_stub: true, an /email-only/<slug>/ route is emitted', () => {
    const config = makeConfig('https://example.com');
    config.build = {
      ...config.build,
      emit_email_only_stub: true,
    } as NectarConfig['build'];
    const post = makePost('weekly-digest', { email_only: true });
    const content = graphWithEmailOnly([post]);
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const stub = routes.find((r) => r.url === '/email-only/weekly-digest/');
    expect(stub).toBeDefined();
    expect(stub?.kind).toBe('post');
    expect(stub?.indexable).toBe(false);
    expect(stub?.outputPath).toBe('email-only/weekly-digest/index.html');
    expect((stub?.data as { post: Post }).post.slug).toBe('weekly-digest');
  });

  test('emit_email_only_stub stub uses the post template when available', () => {
    const config = makeConfig('https://example.com');
    config.build = {
      ...config.build,
      emit_email_only_stub: true,
    } as NectarConfig['build'];
    const post = makePost('issue-7', { email_only: true });
    const content = graphWithEmailOnly([post]);
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const stub = routes.find((r) => r.url === '/email-only/issue-7/');
    expect(stub?.template).toBe('post');
  });

  test('email_only stub is excluded from the home page even with stub emission on', () => {
    const config = makeConfig('https://example.com');
    config.build = {
      ...config.build,
      emit_email_only_stub: true,
    } as NectarConfig['build'];
    const emailPost = makePost('newsletter-1', { email_only: true });
    const visible = makePost('public-1');
    const content = graphWithEmailOnly([emailPost], [visible]);
    const theme = makeTheme();
    const routes = planRoutes({ config, content, theme });
    const home = routes.find((r) => r.kind === 'home');
    const homePosts = (home?.data?.posts as Post[]) ?? [];
    expect(homePosts.map((p) => p.slug)).toEqual(['public-1']);
    expect(homePosts.some((p) => p.email_only)).toBe(false);
  });
});

describe('planRoutes — members templates', () => {
  test('emits static /members/* routes for Ghost members templates', () => {
    const theme = makeTheme();
    theme.templates['members/signin'] = '{{!signin}}';
    theme.templates['members/signup'] = '{{!signup}}';
    theme.templates['members/account'] = '{{!account}}';

    const routes = planRoutes({
      config: makeConfig('https://example.com'),
      content: makeGraph({}),
      theme,
    });

    expect(routes.find((route) => route.url === '/members/signin/')).toMatchObject({
      kind: 'custom',
      outputPath: 'members/signin/index.html',
      template: 'members/signin',
      indexable: false,
    });
    expect(routes.find((route) => route.url === '/members/signup/')).toMatchObject({
      template: 'members/signup',
    });
    expect(routes.find((route) => route.url === '/members/account/')).toMatchObject({
      template: 'members/account',
    });
  });
});
