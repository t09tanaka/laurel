import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRoutesYaml } from '~/build/routes-yaml.ts';
import { configSchema } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';
import { NectarError } from '~/util/errors.ts';

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-content-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
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
  return dir;
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
    expect(graph.tags.find((t) => t.slug === 'news')?.count.posts).toBe(1);
    expect(graph.posts[1]?.html).toContain('Welcome to Nectar.');
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

  test('site.members_* / recommendations_enabled default to false when no portal is configured', async () => {
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
    expect(graph.site.recommendations_enabled).toBe(false);
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
    expect(graph.tags.find((t) => t.slug === 'news')?.url).toBe('https://x.test/category/news/');
    expect(graph.authors.find((a) => a.slug === 'casper')?.url).toBe(
      'https://x.test/writer/casper/',
    );
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
    expect(graph.authors.find((a) => a.slug === 'casper')?.url).toBe(
      'https://x.test/author/casper/',
    );
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

  test('includes scheduled posts whose published_at has already passed', async () => {
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
    expect(graph.posts.map((p) => p.slug)).toEqual(['late']);
  });

  test('always excludes drafts regardless of date', async () => {
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
});
