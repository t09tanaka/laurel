import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importWordPressExport } from '~/wordpress/import.ts';

interface CapturedStderr {
  data: string;
  restore: () => void;
}

function captureStderr(): CapturedStderr {
  const original = process.stderr.write.bind(process.stderr);
  let data = '';
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    data += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  return {
    get data() {
      return data;
    },
    restore: () => {
      process.stderr.write = original;
    },
  } as CapturedStderr;
}

interface WxrPostFixture {
  title: string;
  slug: string;
  status?: string;
  type?: string;
  html?: string;
  excerpt?: string;
  creator?: string;
  date?: string;
  modified?: string;
  tags?: Array<{ slug: string; name: string }>;
  categories?: Array<{ slug: string; name: string }>;
}

interface WxrFixtureOptions {
  posts?: WxrPostFixture[];
  authors?: Array<{ login: string; display: string; email?: string }>;
  tags?: Array<{ slug: string; name: string; description?: string }>;
  categories?: Array<{ slug: string; name: string }>;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildWxr(opts: WxrFixtureOptions): string {
  const authors = opts.authors ?? [];
  const tags = opts.tags ?? [];
  const cats = opts.categories ?? [];
  const items = (opts.posts ?? []).map((p, i) => {
    const cats = (p.categories ?? [])
      .map(
        (c) =>
          `      <category domain="category" nicename="${escapeXml(c.slug)}"><![CDATA[${c.name}]]></category>`,
      )
      .join('\n');
    const tagsXml = (p.tags ?? [])
      .map(
        (t) =>
          `      <category domain="post_tag" nicename="${escapeXml(t.slug)}"><![CDATA[${t.name}]]></category>`,
      )
      .join('\n');
    return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>https://example.com/${p.slug}</link>
      <pubDate>Mon, 15 Jan 2026 09:30:00 +0000</pubDate>
      <dc:creator><![CDATA[${p.creator ?? 'admin'}]]></dc:creator>
      <guid isPermaLink="false">https://example.com/?p=${i + 100}</guid>
      <description></description>
      <content:encoded><![CDATA[${p.html ?? `<p>${p.title}</p>`}]]></content:encoded>
      <excerpt:encoded><![CDATA[${p.excerpt ?? ''}]]></excerpt:encoded>
      <wp:post_id>${i + 100}</wp:post_id>
      <wp:post_date>${p.date ?? '2026-01-15 09:30:00'}</wp:post_date>
      <wp:post_date_gmt>${p.date ?? '2026-01-15 09:30:00'}</wp:post_date_gmt>
      <wp:post_modified>${p.modified ?? p.date ?? '2026-01-15 09:30:00'}</wp:post_modified>
      <wp:post_modified_gmt>${p.modified ?? p.date ?? '2026-01-15 09:30:00'}</wp:post_modified_gmt>
      <wp:status>${p.status ?? 'publish'}</wp:status>
      <wp:post_name>${p.slug}</wp:post_name>
      <wp:post_type>${p.type ?? 'post'}</wp:post_type>
${cats}
${tagsXml}
    </item>`;
  });

  const authorsXml = authors.map(
    (a) => `    <wp:author>
      <wp:author_login><![CDATA[${a.login}]]></wp:author_login>
      <wp:author_email><![CDATA[${a.email ?? ''}]]></wp:author_email>
      <wp:author_display_name><![CDATA[${a.display}]]></wp:author_display_name>
    </wp:author>`,
  );

  const tagsXml = tags.map(
    (t) => `    <wp:tag>
      <wp:term_id>1</wp:term_id>
      <wp:tag_slug><![CDATA[${t.slug}]]></wp:tag_slug>
      <wp:tag_name><![CDATA[${t.name}]]></wp:tag_name>
      <wp:tag_description><![CDATA[${t.description ?? ''}]]></wp:tag_description>
    </wp:tag>`,
  );

  const catsXml = cats.map(
    (c) => `    <wp:category>
      <wp:term_id>1</wp:term_id>
      <wp:category_nicename><![CDATA[${c.slug}]]></wp:category_nicename>
      <wp:cat_name><![CDATA[${c.name}]]></wp:cat_name>
    </wp:category>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <description>Example WP blog</description>
${authorsXml.join('\n')}
${catsXml.join('\n')}
${tagsXml.join('\n')}
${items.join('\n')}
  </channel>
</rss>`;
}

describe('importWordPressExport — happy path', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-wp-')));
    exportFile = join(cwd, 'export.xml');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('writes a published post to content/posts/<slug>.md with frontmatter and body', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          {
            title: 'Hello WordPress',
            slug: 'hello-wp',
            html: '<p>This is the body.</p>',
            tags: [{ slug: 'greetings', name: 'Greetings' }],
            categories: [{ slug: 'news', name: 'News' }],
          },
        ],
        authors: [{ login: 'admin', display: 'Site Admin', email: 'admin@example.com' }],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(summary.pages).toBe(0);
    expect(summary.authors).toBe(1);
    expect(summary.bodiesEmpty).toBe(0);
    expect(summary.dryRun).toBe(false);

    const md = await readFile(join(cwd, 'content/posts/hello-wp.md'), 'utf8');
    expect(md).toContain('slug: "hello-wp"');
    expect(md).toContain('title: "Hello WordPress"');
    expect(md).toContain('status: "published"');
    expect(md).toContain('tags: ["greetings"]');
    expect(md).toContain('categories: ["news"]');
    expect(md).toContain('authors: ["admin"]');
    expect(md).toContain('This is the body.');

    const author = await readFile(join(cwd, 'content/authors/admin.md'), 'utf8');
    expect(author).toContain('slug: "admin"');
    expect(author).toContain('name: "Site Admin"');
    expect(author).toContain('email: "admin@example.com"');
  });

  test('separates pages from posts via wp:post_type', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          { title: 'About', slug: 'about', type: 'page' },
          { title: 'A Post', slug: 'a-post', type: 'post' },
        ],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(summary.pages).toBe(1);
    await expect(readFile(join(cwd, 'content/pages/about.md'), 'utf8')).resolves.toContain(
      'slug: "about"',
    );
    await expect(readFile(join(cwd, 'content/posts/a-post.md'), 'utf8')).resolves.toContain(
      'slug: "a-post"',
    );
  });

  test('imports drafts but counts them separately', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          { title: 'Pub', slug: 'pub', status: 'publish' },
          { title: 'Draft', slug: 'draft-one', status: 'draft' },
        ],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(2);
    expect(summary.drafts).toBe(1);
    const draftMd = await readFile(join(cwd, 'content/posts/draft-one.md'), 'utf8');
    expect(draftMd).toContain('status: "draft"');
  });

  test('filters out attachment, nav_menu_item, and revision items', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          { title: 'Keep', slug: 'keep', type: 'post' },
          { title: 'IMG', slug: 'img', type: 'attachment' },
          { title: 'Menu', slug: 'menu', type: 'nav_menu_item' },
          { title: 'Rev', slug: 'rev', type: 'revision' },
        ],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(summary.typeFiltered).toBe(3);
  });

  test('filters out non-publish/draft statuses (e.g. inherit, trash, future)', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          { title: 'Keep', slug: 'keep', status: 'publish' },
          { title: 'Trash', slug: 'trash', status: 'trash' },
          { title: 'Inherit', slug: 'inherit-one', status: 'inherit' },
          { title: 'Future', slug: 'future-one', status: 'future' },
        ],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(summary.statusFiltered).toBe(3);
  });

  test('writes only tags that carry a name or description', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [{ title: 'Hi', slug: 'hi' }],
        tags: [
          { slug: 'with-desc', name: 'With Desc', description: 'a description' },
          { slug: 'name-only', name: 'Name Only' },
        ],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.tags).toBe(2);
    const tag = await readFile(join(cwd, 'content/tags/with-desc.md'), 'utf8');
    expect(tag).toContain('name: "With Desc"');
    expect(tag).toContain('description: "a description"');
  });

  test('default conflict policy is skip and preserves existing files', async () => {
    await writeFile(exportFile, buildWxr({ posts: [{ title: 'Hello', slug: 'hello' }] }));
    const dest = join(cwd, 'content/posts/hello.md');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, 'content/posts'), { recursive: true });
    await writeFile(dest, 'EXISTING');

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
    expect(captured.data).toContain(`Skipped (already exists): ${dest}`);
  });

  test('dry-run does not write files but counters reflect what would land', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          { title: 'Hello', slug: 'hello' },
          { title: 'Draft', slug: 'draft-one', status: 'draft' },
          { title: 'IMG', slug: 'img', type: 'attachment' },
        ],
      }),
    );

    const summary = await importWordPressExport({ cwd, file: exportFile, dryRun: true });

    expect(summary.posts).toBe(2);
    expect(summary.drafts).toBe(1);
    expect(summary.typeFiltered).toBe(1);
    expect(summary.dryRun).toBe(true);
    await expect(readFile(join(cwd, 'content/posts/hello.md'), 'utf8')).rejects.toThrow();
  });

  test('counts empty bodies but still writes the post with frontmatter', async () => {
    await writeFile(exportFile, buildWxr({ posts: [{ title: 'Empty', slug: 'empty', html: '' }] }));

    const summary = await importWordPressExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(summary.bodiesEmpty).toBe(1);
  });

  test('normalizes WP local date to ISO with Z suffix', async () => {
    await writeFile(
      exportFile,
      buildWxr({
        posts: [
          {
            title: 'Dated',
            slug: 'dated',
            date: '2026-02-03 04:05:06',
            modified: '2026-03-04 05:06:07',
          },
        ],
      }),
    );

    await importWordPressExport({ cwd, file: exportFile });
    const md = await readFile(join(cwd, 'content/posts/dated.md'), 'utf8');
    expect(md).toContain('date: "2026-02-03T04:05:06Z"');
    expect(md).toContain('updated_at: "2026-03-04T05:06:07Z"');
  });

  test('safeSlug strips path traversal characters so writes stay under content/', async () => {
    await writeFile(exportFile, buildWxr({ posts: [{ title: 'Safe', slug: '../../etc/passwd' }] }));

    const summary = await importWordPressExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);
    // slugify(strict) collapses `../../etc/passwd` down to a single safe segment
    // — the exact result depends on slugify's rules, but it must live under
    // content/posts and not contain path separators.
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(cwd, 'content/posts'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-z0-9-]+\.md$/);
  });
});

describe('importWordPressExport — error handling', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-wp-err-')));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('rejects when the file is missing', async () => {
    await expect(importWordPressExport({ cwd, file: join(cwd, 'nope.xml') })).rejects.toThrow(
      /Cannot read WordPress export/,
    );
  });

  test('rejects when the XML lacks an <rss><channel>', async () => {
    const file = join(cwd, 'bad.xml');
    await writeFile(file, '<?xml version="1.0"?><not-rss/>');
    await expect(importWordPressExport({ cwd, file })).rejects.toThrow(/Invalid WXR export/);
  });
});
