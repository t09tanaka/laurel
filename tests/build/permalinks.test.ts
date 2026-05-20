import { describe, expect, test } from 'bun:test';
import { assignPostUrls, parseFilter, resolvePermalink } from '~/build/permalinks.ts';
import type { ResolvedCollection } from '~/build/routes-yaml.ts';
import type { Author, Post, Tag } from '~/content/model.ts';

function makeTag(slug: string): Tag {
  return {
    id: slug,
    slug,
    name: slug,
    description: '',
    feature_image: undefined,
    accent_color: undefined,
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

function makePost(slug: string, overrides: Partial<Post> = {}): Post {
  return {
    id: `id-${slug}`,
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
    published_at: '2026-03-15T10:30:00Z',
    updated_at: '2026-03-15T10:30:00Z',
    created_at: '2026-03-15T10:30:00Z',
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

describe('resolvePermalink — tokens', () => {
  test('substitutes {slug} verbatim', () => {
    const post = makePost('hello-world');
    expect(resolvePermalink('/{slug}/', post).url).toBe('/hello-world/');
  });

  test('substitutes {id}', () => {
    const post = makePost('p1');
    expect(resolvePermalink('/posts/{id}/', post).url).toBe('/posts/id-p1/');
  });

  test('substitutes {primary_tag} from the post primary_tag.slug', () => {
    const tag = makeTag('news');
    const post = makePost('hello', { tags: [tag], primary_tag: tag });
    expect(resolvePermalink('/{primary_tag}/{slug}/', post).url).toBe('/news/hello/');
  });

  test('emits empty string for {primary_tag} when the post has no tags', () => {
    const post = makePost('orphan');
    // The path is intentionally degenerate; the build pipeline surfaces this
    // through the routing layer rather than rewriting the template.
    expect(resolvePermalink('/{primary_tag}/{slug}/', post).url).toBe('//orphan/');
  });

  test('substitutes {primary_author} from primary_author.slug', () => {
    const author = makeAuthor('alice');
    const post = makePost('hello', { authors: [author], primary_author: author });
    expect(resolvePermalink('/{primary_author}/{slug}/', post).url).toBe('/alice/hello/');
  });

  test('substitutes {year}, {month}, {day} zero-padded from published_at', () => {
    const post = makePost('p', { published_at: '2026-01-05T00:00:00Z' });
    expect(resolvePermalink('/{year}/{month}/{day}/{slug}/', post).url).toBe('/2026/01/05/p/');
  });

  test('records unknown tokens and substitutes them as empty strings', () => {
    const post = makePost('p');
    const result = resolvePermalink('/{slug}/{nope}/', post);
    expect(result.url).toBe('/p//');
    expect(result.unknownTokens).toEqual(['nope']);
  });

  test('handles invalid published_at by emitting empty date parts', () => {
    const post = makePost('p', { published_at: 'not-a-date' });
    const result = resolvePermalink('/{year}/{slug}/', post);
    expect(result.url).toBe('//p/');
    expect(result.unknownTokens).toEqual([]);
  });
});

describe('parseFilter', () => {
  test('empty filter matches every post', () => {
    const { predicate, warnings } = parseFilter(undefined);
    expect(predicate(makePost('a'))).toBe(true);
    expect(warnings).toEqual([]);
  });

  test('tag:foo matches posts whose tags include foo', () => {
    const news = makeTag('news');
    const { predicate } = parseFilter('tag:news');
    expect(predicate(makePost('a', { tags: [news] }))).toBe(true);
    expect(predicate(makePost('b'))).toBe(false);
  });

  test('tags:[a,b] matches when any of the listed tags is present', () => {
    const a = makeTag('a');
    const b = makeTag('b');
    const { predicate } = parseFilter('tags:[a,b]');
    expect(predicate(makePost('p', { tags: [a] }))).toBe(true);
    expect(predicate(makePost('q', { tags: [b] }))).toBe(true);
    expect(predicate(makePost('r', { tags: [makeTag('c')] }))).toBe(false);
  });

  test('author:foo matches posts authored by foo', () => {
    const alice = makeAuthor('alice');
    const { predicate } = parseFilter('author:alice');
    expect(predicate(makePost('p', { authors: [alice] }))).toBe(true);
    expect(predicate(makePost('q'))).toBe(false);
  });

  test('featured:true and featured:false select the matching post.featured', () => {
    expect(parseFilter('featured:true').predicate(makePost('p', { featured: true }))).toBe(true);
    expect(parseFilter('featured:true').predicate(makePost('p', { featured: false }))).toBe(false);
    expect(parseFilter('featured:false').predicate(makePost('p', { featured: false }))).toBe(true);
  });

  test('clauses joined with + are AND-combined', () => {
    const news = makeTag('news');
    const alice = makeAuthor('alice');
    const { predicate } = parseFilter('tag:news+author:alice');
    expect(predicate(makePost('p', { tags: [news], authors: [alice] }))).toBe(true);
    expect(predicate(makePost('q', { tags: [news] }))).toBe(false);
    expect(predicate(makePost('r', { authors: [alice] }))).toBe(false);
  });

  test('unrecognised keys return alwaysFalse and surface a warning', () => {
    const { predicate, warnings } = parseFilter('weird:thing');
    expect(predicate(makePost('p'))).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/weird/);
  });
});

describe('assignPostUrls', () => {
  function col(url: string, permalink: string, filter?: string): ResolvedCollection {
    return filter ? { url, permalink, filter } : { url, permalink };
  }

  test('returns an empty map when no collections are configured', () => {
    const posts = [makePost('a')];
    expect(assignPostUrls(posts, []).size).toBe(0);
  });

  test('matches the most specific collection first when sorted by URL length', () => {
    // resolveCollections sorts by descending URL length; assignPostUrls
    // assumes that ordering. Mirror it here for the test fixture.
    const collections = [col('/blog/', '/blog/{slug}/'), col('/', '/{slug}/')];
    const post = makePost('hello');
    const map = assignPostUrls([post], collections);
    expect(map.get(post.id)?.urlPath).toBe('/blog/hello/');
    expect(map.get(post.id)?.collection.url).toBe('/blog/');
  });

  test('falls back to the catch-all when the specific collection filters the post out', () => {
    const blogTag = makeTag('blog');
    const post = makePost('p'); // not tagged blog
    const collections = [col('/blog/', '/blog/{slug}/', 'tag:blog'), col('/', '/{slug}/')];
    const map = assignPostUrls([post], collections);
    expect(map.get(post.id)?.urlPath).toBe('/p/');
    expect(map.get(post.id)?.collection.url).toBe('/');
    // Sanity check the filter does run when the tag matches.
    const tagged = makePost('q', { tags: [blogTag] });
    const map2 = assignPostUrls([tagged], collections);
    expect(map2.get(tagged.id)?.urlPath).toBe('/blog/q/');
  });

  test('skips a collection whose permalink references an unknown token and tries the next one', () => {
    const collections = [col('/a/', '/{unknown}/{slug}/'), col('/', '/{slug}/')];
    const post = makePost('p');
    const map = assignPostUrls([post], collections);
    expect(map.get(post.id)?.urlPath).toBe('/p/');
    expect(map.get(post.id)?.collection.url).toBe('/');
  });

  test('does not record an assignment when no collection matches', () => {
    const collections = [col('/blog/', '/blog/{slug}/', 'tag:blog')];
    const post = makePost('p');
    expect(assignPostUrls([post], collections).has(post.id)).toBe(false);
  });
});
