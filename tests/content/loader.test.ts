import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
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
});
