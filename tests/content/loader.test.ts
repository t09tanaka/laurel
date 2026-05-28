import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRoutesYaml } from '~/build/routes-yaml.ts';
import { configSchema } from '~/config/schema.ts';
import {
  MISSING_FRONTMATTER_DATE_FALLBACK,
  createRawContentCache,
  loadContent,
} from '~/content/loader.ts';
import { NectarError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-content-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await writeFile(
    join(dir, 'content/posts/hello.md'),
    `---
title: "Hello world"
date: 2026-01-01T00:00:00Z
tags: [news]
authors: [casper]
featured: true
---

# Hello

Welcome to Nectar.
`,
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/second.md'),
    `---
title: "Second"
date: 2026-02-01T00:00:00Z
---

Body 2
`,
    'utf8',
  );
  await writeFile(
    join(dir, 'content/pages/about.md'),
    `---
title: "About"
date: 2026-01-03T00:00:00Z
---

About body
`,
    'utf8',
  );
  await writeFile(
    join(dir, 'content/authors/casper.md'),
    `---
name: Casper
bio: Friendly ghost
---
`,
    'utf8',
  );
  await writeFile(
    join(dir, 'content/tags/news.md'),
    `---
name: News
---
`,
    'utf8',
  );
  return dir;
}

function numberedWords(count: number, start = 1): string[] {
  return Array.from({ length: count }, (_, i) => `w${String(start + i).padStart(2, '0')}`);
}

async function readRenderCacheEntry(
  cwd: string,
  relSourcePath: string,
): Promise<{
  path: string;
  entry: {
    cache_key: string;
    source_path: string;
    result: {
      html: string;
      plaintext: string;
      word_count: number;
      reading_time: number;
    };
  };
}> {
  const cacheDir = join(cwd, '.nectar/cache/markdown');
  const files = await readdir(cacheDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(cacheDir, file);
    const entry = JSON.parse(await readFile(path, 'utf8'));
    if (entry.source_path === join(cwd, relSourcePath)) {
      return { path, entry };
    }
  }
  throw new Error(`No render cache entry found for ${relSourcePath}`);
}

describe('loadContent', () => {
  test('loads posts, pages, authors, and derives tags', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    expect(graph.posts).toHaveLength(2);
    expect(graph.posts[0]?.slug).toBe('second');
    expect(graph.posts[1]?.slug).toBe('hello');
    expect(graph.posts[1]?.tags[0]?.slug).toBe('news');
    expect(graph.posts[1]?.primary_author?.slug).toBe('casper');
    expect(graph.posts[0]?.next).toBeUndefined();
    expect(graph.posts[0]?.prev?.slug).toBe('hello');
    expect(graph.pages).toHaveLength(1);
    expect(graph.pages[0]?.slug).toBe('about');
    expect(graph.authors[0]?.name).toBe('Casper');
    expect(graph.authors.find((a) => a.slug === 'casper')?.count.posts).toBe(1);
    expect(graph.tags.find((t) => t.slug === 'news')?.count.posts).toBe(1);
    expect(graph.posts[1]?.html).toContain('Welcome to Nectar.');
    expect(graph.posts[1]?.post_class.split(' ')).toEqual(
      expect.arrayContaining(['post', 'tag-news', 'featured', 'access', 'no-image']),
    );
    expect(graph.pages[0]?.post_class.split(' ')).toEqual(
      expect.arrayContaining(['post', 'page', 'access', 'no-image']),
    );
  });

  test('reuses unchanged raw content entries without leaking mutated graph objects', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const rawContentCache = createRawContentCache();

    const first = await loadContent({ cwd, config, rawContentCache });
    expect(rawContentCache.stats()).toEqual({
      hits: 0,
      misses: 5,
      sets: 5,
    });

    const hello = first.posts.find((post) => post.slug === 'hello');
    if (!hello) throw new Error('expected hello post');
    hello.title = 'Mutated title';
    hello.tags.length = 0;

    const second = await loadContent({ cwd, config, rawContentCache });
    expect(rawContentCache.stats()).toEqual({
      hits: 5,
      misses: 5,
      sets: 5,
    });
    expect(second.posts.find((post) => post.slug === 'hello')?.title).toBe('Hello world');
    expect(second.posts.find((post) => post.slug === 'hello')?.tags.map((tag) => tag.slug)).toEqual(
      ['news'],
    );
  });

  test('invalidates a raw content cache entry when the source file fingerprint changes', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const rawContentCache = createRawContentCache();

    await loadContent({ cwd, config, rawContentCache });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: "Hello edited"
date: 2026-01-01T00:00:00Z
tags: [news]
authors: [casper]
featured: true
---

# Hello

Welcome to edited Nectar.
`,
      'utf8',
    );

    const edited = await loadContent({ cwd, config, rawContentCache });

    expect(rawContentCache.stats()).toEqual({
      hits: 4,
      misses: 6,
      sets: 6,
    });
    expect(edited.posts.find((post) => post.slug === 'hello')?.title).toBe('Hello edited');
    expect(edited.posts.find((post) => post.slug === 'hello')?.html).toContain(
      'Welcome to edited Nectar.',
    );
  });

  test('does not reuse raw content entries when markdown transforms are active', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const rawContentCache = createRawContentCache();

    await loadContent({
      cwd,
      config,
      rawContentCache,
      markdownTransforms: [(body) => body.replace('Welcome to Nectar.', 'Transformed once.')],
    });
    const second = await loadContent({
      cwd,
      config,
      rawContentCache,
      markdownTransforms: [(body) => body.replace('Welcome to Nectar.', 'Transformed twice.')],
    });

    expect(rawContentCache.stats()).toEqual({
      hits: 0,
      misses: 0,
      sets: 0,
    });
    expect(second.posts.find((post) => post.slug === 'hello')?.html).toContain(
      'Transformed twice.',
    );
  });

  test('surfaces first-class site social account settings', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({
      site: {
        title: 'X',
        url: 'https://x.test',
        twitter: '@nectar',
        facebook: 'nectar.blog',
        linkedin: 'nectar-ssg',
        bluesky: 'nectar.example',
        mastodon: 'nectar@hachyderm.io',
        threads: '@nectar',
        tiktok: '@nectar',
        youtube: '@nectarvideo',
        instagram: '@nectargram',
        github: 't09tanaka/nectar',
      },
    });

    const graph = await loadContent({ cwd, config });

    expect(graph.site).toMatchObject({
      twitter: '@nectar',
      facebook: 'nectar.blog',
      linkedin: 'nectar-ssg',
      bluesky: 'nectar.example',
      mastodon: 'nectar@hachyderm.io',
      threads: '@nectar',
      tiktok: '@nectar',
      youtube: '@nectarvideo',
      instagram: '@nectargram',
      github: 't09tanaka/nectar',
    });
  });

  test('normalizes Ghost excerpt fields from custom_excerpt or 50 plaintext words', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-excerpt-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/authors'), { recursive: true });

    const longPlaintext = numberedWords(55).join(' ');
    const fallbackWords = numberedWords(53, 3).join(' ');
    await writeFile(
      join(cwd, 'content/posts/custom.md'),
      `---
title: Custom excerpt
date: 2026-01-01T00:00:00Z
custom_excerpt: Editor summary
---

${longPlaintext}
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/html-custom.md'),
      `---
title: HTML custom excerpt
date: 2026-01-04T00:00:00Z
custom_excerpt: "<p>Editor <strong>summary</strong></p><script>nope()</script>"
---

${longPlaintext}
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/generated.md'),
      `---
title: Generated excerpt
date: 2026-01-02T00:00:00Z
unsafe_html: true
---

<p>w01 <strong>w02</strong></p>

${fallbackWords}
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/null-custom.md'),
      `---
title: Null custom excerpt
date: 2026-01-03T00:00:00Z
custom_excerpt:
excerpt: Legacy excerpt input
---

${longPlaintext}
`,
      'utf8',
    );

    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    const custom = graph.bySlug.posts.get('custom');
    expect(custom?.custom_excerpt).toBe('Editor summary');
    expect(custom?.excerpt).toBe('Editor summary');

    const generated = graph.bySlug.posts.get('generated');
    const first50Words = numberedWords(50).join(' ');
    expect(generated?.custom_excerpt).toBeUndefined();
    expect(generated).not.toHaveProperty('plaintext');
    expect(generated?.excerpt).toBe(first50Words);
    expect(generated?.excerpt).not.toContain('<strong>');
    expect(/\s$/.test(generated?.excerpt ?? '')).toBe(false);
    expect(generated?.excerpt).not.toContain('w51');

    const nullCustom = graph.bySlug.posts.get('null-custom');
    expect(nullCustom?.custom_excerpt).toBe('Legacy excerpt input');
    expect(nullCustom?.excerpt).toBe('Legacy excerpt input');

    const htmlCustom = graph.bySlug.posts.get('html-custom');
    expect(htmlCustom?.custom_excerpt).toBe('Editor summary');
    expect(htmlCustom?.excerpt).toBe('Editor summary');
  });

  test('strips email cards before plaintext, excerpt, and feed fields are derived', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-email-card-derived-fields-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/email-cards.md'),
      `---
title: Email Cards
date: 2026-01-01T00:00:00Z
unsafe_html: true
---

Public intro.

<div class="kg-card kg-email-card">
  <p>Newsletter body secret.</p>
</div>

Middle public copy.

<div class="kg-card kg-email-cta-card">
  <p>Email CTA secret.</p>
</div>

Public outro.
`,
      'utf8',
    );

    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.bySlug.posts.get('email-cards');
    if (!post) throw new Error('Expected email-cards post to load');

    expect(post.html).toContain('Public intro.');
    expect(post.html).toContain('Middle public copy.');
    expect(post.html).toContain('Public outro.');
    expect(post.html).not.toContain('kg-email-card');
    expect(post.html).not.toContain('kg-email-cta-card');
    expect(post.html).not.toContain('Newsletter body secret');
    expect(post.html).not.toContain('Email CTA secret');

    for (const field of [post.excerpt, post.feed_html, post.feed_excerpt]) {
      expect(field).toContain('Public intro');
      expect(field).toContain('Middle public copy');
      expect(field).toContain('Public outro');
      expect(field).not.toContain('Newsletter body secret');
      expect(field).not.toContain('Email CTA secret');
      expect(field).not.toContain('kg-email-card');
      expect(field).not.toContain('kg-email-cta-card');
    }
  });

  test('derives stable Ghost-compatible ObjectId ids without changing slug URLs', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });

    const first = await loadContent({ cwd, config });
    const second = await loadContent({ cwd, config });
    const objectId = /^[0-9a-f]{24}$/;

    const post = first.bySlug.posts.get('hello');
    const page = first.bySlug.pages.get('about');
    const tag = first.bySlug.tags.get('news');
    const author = first.bySlug.authors.get('casper');

    expect(post?.id).toMatch(objectId);
    expect(page?.id).toMatch(objectId);
    expect(tag?.id).toMatch(objectId);
    expect(author?.id).toMatch(objectId);
    expect(post?.id).toBe(second.bySlug.posts.get('hello')?.id);
    expect(page?.id).toBe(second.bySlug.pages.get('about')?.id);
    expect(tag?.id).toBe(second.bySlug.tags.get('news')?.id);
    expect(author?.id).toBe(second.bySlug.authors.get('casper')?.id);

    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: "Retitled"
