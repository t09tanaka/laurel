import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';

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
});
