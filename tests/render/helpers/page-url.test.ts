import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { LaurelEngine } from '~/render/engine.ts';
import { registerPageUrlHelper } from '~/render/helpers/page-url.ts';

interface PaginationFixture {
  page: number;
  pages: number;
  prev: number | undefined;
  next: number | undefined;
  prev_url: string | undefined;
  next_url: string | undefined;
  base_url?: string | undefined;
}

function makeEngine(): LaurelEngine {
  const hb = Handlebars.create();
  return {
    hb,
    config: {} as LaurelEngine['config'],
    content: {} as LaurelEngine['content'],
    theme: {} as LaurelEngine['theme'],
    templates: {},
    layouts: {},
    render() {
      throw new Error('not used');
    },
  } as unknown as LaurelEngine;
}

function render(source: string, pagination: PaginationFixture | undefined): string {
  const engine = makeEngine();
  registerPageUrlHelper(engine);
  const template = engine.hb.compile(source);
  return template(
    {},
    {
      data: {
        route: pagination ? { data: { pagination } } : undefined,
      },
    },
  );
}

describe('page_url helper (issue #466)', () => {
  test('numeric 1 collapses to baseUrl (no /page/1/ suffix)', () => {
    const html = render('{{page_url 1}}', {
      page: 2,
      pages: 5,
      prev: 1,
      next: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    });
    expect(html).toBe('/');
  });

  test('numeric N>1 builds baseUrl + page/N/', () => {
    const html = render('{{page_url 2}}', {
      page: 1,
      pages: 5,
      prev: undefined,
      next: 2,
      prev_url: undefined,
      next_url: '/page/2/',
      base_url: '/',
    });
    expect(html).toBe('/page/2/');
  });

  test('numeric 1 collapses to baseUrl for non-root listings (tag archive)', () => {
    const html = render('{{page_url 1}}', {
      page: 2,
      pages: 3,
      prev: 1,
      next: 3,
      prev_url: '/tag/news/',
      next_url: '/tag/news/page/3/',
      base_url: '/tag/news/',
    });
    expect(html).toBe('/tag/news/');
  });

  test('numeric N>1 for tag archive uses tag baseUrl', () => {
    const html = render('{{page_url 3}}', {
      page: 2,
      pages: 3,
      prev: 1,
      next: 3,
      prev_url: '/tag/news/',
      next_url: '/tag/news/page/3/',
      base_url: '/tag/news/',
    });
    expect(html).toBe('/tag/news/page/3/');
  });

  test('"next" resolves to pagination.next_url', () => {
    const html = render('{{page_url "next"}}', {
      page: 2,
      pages: 5,
      prev: 1,
      next: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    });
    expect(html).toBe('/page/3/');
  });

  test('"prev" resolves to pagination.prev_url', () => {
    const html = render('{{page_url "prev"}}', {
      page: 3,
      pages: 5,
      prev: 2,
      next: 4,
      prev_url: '/page/2/',
      next_url: '/page/4/',
      base_url: '/',
    });
    expect(html).toBe('/page/2/');
  });

  test('"prev" on page 2 resolves to baseUrl (no /page/1/)', () => {
    const html = render('{{page_url "prev"}}', {
      page: 2,
      pages: 5,
      prev: 1,
      next: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    });
    expect(html).toBe('/');
  });

  test('"prev" on first page returns empty string', () => {
    const html = render('{{page_url "prev"}}', {
      page: 1,
      pages: 5,
      prev: undefined,
      next: 2,
      prev_url: undefined,
      next_url: '/page/2/',
      base_url: '/',
    });
    expect(html).toBe('');
  });

  test('"next" on last page returns empty string', () => {
    const html = render('{{page_url "next"}}', {
      page: 5,
      pages: 5,
      prev: 4,
      next: undefined,
      prev_url: '/page/4/',
      next_url: undefined,
      base_url: '/',
    });
    expect(html).toBe('');
  });

  test('out-of-range numeric (0, > pages) returns empty', () => {
    const pagination: PaginationFixture = {
      page: 2,
      pages: 3,
      prev: 1,
      next: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    };
    expect(render('{{page_url 0}}', pagination)).toBe('');
    expect(render('{{page_url 4}}', pagination)).toBe('');
  });

  test('case-insensitive "PREV" / "NEXT" still resolves', () => {
    const pagination: PaginationFixture = {
      page: 2,
      pages: 3,
      prev: 1,
      next: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    };
    expect(render('{{page_url "PREV"}}', pagination)).toBe('/');
    expect(render('{{page_url "NEXT"}}', pagination)).toBe('/page/3/');
  });

  test('bare {{page_url}} (no arg) resolves to current page URL', () => {
    const pagination: PaginationFixture = {
      page: 2,
      pages: 3,
      prev: 1,
      next: 3,
      prev_url: '/',
      next_url: '/page/3/',
      base_url: '/',
    };
    // page 2 -> /page/2/
    expect(render('{{page_url}}', pagination)).toBe('/page/2/');
  });

  test('returns empty when no route.data.pagination is present', () => {
    expect(render('{{page_url 2}}', undefined)).toBe('');
  });

  test('numeric string ("2") is coerced to a page number', () => {
    const html = render('{{page_url "2"}}', {
      page: 1,
      pages: 5,
      prev: undefined,
      next: 2,
      prev_url: undefined,
      next_url: '/page/2/',
      base_url: '/',
    });
    expect(html).toBe('/page/2/');
  });

  test('numeric request without a base_url falls back to empty (defensive)', () => {
    const html = render('{{page_url 2}}', {
      page: 1,
      pages: 5,
      prev: undefined,
      next: 2,
      prev_url: undefined,
      next_url: '/page/2/',
    });
    expect(html).toBe('');
  });
});