date: 2026-01-01T00:00:00Z
tags: [news]
authors: [casper]
---

Body changed, but slug and published_at stayed fixed.
`,
      'utf8',
    );
    const retitled = await loadContent({ cwd, config });
    expect(retitled.bySlug.posts.get('hello')?.id).toBe(post?.id);

    expect(post?.slug).toBe('hello');
    expect(post?.url).toBe('/hello/');
    expect(page?.slug).toBe('about');
    expect(page?.url).toBe('/about/');
    expect(first.sources?.posts.has(post?.id ?? '')).toBe(true);
    expect(first.sources?.pages.has(page?.id ?? '')).toBe(true);
    expect(first.sources?.tags.has(tag?.id ?? '')).toBe(true);
    expect(first.sources?.authors.has(author?.id ?? '')).toBe(true);
  });

  test('derives stable RFC4122 UUIDs separately from ObjectId ids', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { base_path: '/blog/' },
    });

    const first = await loadContent({ cwd, config });
    const second = await loadContent({ cwd, config });
    const post = first.bySlug.posts.get('hello');
    const page = first.bySlug.pages.get('about');
    const rfc4122V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(post?.uuid).toMatch(rfc4122V5);
    expect(page?.uuid).toMatch(rfc4122V5);
    expect(post?.uuid).not.toBe(post?.id);
    expect(page?.uuid).not.toBe(page?.id);
    expect(post?.uuid).toBe(second.bySlug.posts.get('hello')?.uuid);
    expect(page?.uuid).toBe(second.bySlug.pages.get('about')?.uuid);

    const retitledConfig = configSchema.parse({
      site: { title: 'Retitled site', url: 'https://x.test' },
      build: { base_path: '/blog/' },
    });
    const retitled = await loadContent({ cwd, config: retitledConfig });
    expect(retitled.bySlug.posts.get('hello')?.uuid).toBe(post?.uuid);

    const renamedSite = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://renamed.test' },
        build: { base_path: '/blog/' },
      }),
    });
    const movedBasePath = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        build: { base_path: '/docs/' },
      }),
    });

    expect(renamedSite.bySlug.posts.get('hello')?.uuid).not.toBe(post?.uuid);
    expect(movedBasePath.bySlug.posts.get('hello')?.uuid).not.toBe(post?.uuid);
  });

  test('prefers explicit frontmatter UUIDs over derived values', async () => {
    const cwd = await fixture();
    const explicitPostUuid = '11111111-2222-5333-8444-555555555555';
    const explicitPageUuid = 'aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee';
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
uuid: "${explicitPostUuid}"
title: "Hello world"
date: 2026-01-01T00:00:00Z
tags: [news]
authors: [casper]
featured: true
---

# Hello

Welcome to Nectar.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/pages/about.md'),
      `---
uuid: "${explicitPageUuid}"
title: "About"
date: 2026-01-03T00:00:00Z
---

About body
`,
      'utf8',
    );

    const graph = await loadContent({
      cwd,
      config: configSchema.parse({ site: { title: 'X', url: 'https://x.test' } }),
    });

    expect(graph.bySlug.posts.get('hello')?.uuid).toBe(explicitPostUuid);
    expect(graph.bySlug.pages.get('about')?.uuid).toBe(explicitPageUuid);
  });

  test('counts primary and secondary author posts from the public post graph', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-author-count-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/authors'), { recursive: true });
    await writeFile(join(cwd, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
    await writeFile(join(cwd, 'content/authors/pat.md'), '---\nname: Pat\n---\n', 'utf8');
    await writeFile(
      join(cwd, 'content/posts/co-authored.md'),
      `---
title: Co-authored
date: 2026-01-01T00:00:00Z
authors: [casper, pat]
---

Body.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/pat-only.md'),
      `---
title: Pat only
date: 2026-01-02T00:00:00Z
authors: [pat]
---

Body.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/newsletter.md'),
      `---
title: Newsletter
date: 2026-01-03T00:00:00Z
authors: [pat]
email_only: true
---

Body.
`,
      'utf8',
    );

    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    expect(graph.authors.find((a) => a.slug === 'casper')?.count.posts).toBe(1);
    expect(graph.authors.find((a) => a.slug === 'pat')?.count.posts).toBe(2);
    expect(graph.postsByAuthor.get('pat')?.map((p) => p.slug)).toEqual(['pat-only', 'co-authored']);
  });

  test('loads tag theme fields and exposes them on primary_tag', async () => {
    const cwd = await fixture();
    await mkdir(join(cwd, 'content/tags'), { recursive: true });
    await writeFile(
      join(cwd, 'content/tags/news.md'),
      `---
name: News
accent_color: "#e91e63"
canonical_url: "/topics/news/"
og_title: "News OG"
og_description: "News OG description"
og_image: "/content/images/news-og.jpg"
twitter_title: "News Twitter"
twitter_description: "News Twitter description"
twitter_image: "/content/images/news-twitter.jpg"
codeinjection_head: "<meta name=\\"tag-head\\" content=\\"news\\">"
codeinjection_foot: "<script>window.__tag='news'</script>"
---
`,
      'utf8',
    );

    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { allow_code_injection: true },
    });
    const graph = await loadContent({ cwd, config });

    const tag = graph.bySlug.tags.get('news');
    expect(tag).toMatchObject({
      accent_color: '#e91e63',
      canonical_url: '/topics/news/',
      og_title: 'News OG',
      og_description: 'News OG description',
      og_image: '/content/images/news-og.jpg',
      twitter_title: 'News Twitter',
      twitter_description: 'News Twitter description',
      twitter_image: '/content/images/news-twitter.jpg',
      codeinjection_head: '<meta name="tag-head" content="news">',
      codeinjection_foot: "<script>window.__tag='news'</script>",
    });
    expect(graph.bySlug.posts.get('hello')?.primary_tag).toMatchObject({
      accent_color: '#e91e63',
      canonical_url: '/topics/news/',
      og_image: '/content/images/news-og.jpg',
      twitter_image: '/content/images/news-twitter.jpg',
    });
  });

  test('tag frontmatter visibility overrides the hash-slug heuristic (#1018)', async () => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, 'content/tags/hash-news.md'),
      `---
name: Hash News
visibility: public
---
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/tags/ops.md'),
      `---
name: Ops
visibility: internal
---
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/visibility.md'),
      `---
