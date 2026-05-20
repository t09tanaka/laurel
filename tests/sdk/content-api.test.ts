// SDK smoke test (#213): build a content-api shadow tree on disk, host it
// with `Bun.serve`, and drive `@tryghost/content-api` against it the way a
// real consumer would. This proves that the canonical `meta.pagination`
// projector and the `*/index.json` duo emit interop with the upstream SDK
// without any Nectar-specific shim.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
// `@tryghost/content-api` is CJS and ships no `.d.ts`. The local
// `tests/sdk/types.d.ts` declares the module so this import survives
// strict mode; the SDK is invoked via a structural cast at the call site.
import GhostContentAPI from '@tryghost/content-api';
import { emitContentApiShadows } from '~/build/api.ts';
import { emitContentApiStubs } from '~/build/content-api.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { Author, ContentGraph, Page, Post, SiteData, Tag } from '~/content/model.ts';

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.html': 'text/html',
};

function mimeFor(path: string): string {
  return MIME[extname(path)] ?? 'application/octet-stream';
}

// Resolve a request URL against the staged dist root, mirroring how Netlify
// and Cloudflare Pages resolve directory requests: a path ending in `/` (or
// a directory hit) maps to `<path>/index.json`. Query parameters are
// stripped because the SDK always appends `?key=...&...` but the static
// dump ignores them.
async function resolveStaticFile(root: string, urlPath: string): Promise<string | null> {
  const clean = urlPath.split('?')[0] ?? '/';
  let normalised = normalize(clean).replace(/^\/+/, '');
  if (normalised.includes('..')) return null;
  // Trailing slash → directory index.
  if (normalised === '' || clean.endsWith('/')) {
    normalised = join(normalised, 'index.json');
  }
  const target = join(root, normalised);
  if (!existsSync(target)) {
    // Fall back to `.json` extension if the SDK omitted it.
    if (!normalised.endsWith('.json')) {
      const withExt = `${target}.json`;
      if (existsSync(withExt)) return withExt;
    }
    return null;
  }
  return target;
}

function makeTag(over: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    slug: 'news',
    name: 'News',
    description: '',
    feature_image: undefined,
    accent_color: undefined,
    visibility: 'public',
    meta_title: undefined,
    meta_description: undefined,
    url: 'https://example.com/tag/news/',
    count: { posts: 1 },
    ...over,
  };
}

function makeAuthor(over: Partial<Author> = {}): Author {
  return {
    id: 'author-1',
    slug: 'casper',
    name: 'Casper',
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
    url: 'https://example.com/author/casper/',
    ...over,
  };
}

function makePost(over: Partial<Post> = {}): Post {
  const tag = makeTag();
  const author = makeAuthor();
  // Cast through `unknown` to silence the strict-mode complaint that the
  // anonymous-viewer fields (`access`, `prev`, `next`, `feed_html`,
  // `feed_excerpt`) are not exhaustively populated. The runtime only reads
  // the fields the Content API serializer touches, so this fixture
  // deliberately omits the never-read internals to stay compact. The
  // existing `tests/build/content-api.test.ts` fixture has the same shape.
  return {
    id: 'post-1',
    slug: 'hello-world',
    title: 'Hello, world',
    html: '<p>hi</p>',
    plaintext: 'hi',
    excerpt: 'hi',
    custom_excerpt: undefined,
    feature_image: undefined,
    feature_image_alt: undefined,
    feature_image_caption: undefined,
    feature_image_width: undefined,
    feature_image_height: undefined,
    featured: false,
    page: false,
    published_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    reading_time: 1,
    word_count: 1,
    visibility: 'public',
    status: 'published',
    tags: [tag],
    primary_tag: tag,
    authors: [author],
    primary_author: author,
    url: 'https://example.com/hello-world/',
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
    comments: true,
    access: false,
    prev: undefined,
    next: undefined,
    feed_html: '',
    feed_excerpt: '',
    ...over,
  };
}

function makeSite(): SiteData {
  // Existing tests (tests/build/content-api.test.ts) construct a similar
  // minimal SiteData with `as unknown as SiteData`-style implicit slack on
  // optional-ish fields. We mirror that pattern: pass undefineds for every
  // field the runtime accesses but skip the never-read meta_* / og_* fluff
  // so the fixture stays compact.
  return {
    title: 'SDK Smoke',
    description: 'SDK smoke fixture',
    url: 'https://example.com',
    locale: 'en',
    lang: 'en',
    direction: 'ltr',
    timezone: 'UTC',
    cover_image: undefined,
    logo: undefined,
    icon: undefined,
    accent_color: '#222',
    navigation: [],
    secondary_navigation: undefined,
    twitter: undefined,
    facebook: undefined,
    members_enabled: false,
    paid_members_enabled: false,
    members_invite_only: false,
    recommendations_enabled: false,
  } as unknown as SiteData;
}

