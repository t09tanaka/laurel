import { describe, expect, test } from 'bun:test';
import type { Page, Post } from '~/content/model.ts';
import { type NectarEngine, buildContext } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';

const engine = {} as NectarEngine;

const baseMeta: RouteContext['meta'] = {
  title: '',
  description: '',
  canonical: '',
  image: undefined,
};

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    slug: 'p1',
    title: 'A post',
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
    published_at: '',
    updated_at: '',
    created_at: '',
    reading_time: 0,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: '/p1/',
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

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'pg1',
    slug: 'pg1',
    title: 'A page',
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
    published_at: '',
    updated_at: '',
    created_at: '',
    reading_time: 0,
    word_count: 0,
    visibility: 'public',
    status: 'published',
    tags: [],
    primary_tag: undefined,
    authors: [],
    primary_author: undefined,
    url: '/pg1/',
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
    ...overrides,
  };
}

describe('buildContext', () => {
  test('on a post route, ctx.post is the post object', () => {
    const post = makePost();
    const route: RouteContext = {
      kind: 'post',
      url: '/p1/',
      outputPath: 'p1/index.html',
      template: 'post',
      data: { post },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.post).toBe(post);
    expect(ctx.page).toBe(false);
  });

  test('on a page route, ctx.page is the page and ctx.post is NOT set (issue #156)', () => {
    const page = makePage();
    const route: RouteContext = {
      kind: 'page',
      url: '/pg1/',
      outputPath: 'pg1/index.html',
      template: 'page',
      data: { page },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.page).toBe(page);
    expect(ctx.post).toBeUndefined();
  });

  test('on an error route, ctx.statusCode and ctx.message are exposed (issue #1006)', () => {
    const route: RouteContext = {
      kind: 'error',
      url: '/404.html',
      outputPath: '404.html',
      template: 'error-404',
      data: { error: { statusCode: 404, message: 'Page not found' } },
      meta: baseMeta,
    };
    const ctx = buildContext(engine, route);
    expect(ctx.statusCode).toBe(404);
    expect(ctx.message).toBe('Page not found');
    expect(ctx.error).toEqual({ statusCode: 404, message: 'Page not found' });
  });
});