title: Visibility
date: 2026-03-01T00:00:00Z
tags: [hash-news, ops]
---

Body
`,
      'utf8',
    );

    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    expect(graph.bySlug.tags.get('hash-news')?.visibility).toBe('public');
    expect(graph.bySlug.tags.get('ops')?.visibility).toBe('internal');
    expect(
      graph.bySlug.posts.get('visibility')?.tags.map((tag) => [tag.slug, tag.visibility]),
    ).toEqual([
      ['hash-news', 'public'],
      ['ops', 'internal'],
    ]);
  });

  test('loads author archive SEO fields and exposes them on primary_author', async () => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, 'content/authors/casper.md'),
      `---
name: Casper
bio: Friendly ghost
accent_color: "#7851a9"
og_title: "Casper OG"
og_description: "Casper OG description"
og_image: "/content/images/casper-og.jpg"
twitter_title: "Casper Twitter"
twitter_description: "Casper Twitter description"
twitter_image: "/content/images/casper-twitter.jpg"
codeinjection_head: "<meta name=\\"author-head\\" content=\\"casper\\">"
codeinjection_foot: "<script>window.__author='casper'</script>"
---
`,
      'utf8',
    );

    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { allow_code_injection: true },
    });
    const graph = await loadContent({ cwd, config });

    const author = graph.bySlug.authors.get('casper');
    expect(author).toMatchObject({
      accent_color: '#7851a9',
      og_title: 'Casper OG',
      og_description: 'Casper OG description',
      og_image: '/content/images/casper-og.jpg',
      twitter_title: 'Casper Twitter',
      twitter_description: 'Casper Twitter description',
      twitter_image: '/content/images/casper-twitter.jpg',
      codeinjection_head: '<meta name="author-head" content="casper">',
      codeinjection_foot: "<script>window.__author='casper'</script>",
    });
    expect(graph.bySlug.posts.get('hello')?.primary_author).toMatchObject({
      accent_color: '#7851a9',
      og_image: '/content/images/casper-og.jpg',
      twitter_image: '/content/images/casper-twitter.jpg',
    });
  });

  test('reuses cached markdown render results until source content changes', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });

    await loadContent({ cwd, config });
    const { path, entry } = await readRenderCacheEntry(cwd, 'content/posts/hello.md');
    await writeFile(
      path,
      JSON.stringify({
        ...entry,
        result: {
          html: '<p>cached hello</p>',
          plaintext: 'cached hello',
          word_count: 2,
          reading_time: 1,
        },
      }),
      'utf8',
    );

    const cached = await loadContent({ cwd, config });
    expect(cached.bySlug.posts.get('hello')?.html).toBe('<p>cached hello</p>');
    expect(cached.bySlug.posts.get('hello')).not.toHaveProperty('plaintext');

    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: "Hello world"
date: 2026-01-01T00:00:00Z
tags: [news]
authors: [casper]
featured: true
---

# Hello

Fresh body.
`,
      'utf8',
    );

    const invalidated = await loadContent({ cwd, config });
    expect(invalidated.bySlug.posts.get('hello')?.html).toContain('Fresh body.');
    expect(invalidated.bySlug.posts.get('hello')?.html).not.toBe('<p>cached hello</p>');
  });

  test('ignores corrupt markdown render cache entries and rewrites them', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });

    await loadContent({ cwd, config });
    const { path } = await readRenderCacheEntry(cwd, 'content/posts/second.md');
    await writeFile(path, '{not json', 'utf8');

    const graph = await loadContent({ cwd, config });
    expect(graph.bySlug.posts.get('second')?.html).toContain('Body 2');

    const rewritten = JSON.parse(await readFile(path, 'utf8'));
    expect(rewritten.result.html).toContain('Body 2');
  });

  test('starts markdown normalization for sibling posts in parallel before rendering', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-parallel-markdown-render-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/a.md'),
      `---
title: First
date: 2026-01-01T00:00:00Z
---

first body
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/b.md'),
      `---
title: Second
date: 2026-01-02T00:00:00Z
---

second body
`,
      'utf8',
    );

    let seenSecond = false;
    let releaseFirst: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let timeoutId: Timer | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('second post render was not scheduled in parallel')),
        500,
      );
    });

    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    try {
      const graph = await loadContent({
        cwd,
        config,
        markdownTransforms: [
          async (body) => {
            if (body.includes('second body')) {
              seenSecond = true;
              releaseFirst?.();
              return body;
            }
            if (body.includes('first body')) {
              await Promise.race([secondStarted, timeout]);
            }
            return body;
          },
        ],
      });

      expect(seenSecond).toBe(true);
      expect(graph.posts.map((post) => post.slug)).toEqual(['b', 'a']);
      expect(graph.bySlug.posts.get('a')?.html).toContain('first body');
      expect(graph.bySlug.posts.get('b')?.html).toContain('second body');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });

  test('copies config site.icon into SiteData', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({
      site: {
        title: 'X',
        url: 'https://x.test',
        icon: '/content/images/site-icon.svg',
      },
    });
    const graph = await loadContent({ cwd, config });

    expect(graph.site.icon).toBe('/content/images/site-icon.svg');
  });

  test('builds postsByTag and postsByAuthor inverse maps preserving sort order', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    const newsPosts = graph.postsByTag.get('news');
    expect(newsPosts).toBeDefined();
    expect(newsPosts).toHaveLength(1);
    expect(newsPosts?.[0]?.slug).toBe('hello');

    const casperPosts = graph.postsByAuthor.get('casper');
    expect(casperPosts).toBeDefined();
    expect(casperPosts).toHaveLength(1);
    expect(casperPosts?.[0]?.slug).toBe('hello');

    // Tags / authors that exist but have no posts still get an empty bucket so
    // route planners don't need a null check.
    expect(graph.postsByTag.has('news')).toBe(true);
    expect(graph.postsByAuthor.has('casper')).toBe(true);
  });

  test('site.direction is ltr by default and rtl for Arabic locale', async () => {
    const cwd = await fixture();
    const ltr = await loadContent({
      cwd,
      config: configSchema.parse({ site: { title: 'X', url: 'https://x.test' } }),
    });
    expect(ltr.site.locale).toBe('en');
    expect(ltr.site.direction).toBe('ltr');

    const rtl = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test', locale: 'ar-EG' },
      }),
    });
    expect(rtl.site.locale).toBe('ar-EG');
    expect(rtl.site.direction).toBe('rtl');
  });

  test('loads locale-scoped content trees and frontmatter locale into localized model URLs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-locales-'));
    await mkdir(join(cwd, 'content/en/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/ja/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/ja/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/ja/tags'), { recursive: true });
    await mkdir(join(cwd, 'content/ja/authors'), { recursive: true });
    await writeFile(
      join(cwd, 'content/en/posts/hello.md'),
      `---
title: Hello
date: 2026-01-01T00:00:00Z
---

Hello body.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/ja/posts/hello.md'),
      `---
title: こんにちは
locale: ja
date: 2026-01-02T00:00:00Z
tags: [news]
authors: [hana]
---

本文です。
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/ja/pages/about.md'),
      `---
title: About JA
---
About JA.
`,
      'utf8',
    );
    await writeFile(join(cwd, 'content/ja/tags/news.md'), '---\nname: ニュース\n---\n', 'utf8');
    await writeFile(join(cwd, 'content/ja/authors/hana.md'), '---\nname: Hana\n---\n', 'utf8');

    const graph = await loadContent({
      cwd,
      config: configSchema.parse({ site: { title: 'X', url: 'https://x.test' } }),
    });

    expect(graph.localeRouting).toBe(true);
    expect(graph.locales).toEqual(['en', 'ja']);
    expect(graph.posts.map((p) => [p.locale, p.url])).toEqual([
      ['ja', '/ja/hello/'],
      ['en', '/en/hello/'],
    ]);
    expect(graph.pages[0]?.locale).toBe('ja');
    expect(graph.pages[0]?.url).toBe('/ja/about/');
    expect(graph.tags.find((t) => t.locale === 'ja' && t.slug === 'news')?.url).toBe(
      '/ja/tag/news/',
    );
    expect(graph.authors.find((a) => a.locale === 'ja' && a.slug === 'hana')?.url).toBe(
      '/ja/author/hana/',
    );
    expect(graph.postsByTag.get('ja\u0000news')?.[0]?.locale).toBe('ja');
  });

  test('site.members_* / comments / recommendations defaults are stable booleans/strings', async () => {
    // Ghost Source theme branches sidebar/footer/CTA/navigation on these.
    // Default config has no Portal backend, so they must be stable booleans
    // (false), not undefined — otherwise Handlebars `#if` reads as falsy but a
    // future typo could ship `undefined` past the type check.
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({ site: { title: 'X', url: 'https://x.test' } }),
    });
    expect(graph.site.members_enabled).toBe(false);
    expect(graph.site.paid_members_enabled).toBe(false);
    expect(graph.site.members_invite_only).toBe(false);
    expect(graph.site.member_count).toBeUndefined();
    expect(graph.site.comments_enabled).toBe(false);
    expect(graph.site.comments_access).toBe('all');
    expect(graph.site.portal_button).toBe(false);
    expect(graph.site.portal_button_icon).toBe('');
    expect(graph.site.portal_button_signup_text).toBe('');
    expect(graph.site.portal_button_style).toBe('');
    expect(graph.site.portal_name).toBe(false);
    expect(graph.site.portal_plans).toEqual([]);
    expect(graph.site.portal_signup_checkbox_required).toBe(false);
    expect(graph.site.portal_signup_terms_html).toBe('');
    expect(graph.site.signup_url).toBe('');
    expect(graph.site.recommendations_enabled).toBe(false);
    expect(graph.site.private).toBe(false);
  });

  test('[site].private round-trips to the Ghost-compatible @site flag', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test', private: true },
      }),
    });
    expect(graph.site.private).toBe(true);
  });

  test('site.members_enabled flips on when `[components.portal].provider != "none"`', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        components: { portal: { provider: 'ghost' } },
      }),
    });
    expect(graph.site.members_enabled).toBe(true);
    // paid + invite_only stay false unless explicitly opted in.
    expect(graph.site.paid_members_enabled).toBe(false);
    expect(graph.site.members_invite_only).toBe(false);
  });

  test('site.paid_members_enabled / members_invite_only follow portal sub-flags only when portal is on', async () => {
    const cwd = await fixture();
    const enabled = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        components: { portal: { provider: 'ghost', paid: true, invite_only: true } },
      }),
    });
    expect(enabled.site.paid_members_enabled).toBe(true);
    expect(enabled.site.members_invite_only).toBe(true);

    // With provider="none" the sub-flags are forced false: a paid=true setting
    // alongside provider="none" must not flip @site.paid_members_enabled, or
    // the Source sidebar would render an Upgrade button against a portal
    // surface that never loads.
    const disabled = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        components: { portal: { provider: 'none', paid: true, invite_only: true } },
      }),
    });
    expect(disabled.site.members_enabled).toBe(false);
    expect(disabled.site.paid_members_enabled).toBe(false);
    expect(disabled.site.members_invite_only).toBe(false);
  });

  test('components.portal.member_count round-trips to @site for static helper output', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        components: {
          portal: {
            member_count: 1234,
          },
        },
      }),
    });

    expect(graph.site.member_count).toBe(1234);
  });

  // Issue #420 / #962: the `[site]` block accepts explicit `members_enabled` /
  // `paid_members_enabled` / `members_invite_only` / `comments_*`
  // overrides. They win over the derived Portal-provider defaults so an
  // operator can decouple the theme UI from the Portal wiring.
  test('[site].members_* explicit overrides win over Portal-derived defaults (issue #420)', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: {
          title: 'X',
          url: 'https://x.test',
          members_enabled: true,
          paid_members_enabled: true,
          members_invite_only: true,
          comments_enabled: true,
          comments_access: 'paid',
        },
        // Portal off — would normally force every flag to false.
        components: { portal: { provider: 'none' } },
      }),
    });
    expect(graph.site.members_enabled).toBe(true);
    expect(graph.site.paid_members_enabled).toBe(true);
    expect(graph.site.members_invite_only).toBe(true);
    expect(graph.site.comments_enabled).toBe(true);
    expect(graph.site.comments_access).toBe('paid');
  });

  test('[site.portal] settings round-trip to Ghost-compatible @site fields (issue #964)', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: {
          title: 'X',
          url: 'https://x.test',
          portal: {
            portal_button: true,
            portal_button_icon: 'icon-2',
            portal_button_signup_text: 'Join now',
            portal_button_style: 'icon-and-text',
            portal_name: 'Nectar Portal',
            portal_plans: ['free', 'monthly'],
            portal_signup_checkbox_required: true,
            portal_signup_terms_html: '<p>Terms apply</p>',
            signup_url: 'https://x.test/signup/',
          },
        },
      }),
    });

    expect(graph.site.portal_button).toBe(true);
    expect(graph.site.portal_button_icon).toBe('icon-2');
    expect(graph.site.portal_button_signup_text).toBe('Join now');
    expect(graph.site.portal_button_style).toBe('icon-and-text');
    expect(graph.site.portal_name).toBe('Nectar Portal');
    expect(graph.site.portal_plans).toEqual(['free', 'monthly']);
    expect(graph.site.portal_signup_checkbox_required).toBe(true);
    expect(graph.site.portal_signup_terms_html).toBe('<p>Terms apply</p>');
    expect(graph.site.signup_url).toBe('https://x.test/signup/');
  });

  // Issue #491: themes that probe `{{@site.stripe_publishable_key}}` to
  // decide whether to render a client-only checkout widget need a defined
  // surface. Default `undefined` (members out-of-scope), but operators
  // wiring their own checkout can opt in and the value round-trips verbatim.
  test('[site].stripe_publishable_key round-trips to @site (issue #491)', async () => {
    const cwd = await fixture();
    const defaulted = await loadContent({
      cwd,
      config: configSchema.parse({ site: { title: 'X', url: 'https://x.test' } }),
    });
    expect(defaulted.site.stripe_publishable_key).toBeUndefined();

    const opted = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test', stripe_publishable_key: 'pk_test_xyz' },
      }),
    });
    expect(opted.site.stripe_publishable_key).toBe('pk_test_xyz');
  });

  test('rewrites post-relative image URLs to public content image paths (issue #1016)', async () => {
    const cwd = await fixture();
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(join(cwd, 'content/images/asset.jpg'), 'asset', 'utf8');
    await writeFile(
      join(cwd, 'content/posts/relative-images.md'),
      `---
title: "Relative Images"
date: 2026-04-01T00:00:00Z
---

![Sibling shorthand](./images/sibling.jpg)

![Asset relative](../images/asset.jpg?width=1200#hero)

{{< figure src="./images/card.jpg" srcset="./images/card-600.jpg 600w, ../images/asset.jpg 1200w, https://cdn.test/remote.jpg 1600w" alt="Card" />}}
`,
      'utf8',
    );

    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        build: { base_path: '/blog/' },
      }),
    });
    const post = graph.posts.find((p) => p.slug === 'relative-images');
    expect(post?.html).toContain('src="/content/images/sibling.jpg"');
    expect(post?.html).toContain('src="/content/images/asset.jpg?width=1200#hero"');
    expect(post?.html).toContain('src="/content/images/card.jpg"');
    expect(post?.html).toContain(
      'srcset="/content/images/card-600.jpg 600w, /content/images/asset.jpg 1200w, https://cdn.test/remote.jpg 1600w"',
    );
    expect(post?.html).not.toContain('./images/');
    expect(post?.html).not.toContain('../images/');
    expect(post?.html).not.toContain('/blog/content/images/');
  });

  // Issue #421: site-level meta / og / twitter knobs surface to themes via
  // @site.* and act as the last fallback inside {{ghost_head}}.
  test('[site].meta_* / og_* / twitter_* round-trip to @site (issue #421)', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: {
          title: 'X',
          url: 'https://x.test',
          meta_title: 'Meta T',
          meta_description: 'Meta D',
          og_image: 'https://x.test/og.png',
          og_title: 'OG T',
          og_description: 'OG D',
          twitter_image: 'https://x.test/tw.png',
          twitter_title: 'TW T',
          twitter_description: 'TW D',
        },
      }),
    });
    expect(graph.site.meta_title).toBe('Meta T');
    expect(graph.site.meta_description).toBe('Meta D');
    expect(graph.site.og_image).toBe('https://x.test/og.png');
    expect(graph.site.og_title).toBe('OG T');
    expect(graph.site.og_description).toBe('OG D');
    expect(graph.site.twitter_image).toBe('https://x.test/tw.png');
    expect(graph.site.twitter_title).toBe('TW T');
    expect(graph.site.twitter_description).toBe('TW D');
  });

  // Issue #419: site-level codeinjection_head / codeinjection_foot are
  // gated on `build.allow_code_injection`. Without the opt-in, the values
  // are silently dropped so a copied-in [site] block from an untrusted
  // source cannot smuggle scripts via {{ghost_head}} / {{ghost_foot}}.
  test('[site].codeinjection_* is dropped unless build.allow_code_injection = true (issue #419)', async () => {
    const cwd = await fixture();
    const gated = await loadContent({
      cwd,
      config: configSchema.parse({
        site: {
          title: 'X',
          url: 'https://x.test',
          codeinjection_head: '<script>1</script>',
          codeinjection_foot: '<script>2</script>',
        },
      }),
    });
    expect(gated.site.codeinjection_head).toBeUndefined();
    expect(gated.site.codeinjection_foot).toBeUndefined();

    const allowed = await loadContent({
      cwd,
      config: configSchema.parse({
        site: {
          title: 'X',
          url: 'https://x.test',
          codeinjection_head: '<script>1</script>',
          codeinjection_foot: '<script>2</script>',
        },
        build: { allow_code_injection: true },
      }),
    });
    expect(allowed.site.codeinjection_head).toBe('<script>1</script>');
    expect(allowed.site.codeinjection_foot).toBe('<script>2</script>');
  });

  test('site.recommendations_enabled flips to true once `[[recommendations]]` is populated', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        recommendations: [{ title: 'Cool', url: 'https://cool.example' }],
      }),
    });
    expect(graph.site.recommendations_enabled).toBe(true);
  });

  test('tag.url and author.url honour routes.yaml taxonomy paths (issue #233)', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({
      cwd,
      config,
      routesYaml: {
        ...emptyRoutesYaml(),
        taxonomies: { tag: '/category/{slug}/', author: '/writer/{slug}/' },
      },
    });
    expect(graph.tags.find((t) => t.slug === 'news')?.url).toBe('/category/news/');
    expect(graph.authors.find((a) => a.slug === 'casper')?.url).toBe('/writer/casper/');
  });

  test('stores model URLs as base-path-prefixed paths for url helper resolution', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { base_path: '/blog/' },
    });
    const graph = await loadContent({ cwd, config });

    expect(graph.posts.find((p) => p.slug === 'second')?.url).toBe('/blog/second/');
    expect(graph.pages.find((p) => p.slug === 'about')?.url).toBe('/blog/about/');
    expect(graph.tags.find((t) => t.slug === 'news')?.url).toBe('/blog/tag/news/');
    expect(graph.authors.find((a) => a.slug === 'casper')?.url).toBe('/blog/author/casper/');
  });

  test('graph.tiers is empty by default and the helper resolves it as a no-op resource', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({ site: { title: 'X', url: 'https://x.test' } }),
    });
    expect(graph.tiers).toEqual([]);
  });

  test('graph.tiers projects each [[tiers]] entry into a Ghost-shaped tier object', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        tiers: [
          {
            name: 'Free',
            description: 'Weekly newsletter',
            benefits: ['Weekly digest'],
          },
          {
            name: 'Premium',
            description: 'Plus archives + Discord',
            monthly_price: 9,
            yearly_price: 90,
            currency: 'USD',
            welcome_page_url: 'https://buttondown.example/pay/premium',
            benefits: ['Full archives', 'Discord access'],
          },
        ],
      }),
    });
    expect(graph.tiers.length).toBe(2);
    const free = graph.tiers[0];
    expect(free).toBeDefined();
    if (!free) throw new Error('unreachable');
    expect(free.slug).toBe('free');
    expect(free.type).toBe('free');
    expect(free.active).toBe(true);
    expect(free.visibility).toBe('public');
    expect(free.monthly_price).toBeUndefined();
    expect(free.yearly_price).toBeUndefined();
    // Currency is dropped on free tiers so themes can branch on `tier.currency`
    // without an extra `tier.type === 'paid'` guard.
    expect(free.currency).toBeUndefined();
    expect(free.benefits).toEqual(['Weekly digest']);

    const premium = graph.tiers[1];
    expect(premium).toBeDefined();
    if (!premium) throw new Error('unreachable');
    expect(premium.slug).toBe('premium');
    expect(premium.type).toBe('paid');
    expect(premium.monthly_price).toBe(9);
    expect(premium.yearly_price).toBe(90);
    expect(premium.currency).toBe('USD');
    expect(premium.welcome_page_url).toBe('https://buttondown.example/pay/premium');
    expect(premium.benefits).toEqual(['Full archives', 'Discord access']);
  });

  test('graph.tiers disambiguates duplicate names by appending a numeric suffix to the slug', async () => {
    const cwd = await fixture();
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        tiers: [{ name: 'Premium' }, { name: 'Premium', monthly_price: 12 }],
      }),
    });
    expect(graph.tiers.map((t) => t.slug)).toEqual(['premium', 'premium-2']);
    // The second entry kept its price-driven `paid` type.
    expect(graph.tiers[1]?.type).toBe('paid');
  });

  test('post.tiers resolves frontmatter tier slugs against configured tiers', async () => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, 'content/posts/tiered.md'),
      `---
title: "Tiered"
date: 2026-03-01T00:00:00Z
visibility: tiers
tiers: [premium, supporter]
---

Members-only body.
`,
      'utf8',
    );
    const graph = await loadContent({
      cwd,
      config: configSchema.parse({
        site: { title: 'X', url: 'https://x.test' },
        tiers: [
          { name: 'Premium', monthly_price: 9, yearly_price: 90, currency: 'USD' },
          { name: 'Supporter', monthly_price: 3, currency: 'USD' },
        ],
      }),
    });

    const tiered = graph.posts.find((p) => p.slug === 'tiered');
    expect(tiered?.tiers.map((t) => [t.slug, t.name, t.monthly_price, t.yearly_price])).toEqual([
      ['premium', 'Premium', 9, 90],
      ['supporter', 'Supporter', 3, undefined],
    ]);
    expect(graph.posts.find((p) => p.slug === 'second')?.tiers).toEqual([]);
  });

  test('post.url honours routes.yaml `collections:` permalink and filter', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({
      cwd,
      config,
      routesYaml: {
        ...emptyRoutesYaml(),
        // The /blog/ collection only accepts posts tagged 'news'. The
        // hello post carries that tag; second.md does not, so it falls
        // through to the catch-all root collection.
        collections: {
          '/': { permalink: '/{slug}/' },
          '/blog/': { permalink: '/blog/{slug}/', filter: 'tag:news' },
        },
      },
    });
    const hello = graph.posts.find((p) => p.slug === 'hello');
    const second = graph.posts.find((p) => p.slug === 'second');
    expect(hello?.url).toBe('/blog/hello/');
    expect(second?.url).toBe('/second/');
  });

  test('omitting collections leaves post.url at the legacy slug-based path', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts.find((p) => p.slug === 'hello')?.url).toBe('/hello/');
  });

  test('tag.url is blank when the tag taxonomy is disabled via routes.yaml', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({
      cwd,
      config,
      routesYaml: { ...emptyRoutesYaml(), taxonomies: { author: '/author/{slug}/' } },
    });
    expect(graph.tags.find((t) => t.slug === 'news')?.url).toBe('');
    // author archive remains enabled, so its URL stays populated
    expect(graph.authors.find((a) => a.slug === 'casper')?.url).toBe('/author/casper/');
  });
});