function makeGraph(): ContentGraph {
  const tag = makeTag();
  const author = makeAuthor();
  const posts = [
    makePost({ id: 'p-1', slug: 'hello-world', title: 'Hello, world' }),
    makePost({ id: 'p-2', slug: 'second-post', title: 'Second' }),
    makePost({ id: 'p-3', slug: 'third-post', title: 'Third' }),
  ];
  return {
    posts,
    pages: [] as Page[],
    tags: [tag],
    authors: [author],
    tiers: [],
    bySlug: {
      posts: new Map(posts.map((p) => [p.slug, p])),
      pages: new Map(),
      tags: new Map([[tag.slug, tag]]),
      authors: new Map([[author.slug, author]]),
    },
    postsByTag: new Map([[tag.slug, posts]]),
    postsByAuthor: new Map([[author.slug, posts]]),
    site: makeSite(),
  };
}

function makeConfig(): NectarConfig {
  // Pull a real defaults-only config via the schema's `.parse({...})` is
  // overkill for this smoke test. We only access `config.build.base_path`
  // in `emitContentApiShadows`, so a minimal stub is sufficient.
  return {
    build: { base_path: '/' },
  } as unknown as NectarConfig;
}

interface ServerHandle {
  url: string;
  stop: () => Promise<void>;
}

async function serveDir(outputDir: string): Promise<ServerHandle> {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const resolved = await resolveStaticFile(outputDir, u.pathname);
      if (!resolved) return new Response('not found', { status: 404 });
      const file = Bun.file(resolved);
      return new Response(file, {
        headers: {
          'content-type': mimeFor(resolved),
          'access-control-allow-origin': '*',
        },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true).then(() => undefined),
  };
}

describe('@tryghost/content-api SDK smoke (#213)', () => {
  test('drives the SDK against a built shadow tree end-to-end', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-sdk-smoke-'));
    const content = makeGraph();
    const config = makeConfig();

    await emitContentApiShadows({ config, content, outputDir });
    await emitContentApiStubs({ content, outputDir });

    const handle = await serveDir(outputDir);
    try {
      const api = new (
        GhostContentAPI as unknown as new (opts: {
          url: string;
          key: string;
          version: string;
        }) => {
          posts: {
            browse(opts?: Record<string, unknown>): Promise<unknown>;
            read(opts: { slug: string }): Promise<unknown>;
          };
          tags: { browse(opts?: Record<string, unknown>): Promise<unknown> };
        }
      )({
        url: handle.url,
        key: '0123456789abcdef0123456789',
        version: 'v5.0',
      });

      // (1) posts.browse — directory-index resolution → posts/index.json
      const posts = (await api.posts.browse()) as Array<{ slug: string; title: string }> & {
        meta?: { pagination: Record<string, unknown> };
      };
      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBe(3);
      expect(posts.map((p) => p.slug)).toEqual(['hello-world', 'second-post', 'third-post']);

      // (2) read by slug — directory-index resolution → posts/slug/<slug>/index.json
      const post = (await api.posts.read({ slug: 'second-post' })) as { slug: string };
      expect(post.slug).toBe('second-post');

      // (3) meta.pagination shape matches Ghost canonical contract
      const meta = posts.meta;
      expect(meta).toBeDefined();
      expect(meta?.pagination).toEqual({
        page: 1,
        limit: 3,
        pages: 1,
        total: 3,
        next: null,
        prev: null,
      });

      // (4) tags collection also exposes the canonical pagination shape
      const tags = (await api.tags.browse()) as Array<{ slug: string }> & {
        meta?: { pagination: { page: number; total: number; pages: number } };
      };
      expect(Array.isArray(tags)).toBe(true);
      expect(tags[0]?.slug).toBe('news');
      expect(tags.meta?.pagination.page).toBe(1);
      expect(tags.meta?.pagination.total).toBe(1);
      expect(tags.meta?.pagination.pages).toBe(1);
    } finally {
      await handle.stop();
    }
  });
});