describe('loadContent feature image dimensions', () => {
  test('reads intrinsic SVG width/height from local feature_image', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-dims-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(
      join(cwd, 'content/images/cover.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"></svg>',
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/dims.md'),
      `---
title: Dims
date: 2026-01-01T00:00:00Z
feature_image: "/content/images/cover.svg"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];
    expect(post?.feature_image_width).toBe(1200);
    expect(post?.feature_image_height).toBe(600);
  });

  test('counts feature_image in Ghost-compatible reading_time', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-feature-reading-time-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await mkdir(join(cwd, 'content/authors'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/feature.md'),
      `---
title: "Feature"
date: 2026-01-01T00:00:00Z
feature_image: "https://cdn.example.com/cover.jpg"
---

${'word '.repeat(400)}
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    expect(graph.posts[0]?.word_count).toBe(400);
    expect(graph.posts[0]?.reading_time).toBe(2);
  });

  test('honors explicit frontmatter dimensions over file probe', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-dims-explicit-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await mkdir(join(cwd, 'content/images'), { recursive: true });
    await writeFile(
      join(cwd, 'content/images/cover.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"></svg>',
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/dims.md'),
      `---
title: Dims
date: 2026-01-01T00:00:00Z
feature_image: "/content/images/cover.svg"
feature_image_width: 800
feature_image_height: 400
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];
    expect(post?.feature_image_width).toBe(800);
    expect(post?.feature_image_height).toBe(400);
  });

  test('leaves dimensions undefined for remote feature images', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-dims-remote-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/remote.md'),
      `---
title: Remote
date: 2026-01-01T00:00:00Z
feature_image: "https://cdn.example.com/cover.jpg"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];
    expect(post?.feature_image_width).toBeUndefined();
    expect(post?.feature_image_height).toBeUndefined();
  });
});

describe('loadContent slug sanitization', () => {
  test('sanitizes malicious frontmatter slug for posts (path traversal)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-slug-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/evil.md'),
      `---
title: Evil
slug: "../../../../etc/cron.d/evil"
date: 2026-01-01T00:00:00Z
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const slug = graph.posts[0]?.slug ?? '';
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).not.toContain('..');
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('\\');
  });

  test('sanitizes malicious tag slugs from post frontmatter', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-slug-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/p.md'),
      `---
title: P
tags: ["../../evil"]
date: 2026-01-01T00:00:00Z
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    for (const tag of graph.tags) {
      expect(tag.slug).not.toContain('..');
      expect(tag.slug).not.toContain('/');
    }
  });

  test('sanitizes malicious author slug from author markdown frontmatter', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-slug-'));
    await mkdir(join(cwd, 'content/authors'), { recursive: true });
    await writeFile(
      join(cwd, 'content/authors/x.md'),
      `---
slug: "../../escape"
name: Escape
---
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    for (const author of graph.authors) {
      expect(author.slug).not.toContain('..');
      expect(author.slug).not.toContain('/');
    }
  });

  test('skips symlinked markdown files instead of following them outside the content tree', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-symlink-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), 'nectar-outside-'));
    const secret = join(outside, 'secret.md');
    await writeFile(
      secret,
      '---\ntitle: Stolen\ndate: 2026-01-01T00:00:00Z\n---\n\nSECRET_TOKEN=abc123\n',
      'utf8',
    );
    await symlink(secret, join(cwd, 'content/posts/oops.md'));
    await writeFile(
      join(cwd, 'content/posts/real.md'),
      '---\ntitle: Real\ndate: 2026-02-01T00:00:00Z\n---\n\nhi\n',
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts.map((p) => p.slug)).toEqual(['real']);
    for (const post of graph.posts) {
      expect(post.html).not.toContain('SECRET_TOKEN');
    }
  });

  test('strips raw <script> from post body by default', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-xss-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/xss.md'),
      `---
title: XSS
date: 2026-01-01T00:00:00Z
---

Body

<script>alert(1)</script>
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const html = graph.posts[0]?.html ?? '';
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  test('passes raw HTML through when unsafe_html: true', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-xss-optout-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/trusted.md'),
      `---
title: Trusted
date: 2026-01-01T00:00:00Z
unsafe_html: true
---

<div data-trusted="1"><em>raw</em></div>
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const html = graph.posts[0]?.html ?? '';
    expect(html).toContain('<div data-trusted="1">');
    expect(html).toContain('<em>raw</em>');
  });

  test('drops codeinjection_head/codeinjection_foot from frontmatter by default', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-codeinj-default-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/evil.md'),
      `---
title: Evil
date: 2026-01-01T00:00:00Z
codeinjection_head: "<script src=//evil.tld/x.js></script>"
codeinjection_foot: "<script>steal()</script>"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];
    expect(post?.codeinjection_head).toBeUndefined();
    expect(post?.codeinjection_foot).toBeUndefined();
  });

  test('passes codeinjection through when build.allow_code_injection: true', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-codeinj-optin-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/trusted.md'),
      `---
title: Trusted
date: 2026-01-01T00:00:00Z
codeinjection_head: "<meta name=x>"
codeinjection_foot: "<script>ok()</script>"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { allow_code_injection: true },
    });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];
    expect(post?.codeinjection_head).toBe('<meta name=x>');
    expect(post?.codeinjection_foot).toBe('<script>ok()</script>');
  });

  // Issue #322: Ghost HTML cards embed `<script>` / `<style>` blocks that
  // themes assume `{{content}}` will splice verbatim into `post.html`. The
  // post-loader gates raw HTML behind frontmatter `unsafe_html: true` (the
  // same opt-in used elsewhere), so an author who needs an HTML card to keep
  // its `<script>` payload — e.g. a third-party embed pulled forward from
  // Ghost via `nectar import-ghost` — can preserve it by flipping the flag.
  // Without the flag, sanitisation strips both for XSS defence.
  test('preserves <script> from HTML card content when unsafe_html: true (issue #322)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-html-card-script-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/embed.md'),
      `---
title: Embed
date: 2026-01-01T00:00:00Z
unsafe_html: true
---

Intro paragraph.

<script src="https://embed.example.com/widget.js"></script>

Outro paragraph.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const html = graph.posts[0]?.html ?? '';
    expect(html).toContain('<script src="https://embed.example.com/widget.js"></script>');
  });

  test('preserves <style> from HTML card content when unsafe_html: true (issue #322)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-html-card-style-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/styled.md'),
      `---
title: Styled
date: 2026-01-01T00:00:00Z
unsafe_html: true
---

<style>.custom-card { color: rebeccapurple; }</style>

<div class="custom-card">Hello</div>
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const html = graph.posts[0]?.html ?? '';
    expect(html).toContain('<style>.custom-card { color: rebeccapurple; }</style>');
    expect(html).toContain('<div class="custom-card">');
  });

  test('still strips <script>/<style> when unsafe_html is not set (issue #322 XSS guard)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-html-card-default-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/untrusted.md'),
      `---
title: Untrusted
date: 2026-01-01T00:00:00Z
---

<script>alert(1)</script>

<style>body { display: none }</style>

Body.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const html = graph.posts[0]?.html ?? '';
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('alert(1)');
  });

  test('surfaces malformed YAML frontmatter as a NectarError with the offending file path', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-bad-yaml-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const file = join(cwd, 'content/posts/bad.md');
    await writeFile(
      file,
      `---
title: ok
  date: 2026-01-01
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    try {
      await loadContent({ cwd, config });
      throw new Error('expected loadContent to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.file).toBe(file);
      expect(ne.line).toBe(3);
      expect(ne.message).toMatch(/invalid frontmatter/);
    }
  });

  test('surfaces unparseable post date as a NectarError instead of silently sorting to 1970', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-bad-date-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const file = join(cwd, 'content/posts/bad-date.md');
    await writeFile(
      file,
      `---
title: "Bad date"
date: "not-a-real-date"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    try {
      await loadContent({ cwd, config });
      throw new Error('expected loadContent to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.file).toBe(file);
      expect(ne.code).toBe('content');
      expect(ne.message).toMatch(/Invalid date in frontmatter/);
      expect(ne.message).toContain('not-a-real-date');
      // The post path is also embedded in the message via the context arg, so
      // logs that bypass the formatter still pinpoint the offending file.
      expect(ne.message).toContain(file);
    }
  });

  test('uses a fixed epoch fallback when post frontmatter omits date fields', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-missing-date-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const file = join(cwd, 'content/posts/no-date.md');
    await writeFile(
      file,
      `---
title: "No date"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const graph = await loadContent({ cwd, config });
      expect(graph.posts[0]?.published_at).toBe(MISSING_FRONTMATTER_DATE_FALLBACK);
      expect(graph.posts[0]?.updated_at).toBe(MISSING_FRONTMATTER_DATE_FALLBACK);
      expect(warn).toHaveBeenCalledWith(
        `Missing \`date\` or \`published_at\` in ${file}; using ${MISSING_FRONTMATTER_DATE_FALLBACK} to avoid leaking build time.`,
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('strips raw <script> from feature_image_caption frontmatter', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-caption-xss-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/cap.md'),
      `---
title: Cap
date: 2026-01-01T00:00:00Z
feature_image_caption: "Photo by <a href=\\"https://ok.test\\">A</a><script>alert(1)</script>"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const caption = graph.posts[0]?.feature_image_caption ?? '';
    expect(caption).not.toContain('<script');
    expect(caption).not.toContain('alert(1)');
    expect(caption).toContain('<a href="https://ok.test"');
    expect(caption).toContain('Photo by');
  });

  test('drops event handler attributes and javascript: hrefs from feature_image_caption', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-caption-handlers-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/cap.md'),
      `---
title: Cap
date: 2026-01-01T00:00:00Z
feature_image_caption: "<a href=\\"javascript:alert(1)\\" onclick=\\"alert(2)\\">x</a>"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const caption = graph.posts[0]?.feature_image_caption ?? '';
    expect(caption.toLowerCase()).not.toContain('javascript:');
    expect(caption.toLowerCase()).not.toContain('onclick');
    expect(caption).not.toContain('alert(1)');
    expect(caption).not.toContain('alert(2)');
  });

  test('preserves safe inline formatting in feature_image_caption', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-caption-safe-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/cap.md'),
      `---
title: Cap
date: 2026-01-01T00:00:00Z
feature_image_caption: "Photo by <em>Alice</em> &mdash; <strong>2026</strong>"
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const caption = graph.posts[0]?.feature_image_caption ?? '';
    expect(caption).toContain('<em>Alice</em>');
    expect(caption).toContain('<strong>2026</strong>');
  });

  test('throws when explicit frontmatter slug sanitizes to empty', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-slug-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/p.md'),
      `---
title: P
slug: "///"
date: 2026-01-01T00:00:00Z
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    await expect(loadContent({ cwd, config })).rejects.toThrow(/Invalid slug/);
  });

  test('refuses Markdown sources larger than content.max_markdown_bytes and reports the offending file (issue #1136)', async () => {
    // A contributor PR with an outsized Markdown body can OOM or hang the build
    // runner (marked.parse is CPU-bound and quadratic on pathological input).
    // Enforce the cap at stat() so the body is never loaded into memory and the
    // error points at the offending path.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-md-size-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const file = join(cwd, 'content/posts/big.md');
    const header = '---\ntitle: Big\ndate: 2026-01-01T00:00:00Z\n---\n\n';
    const body = 'x'.repeat(2048);
    await writeFile(file, header + body, 'utf8');

    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      content: { max_markdown_bytes: 1024 },
    });
    try {
      await loadContent({ cwd, config });
      throw new Error('expected loadContent to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.file).toBe(file);
      expect(ne.message).toMatch(/exceed/i);
      expect(ne.hint).toMatch(/max_markdown_bytes/);
    }
  });

  test('content.max_markdown_bytes = 0 disables the size check entirely', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-md-size-off-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const file = join(cwd, 'content/posts/big.md');
    const header = '---\ntitle: Big\ndate: 2026-01-01T00:00:00Z\n---\n\n';
    const body = 'x'.repeat(2048);
    await writeFile(file, header + body, 'utf8');

    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      content: { max_markdown_bytes: 0 },
    });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts).toHaveLength(1);
    expect(graph.posts[0]?.slug).toBe('big');
  });
});

describe('loadContent page custom_template (issue #1005)', () => {
  test('reads `template` frontmatter and stores it as the canonical custom-<name>', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-page-tmpl-'));
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await writeFile(
      join(cwd, 'content/pages/about.md'),
      `---
title: About
template: about
---

About body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.pages[0]?.custom_template).toBe('custom-about');
  });

  test('accepts pre-prefixed `custom-foo` without double-prefixing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-page-tmpl-pref-'));
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await writeFile(
      join(cwd, 'content/pages/about.md'),
      `---
title: About
custom_template: custom-about
---

About body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.pages[0]?.custom_template).toBe('custom-about');
  });

  test('rejects unsafe template names (path traversal, slashes, dots)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-page-tmpl-bad-'));
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await writeFile(
      join(cwd, 'content/pages/about.md'),
      `---
title: About
template: "../etc/passwd"
---

About body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.pages[0]?.custom_template).toBeUndefined();
  });

  test('leaves custom_template undefined when frontmatter is missing', async () => {
    const cwd = await fixture();
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.pages[0]?.custom_template).toBeUndefined();
  });
});

describe('loadContent post custom_template alternate layouts (issue #704)', () => {
  test('reads `template` frontmatter and stores it as the canonical custom-<name>', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-post-tmpl-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: Hello
template: narrow-feature-image
---

Hello body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts[0]?.custom_template).toBe('custom-narrow-feature-image');
  });

  test('accepts Dawn pre-prefixed custom-no-feature-image without double-prefixing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-post-tmpl-pref-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: Hello
custom_template: custom-no-feature-image
---

Hello body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts[0]?.custom_template).toBe('custom-no-feature-image');
  });

  test('rejects unsafe post template names', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-post-tmpl-bad-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/hello.md'),
      `---
title: Hello
template: "../etc/passwd"
---

Hello body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts[0]?.custom_template).toBeUndefined();
  });
});

describe('loadContent scheduled posts', () => {
  test('excludes scheduled posts whose published_at is still in the future', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-scheduled-future-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const futureIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(cwd, 'content/posts/embargo.md'),
      `---
title: Embargo
status: scheduled
date: ${futureIso}
---

Secret announcement.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/live.md'),
      `---
title: Live
date: 2026-01-01T00:00:00Z
---

Public.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts.map((p) => p.slug)).toEqual(['live']);
  });

  test('excludes scheduled posts even when published_at has already passed', async () => {
    // Ghost only ships a post once the author flips `status` from `scheduled`
    // to `published`. A scheduled post with a past date means the cron flip
    // hasn't happened yet (or the author edited the date), so Nectar must keep
    // it out of the build until the status is updated — otherwise issue #447's
    // silent leak path reopens.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-scheduled-past-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const pastIso = new Date(Date.now() - 60 * 1000).toISOString();
    await writeFile(
      join(cwd, 'content/posts/late.md'),
      `---
title: Late
status: scheduled
date: ${pastIso}
---

Now live.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts).toHaveLength(0);
  });

  test('excludes posts with future published_at even when status is published', async () => {
    // Issue #444: a post staged with `status: published` and a future date
    // would otherwise ship immediately on the next build, defeating the date
    // gate Ghost authors expect.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-future-published-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const futureIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(cwd, 'content/posts/launch.md'),
      `---
title: Launch
status: published
date: ${futureIso}
---

Not yet.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/live.md'),
      `---
title: Live
status: published
date: 2024-01-01T00:00:00Z
---

Already out.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts.map((p) => p.slug)).toEqual(['live']);
  });

  test('include_future_posts config opts back into future-dated and scheduled posts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-include-future-config-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const futureIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(cwd, 'content/posts/embargo.md'),
      `---
title: Embargo
status: scheduled
date: ${futureIso}
---

Secret.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/launch.md'),
      `---
title: Launch
status: published
date: ${futureIso}
---

Post-dated.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/live.md'),
      `---
title: Live
status: published
date: 2024-01-01T00:00:00Z
---

Past.
`,
      'utf8',
    );
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { include_future_posts: true },
    });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts.map((p) => p.slug).sort()).toEqual(['embargo', 'launch', 'live']);
  });

  test('includeFuturePosts option overrides default exclusion', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-include-future-option-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const futureIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(cwd, 'content/posts/embargo.md'),
      `---
title: Embargo
status: scheduled
date: ${futureIso}
---

Secret.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const excluded = await loadContent({ cwd, config });
    expect(excluded.posts).toHaveLength(0);
    const included = await loadContent({ cwd, config, includeFuturePosts: true });
    expect(included.posts.map((p) => p.slug)).toEqual(['embargo']);
  });

  test('include_future_posts does not unmask drafts on its own', async () => {
    // Drafts and future-dated content are independently gated. A scheduled
    // *and* draft post stays hidden unless both opt-ins are flipped, so the
    // looser preview policy can't accidentally promote WIP work.
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-future-not-drafts-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/wip.md'),
      `---
title: WIP
status: draft
date: 2024-01-01T00:00:00Z
---

Not ready.
`,
      'utf8',
    );
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      build: { include_future_posts: true },
    });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts).toHaveLength(0);
  });

  test('excludes drafts by default regardless of date', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-draft-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/wip.md'),
      `---
title: WIP
status: draft
date: 2020-01-01T00:00:00Z
---

Not ready.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts).toHaveLength(0);
  });

  test('includes drafts when includeDrafts is true', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-draft-opt-in-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/wip.md'),
      `---
title: WIP
status: draft
date: 2020-01-01T00:00:00Z
---

Not ready.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/live.md'),
      `---
title: Live
date: 2026-01-01T00:00:00Z
---

Published.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config, includeDrafts: true });
    expect(graph.posts.map((p) => p.slug).sort()).toEqual(['live', 'wip']);
  });

  test('includeDrafts also surfaces draft pages', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-draft-page-'));
    await mkdir(join(cwd, 'content/pages'), { recursive: true });
    await writeFile(
      join(cwd, 'content/pages/wip-page.md'),
      `---
title: WIP page
status: draft
---

Not ready.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const excluded = await loadContent({ cwd, config });
    expect(excluded.pages).toHaveLength(0);
    const included = await loadContent({ cwd, config, includeDrafts: true });
    expect(included.pages.map((p) => p.slug)).toEqual(['wip-page']);
  });

  test('includeDrafts does not unmask scheduled posts whose date is still in the future', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-draft-scheduled-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    const futureIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(cwd, 'content/posts/embargo.md'),
      `---
title: Embargo
status: scheduled
date: ${futureIso}
---

Secret.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config, includeDrafts: true });
    expect(graph.posts).toHaveLength(0);
  });
});

describe('loadContent parallel markdown loading is deterministic', () => {
  // Reading every post body in parallel makes finish order non-deterministic.
  // The graph's `posts` array still has to be sorted by `published_at desc`
  // every run, so the bug we are guarding against is the post body being
  // attached to the wrong slug — which would happen if the parallel results
  // were spliced back in iteration order rather than index order. We exercise
  // both rendering paths (regular + paywalled re-render) across 60 posts so
  // the chunking layer (32-wide) is forced to do at least two batches.
  test('every slug ends up with its own body across many posts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-parallel-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    const POST_COUNT = 60;
    for (let i = 0; i < POST_COUNT; i += 1) {
      const slug = `post-${i.toString().padStart(3, '0')}`;
      // Stagger published_at so the post order is fully determined and we can
      // map graph index -> source slug without ambiguity.
      const date = new Date(2026, 0, 1, 0, 0, i).toISOString();
      await writeFile(
        join(dir, 'content/posts', `${slug}.md`),
        `---\ntitle: "Post ${i}"\ndate: ${date}\n---\n\nBody for ${slug}.\n`,
        'utf8',
      );
    }
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd: dir, config });
    expect(graph.posts).toHaveLength(POST_COUNT);
    for (const post of graph.posts) {
      expect(post.html).toContain(`Body for ${post.slug}.`);
    }
  });

  // #857: posts without a `title:` frontmatter fall back to using the slug
  // as the title (Ghost behaviour), but the loader now warns at build time
  // so contributors notice the synthesised headline.
  test('warns when frontmatter title is missing or empty and uses slug as fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-empty-title-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await writeFile(
      join(dir, 'content/posts/no-title.md'),
      '---\ndate: 2026-01-01\n---\nBody\n',
      'utf8',
    );
    await writeFile(
      join(dir, 'content/posts/blank-title.md'),
      `---\ntitle: ""\ndate: 2026-01-02\n---\nBody\n`,
      'utf8',
    );

    const warnings: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      const s = typeof chunk === 'string' ? chunk : String(chunk);
      // Logger output may contain ANSI color codes and timestamp formatting
      // under Bun's test runner, so detect the warning level token flexibly.
      if (/\bwarn\b/.test(s)) warnings.push(s);
      return true;
    }) as typeof process.stderr.write;
    try {
      const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
      const graph = await loadContent({ cwd: dir, config });
      const missing = graph.posts.find((p) => p.slug === 'no-title');
      const blank = graph.posts.find((p) => p.slug === 'blank-title');
      expect(missing?.title).toBe('no-title');
      expect(blank?.title).toBe('blank-title');
    } finally {
      process.stderr.write = origWrite;
    }
    expect(warnings.some((w) => w.includes('no-title.md') && w.includes('Missing or empty'))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes('blank-title.md'))).toBe(true);
  });

  // #859: filenames whose slug-friendly form would collapse to an empty
  // string (e.g. `_index.md`) are refused at load time. Better than silently
  // shipping an unreachable post under an empty URL.
  test('throws when a filename slugifies to an empty string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-empty-slug-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await writeFile(
      join(dir, 'content/posts/_.md'),
      '---\ntitle: Edge\ndate: 2026-01-01\n---\nbody\n',
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    await expect(loadContent({ cwd: dir, config })).rejects.toThrow(NectarError);
  });

  // #860: a typo'd tag slug in frontmatter (e.g. `tags: [neews]`) used to
  // produce a phantom archive with no warning. The loader now warns once
  // per missing tag/author slug so the operator notices the orphan.
  test('warns once per auto-created tag and author slug missing a backing .md', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-auto-create-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    // Two posts reference the same orphan tag/author — the warn should
    // emit once per slug, not once per reference.
    await writeFile(
      join(dir, 'content/posts/a.md'),
      '---\ntitle: A\ndate: 2026-01-01\ntags: [orphan-tag-unique-860]\nauthors: [orphan-author-unique-860]\n---\nbody\n',
      'utf8',
    );
    await writeFile(
      join(dir, 'content/posts/b.md'),
      '---\ntitle: B\ndate: 2026-01-02\ntags: [orphan-tag-unique-860]\nauthors: [orphan-author-unique-860]\n---\nbody\n',
      'utf8',
    );

    const warnings: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      const s = typeof chunk === 'string' ? chunk : String(chunk);
      // Logger output may contain ANSI color codes and timestamp formatting
      // under Bun's test runner, so detect the warning level token flexibly.
      if (/\bwarn\b/.test(s)) warnings.push(s);
      return true;
    }) as typeof process.stderr.write;
    try {
      const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
      await loadContent({ cwd: dir, config });
    } finally {
      process.stderr.write = origWrite;
    }
    const tagWarns = warnings.filter(
      (w) => w.includes('Auto-creating tag') && w.includes('"orphan-tag-unique-860"'),
    );
    const authorWarns = warnings.filter(
      (w) => w.includes('Auto-creating author') && w.includes('"orphan-author-unique-860"'),
    );
    expect(tagWarns).toHaveLength(1);
    expect(authorWarns).toHaveLength(1);
  });

  test('does not warn for internal hash-prefixed tags (Ghost workflow)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-hash-tag-'));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await writeFile(
      join(dir, 'content/posts/a.md'),
      '---\ntitle: A\ndate: 2026-01-01\ntags: [hash-featured]\n---\nbody\n',
      'utf8',
    );

    const warnings: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      const s = typeof chunk === 'string' ? chunk : String(chunk);
      // Logger output may contain ANSI color codes and timestamp formatting
      // under Bun's test runner, so detect the warning level token flexibly.
      if (/\bwarn\b/.test(s)) warnings.push(s);
      return true;
    }) as typeof process.stderr.write;
    try {
      const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
      const graph = await loadContent({ cwd: dir, config });
      expect(graph.tags.find((t) => t.slug === 'hash-featured')?.visibility).toBe('internal');
    } finally {
      process.stderr.write = origWrite;
    }
    expect(warnings.some((w) => w.includes('Auto-creating tag') && w.includes('hash-'))).toBe(
      false,
    );
  });
});

describe('loadContent email_only frontmatter (#505)', () => {
  // Posts authored with `email_only: true` ship via newsletter delivery only.
  // The loader partitions them out of `posts` / `bySlug.posts` /
  // `postsByTag` / `postsByAuthor` so RSS, sitemap, OG generation, the
  // search index, and the public route plan never see them, and surfaces
  // them via `emailOnlyPosts` for opt-in stub emission downstream.

  test('email_only post is excluded from posts and indices, present in emailOnlyPosts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-emailonly-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/visible.md'),
      `---
title: Visible
date: 2026-01-02T00:00:00Z
tags: [news]
---

Public body.
`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'content/posts/newsletter.md'),
      `---
title: Newsletter Only
date: 2026-01-01T00:00:00Z
email_only: true
tags: [news]
---

Subscribers-only body.
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });

    expect(graph.posts.map((p) => p.slug)).toEqual(['visible']);
    expect(graph.bySlug.posts.has('newsletter')).toBe(false);
    expect(graph.bySlug.posts.has('visible')).toBe(true);
    expect(graph.emailOnlyPosts.map((p) => p.slug)).toEqual(['newsletter']);
    expect(graph.emailOnlyPosts[0]?.email_only).toBe(true);
    // Tag index reflects only the visible post — the email-only post must
    // not contribute to the public tag archive size or order.
    const newsTag = graph.postsByTag.get('news') ?? [];
    expect(newsTag.map((p) => p.slug)).toEqual(['visible']);
  });

  test('email_only post url is rewritten to /email-only/<slug>/', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-emailonly-url-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/issue-1.md'),
      `---
title: Issue 1
date: 2026-01-01T00:00:00Z
email_only: true
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.emailOnlyPosts[0]?.url).toBe('/email-only/issue-1/');
  });

  test('missing email_only defaults to false (regular post, present in posts)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-emailonly-default-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/plain.md'),
      `---
title: Plain
date: 2026-01-01T00:00:00Z
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts[0]?.email_only).toBe(false);
    expect(graph.emailOnlyPosts).toHaveLength(0);
  });

  test('post exposes Ghost-compatible comment and newsletter metadata defaults', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-post-ghost-fields-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/plain.md'),
      `---
title: Plain
date: 2026-01-01T00:00:00Z
email_subject: Weekly Plain
send_email_when_published: true
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];

    expect(post?.comment_id).toBe(post?.id);
    expect(post?.count).toEqual({
      signups: 0,
      clicks: 0,
      comments: 0,
      conversions: 0,
      positive_feedback: 0,
      negative_feedback: 0,
    });
    expect(post?.email_subject).toBe('Weekly Plain');
    expect(post?.send_email_when_published).toBe(true);
  });

  test('post exposes imported Ghost newsletter card metadata and raw frontmatter deck', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-post-ghost-frontmatter-'));
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(
      join(cwd, 'content/posts/newsletter.md'),
      `---
title: Newsletter
date: 2026-01-01T00:00:00Z
frontmatter: "{\\"root\\":{\\"children\\":[{\\"type\\":\\"html\\",\\"html\\":\\"<div>Deck</div>\\"}]}}"
email_card_segments: [{"type":"email-cta","html":"<p>CTA</p>","visibility":{"email":{"memberSegment":"status:free"}}}]
---

body
`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const post = graph.posts[0];

    expect(post?.frontmatter).toBe(
      '{"root":{"children":[{"type":"html","html":"<div>Deck</div>"}]}}',
    );
    expect(post?.email_card_segments).toEqual([
      {
        type: 'email-cta',
        html: '<p>CTA</p>',
        visibility: { email: { memberSegment: 'status:free' } },
      },
    ]);
  });
});
