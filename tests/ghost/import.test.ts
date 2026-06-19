import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import TOML from '@iarna/toml';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { importGhostExport } from '~/ghost/import.ts';
import { ensureDir } from '~/util/fs.ts';

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

function makeExport(
  posts: Array<{
    id?: string;
    slug: string;
    title: string;
    html?: string;
    uuid?: string;
    created_at?: string;
    type?: 'post' | 'page';
  }>,
): string {
  return JSON.stringify({
    db: [
      {
        data: {
          posts: posts.map((p, i) => ({
            id: p.id ?? `post-${i}`,
            uuid: p.uuid,
            title: p.title,
            slug: p.slug,
            html: p.html ?? `<p>${p.title}</p>`,
            status: 'published',
            type: p.type ?? 'post',
            created_at: p.created_at,
          })),
        },
      },
    ],
  });
}

function jpegWithExif(payload = 'SECRET_GPS'): Buffer {
  const exif = Buffer.from(`Exif\0\0${payload}`, 'binary');
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]),
    exif,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]),
  ]);
}

function singleImagePostExport(url: string): string {
  return JSON.stringify({
    db: [
      {
        data: {
          posts: [
            {
              id: 'p1',
              title: 'Image',
              slug: 'image',
              html: `<p><img src="${url}" alt="x" /></p>`,
              feature_image: url,
              status: 'published',
              type: 'post',
            },
          ],
        },
      },
    ],
  });
}

describe('importGhostExport — --on-conflict policy', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('defaults to skip and preserves existing post files', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.overwritten).toBe(0);
    expect(summary.renamed).toBe(0);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
    expect(captured.data).toContain(`Skipped (already exists): ${dest}`);
  });

  test('overwrite replaces existing file and reports the path', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    expect(summary.overwritten).toBe(1);
    expect(summary.skipped).toBe(0);
    const after = await readFile(dest, 'utf8');
    expect(after).not.toBe('EXISTING');
    expect(after).toContain('slug: "hello"');
    expect(captured.data).toContain(`Overwrote: ${dest}`);
  });

  test('preserves Ghost post identifiers in frontmatter', async () => {
    const id = '64d3f8e1a51f2b7c9d0e1234';
    const uuid = '11111111-2222-5333-8444-555555555555';
    const created_at = '2024-01-02T03:04:05.000Z';
    await writeFile(
      exportFile,
      makeExport([{ id, slug: 'hello', title: 'Hello', uuid, created_at }]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    const out = await readFile(join(cwd, 'content/posts/hello.md'), 'utf8');

    expect(summary.posts).toBe(1);
    expect(out).toContain(`id: "${id}"`);
    expect(out).toContain(`uuid: "${uuid}"`);
    expect(out).toContain(`created_at: "${created_at}"`);
  });

  test('preserves Ghost page identifiers in frontmatter', async () => {
    const id = '64d3f8e1a51f2b7c9d0e5678';
    const uuid = '22222222-3333-5444-8555-666666666666';
    const created_at = '2024-02-03T04:05:06.000Z';
    await writeFile(
      exportFile,
      makeExport([{ id, slug: 'about', title: 'About', uuid, created_at, type: 'page' }]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    const out = await readFile(join(cwd, 'content/pages/about.md'), 'utf8');

    expect(summary.pages).toBe(1);
    expect(out).toContain(`id: "${id}"`);
    expect(out).toContain(`uuid: "${uuid}"`);
    expect(out).toContain(`created_at: "${created_at}"`);
  });

  test('writes post tier relationships into frontmatter', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'post-1',
                  title: 'Premium Post',
                  slug: 'premium-post',
                  html: '<p>Secret</p>',
                  status: 'published',
                  type: 'post',
                  visibility: 'tiers',
                },
              ],
              tiers: [{ id: 'tier-1', slug: 'premium', name: 'Premium' }],
              posts_tiers: [{ post_id: 'post-1', tier_id: 'tier-1', sort_order: 0 }],
            },
          },
        ],
      }),
    );

    await importGhostExport({ cwd, file: exportFile });

    const out = await readFile(join(cwd, 'content/posts/premium-post.md'), 'utf8');
    expect(out).toContain('visibility: "tiers"');
    expect(out).toContain('tiers: ["premium"]');
  });

  test('rename writes to a numbered filename and leaves the original alone', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'rename' });

    expect(summary.posts).toBe(1);
    expect(summary.renamed).toBe(1);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
    const renamed = join(cwd, 'content/posts/hello-2.md');
    expect(await readFile(renamed, 'utf8')).toContain('slug: "hello"');
    expect(captured.data).toContain(`Renamed (conflict with ${dest}): ${renamed}`);
  });

  test('rename picks the next free numeric suffix when -2 is also taken', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    await ensureDir(join(cwd, 'content/posts'));
    const original = join(cwd, 'content/posts/hello.md');
    const blocker = join(cwd, 'content/posts/hello-2.md');
    await writeFile(original, 'A');
    await writeFile(blocker, 'B');

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'rename' });

    expect(summary.renamed).toBe(1);
    expect(await readFile(original, 'utf8')).toBe('A');
    expect(await readFile(blocker, 'utf8')).toBe('B');
    const fresh = join(cwd, 'content/posts/hello-3.md');
    expect(await readFile(fresh, 'utf8')).toContain('slug: "hello"');
  });

  test('writes new files without touching stderr when there is no conflict', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'fresh', title: 'Fresh' }]));

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'skip' });

    expect(summary.posts).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(captured.data).toBe('');
    const dest = join(cwd, 'content/posts/fresh.md');
    expect(await readFile(dest, 'utf8')).toContain('slug: "fresh"');
  });
});

describe('importGhostExport — intra-export slug collisions (#1138)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-coll-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('refuses the second post when two posts share a slug, regardless of onConflict=overwrite', async () => {
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'duplicate', title: 'First', html: '<p>FIRST</p>' },
        { slug: 'duplicate', title: 'Second (tampered)', html: '<p>SECOND</p>' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
    });

    // Only the first occurrence is written. The second is refused as an
    // intra-export collision — silently overwriting a freshly-written file
    // from the same export would hide a tampered export.
    expect(summary.posts).toBe(1);
    expect(summary.slugCollisions).toBe(1);
    expect(summary.overwritten).toBe(0);
    const dest = join(cwd, 'content/posts/duplicate.md');
    const body = await readFile(dest, 'utf8');
    expect(body).toContain('title: "First"');
    expect(body).not.toContain('SECOND');
    expect(captured.data).toContain('Slug collision within Ghost export');
    expect(captured.data).toContain(dest);
  });

  test('refuses the second post under onConflict=skip and reports the collision distinctly', async () => {
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'twin', title: 'First' },
        { slug: 'twin', title: 'Second' },
      ]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'skip' });

    expect(summary.posts).toBe(1);
    expect(summary.slugCollisions).toBe(1);
    // The collision counter is separate from `skipped`, which is reserved for
    // pre-existing files (re-import case).
    expect(summary.skipped).toBe(0);
  });

  test('rename policy avoids the collision by writing the second post to a numbered file', async () => {
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'rename-me', title: 'First' },
        { slug: 'rename-me', title: 'Second' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'rename',
    });

    // Rename was already explicit opt-in for keeping both, so we honor it.
    // No collision is counted because no overwrite was attempted.
    expect(summary.posts).toBe(2);
    expect(summary.renamed).toBe(1);
    expect(summary.slugCollisions).toBe(0);
    const original = join(cwd, 'content/posts/rename-me.md');
    const numbered = join(cwd, 'content/posts/rename-me-2.md');
    expect(await readFile(original, 'utf8')).toContain('title: "First"');
    expect(await readFile(numbered, 'utf8')).toContain('title: "Second"');
  });

  test('dry-run still detects intra-export collisions without writing', async () => {
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'preview', title: 'First' },
        { slug: 'preview', title: 'Second' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
      dryRun: true,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.slugCollisions).toBe(1);
    expect(summary.posts).toBe(1);
    await expect(access(join(cwd, 'content/posts/preview.md'))).rejects.toThrow();
  });

  test('refuses a page when a post already claimed the same public slug', async () => {
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'shared', title: 'Post', html: '<p>POST</p>' },
        { slug: 'shared', title: 'Page', html: '<p>PAGE</p>', type: 'page' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
    });

    expect(summary.posts).toBe(1);
    expect(summary.pages).toBe(0);
    expect(summary.slugCollisions).toBe(1);
    expect(summary.overwritten).toBe(0);
    expect(await readFile(join(cwd, 'content/posts/shared.md'), 'utf8')).toContain('title: "Post"');
    await expect(access(join(cwd, 'content/pages/shared.md'))).rejects.toThrow();
    expect(captured.data).toContain('Post/page slug collision within Ghost export');
    expect(captured.data).toContain('post "shared"');
    expect(captured.data).toContain('page "shared"');
  });

  test('rename policy gives a post/page slug collision a numbered public slug', async () => {
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'shared', title: 'Post', html: '<p>POST</p>' },
        { slug: 'shared', title: 'Page', html: '<p>PAGE</p>', type: 'page' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'rename',
    });

    expect(summary.posts).toBe(1);
    expect(summary.pages).toBe(1);
    expect(summary.renamed).toBe(1);
    expect(summary.slugCollisions).toBe(0);
    expect(await readFile(join(cwd, 'content/posts/shared.md'), 'utf8')).toContain(
      'slug: "shared"',
    );
    const page = await readFile(join(cwd, 'content/pages/shared-2.md'), 'utf8');
    expect(page).toContain('title: "Page"');
    expect(page).toContain('slug: "shared-2"');
  });

  test('collision is independent across kinds (post slug == tag slug does not collide)', async () => {
    // Posts and tags write under different base directories, so sharing a slug
    // is safe and must not be flagged as a collision.
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'shared',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'shared',
                  name: 'Shared',
                  description: 'a tag named the same as the post slug',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.slugCollisions).toBe(0);
  });

  test('preserves Ghost tag theme fields in tag frontmatter', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              tags: [
                {
                  id: 't1',
                  slug: 'ruby',
                  name: 'Ruby',
                  accent_color: '#b6174b',
                  og_title: 'Ruby OG',
                  og_description: 'Ruby OG description',
                  og_image: 'https://cdn.example.com/ruby-og.jpg',
                  twitter_title: 'Ruby Twitter',
                  twitter_description: 'Ruby Twitter description',
                  twitter_image: 'https://cdn.example.com/ruby-twitter.jpg',
                  codeinjection_head: '<meta name="tag-head" content="ruby">',
                  codeinjection_foot: '<script>window.__tag = "ruby"</script>',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, keepCodeInjection: true });

    expect(summary.tags).toBe(1);
    const tagMd = await readFile(join(cwd, 'content/tags/ruby.md'), 'utf8');
    expect(tagMd).toContain('accent_color: "#b6174b"');
    expect(tagMd).toContain('og_title: "Ruby OG"');
    expect(tagMd).toContain('og_description: "Ruby OG description"');
    expect(tagMd).toContain('og_image: "https://cdn.example.com/ruby-og.jpg"');
    expect(tagMd).toContain('twitter_title: "Ruby Twitter"');
    expect(tagMd).toContain('twitter_description: "Ruby Twitter description"');
    expect(tagMd).toContain('twitter_image: "https://cdn.example.com/ruby-twitter.jpg"');
    expect(tagMd).toContain('codeinjection_head: "<meta name=\\"tag-head\\" content=\\"ruby\\">"');
    expect(tagMd).toContain('codeinjection_foot: "<script>window.__tag = \\"ruby\\"</script>"');
  });

  test('preserves Ghost author archive SEO fields in author frontmatter', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              users: [
                {
                  id: 'u1',
                  slug: 'jane',
                  name: 'Jane',
                  accent_color: '#7851a9',
                  og_title: 'Jane OG',
                  og_description: 'Jane OG description',
                  og_image: 'https://cdn.example.com/jane-og.jpg',
                  twitter_title: 'Jane Twitter',
                  twitter_description: 'Jane Twitter description',
                  twitter_image: 'https://cdn.example.com/jane-twitter.jpg',
                  codeinjection_head: '<meta name="author-head" content="jane">',
                  codeinjection_foot: '<script>window.__author = "jane"</script>',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, keepCodeInjection: true });

    expect(summary.authors).toBe(1);
    const authorMd = await readFile(join(cwd, 'content/authors/jane.md'), 'utf8');
    expect(authorMd).toContain('accent_color: "#7851a9"');
    expect(authorMd).toContain('og_title: "Jane OG"');
    expect(authorMd).toContain('og_description: "Jane OG description"');
    expect(authorMd).toContain('og_image: "https://cdn.example.com/jane-og.jpg"');
    expect(authorMd).toContain('twitter_title: "Jane Twitter"');
    expect(authorMd).toContain('twitter_description: "Jane Twitter description"');
    expect(authorMd).toContain('twitter_image: "https://cdn.example.com/jane-twitter.jpg"');
    expect(authorMd).toContain(
      'codeinjection_head: "<meta name=\\"author-head\\" content=\\"jane\\">"',
    );
    expect(authorMd).toContain(
      'codeinjection_foot: "<script>window.__author = \\"jane\\"</script>"',
    );
  });
});

describe('importGhostExport — Ghost post metadata compatibility', () => {
  test('preserves page title/feature-image visibility and post email metadata', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-meta-')));
    try {
      const exportFile = join(cwd, 'export.json');
      await writeFile(
        exportFile,
        JSON.stringify({
          db: [
            {
              data: {
                posts: [
                  {
                    id: 'page-1',
                    title: 'About',
                    slug: 'about',
                    html: '<p>About</p>',
                    status: 'published',
                    type: 'page',
                    show_title_and_feature_image: false,
                  },
                  {
                    id: 'post-1',
                    title: 'Newsletter',
                    slug: 'newsletter',
                    html: '<p>News</p>',
                    status: 'published',
                    type: 'post',
                    email_only: 1,
                  },
                ],
                posts_meta: [
                  {
                    post_id: 'post-1',
                    email_subject: 'Custom subject',
                    send_email_when_published: 1,
                    signups: 3,
                    clicks: '4',
                    comments: 2,
                  },
                ],
              },
            },
          ],
        }),
      );

      await importGhostExport({ cwd, file: exportFile });

      const page = await readFile(join(cwd, 'content/pages/about.md'), 'utf8');
      const post = await readFile(join(cwd, 'content/posts/newsletter.md'), 'utf8');
      expect(page).toContain('show_title_and_feature_image: false');
      expect(post).toContain('email_only: true');
      expect(post).toContain('email_subject: "Custom subject"');
      expect(post).toContain('send_email_when_published: true');
      expect(post).toContain('count: {"signups":3,"clicks":4,"comments":2}');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('importGhostExport — --keep-html (#808)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-html-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('preserves rendered Ghost HTML as a .md.html sibling when requested', async () => {
    await writeFile(
      exportFile,
      makeExport([
        {
          slug: 'hello',
          title: 'Hello',
          html: '<p>Hello <strong>HTML</strong></p><figure class="kg-card">card</figure>',
        },
      ]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, keepHtml: true });

    const markdownPath = join(cwd, 'content/posts/hello.md');
    const htmlPath = join(cwd, 'content/posts/hello.md.html');
    expect(summary.posts).toBe(1);
    expect(summary.htmlPreserved).toBe(1);
    expect(summary.plannedPaths).toContain(markdownPath);
    expect(summary.plannedPaths).toContain(htmlPath);
    expect(await readFile(markdownPath, 'utf8')).toContain('**HTML**');
    expect(await readFile(htmlPath, 'utf8')).toBe(
      '<p>Hello <strong>HTML</strong></p><figure class="kg-card">card</figure>',
    );
  });

  test('dry-run plans the .md.html sibling without writing it', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'preview', title: 'Preview' }]));

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      keepHtml: true,
      dryRun: true,
    });

    const htmlPath = join(cwd, 'content/posts/preview.md.html');
    expect(summary.dryRun).toBe(true);
    expect(summary.htmlPreserved).toBe(1);
    expect(summary.plannedPaths).toContain(htmlPath);
    await expect(access(htmlPath)).rejects.toThrow();
  });

  test('default import does not write rendered HTML siblings', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'plain', title: 'Plain' }]));

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.htmlPreserved).toBe(0);
    await expect(access(join(cwd, 'content/posts/plain.md.html'))).rejects.toThrow();
  });
});

describe('importGhostExport — reusable Ghost HTML cards', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-components-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('extracts repeated Ghost HTML cards into a reusable component', async () => {
    const bannerHtml =
      '<div class="kg-card kg-html-card"><figure><a href="https://esimdb.com/ja" target="_blank"><img src="https://esimdb.com/images/esimdb-banner-ja-v3.jpg" alt="eSIMDB banner" /></a><figcaption style="text-align:center;font-size:0.8em">eSIMDB</figcaption></figure></div>';
    await writeFile(
      exportFile,
      makeExport([
        {
          slug: 'first',
          title: 'First',
          html: `<p>Before</p>${bannerHtml}<p>After</p>`,
        },
        {
          slug: 'second',
          title: 'Second',
          html: `<p>Intro</p>${bannerHtml}`,
        },
      ]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    const first = await readFile(join(cwd, 'content/posts/first.md'), 'utf8');
    const second = await readFile(join(cwd, 'content/posts/second.md'), 'utf8');
    const shortcode = first.match(/\{(ghost-html-card-[a-f0-9]+)\}/)?.[1];
    expect(shortcode).toBeDefined();
    expect(first).toContain(`{${shortcode}}`);
    expect(second).toContain(`{${shortcode}}`);
    expect(first).not.toContain('<div class="kg-card kg-html-card">');
    expect(second).not.toContain('<div class="kg-card kg-html-card">');

    const componentPath = join(cwd, `content/components/${shortcode}.md`);
    const component = await readFile(componentPath, 'utf8');
    expect(component).toContain(`slug: "${shortcode}"`);
    expect(component).toContain('```html');
    expect(component).toContain('<div class="kg-card kg-html-card">');
    expect(component).toContain('https://esimdb.com/images/esimdb-banner-ja-v3.jpg');
    expect(summary.plannedPaths).toContain(componentPath);
    expect(summary.plannedPaths.filter((p) => p === componentPath)).toHaveLength(1);
  });

  test('leaves one-off Ghost HTML cards inline to avoid component clutter', async () => {
    const uniqueHtml =
      '<div class="kg-card kg-html-card"><table><tbody><tr><td>One-off</td></tr></tbody></table></div>';
    await writeFile(
      exportFile,
      makeExport([
        {
          slug: 'unique',
          title: 'Unique',
          html: `<p>Before</p>${uniqueHtml}`,
        },
      ]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    const post = await readFile(join(cwd, 'content/posts/unique.md'), 'utf8');
    expect(post).toContain('<div class="kg-card kg-html-card">');
    expect(post).not.toContain('{ghost-html-card-');
    expect(summary.plannedPaths.some((p) => p.includes('/components/'))).toBe(false);
  });
});

describe('importGhostExport — slug sanitization (#160)', () => {
  let cwd: string;
  let outside: string;
  let exportFile: string;

  beforeEach(async () => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-sec-')));
    cwd = join(tmp, 'project');
    outside = join(tmp, 'outside');
    await ensureDir(cwd);
    await ensureDir(outside);
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test('post slug `../../escape` is re-slugified and stays under content/posts', async () => {
    const escapeTarget = join(outside, 'escape.md');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Bad',
                  slug: '../../outside/escape',
                  html: '<p>Bad</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    await expect(access(escapeTarget)).rejects.toThrow();
    const postsDir = join(cwd, 'content/posts');
    const entries = await readdir(postsDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/\.md$/);
    expect(entries[0]).not.toContain('..');
    expect(entries[0]).not.toContain('/');
  });

  test('post with absolute-path slug stays under content/posts', async () => {
    const absTarget = join(outside, 'pwned.md');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Title-Fallback',
                  slug: '/etc/pwned',
                  html: '<p>x</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    await expect(access(absTarget)).rejects.toThrow();
    const entries = await readdir(join(cwd, 'content/posts'));
    expect(entries.length).toBe(1);
    expect(entries[0]).not.toContain('/');
  });

  test('tag slug `../tagjacked` is re-slugified and stays under content/tags', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              tags: [
                {
                  id: 't1',
                  slug: '../../outside/tagjacked',
                  name: 'Bad Tag',
                  description: 'has description so it gets written',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.tags).toBe(1);
    await expect(access(join(outside, 'tagjacked.md'))).rejects.toThrow();
    const entries = await readdir(join(cwd, 'content/tags'));
    expect(entries.length).toBe(1);
    expect(entries[0]).not.toContain('..');
    expect(entries[0]).not.toContain('/');
  });

  test('author slug `../authorjacked` is re-slugified and stays under content/authors', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              users: [
                {
                  id: 'u1',
                  slug: '../../outside/authorjacked',
                  name: 'Bad Author',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.authors).toBe(1);
    await expect(access(join(outside, 'authorjacked.md'))).rejects.toThrow();
    const entries = await readdir(join(cwd, 'content/authors'));
    expect(entries.length).toBe(1);
    expect(entries[0]).not.toContain('..');
    expect(entries[0]).not.toContain('/');
  });

  test('post slug that becomes empty after sanitization falls back to title', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Recoverable Title',
                  slug: '../..',
                  html: '<p>Body</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(1);
    const entries = await readdir(join(cwd, 'content/posts'));
    expect(entries).toEqual(['recoverable-title.md']);
  });

  test('post with no recoverable slug or title is skipped', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: '../..',
                  slug: '...',
                  html: '<p>Body</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.posts).toBe(0);
    await expect(access(join(cwd, 'content/posts'))).rejects.toThrow();
  });
});

describe('importGhostExport — slug postcondition /^[a-z0-9-]+$/ (#115)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-sluggate-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('every written post/tag/author filename matches /^[a-z0-9-]+\\.md$/', async () => {
    const nastySlugs = [
      '../../etc/passwd',
      '/etc/pwned',
      'A/B/C',
      '..\\..\\windows\\system32',
      'foo bar',
      'résumé café',
      '日本語スラッグ',
      'foo.bar.baz',
      '%2e%2e%2fescape',
      'mixed-Case-123',
      '   trim-me   ',
    ];
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: nastySlugs.map((slug, i) => ({
                id: `p-${i}`,
                title: `Fallback Title ${i}`,
                slug,
                html: `<p>${i}</p>`,
                status: 'published',
                type: 'post',
              })),
              tags: nastySlugs.map((slug, i) => ({
                id: `t-${i}`,
                slug,
                name: `Tag ${i}`,
                description: 'forces a write',
              })),
              users: nastySlugs.map((slug, i) => ({
                id: `u-${i}`,
                slug,
                name: `Author ${i}`,
              })),
            },
          },
        ],
      }),
    );

    await importGhostExport({ cwd, file: exportFile, onConflict: 'rename' });

    const postcondition = /^[a-z0-9][a-z0-9-]*\.md$/;
    for (const sub of ['content/posts', 'content/tags', 'content/authors']) {
      const dir = join(cwd, sub);
      const entries = await readdir(dir);
      expect(entries.length).toBeGreaterThan(0);
      for (const name of entries) {
        expect(name).toMatch(postcondition);
        expect(name).not.toContain('/');
        expect(name).not.toContain('\\');
        expect(name).not.toContain('..');
      }
    }
  });
});

describe('importGhostExport — folder input + asset copy (#73)', () => {
  let exportDir: string;

  beforeEach(async () => {
    exportDir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-assets-')));
  });

  afterEach(async () => {
    await rm(exportDir, { recursive: true, force: true });
  });

  async function writeJsonNamed(name: string): Promise<string> {
    const file = join(exportDir, name);
    await writeFile(
      file,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p><img src="/content/images/2024/01/pic.jpg" alt="pic"></p>',
                  feature_image: '/content/images/2024/01/cover.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    return file;
  }

  test('folder input finds the .json and copies content/images, content/files, content/media', async () => {
    await writeJsonNamed('my-blog.ghost.2024-01-01.json');

    await ensureDir(join(exportDir, 'content/images/2024/01'));
    await writeFile(join(exportDir, 'content/images/2024/01/cover.jpg'), 'COVER');
    await writeFile(join(exportDir, 'content/images/2024/01/pic.jpg'), 'PIC');
    await ensureDir(join(exportDir, 'content/files'));
    await writeFile(join(exportDir, 'content/files/handout.pdf'), 'PDF');
    await ensureDir(join(exportDir, 'content/media/clip'));
    await writeFile(join(exportDir, 'content/media/clip/intro.mp4'), 'MP4');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(4);

      expect(await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8')).toBe('COVER');
      expect(await readFile(join(cwd, 'content/images/2024/01/pic.jpg'), 'utf8')).toBe('PIC');
      expect(await readFile(join(cwd, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
      expect(await readFile(join(cwd, 'content/media/clip/intro.mp4'), 'utf8')).toBe('MP4');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('folder asset copy sanitizes SVG and strips JPEG EXIF metadata', async () => {
    await writeJsonNamed('my-blog.ghost.2024-01-01.json');

    await ensureDir(join(exportDir, 'content/images/2024/01'));
    await writeFile(
      join(exportDir, 'content/images/2024/01/unsafe.svg'),
      [
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
        '<script>alert(1)</script>',
        '<a href="javascript:alert(2)" xlink:href="javascript:alert(3)">x</a>',
        '<circle onclick="alert(4)" cx="5" cy="5" r="5" />',
        '</svg>',
      ].join(''),
    );
    await writeFile(join(exportDir, 'content/images/2024/01/photo.jpg'), jpegWithExif());

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.assetsCopied).toBe(2);

      const svg = await readFile(join(cwd, 'content/images/2024/01/unsafe.svg'), 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('onload=');
      expect(svg).not.toContain('onclick=');
      expect(svg).not.toContain('javascript:');

      const jpg = await readFile(join(cwd, 'content/images/2024/01/photo.jpg'));
      expect(jpg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(jpg.includes(Buffer.from('Exif\0\0', 'binary'))).toBe(false);
      expect(jpg.includes(Buffer.from('SECRET_GPS'))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('folder input without content/ subdir but with images/ at top level still works', async () => {
    await writeJsonNamed('export.json');

    await ensureDir(join(exportDir, 'images/2024'));
    await writeFile(join(exportDir, 'images/2024/cover.jpg'), 'COVER');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(1);
      expect(await readFile(join(cwd, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('folder with no JSON throws a clear error', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      await expect(importGhostExport({ cwd, file: exportDir })).rejects.toThrow(
        /Ghost export directory does not contain a \.json export file:/,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('JSON file input + explicit --assets copies from the override dir', async () => {
    const jsonFile = await writeJsonNamed('export.json');

    const assetsRoot = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-ext-')));
    try {
      await ensureDir(join(assetsRoot, 'images'));
      await writeFile(join(assetsRoot, 'images/cover.jpg'), 'OVERRIDE');

      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
      try {
        const summary = await importGhostExport({
          cwd,
          file: jsonFile,
          onConflict: 'overwrite',
          assetsDir: assetsRoot,
        });
        expect(summary.posts).toBe(1);
        expect(summary.assetsCopied).toBe(1);
        expect(await readFile(join(cwd, 'content/images/cover.jpg'), 'utf8')).toBe('OVERRIDE');
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      await rm(assetsRoot, { recursive: true, force: true });
    }
  });

  test('--assets wins over folder-detected content/ subdir', async () => {
    await writeJsonNamed('export.json');
    await ensureDir(join(exportDir, 'content/images'));
    await writeFile(join(exportDir, 'content/images/auto.jpg'), 'AUTO');

    const override = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-ovr-')));
    try {
      await ensureDir(join(override, 'images'));
      await writeFile(join(override, 'images/explicit.jpg'), 'EXPLICIT');

      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
      try {
        const summary = await importGhostExport({
          cwd,
          file: exportDir,
          onConflict: 'overwrite',
          assetsDir: override,
        });
        expect(summary.assetsCopied).toBe(1);
        expect(await readFile(join(cwd, 'content/images/explicit.jpg'), 'utf8')).toBe('EXPLICIT');
        await expect(access(join(cwd, 'content/images/auto.jpg'))).rejects.toThrow();
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    } finally {
      await rm(override, { recursive: true, force: true });
    }
  });

  test('--assets pointing to a non-existent dir rejects with a clear error', async () => {
    const jsonFile = await writeJsonNamed('export.json');
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      await expect(
        importGhostExport({
          cwd,
          file: jsonFile,
          assetsDir: join(exportDir, 'does-not-exist'),
        }),
      ).rejects.toThrow(/--assets directory does not exist/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('does not overwrite existing destination asset files', async () => {
    await writeJsonNamed('export.json');
    await ensureDir(join(exportDir, 'content/images'));
    await writeFile(join(exportDir, 'content/images/cover.jpg'), 'FROM-EXPORT');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      await ensureDir(join(cwd, 'content/images'));
      await writeFile(join(cwd, 'content/images/cover.jpg'), 'KEEP-ME');

      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.assetsCopied).toBe(0);
      expect(await readFile(join(cwd, 'content/images/cover.jpg'), 'utf8')).toBe('KEEP-ME');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('passing a missing .zip path rejects with a clear error', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      await expect(
        importGhostExport({ cwd, file: join(exportDir, 'does-not-exist.zip') }),
      ).rejects.toThrow(/Cannot read Ghost export/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('JSON file input auto-detects sibling content/images assets', async () => {
    const jsonFile = await writeJsonNamed('export.json');
    await ensureDir(join(exportDir, 'content/images/2024'));
    await writeFile(join(exportDir, 'content/images/2024/cover.jpg'), 'COVER');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: jsonFile, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(1);
      expect(await readFile(join(cwd, 'content/images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('JSON file input without sibling assets does not copy anything', async () => {
    const jsonFile = await writeJsonNamed('export.json');
    await rm(join(exportDir, 'content'), { recursive: true, force: true });

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: jsonFile, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(0);
      await expect(access(join(cwd, 'content/images'))).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  // Regression for backlog task #99: a kg-video-card references three asset
  // types (poster image / video file / caption track) that Ghost scatters into
  // three subdirs. Confirm all three round-trip through the importer to disk
  // *and* survive in the resulting markdown shortcode.
  test('kg-video-card poster / video / caption track all get relocated and referenced (#99)', async () => {
    await writeFile(
      join(exportDir, 'export.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Demo',
                  slug: 'demo',
                  html:
                    '<figure class="kg-card kg-video-card">' +
                    '<div class="kg-video-container">' +
                    '<video poster="/content/images/2024/01/poster.jpg" width="1280" height="720">' +
                    '<source src="/content/media/2024/01/demo.mp4" type="video/mp4" />' +
                    '<track src="/content/files/2024/01/demo-en.vtt" kind="subtitles" srclang="en" label="English" default />' +
                    '</video>' +
                    '</div>' +
                    '<figcaption>Demo caption</figcaption>' +
                    '</figure>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await ensureDir(join(exportDir, 'content/images/2024/01'));
    await writeFile(join(exportDir, 'content/images/2024/01/poster.jpg'), 'POSTER');
    await ensureDir(join(exportDir, 'content/media/2024/01'));
    await writeFile(join(exportDir, 'content/media/2024/01/demo.mp4'), 'MP4');
    await ensureDir(join(exportDir, 'content/files/2024/01'));
    await writeFile(join(exportDir, 'content/files/2024/01/demo-en.vtt'), 'VTT');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(3);

      expect(await readFile(join(cwd, 'content/images/2024/01/poster.jpg'), 'utf8')).toBe('POSTER');
      expect(await readFile(join(cwd, 'content/media/2024/01/demo.mp4'), 'utf8')).toBe('MP4');
      expect(await readFile(join(cwd, 'content/files/2024/01/demo-en.vtt'), 'utf8')).toBe('VTT');

      const postMd = await readFile(join(cwd, 'content/posts/demo.md'), 'utf8');
      expect(postMd).toContain('poster="/content/images/2024/01/poster.jpg"');
      expect(postMd).toContain('src="/content/media/2024/01/demo.mp4"');
      expect(postMd).toContain('src="/content/files/2024/01/demo-en.vtt"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('header card background image placeholders are stripped and copied from Ghost content assets', async () => {
    await writeFile(
      join(exportDir, 'export.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Header',
                  slug: 'header',
                  html: [
                    '<div class="kg-card kg-header-card kg-style-dark kg-size-large" ',
                    'style="background-image: url(&quot;__GHOST_URL__/content/images/2024/01/header.jpg&quot;)" ',
                    'data-background-image="__GHOST_URL__/content/images/2024/01/header.jpg">',
                    '<h2 class="kg-header-card-heading">Hero</h2>',
                    '</div>',
                  ].join(''),
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    await ensureDir(join(exportDir, 'content/images/2024/01'));
    await writeFile(join(exportDir, 'content/images/2024/01/header.jpg'), 'HEADER');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: exportDir, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(1);
      expect(await readFile(join(cwd, 'content/images/2024/01/header.jpg'), 'utf8')).toBe('HEADER');

      const postMd = await readFile(join(cwd, 'content/posts/header.md'), 'utf8');
      expect(postMd).not.toContain('__GHOST_URL__');
      expect(postMd).toContain('background="/content/images/2024/01/header.jpg"');
      expect(postMd).toContain('title="Hero"');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('importGhostExport — ZIP archive input (#88)', () => {
  let stagingDir: string;

  beforeEach(async () => {
    stagingDir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-zip-')));
  });

  afterEach(async () => {
    await rm(stagingDir, { recursive: true, force: true });
  });

  async function makeGhostExportFolder(root: string): Promise<void> {
    await ensureDir(root);
    await writeFile(
      join(root, 'my-blog.ghost.2024-01-01.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Zipped Hello',
                  slug: 'zipped-hello',
                  html: '<p><a href="__GHOST_URL__/content/files/handout.pdf">PDF</a> and <img src="__GHOST_URL__/content/images/2024/01/pic.jpg" alt="pic"></p>',
                  feature_image: '__GHOST_URL__/content/images/2024/01/cover.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    await ensureDir(join(root, 'content/images/2024/01'));
    await writeFile(join(root, 'content/images/2024/01/cover.jpg'), 'COVER');
    await writeFile(join(root, 'content/images/2024/01/pic.jpg'), 'PIC');
    await ensureDir(join(root, 'content/files'));
    await writeFile(join(root, 'content/files/handout.pdf'), 'PDF');
    await ensureDir(join(root, 'content/media'));
    await writeFile(join(root, 'content/media/intro.mp4'), 'MP4');
  }

  async function makeZip(
    zipPath: string,
    sourceDir: string,
    includeWrapper: boolean,
  ): Promise<void> {
    // `zip -r out.zip <name>` (run inside the parent dir) preserves the wrapper
    // folder. To produce a flat zip, run inside `sourceDir` and pass `.`.
    const cwd = includeWrapper ? dirname(sourceDir) : sourceDir;
    const target = includeWrapper ? sourceDir.slice(cwd.length + 1) : '.';
    const proc = Bun.spawn(['zip', '-rq', zipPath, target], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const errText = await new Response(proc.stderr).text();
      throw new Error(`Failed to build test zip: ${errText}`);
    }
  }

  test('extracts a wrapper-style Ghost zip and imports posts + assets', async () => {
    const exportFolder = join(stagingDir, 'my-blog.ghost.2024-01-01');
    await makeGhostExportFolder(exportFolder);
    const zipPath = join(stagingDir, 'my-blog.ghost.2024-01-01.zip');
    await makeZip(zipPath, exportFolder, true);

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-zip-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: zipPath, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(4);

      const postMd = await readFile(join(cwd, 'content/posts/zipped-hello.md'), 'utf8');
      expect(postMd).not.toContain('__GHOST_URL__');
      expect(postMd).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
      expect(postMd).toContain('/content/files/handout.pdf');

      expect(await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8')).toBe('COVER');
      expect(await readFile(join(cwd, 'content/images/2024/01/pic.jpg'), 'utf8')).toBe('PIC');
      expect(await readFile(join(cwd, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
      expect(await readFile(join(cwd, 'content/media/intro.mp4'), 'utf8')).toBe('MP4');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('extracts a flat (no wrapper folder) Ghost zip', async () => {
    const exportFolder = join(stagingDir, 'flat');
    await makeGhostExportFolder(exportFolder);
    const zipPath = join(stagingDir, 'flat-export.zip');
    await makeZip(zipPath, exportFolder, false);

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-zip-cwd-')));
    try {
      const summary = await importGhostExport({ cwd, file: zipPath, onConflict: 'overwrite' });
      expect(summary.posts).toBe(1);
      expect(summary.assetsCopied).toBe(4);
      expect(await readFile(join(cwd, 'content/files/handout.pdf'), 'utf8')).toBe('PDF');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('cleans up the temp extraction dir after a successful import', async () => {
    const exportFolder = join(stagingDir, 'my-blog');
    await makeGhostExportFolder(exportFolder);
    const zipPath = join(stagingDir, 'my-blog.zip');
    await makeZip(zipPath, exportFolder, true);

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-zip-cwd-')));
    try {
      const before = (await readdir(tmpdir())).filter((n) => n.startsWith('laurel-ghost-zip-'));
      await importGhostExport({ cwd, file: zipPath, onConflict: 'overwrite' });
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith('laurel-ghost-zip-'));
      expect(after.length).toBe(before.length);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('rejects a corrupt .zip with a clear error and cleans up the temp dir', async () => {
    const zipPath = join(stagingDir, 'corrupt.zip');
    await writeFile(zipPath, 'NOT A ZIP');

    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-zip-cwd-')));
    try {
      const before = (await readdir(tmpdir())).filter((n) => n.startsWith('laurel-ghost-zip-'));
      await expect(importGhostExport({ cwd, file: zipPath })).rejects.toThrow(/Failed to extract/);
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith('laurel-ghost-zip-'));
      expect(after.length).toBe(before.length);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('importGhostExport — __GHOST_URL__ placeholder (#72)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-url-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('strips __GHOST_URL__ placeholder from body, frontmatter, and metadata', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Hello',
                slug: 'hello',
                html: '<p>See <a href="__GHOST_URL__/welcome/">the welcome post</a> and this <img src="__GHOST_URL__/content/images/2024/01/pic.jpg" alt="pic"></p>',
                feature_image: '__GHOST_URL__/content/images/2024/01/cover.jpg',
                og_image: '__GHOST_URL__/content/images/2024/01/og.jpg',
                twitter_image: '__GHOST_URL__/content/images/2024/01/tw.jpg',
                canonical_url: '__GHOST_URL__/canonical/',
                codeinjection_head:
                  '<link rel="stylesheet" href="__GHOST_URL__/content/files/style.css">',
                codeinjection_foot: '<script src="__GHOST_URL__/content/files/foot.js"></script>',
                status: 'published',
                published_at: '2024-01-01T00:00:00.000Z',
              },
            ],
            tags: [
              {
                id: 't1',
                slug: 'news',
                name: 'News',
                description: 'See __GHOST_URL__/tag/news/ for more',
                feature_image: '__GHOST_URL__/content/images/tag.jpg',
                meta_title: 'News',
              },
            ],
            users: [
              {
                id: 'u1',
                slug: 'casper',
                name: 'Casper',
                profile_image: '__GHOST_URL__/content/images/avatar.jpg',
              },
            ],
            posts_tags: [{ post_id: 'p1', tag_id: 't1', sort_order: 0 }],
            posts_authors: [{ post_id: 'p1', user_id: 'u1', sort_order: 0 }],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.authors).toBe(1);

    const postMd = await readFile(join(cwd, 'content/posts/hello.md'), 'utf8');
    expect(postMd).not.toContain('__GHOST_URL__');
    expect(postMd).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
    expect(postMd).toContain('og_image: "/content/images/2024/01/og.jpg"');
    expect(postMd).toContain('twitter_image: "/content/images/2024/01/tw.jpg"');
    expect(postMd).toContain('canonical_url: "/canonical/"');
    expect(postMd).toContain('/content/images/2024/01/pic.jpg');
    expect(postMd).toContain('/welcome/');

    const tagMd = await readFile(join(cwd, 'content/tags/news.md'), 'utf8');
    expect(tagMd).not.toContain('__GHOST_URL__');
    expect(tagMd).toContain('/tag/news/');
    expect(tagMd).toContain('feature_image: "/content/images/tag.jpg"');

    const authorMd = await readFile(join(cwd, 'content/authors/casper.md'), 'utf8');
    expect(authorMd).not.toContain('__GHOST_URL__');
    expect(authorMd).toContain('profile_image: "/content/images/avatar.jpg"');
  });

  test('strips __GHOST_URL__ from Koenig media card URLs, srcset, and inline style URLs', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Media',
                slug: 'media',
                html: [
                  '<figure class="kg-card kg-image-card">',
                  '<img src="__GHOST_URL__/content/images/2024/01/photo.jpg" srcset="__GHOST_URL__/content/images/size/w600/photo.jpg 600w, __GHOST_URL__/content/images/photo.jpg 1200w" sizes="(min-width: 720px) 720px, 100vw" alt="Photo" />',
                  '</figure>',
                  '<p><img src="__GHOST_URL__/content/images/2024/01/plain.jpg" srcset="__GHOST_URL__/content/images/size/w600/plain.jpg 600w, __GHOST_URL__/content/images/plain.jpg 1200w" sizes="100vw" alt="Plain" /></p>',
                  '<figure class="kg-card kg-video-card">',
                  '<div class="kg-video-container" style="background-image:url(__GHOST_URL__/content/images/2024/01/bg.jpg);--aspect-ratio: 1.777">',
                  '<video poster="__GHOST_URL__/content/images/2024/01/poster.jpg" preload="metadata">',
                  '<source src="__GHOST_URL__/content/media/2024/01/demo.mp4" type="video/mp4" />',
                  '</video>',
                  '</div>',
                  '</figure>',
                  '<div class="kg-card kg-audio-card">',
                  '<img class="kg-audio-thumbnail" src="__GHOST_URL__/content/images/2024/01/audio-cover.jpg" alt="" />',
                  '<div class="kg-audio-player-container">',
                  '<audio src="__GHOST_URL__/content/media/2024/01/podcast.mp3"></audio>',
                  '<div class="kg-audio-title">Episode 1</div>',
                  '</div>',
                  '</div>',
                  '<div class="kg-card kg-file-card">',
                  '<a class="kg-file-card-container" href="__GHOST_URL__/content/files/2024/01/handout.pdf">',
                  '<div class="kg-file-card-title">Handout</div>',
                  '</a>',
                  '</div>',
                  '<!--kg-card-begin: html--><div style="background-image: url(&quot;__GHOST_URL__/content/images/2024/01/html-bg.jpg&quot;)">HTML card</div><!--kg-card-end: html-->',
                ].join(''),
                feature_image: '__GHOST_URL__/content/images/2024/01/cover.jpg',
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(1);

    const postMd = await readFile(join(cwd, 'content/posts/media.md'), 'utf8');
    expect(postMd).not.toContain('__GHOST_URL__');
    expect(postMd).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
    expect(postMd).toContain('![Photo](/content/images/2024/01/photo.jpg)');
    expect(postMd).toContain('src="/content/images/2024/01/plain.jpg"');
    expect(postMd).toContain(
      'srcset="/content/images/size/w600/plain.jpg 600w, /content/images/plain.jpg 1200w"',
    );
    expect(postMd).toContain('sizes="100vw"');
    expect(postMd).toContain('poster="/content/images/2024/01/poster.jpg"');
    expect(postMd).toContain('src="/content/media/2024/01/demo.mp4"');
    expect(postMd).toContain('src="/content/media/2024/01/podcast.mp3"');
    expect(postMd).toContain('thumbnail="/content/images/2024/01/audio-cover.jpg"');
    expect(postMd).toContain('href="/content/files/2024/01/handout.pdf"');
    expect(postMd).toContain(
      'style="background-image:url(&quot;/content/images/2024/01/html-bg.jpg&quot;)"',
    );
  });

  test('strips __GHOST_URL__ from bookmark icon and thumbnail metadata', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Bookmark',
                slug: 'bookmark',
                html: [
                  '<figure class="kg-card kg-bookmark-card">',
                  '<a class="kg-bookmark-container" href="https://example.com/article">',
                  '<div class="kg-bookmark-content">',
                  '<div class="kg-bookmark-title">Example</div>',
                  '<div class="kg-bookmark-metadata">',
                  '<img class="kg-bookmark-icon" src="__GHOST_URL__/content/images/favicon.ico" alt="">',
                  '</div>',
                  '</div>',
                  '<div class="kg-bookmark-thumbnail">',
                  '<img src="__GHOST_URL__/content/images/bookmark.jpg" alt="">',
                  '</div>',
                  '</a>',
                  '</figure>',
                ].join(''),
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(1);

    const postMd = await readFile(join(cwd, 'content/posts/bookmark.md'), 'utf8');
    expect(postMd).not.toContain('__GHOST_URL__');
    expect(postMd).toContain('icon="/content/images/favicon.ico"');
    expect(postMd).toContain('thumbnail="/content/images/bookmark.jpg"');
  });
});

describe('importGhostExport — Koenig card comment fences', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('strips email/email-cta regions and preserves html/markdown card payloads', async () => {
    const postHtml = [
      '<p>Public intro.</p>',
      '<!--kg-card-begin: email--><p>Paid subscribers only: secret link.</p><!--kg-card-end: email-->',
      '<!--kg-card-begin: html--><div class="newsletter-signup"><span style="color:red">Sign up</span></div><!--kg-card-end: html-->',
      '<!--kg-card-begin: markdown--><h2>Heading</h2><p>Body paragraph.</p><!--kg-card-end: markdown-->',
      '<!--kg-card-begin: email-cta--><p>Members-only CTA copy.</p><!--kg-card-end: email-cta-->',
      '<p>Public outro.</p>',
    ].join('\n');

    await writeFile(exportFile, makeExport([{ slug: 'fences', title: 'Fences', html: postHtml }]));

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/fences.md'), 'utf8');
    expect(md).toContain('Public intro.');
    expect(md).toContain('Public outro.');
    // email + email-cta regions must NOT leak into the static site.
    expect(md).not.toContain('Paid subscribers only');
    expect(md).not.toContain('secret link');
    expect(md).not.toContain('Members-only CTA copy');
    // html card preserves the raw user payload verbatim.
    expect(md).toContain(
      '<div class="newsletter-signup"><span style="color:red">Sign up</span></div>',
    );
    // markdown card content rendered as markdown.
    expect(md).toContain('## Heading');
    expect(md).toContain('Body paragraph.');
  });

  test('preserves email-cta segment metadata and raw post frontmatter outside the public body', async () => {
    const rawFrontmatter = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [{ type: 'html', html: '<div>Deck value</div>', version: 1 }],
      },
    });
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'extended-text', text: 'Public body.', format: 0, version: 1 }],
          },
          {
            type: 'email-cta',
            version: 1,
            html: '<p>Newsletter CTA only.</p>',
            visibility: {
              email: { memberSegment: 'status:free,status:-free' },
              web: { memberSegment: 'status:free' },
            },
          },
        ],
      },
    });
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'post-email-cta-metadata',
                title: 'Email CTA Metadata',
                slug: 'email-cta-metadata',
                lexical,
                frontmatter: rawFrontmatter,
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/email-cta-metadata.md'), 'utf8');
    const parsed = parseFrontmatter(md);
    expect(parsed.body).toContain('Public body.');
    expect(parsed.body).not.toContain('Newsletter CTA only');
    expect(parsed.data.frontmatter).toBe(rawFrontmatter);
    expect(parsed.data.email_card_segments).toEqual([
      {
        type: 'email-cta',
        html: '<p>Newsletter CTA only.</p>',
        visibility: {
          email: { memberSegment: 'status:free,status:-free' },
          web: { memberSegment: 'status:free' },
        },
      },
    ]);
  });

  test('preserves comment-fenced bookmark cards instead of importing a bare link', async () => {
    const postHtml = [
      '<p>Intro.</p>',
      '<!--kg-card-begin: bookmark--><a href="https://example.com/post">https://example.com/post</a><!--kg-card-end: bookmark-->',
      '<p>Outro.</p>',
    ].join('\n');

    await writeFile(
      exportFile,
      makeExport([{ slug: 'bookmark-fence', title: 'Bookmark', html: postHtml }]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/bookmark-fence.md'), 'utf8');
    expect(md).toContain('Intro.');
    expect(md).toContain('Outro.');
    expect(md).toContain('{{< bookmark url="https://example.com/post" />}}');
    expect(md).not.toContain('[https://example.com/post](https://example.com/post)');
  });

  test('uses structured Lexical bookmark cards when the html column is a bare link', async () => {
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'extended-text', text: 'Intro.', format: 0, version: 1 }],
          },
          {
            type: 'bookmark',
            url: 'https://example.com/post',
            metadata: {
              title: 'Bookmark Title',
              description: 'Generated card metadata.',
              publisher: 'Example',
            },
            version: 1,
          },
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'extended-text', text: 'Outro.', format: 0, version: 1 }],
          },
        ],
      },
    });
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'post-lexical-bookmark',
                title: 'Lexical Bookmark',
                slug: 'lexical-bookmark',
                html: '<p>Intro.</p><p><a href="https://example.com/post">https://example.com/post</a></p><p>Outro.</p>',
                lexical,
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/lexical-bookmark.md'), 'utf8');
    expect(md).toContain('Intro.');
    expect(md).toContain('Outro.');
    expect(md).toContain('url="https://example.com/post"');
    expect(md).toContain('title="Bookmark Title"');
    expect(md).toContain('description="Generated card metadata."');
    expect(md).toContain('publisher="Example"');
    expect(md).not.toContain('[https://example.com/post](https://example.com/post)');
  });

  test('preserves Ghost members-only paywall comments as markdown split markers', async () => {
    const postHtml = [
      '<p>Public intro.</p>',
      '<!--members-only-->',
      '<p>Paid paragraph behind the wall.</p>',
    ].join('\n');

    await writeFile(
      exportFile,
      makeExport([{ slug: 'paywall-comment', title: 'Paywall Comment', html: postHtml }]),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/paywall-comment.md'), 'utf8');
    expect(md).toContain('Public intro.');
    expect(md).toContain('<!-- members-only -->');
    expect(md).toContain('Paid paragraph behind the wall.');
    expect(md.indexOf('Public intro.')).toBeLessThan(md.indexOf('<!-- members-only -->'));
    expect(md.indexOf('<!-- members-only -->')).toBeLessThan(
      md.indexOf('Paid paragraph behind the wall.'),
    );
  });

  test('preserves raw lexical markdown card payload when html is also present', async () => {
    const rawMarkdown = [
      'Raw heading',
      '===========',
      '',
      'This keeps a [reference link][ref] and author spacing.',
      '',
      '[ref]: https://example.com "Reference Title"',
    ].join('\n');
    const renderedMarkdownCard = [
      '<!--kg-card-begin: markdown-->',
      '<h1 id="raw-heading">Raw heading</h1>',
      '<p>This keeps a <a href="https://example.com" title="Reference Title">reference link</a> and author spacing.</p>',
      '<!--kg-card-end: markdown-->',
    ].join('');
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'markdown',
            version: 1,
            markdown: rawMarkdown,
          },
        ],
      },
    });
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'post-raw-markdown',
                title: 'Raw Markdown',
                slug: 'raw-markdown',
                html: ['<p>Public intro.</p>', renderedMarkdownCard, '<p>Public outro.</p>'].join(
                  '\n',
                ),
                lexical,
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/raw-markdown.md'), 'utf8');
    expect(md).toContain('Public intro.');
    expect(md).toContain('Public outro.');
    expect(md).toContain('<!--kg-card-begin: markdown-->');
    expect(md).toContain(rawMarkdown);
    expect(md).toContain('<!--kg-card-end: markdown-->');
    expect(md).not.toContain('# Raw heading');
    expect(md).not.toContain('[reference link](https://example.com "Reference Title")');
  });
});

describe('importGhostExport — --download-images (#128)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-dl-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  interface FakeFetchOptions {
    // URLs that should respond with the given body bytes + content-type.
    ok?: Record<string, { body: string | Uint8Array; contentType?: string }>;
    // URLs that should respond with an HTTP error status.
    error?: Record<string, number>;
    // URLs that should make fetch throw (simulating a connection failure).
    throw?: string[];
  }

  function fakeFetch(opts: FakeFetchOptions): {
    fetcher: typeof fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (opts.throw?.includes(url)) {
        throw new Error(`simulated network failure for ${url}`);
      }
      if (opts.error && url in opts.error) {
        return new Response('', { status: opts.error[url] });
      }
      if (opts.ok && url in opts.ok) {
        const ok = opts.ok[url];
        if (!ok) return new Response('', { status: 404 });
        const { body, contentType } = ok;
        return new Response(body, {
          status: 200,
          headers: { 'content-type': contentType ?? 'image/jpeg' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetcher, calls };
  }

  test('downloads Ghost CDN URLs to content/images and preserves the path', async () => {
    const ghostUrl = 'https://my-ghost-site.com/content/images/2024/01/cover.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: `<p>See <img src="${ghostUrl}" alt="cover" /></p>`,
                  feature_image: ghostUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: { [ghostUrl]: { body: 'GHOSTBYTES', contentType: 'image/jpeg' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.imagesFailed).toBe(0);
    // Same URL appears in body + feature_image; only one fetch.
    expect(calls.length).toBe(1);

    const written = await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8');
    expect(written).toBe('GHOSTBYTES');

    const md = await readFile(join(cwd, 'content/posts/hello.md'), 'utf8');
    expect(md).not.toContain(ghostUrl);
    expect(md).toContain('feature_image: "/content/images/2024/01/cover.jpg"');
    expect(md).toContain('/content/images/2024/01/cover.jpg');
  });

  test('leaves external Unsplash-style URLs untouched without fetching them', async () => {
    const unsplashUrl = 'https://images.unsplash.com/photo-12345?w=1200';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Unsplash',
                  slug: 'unsplash',
                  html: `<p><img src="${unsplashUrl}" alt="hero" /></p>`,
                  feature_image: unsplashUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: { [unsplashUrl]: { body: 'UNSPLASH', contentType: 'image/jpeg' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(calls).toEqual([]);
    await expect(readdir(join(cwd, 'content/images/external'))).rejects.toThrow();

    const md = await readFile(join(cwd, 'content/posts/unsplash.md'), 'utf8');
    expect(md).toContain(unsplashUrl);
    expect(md).toContain(`feature_image: "${unsplashUrl}"`);
  });

  test('sanitizes downloaded SVG payloads before writing them', async () => {
    const svgUrl = 'https://cdn.example.com/content/images/logo.svg';
    await writeFile(exportFile, singleImagePostExport(svgUrl));

    const { fetcher } = fakeFetch({
      ok: {
        [svgUrl]: {
          contentType: 'image/svg+xml',
          body: [
            '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
            '<script>alert(1)</script>',
            '<image href="javascript:alert(2)" />',
            '<path onclick="alert(3)" d="M0 0h10v10z" />',
            '</svg>',
          ].join(''),
        },
      },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    const svg = await readFile(join(cwd, 'content/images/logo.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onload=');
    expect(svg).not.toContain('onclick=');
    expect(svg).not.toContain('javascript:');
  });

  test('strips EXIF metadata from downloaded JPEG payloads before writing them', async () => {
    const jpgUrl = 'https://cdn.example.com/content/images/photo.jpg';
    await writeFile(exportFile, singleImagePostExport(jpgUrl));

    const { fetcher } = fakeFetch({
      ok: { [jpgUrl]: { body: jpegWithExif(), contentType: 'image/jpeg' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    const jpg = await readFile(join(cwd, 'content/images/photo.jpg'));
    expect(jpg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpg.includes(Buffer.from('Exif\0\0', 'binary'))).toBe(false);
    expect(jpg.includes(Buffer.from('SECRET_GPS'))).toBe(false);
  });

  test('leaves bookmark icon and thumbnail service URLs untouched', async () => {
    const iconUrl = 'https://example.com/favicon.ico';
    const thumbnailUrl = 'https://cdn.example.com/thumb.jpg?width=1200';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Bookmark',
                  slug: 'bookmark',
                  html: [
                    '<figure class="kg-card kg-bookmark-card">',
                    '<a class="kg-bookmark-container" href="https://example.com/article">',
                    '<div class="kg-bookmark-content">',
                    '<div class="kg-bookmark-title">Example</div>',
                    '<div class="kg-bookmark-metadata">',
                    `<img class="kg-bookmark-icon" src="${iconUrl}" alt="">`,
                    '</div>',
                    '</div>',
                    '<div class="kg-bookmark-thumbnail">',
                    `<img src="${thumbnailUrl}" alt="">`,
                    '</div>',
                    '</a>',
                    '</figure>',
                  ].join(''),
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: {
        [iconUrl]: { body: 'ICO', contentType: 'image/x-icon' },
        [thumbnailUrl]: { body: 'JPG', contentType: 'image/jpeg' },
      },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(calls).toEqual([]);
    await expect(readdir(join(cwd, 'content/images/bookmarks'))).rejects.toThrow();

    const md = await readFile(join(cwd, 'content/posts/bookmark.md'), 'utf8');
    expect(md).toContain(iconUrl);
    expect(md).toContain(thumbnailUrl);
  });

  test('downloads header card background-image URLs and rewrites the inline style', async () => {
    const headerUrl = 'https://my-ghost-site.com/content/images/2024/01/header.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Header',
                  slug: 'header',
                  html: [
                    '<div class="kg-card kg-header-card kg-v2 kg-style-image kg-width-full">',
                    '<picture>',
                    `<img class="kg-header-card-image" src="${headerUrl}" width="1600" height="900" alt="">`,
                    '</picture>',
                    '<h2 class="kg-header-card-heading">Hero</h2>',
                    '</div>',
                  ].join(''),
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: { [headerUrl]: { body: 'HEADER', contentType: 'image/jpeg' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.imagesFailed).toBe(0);
    expect(calls).toEqual([headerUrl]);
    expect(await readFile(join(cwd, 'content/images/2024/01/header.jpg'), 'utf8')).toBe('HEADER');

    const md = await readFile(join(cwd, 'content/posts/header.md'), 'utf8');
    expect(md).not.toContain(headerUrl);
    expect(md).toContain('version="v2"');
    expect(md).toContain('background_image="/content/images/2024/01/header.jpg"');
    expect(md).toContain('heading="Hero"');
  });

  test('leaves markdown ![alt](url) service URLs emitted by Turndown untouched', async () => {
    // Turndown converts <img src=... alt=...> into ![alt](url), so the
    // rewriter sees markdown image syntax in the final body. Verify that
    // path explicitly.
    const remoteUrl = 'https://images.unsplash.com/inline.png';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Md',
                  slug: 'md',
                  html: `<p>before <img src="${remoteUrl}" alt="alt text"> after</p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: { [remoteUrl]: { body: 'PNG', contentType: 'image/png' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(calls).toEqual([]);
    const md = await readFile(join(cwd, 'content/posts/md.md'), 'utf8');
    expect(md).toContain(`![alt text](${remoteUrl})`);
  });

  test('leaves URLs untouched and counts failures when downloads fail', async () => {
    const failUrl = 'https://my-ghost-site.com/content/images/missing.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'F',
                  slug: 'f',
                  html: `<p><img src="${failUrl}" alt="x" /></p>`,
                  feature_image: failUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({ error: { [failUrl]: 404 } });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    // Failure cached: same URL in body + feature_image counts as one failure.
    expect(summary.imagesFailed).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/f.md'), 'utf8');
    expect(md).toContain(failUrl);
    expect(md).toContain(`feature_image: "${failUrl}"`);
  });

  test('also rewrites tag feature_image and author profile_image / cover_image', async () => {
    const tagImg = 'https://images.unsplash.com/tag.jpg';
    const profileImg = 'https://images.unsplash.com/profile.jpg';
    const coverImg = 'https://my-ghost-site.com/content/images/cover.jpg';

    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'news',
                  name: 'News',
                  description: 'd',
                  feature_image: tagImg,
                },
              ],
              users: [
                {
                  id: 'u1',
                  slug: 'casper',
                  name: 'Casper',
                  profile_image: profileImg,
                  cover_image: coverImg,
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({
      ok: {
        [tagImg]: { body: 'T', contentType: 'image/jpeg' },
        [profileImg]: { body: 'P', contentType: 'image/jpeg' },
        [coverImg]: { body: 'C', contentType: 'image/jpeg' },
      },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
      onConflict: 'overwrite',
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(await readFile(join(cwd, 'content/images/cover.jpg'), 'utf8')).toBe('C');

    const tagMd = await readFile(join(cwd, 'content/tags/news.md'), 'utf8');
    expect(tagMd).toContain(`feature_image: "${tagImg}"`);

    const authorMd = await readFile(join(cwd, 'content/authors/casper.md'), 'utf8');
    expect(authorMd).toContain(`profile_image: "${profileImg}"`);
    expect(authorMd).toContain('cover_image: "/content/images/cover.jpg"');
  });

  test('leaves relative / data: URLs alone and does not fetch them', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Skip',
                  slug: 'skip',
                  html: '<p><img src="/content/images/already-local.jpg" alt="a" /><img src="data:image/png;base64,AAAA" alt="b" /></p>',
                  feature_image: '/content/images/local.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({});

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(calls.length).toBe(0);

    const md = await readFile(join(cwd, 'content/posts/skip.md'), 'utf8');
    expect(md).toContain('/content/images/already-local.jpg');
    expect(md).toContain('data:image/png;base64,AAAA');
    expect(md).toContain('feature_image: "/content/images/local.jpg"');
  });

  test('disabled by default: URLs are kept verbatim (back-compat)', async () => {
    const ghostUrl = 'https://my-ghost-site.com/content/images/2024/01/cover.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'X',
                  slug: 'x',
                  html: `<p><img src="${ghostUrl}" alt="c" /></p>`,
                  feature_image: ghostUrl,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    const md = await readFile(join(cwd, 'content/posts/x.md'), 'utf8');
    expect(md).toContain(ghostUrl);
    expect(md).toContain(`feature_image: "${ghostUrl}"`);
  });

  test('does not fetch extensionless third-party service URLs', async () => {
    const extlessUrl = 'https://cdn.example.com/random-id';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'E',
                  slug: 'e',
                  html: `<p><img src="${extlessUrl}" alt="e" /></p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher, calls } = fakeFetch({
      ok: { [extlessUrl]: { body: 'WEBP', contentType: 'image/webp' } },
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(calls).toEqual([]);
    await expect(readdir(join(cwd, 'content/images/external'))).rejects.toThrow();
  });

  test('survives a thrown fetch error and continues importing', async () => {
    const throwUrl = 'https://my-ghost-site.com/content/images/boom.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'B',
                  slug: 'b',
                  html: `<p><img src="${throwUrl}" alt="b" /></p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const { fetcher } = fakeFetch({ throw: [throwUrl] });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.posts).toBe(1);
    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(1);

    const md = await readFile(join(cwd, 'content/posts/b.md'), 'utf8');
    expect(md).toContain(throwUrl);
  });
});

describe('importGhostExport — settings-level images', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-settings-img-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function settingsFetch(ok: Record<string, string>): { fetcher: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      const body = ok[url];
      if (body !== undefined) {
        return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetcher, calls };
  }

  async function writeSettingsExport(
    settings: Record<string, string>,
    posts: unknown[] = [],
  ): Promise<void> {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts,
              settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
            },
          },
        ],
      }),
    );
  }

  test('downloads settings icon/og_image and rewrites laurel.toml to local paths', async () => {
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/2024/01/favicon.png',
      og_image: '__GHOST_URL__/content/images/2024/01/og.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher, calls } = settingsFetch({
      [`${source}/content/images/2024/01/favicon.png`]: 'ICON',
      [`${source}/content/images/2024/01/og.png`]: 'OG',
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: source,
      fetcher,
    });

    expect(summary.settingsImagesDownloaded).toBe(2);
    expect(summary.settingsImagesFailed).toBe(0);
    expect(calls.length).toBe(2);
    expect(await readFile(join(cwd, 'content/images/2024/01/favicon.png'), 'utf8')).toBe('ICON');
    expect(await readFile(join(cwd, 'content/images/2024/01/og.png'), 'utf8')).toBe('OG');

    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    expect(toml).toContain('icon = "/content/images/2024/01/favicon.png"');
    expect(toml).toContain('og_image = "/content/images/2024/01/og.png"');
  });

  test('leaves third-party settings images external and does not fetch them', async () => {
    await writeSettingsExport({
      title: 'Old Blog',
      og_image: 'https://static.ghost.org/v5.0.0/images/default.png',
      icon: '__GHOST_URL__/content/images/icon.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher, calls } = settingsFetch({
      [`${source}/content/images/icon.png`]: 'ICON',
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: source,
      fetcher,
    });

    expect(summary.settingsImagesDownloaded).toBe(1);
    // og_image is a third-party URL left external: like body images, it is not
    // counted as a failure (failed counts genuine fetch errors only).
    expect(summary.settingsImagesFailed).toBe(0);
    expect(calls).toEqual([`${source}/content/images/icon.png`]);

    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    expect(toml).toContain('og_image = "https://static.ghost.org/v5.0.0/images/default.png"');
    expect(toml).toContain('icon = "/content/images/icon.png"');
  });

  test('without --source-url, skips settings images and warns instead of breaking silently', async () => {
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/icon.png',
      og_image: '__GHOST_URL__/content/images/og.png',
    });
    const { fetcher, calls } = settingsFetch({});

    const stderr = captureStderr();
    let summary: Awaited<ReturnType<typeof importGhostExport>>;
    try {
      summary = await importGhostExport({
        cwd,
        file: exportFile,
        downloadImages: true,
        fetcher,
      });
    } finally {
      stderr.restore();
    }

    expect(summary.settingsImagesDownloaded).toBe(0);
    expect(calls).toEqual([]);
    expect(stderr.data).toContain('--source-url');
    // laurel.toml keeps the site-relative ghost paths unchanged.
    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    expect(toml).toContain('icon = "/content/images/icon.png"');
  });

  test('--no-download-settings-images skips settings images even with --source-url', async () => {
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/icon.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher, calls } = settingsFetch({
      [`${source}/content/images/icon.png`]: 'ICON',
    });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      downloadSettingsImages: false,
      sourceUrl: source,
      fetcher,
    });

    expect(summary.settingsImagesDownloaded).toBe(0);
    expect(calls).toEqual([]);
    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    expect(toml).toContain('icon = "/content/images/icon.png"');
  });

  test('does not re-download a settings image already fetched as a post feature_image', async () => {
    const rel = '/content/images/shared.png';
    await writeSettingsExport({ title: 'Old Blog', og_image: `__GHOST_URL__${rel}` }, [
      {
        id: 'p1',
        title: 'Hello',
        slug: 'hello',
        status: 'published',
        type: 'post',
        feature_image: `__GHOST_URL__${rel}`,
        html: '<p>hi</p>',
      },
    ]);
    const source = 'https://oldblog.example';
    const { fetcher, calls } = settingsFetch({ [`${source}${rel}`]: 'SHARED' });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: source,
      fetcher,
    });

    // One network fetch despite the post feature_image and settings og_image
    // both referencing it; settings sees the downloader cache hit.
    expect(calls).toEqual([`${source}${rel}`]);
    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.settingsImagesDownloaded).toBe(0);

    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    expect(toml).toContain(`og_image = "${rel}"`);
  });

  test('default skip fill-merges missing image keys into an existing laurel.toml', async () => {
    // Documented flow: `laurel init` already wrote a laurel.toml with no image
    // keys, so the default skip policy applies. The settings images must
    // download AND their paths must be filled into the config (without
    // clobbering the user's existing values) or favicon/og:image 404 on build.
    await writeFile(join(cwd, 'laurel.toml'), '[site]\ntitle = "Existing"\n');
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/favicon.png',
      og_image: '__GHOST_URL__/content/images/og.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher, calls } = settingsFetch({
      [`${source}/content/images/favicon.png`]: 'ICON',
      [`${source}/content/images/og.png`]: 'OG',
    });

    const stderr = captureStderr();
    let summary: Awaited<ReturnType<typeof importGhostExport>>;
    try {
      summary = await importGhostExport({
        cwd,
        file: exportFile,
        downloadImages: true,
        sourceUrl: source,
        fetcher,
      });
    } finally {
      stderr.restore();
    }

    expect(stderr.data).toContain('Merged');
    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    // Existing user value is preserved (fill mode never clobbers)...
    expect(toml).toContain('title = "Existing"');
    expect(toml).not.toContain('Old Blog');
    // ...and the missing image keys are filled in with the downloaded paths.
    expect(toml).toContain('icon = "/content/images/favicon.png"');
    expect(toml).toContain('og_image = "/content/images/og.png"');
    expect(summary.settingsImagesDownloaded).toBe(2);
    expect(calls.length).toBe(2);
    expect(await readFile(join(cwd, 'content/images/favicon.png'), 'utf8')).toBe('ICON');
    expect(await readFile(join(cwd, 'content/images/og.png'), 'utf8')).toBe('OG');
  });

  test('skip leaves laurel.toml untouched when it already has every Ghost key', async () => {
    // Re-import case: the config already carries the imported settings, so there
    // is nothing to fill and the file must be left byte-for-byte (true skip).
    const original = [
      '# hand-written',
      '[site]',
      'title = "Existing"',
      'icon = "/content/images/favicon.png"',
      '',
    ].join('\n');
    await writeFile(join(cwd, 'laurel.toml'), original);
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/favicon.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher } = settingsFetch({
      [`${source}/content/images/favicon.png`]: 'ICON',
    });

    const stderr = captureStderr();
    try {
      await importGhostExport({
        cwd,
        file: exportFile,
        downloadImages: true,
        sourceUrl: source,
        fetcher,
      });
    } finally {
      stderr.restore();
    }

    expect(stderr.data).toContain('Skipped (already complete)');
    // Untouched: comment + formatting preserved.
    expect(await readFile(join(cwd, 'laurel.toml'), 'utf8')).toBe(original);
  });

  test('fill-merge never overwrites an existing (even blank) title with the default', async () => {
    // fill mode must treat a present-but-blank title as the user's value, not
    // replace it with the "Laurel Site" sentinel.
    await writeFile(join(cwd, 'laurel.toml'), '[site]\ntitle = ""\n');
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/favicon.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher } = settingsFetch({
      [`${source}/content/images/favicon.png`]: 'ICON',
    });

    await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: source,
      fetcher,
    });

    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    expect(toml).toContain('title = ""');
    expect(toml).not.toContain('Laurel Site');
    expect(toml).not.toContain('Old Blog');
    expect(toml).toContain('icon = "/content/images/favicon.png"');
  });

  test('skip does not clobber an existing image key the user already set', async () => {
    await writeFile(
      join(cwd, 'laurel.toml'),
      '[site]\ntitle = "Existing"\nicon = "/content/images/custom-icon.png"\n',
    );
    await writeSettingsExport({
      title: 'Old Blog',
      icon: '__GHOST_URL__/content/images/favicon.png',
      og_image: '__GHOST_URL__/content/images/og.png',
    });
    const source = 'https://oldblog.example';
    const { fetcher } = settingsFetch({
      [`${source}/content/images/favicon.png`]: 'ICON',
      [`${source}/content/images/og.png`]: 'OG',
    });

    const stderr = captureStderr();
    try {
      await importGhostExport({
        cwd,
        file: exportFile,
        downloadImages: true,
        sourceUrl: source,
        fetcher,
      });
    } finally {
      stderr.restore();
    }

    const toml = await readFile(join(cwd, 'laurel.toml'), 'utf8');
    // User's icon survives; only the missing og_image is filled in.
    expect(toml).toContain('icon = "/content/images/custom-icon.png"');
    expect(toml).toContain('og_image = "/content/images/og.png"');
  });
});

describe('importGhostExport — --max-image-size (#239)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-maxsz-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // Build a fetch that returns a body of `bodyBytes` length and an optional
  // Content-Length header. Lets us exercise the upfront header check and the
  // post-download body check independently.
  function sizedFetch(
    url: string,
    bodyBytes: number,
    opts: { advertisedLength?: number | 'omit' } = {},
  ): typeof fetch {
    return (async (input: string | URL | Request): Promise<Response> => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u !== url) return new Response('not found', { status: 404 });
      const body = new Uint8Array(bodyBytes);
      const headers: Record<string, string> = { 'content-type': 'image/jpeg' };
      const advertised = opts.advertisedLength ?? bodyBytes;
      if (advertised !== 'omit') {
        headers['content-length'] = String(advertised);
      }
      return new Response(body, { status: 200, headers });
    }) as typeof fetch;
  }

  function singlePostExport(url: string): string {
    return JSON.stringify({
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Big',
                slug: 'big',
                html: `<p><img src="${url}" alt="x" /></p>`,
                feature_image: url,
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    });
  }

  test('rejects upfront when Content-Length exceeds the cap (no buffer allocated)', async () => {
    const url = 'https://cdn.example.com/content/images/huge.jpg';
    await writeFile(exportFile, singlePostExport(url));

    // Advertised 20 MB, cap 5 MB. The body is small (we never read it because
    // the header check trips first) but the test asserts the header path.
    const fetcher = sizedFetch(url, 1, { advertisedLength: 20 * 1024 * 1024 });
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      maxImageSizeBytes: 5 * 1024 * 1024,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(1);
    const md = await readFile(join(cwd, 'content/posts/big.md'), 'utf8');
    expect(md).toContain(url);
    expect(md).toContain(`feature_image: "${url}"`);
  });

  test('rejects after download when the server lied about Content-Length', async () => {
    const url = 'https://cdn.example.com/content/images/lies.jpg';
    await writeFile(exportFile, singlePostExport(url));

    // Server says 100 bytes, actually streams 2 MiB. Body-length check must
    // still refuse the image and not write it under content/images/.
    const fetcher = sizedFetch(url, 2 * 1024 * 1024, { advertisedLength: 100 });
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      maxImageSizeBytes: 1024 * 1024,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(1);
    await expect(access(join(cwd, 'content/images/lies.jpg'))).rejects.toThrow();
  });

  test('rejects after download when Content-Length header is missing', async () => {
    const url = 'https://cdn.example.com/content/images/no-header.jpg';
    await writeFile(exportFile, singlePostExport(url));

    const fetcher = sizedFetch(url, 2 * 1024 * 1024, { advertisedLength: 'omit' });
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      maxImageSizeBytes: 1024 * 1024,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(1);
  });

  test('accepts an image exactly at the cap', async () => {
    const url = 'https://cdn.example.com/content/images/edge.jpg';
    await writeFile(exportFile, singlePostExport(url));

    const cap = 1024;
    const fetcher = sizedFetch(url, cap);
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      maxImageSizeBytes: cap,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.imagesFailed).toBe(0);
  });

  test('0 disables the cap and allows arbitrarily large images', async () => {
    const url = 'https://cdn.example.com/content/images/unbounded.jpg';
    await writeFile(exportFile, singlePostExport(url));

    // 16 MiB body, no cap. With cap = 0 the downloader must skip both the
    // header check and the post-body check.
    const fetcher = sizedFetch(url, 16 * 1024 * 1024);
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      maxImageSizeBytes: 0,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(summary.imagesFailed).toBe(0);
  });

  test('defaults to 10 MiB cap when maxImageSizeBytes is not set', async () => {
    const url = 'https://cdn.example.com/content/images/just-over.jpg';
    await writeFile(exportFile, singlePostExport(url));

    // 11 MiB body with no explicit cap. Default 10 MiB cap should refuse it.
    const fetcher = sizedFetch(url, 11 * 1024 * 1024);
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(1);
  });
});

describe('importGhostExport — --source-url (#500)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-srcurl-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('rewrites markdown links pointing at the source host to site-relative paths', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Has link',
                  slug: 'has-link',
                  html: '<p>See <a href="https://oldblog.com/old-slug">prior post</a> for context.</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/has-link.md'), 'utf8');
    expect(md).toContain('[prior post](/old-slug)');
    expect(md).not.toContain('oldblog.com');
  });

  test('leaves links to other hosts untouched', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'External link',
                  slug: 'ext',
                  html: '<p><a href="https://example.com/external">external</a> and <a href="https://oldblog.com/internal">internal</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/ext.md'), 'utf8');
    expect(md).toContain('https://example.com/external');
    expect(md).toContain('](/internal)');
    expect(md).not.toContain('https://oldblog.com');
  });

  test('matches http and https variants of the source host', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Mixed schemes',
                  slug: 'mixed',
                  html: '<p><a href="http://oldblog.com/a">a</a> and <a href="https://oldblog.com/b">b</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/mixed.md'), 'utf8');
    expect(md).toContain('[a](/a)');
    expect(md).toContain('[b](/b)');
    expect(md).not.toContain('oldblog.com');
  });

  test('preserves query strings and fragments when rewriting', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Query',
                  slug: 'query',
                  html: '<p><a href="https://oldblog.com/post?ref=feed#top">link</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/query.md'), 'utf8');
    expect(md).toContain('[link](/post?ref=feed#top)');
  });

  test('leaves image markdown alone (image-downloader owns that syntax)', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Image only',
                  slug: 'img',
                  html: '<p><img src="https://oldblog.com/content/images/foo.jpg" alt="x" /></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/img.md'), 'utf8');
    // The link rewriter must NOT touch `![alt](url)` — that's the image
    // downloader's domain. Without --download-images, the URL stays as-is.
    expect(md).toContain('https://oldblog.com/content/images/foo.jpg');
  });

  test('composes with --download-images: images downloaded, links rewritten', async () => {
    const imageUrl = 'https://oldblog.com/content/images/2024/01/cover.jpg';
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Both',
                  slug: 'both',
                  html: `<p><img src="${imageUrl}" alt="c"/> Read <a href="https://oldblog.com/older">older</a></p>`,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === imageUrl) {
        return new Response('BYTES', {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: 'https://oldblog.com',
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    const md = await readFile(join(cwd, 'content/posts/both.md'), 'utf8');
    expect(md).toContain('/content/images/2024/01/cover.jpg');
    expect(md).toContain('[older](/older)');
    expect(md).not.toContain('https://oldblog.com');
  });

  test('throws when sourceUrl is not a valid http(s) URL', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [{ data: { posts: [] } }] }));

    await expect(
      importGhostExport({ cwd, file: exportFile, sourceUrl: 'not a url' }),
    ).rejects.toThrow(/Invalid --source-url/);

    await expect(
      importGhostExport({ cwd, file: exportFile, sourceUrl: 'ftp://oldblog.com' }),
    ).rejects.toThrow(/Only http\(s\)/);
  });

  test('matches hostname case-insensitively', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Case',
                  slug: 'case',
                  html: '<p><a href="https://OldBlog.com/CasePath">x</a></p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({
      cwd,
      file: exportFile,
      sourceUrl: 'https://oldblog.com',
    });

    const md = await readFile(join(cwd, 'content/posts/case.md'), 'utf8');
    expect(md).toContain('[x](/CasePath)');
    expect(md).not.toContain('OldBlog.com');
  });
});

describe('importGhostExport — multi-db export merging (#126)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-multidb-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('merges posts, tags, users, and join rows split across multiple db[i] blocks', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Post One',
                  slug: 'post-one',
                  html: '<p>one</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [{ id: 't1', slug: 'tag-one', name: 'Tag One', description: 'd1' }],
              users: [{ id: 'u1', slug: 'alice', name: 'Alice', bio: 'b1' }],
              posts_tags: [{ post_id: 'p1', tag_id: 't1' }],
              posts_authors: [{ post_id: 'p1', user_id: 'u1' }],
            },
          },
          {
            data: {
              posts: [
                {
                  id: 'p2',
                  title: 'Post Two',
                  slug: 'post-two',
                  html: '<p>two</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [{ id: 't2', slug: 'tag-two', name: 'Tag Two', description: 'd2' }],
              users: [{ id: 'u2', slug: 'bob', name: 'Bob', bio: 'b2' }],
              posts_tags: [{ post_id: 'p2', tag_id: 't2' }],
              posts_authors: [{ post_id: 'p2', user_id: 'u2' }],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(2);
    expect(summary.tags).toBe(2);
    expect(summary.authors).toBe(2);

    const postOne = await readFile(join(cwd, 'content/posts/post-one.md'), 'utf8');
    const postTwo = await readFile(join(cwd, 'content/posts/post-two.md'), 'utf8');
    expect(postOne).toContain('tags: ["tag-one"]');
    expect(postOne).toContain('authors: ["alice"]');
    expect(postTwo).toContain('tags: ["tag-two"]');
    expect(postTwo).toContain('authors: ["bob"]');
    await readFile(join(cwd, 'content/tags/tag-one.md'), 'utf8');
    await readFile(join(cwd, 'content/tags/tag-two.md'), 'utf8');
    await readFile(join(cwd, 'content/authors/alice.md'), 'utf8');
    await readFile(join(cwd, 'content/authors/bob.md'), 'utf8');
  });

  test('imports referenced tags even when they only have slug and name', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Tagged',
                  slug: 'tagged',
                  html: '<p>body</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [{ id: 't1', slug: 'plain-tag', name: 'Plain Tag' }],
              posts_tags: [{ post_id: 'p1', tag_id: 't1' }],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.tags).toBe(1);
    const tagMd = await readFile(join(cwd, 'content/tags/plain-tag.md'), 'utf8');
    expect(tagMd).toContain('slug: "plain-tag"');
    expect(tagMd).toContain('name: "Plain Tag"');
  });

  test('uses a canonical one-newline markdown format for empty imported bodies', async () => {
    await writeFile(
      exportFile,
      makeExport([{ slug: 'empty-body', title: 'Empty Body', html: '' }]),
    );

    await importGhostExport({ cwd, file: exportFile });

    const md = await readFile(join(cwd, 'content/posts/empty-body.md'), 'utf8');
    expect(md).toMatch(/^---\n[\s\S]*\n---\n$/);
    expect(md).not.toMatch(/\n---\n\n\n$/);
  });

  test('handles a db[i] block with no data field (e.g. members-only split block)', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Solo',
                  slug: 'solo',
                  html: '<p>solo</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
          { meta: { exported_on: 0 } },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(1);
  });

  test('throws when db array is missing', async () => {
    await writeFile(exportFile, JSON.stringify({ meta: { exported_on: 0 } }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db array missing or empty/,
    );
  });

  test('throws when the top-level export JSON is not an object (#1043)', async () => {
    await writeFile(exportFile, JSON.stringify([{ db: [] }]));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /top-level JSON must be an object/,
    );
  });

  test('throws when db array is present but empty', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db array missing or empty/,
    );
  });

  test('throws when a db entry is not an object (#1043)', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [null] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db\[0\] must be an object/,
    );
  });

  test('throws when a db data block is not an object (#1043)', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [{ data: 'corrupt' }] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db\[0\]\.data must be an object/,
    );
  });

  test('throws when a known data table is not an array (#1043)', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [{ data: { posts: { id: 'p1' } } }] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /db\[0\]\.data\.posts must be an array/,
    );
  });

  test('throws when every db[i] entry is missing its data field', async () => {
    await writeFile(exportFile, JSON.stringify({ db: [{ meta: 1 }, { meta: 2 }] }));
    await expect(importGhostExport({ cwd, file: exportFile })).rejects.toThrow(
      /no db\[i\]\.data block present/,
    );
  });
});

describe('importGhostExport — Lexical/Mobiledoc body rendering (#127)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('renders a Ghost 5.x post body from the `lexical` field', async () => {
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              { type: 'extended-text', text: 'Hello ', format: 0, version: 1 },
              { type: 'extended-text', text: 'world', format: 1, version: 1 },
            ],
          },
          {
            type: 'heading',
            tag: 'h2',
            version: 1,
            children: [{ type: 'extended-text', text: 'Section', format: 0, version: 1 }],
          },
        ],
      },
    });
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'L',
                  slug: 'lexical',
                  html: null,
                  lexical,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    const body = await readFile(join(cwd, 'content/posts/lexical.md'), 'utf8');
    expect(body).toContain('Hello **world**');
    expect(body).toContain('## Section');
  });

  test('renders an older Ghost post body from the `mobiledoc` field', async () => {
    const mobiledoc = JSON.stringify({
      version: '0.3.1',
      atoms: [],
      cards: [['image', { src: '/content/images/legacy.jpg', alt: 'L' }]],
      markups: [['strong']],
      sections: [
        [1, 'p', [[0, [0], 1, 'bold start']]],
        [10, 0],
      ],
    });
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'M',
                  slug: 'mobiledoc',
                  html: null,
                  mobiledoc,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    const body = await readFile(join(cwd, 'content/posts/mobiledoc.md'), 'utf8');
    expect(body).toContain('**bold start**');
    expect(body).toContain('/content/images/legacy.jpg');
  });

  test('prefers `html` when both html and lexical are present', async () => {
    const lexical = JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'extended-text', text: 'from-lexical', format: 0, version: 1 }],
          },
        ],
      },
    });
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Pref',
                  slug: 'prefer-html',
                  html: '<p>from-html</p>',
                  lexical,
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    await importGhostExport({ cwd, file: exportFile });
    const body = await readFile(join(cwd, 'content/posts/prefer-html.md'), 'utf8');
    expect(body).toContain('from-html');
    expect(body).not.toContain('from-lexical');
  });

  test('strips a leading h1 that duplicates the Ghost title', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Fish & Chips',
                  slug: 'duplicate-h1',
                  html: '<h1> Fish &amp;\n Chips </h1><p>Body copy</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    const body = await readFile(join(cwd, 'content/posts/duplicate-h1.md'), 'utf8');
    expect(body).toContain('Body copy');
    expect(body).not.toContain('# Fish & Chips');
  });

  test('keeps a leading h1 when it does not match the Ghost title', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Fish & Chips',
                  slug: 'different-h1',
                  html: '<h1>Different heading</h1><p>Body copy</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    const body = await readFile(join(cwd, 'content/posts/different-h1.md'), 'utf8');
    expect(body).toContain('# Different heading');
    expect(body).toContain('Body copy');
  });

  test('warns and writes an empty body when lexical JSON is unrenderable', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Broken',
                  slug: 'broken',
                  html: null,
                  lexical: 'not json',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
    expect(captured.data).toContain('Lexical body is not valid JSON');
    const body = await readFile(join(cwd, 'content/posts/broken.md'), 'utf8');
    // The frontmatter is still written; the body section is empty.
    expect(body).toContain('slug: "broken"');
    expect(body.trim().endsWith('---')).toBe(true);
  });
});

describe('importGhostExport — posts_tags/posts_authors bucketing (#139)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('emits tags and authors in sort_order, scoped to each post', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'First',
                slug: 'first',
                html: '<p>first</p>',
                status: 'published',
                type: 'post',
              },
              {
                id: 'p2',
                title: 'Second',
                slug: 'second',
                html: '<p>second</p>',
                status: 'published',
                type: 'post',
              },
            ],
            tags: [
              { id: 't-a', slug: 'alpha', name: 'Alpha' },
              { id: 't-b', slug: 'beta', name: 'Beta' },
              { id: 't-c', slug: 'gamma', name: 'Gamma' },
            ],
            users: [
              { id: 'u-a', slug: 'ann', name: 'Ann' },
              { id: 'u-b', slug: 'bob', name: 'Bob' },
            ],
            // Intentionally shuffled so the implementation must respect
            // sort_order rather than insertion order to produce alpha, beta, gamma.
            posts_tags: [
              { post_id: 'p1', tag_id: 't-c', sort_order: 2 },
              { post_id: 'p2', tag_id: 't-b', sort_order: 0 },
              { post_id: 'p1', tag_id: 't-a', sort_order: 0 },
              { post_id: 'p1', tag_id: 't-b', sort_order: 1 },
            ],
            posts_authors: [
              { post_id: 'p1', user_id: 'u-b', sort_order: 1 },
              { post_id: 'p2', user_id: 'u-a', sort_order: 0 },
              { post_id: 'p1', user_id: 'u-a', sort_order: 0 },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));
    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(2);

    const p1 = await readFile(join(cwd, 'content/posts/first.md'), 'utf8');
    expect(p1).toContain('tags: ["alpha", "beta", "gamma"]');
    expect(p1).toContain('authors: ["ann", "bob"]');

    const p2 = await readFile(join(cwd, 'content/posts/second.md'), 'utf8');
    expect(p2).toContain('tags: ["beta"]');
    expect(p2).toContain('authors: ["ann"]');
  });

  test('falls back to Ghost post created_by when posts_authors is missing', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Authored without join row',
                slug: 'authored-without-join-row',
                html: '<p>body</p>',
                status: 'published',
                type: 'post',
                created_by: 'u-a',
              },
            ],
            users: [{ id: 'u-a', slug: 'ann', name: 'Ann' }],
            posts_authors: [],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));
    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(1);
    expect(summary.authors).toBe(1);

    const post = await readFile(join(cwd, 'content/posts/authored-without-join-row.md'), 'utf8');
    expect(post).toContain('authors: ["ann"]');
  });

  test('accepts Ghost posts_authors author_id exports', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Authored with author id',
                slug: 'authored-with-author-id',
                html: '<p>body</p>',
                status: 'published',
                type: 'post',
              },
            ],
            users: [{ id: 'u-a', slug: 'ann', name: 'Ann' }],
            posts_authors: [{ post_id: 'p1', author_id: 'u-a', sort_order: 0 }],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));
    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    expect(summary.posts).toBe(1);
    expect(summary.authors).toBe(1);

    const post = await readFile(join(cwd, 'content/posts/authored-with-author-id.md'), 'utf8');
    expect(post).toContain('authors: ["ann"]');
  });
});

describe('importGhostExport — --dry-run (#502)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('counts what would land without writing markdown files', async () => {
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Published',
                  slug: 'published',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
                {
                  id: 'p2',
                  title: 'A Draft',
                  slug: 'a-draft',
                  html: '<p>draft body</p>',
                  status: 'draft',
                  type: 'post',
                },
                {
                  id: 'p3',
                  title: 'Scheduled',
                  slug: 'scheduled',
                  html: '<p>x</p>',
                  status: 'scheduled',
                  type: 'post',
                },
                {
                  id: 'p4',
                  title: 'Empty Body',
                  slug: 'empty-body',
                  html: null,
                  lexical: 'not json',
                  status: 'published',
                  type: 'post',
                },
                {
                  id: 'p5',
                  title: 'About',
                  slug: 'about',
                  html: '<p>about</p>',
                  status: 'published',
                  type: 'page',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'news',
                  name: 'News',
                  description: 'newsy',
                },
              ],
              users: [{ id: 'u1', slug: 'jane', name: 'Jane' }],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({ cwd, file: exportFile, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.posts).toBe(3);
    expect(summary.pages).toBe(1);
    expect(summary.drafts).toBe(1);
    expect(summary.statusFiltered).toBe(1);
    expect(summary.bodiesEmpty).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.authors).toBe(1);

    await expect(access(join(cwd, 'content/posts/published.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/posts/a-draft.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/pages/about.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/tags/news.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/authors/jane.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/posts'))).rejects.toThrow();
  });

  test('counts assets that would be copied without copying them', async () => {
    const exportFolder = join(cwd, 'ghost-export');
    await Bun.write(
      join(exportFolder, 'my-blog.ghost.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
    await Bun.write(join(exportFolder, 'content/images/2024/cover.jpg'), 'COVER');
    await Bun.write(join(exportFolder, 'content/files/handout.pdf'), 'PDF');

    const summary = await importGhostExport({ cwd, file: exportFolder, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.posts).toBe(1);
    expect(summary.assetsCopied).toBe(2);
    await expect(access(join(cwd, 'content/posts/hello.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/images/2024/cover.jpg'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/files/handout.pdf'))).rejects.toThrow();
  });

  test('skips network entirely when --download-images is combined with --dry-run', async () => {
    let fetchCalls = 0;
    const fakeFetch = (async () => {
      fetchCalls += 1;
      return new Response('IMG', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as unknown as typeof fetch;

    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'WithImage',
                  slug: 'with-image',
                  html: '<p><img src="https://example.com/a.jpg"></p>',
                  feature_image: 'https://example.com/cover.jpg',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      dryRun: true,
      downloadImages: true,
      fetcher: fakeFetch,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.imagesDownloaded).toBe(0);
    expect(summary.imagesFailed).toBe(0);
    expect(fetchCalls).toBe(0);
    await expect(access(join(cwd, 'content/posts/with-image.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'content/images'))).rejects.toThrow();
  });

  test('reports would-skip conflict counts but never writes', async () => {
    const dest = join(cwd, 'content/posts/hello.md');
    await ensureDir(join(cwd, 'content/posts'));
    await writeFile(dest, 'EXISTING');
    await writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      dryRun: true,
      onConflict: 'skip',
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.posts).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(await readFile(dest, 'utf8')).toBe('EXISTING');
  });
});

describe('importGhostExport — outputDir (#265)', () => {
  let cwd: string;
  let exportFolder: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-output-')));
    exportFolder = join(cwd, 'ghost-export');
    await Bun.write(
      join(exportFolder, 'my-blog.ghost.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'Old News',
                  name: 'Old News',
                  description: 'newsy',
                },
              ],
            },
          },
        ],
      }),
    );
    await Bun.write(join(exportFolder, 'content/images/2024/cover.jpg'), 'COVER');
    await Bun.write(
      join(exportFolder, 'content/data/redirects.json'),
      JSON.stringify([{ from: '^/legacy/$', to: '/hello/', permanent: true }]),
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('writes markdown, assets, and redirect files under the review output root', async () => {
    const outputDir = join(cwd, 'review-import');
    const summary = await importGhostExport({
      cwd,
      file: exportFolder,
      outputDir,
      onConflict: 'overwrite',
    });

    expect(summary.posts).toBe(1);
    expect(summary.tags).toBe(1);
    expect(summary.assetsCopied).toBe(1);
    expect(summary.redirectsImported).toBe(1);
    expect(summary.slugRedirects).toBe(1);
    expect(summary.plannedPaths).toContain(join(outputDir, 'posts/hello.md'));
    expect(summary.plannedPaths).toContain(join(outputDir, 'images/2024/cover.jpg'));
    expect(summary.plannedPaths).toContain(join(outputDir, 'migration/redirects/_redirects'));

    expect(await readFile(join(outputDir, 'posts/hello.md'), 'utf8')).toContain('title: "Hello"');
    expect(await readFile(join(outputDir, 'images/2024/cover.jpg'), 'utf8')).toBe('COVER');
    expect(await readFile(join(outputDir, 'migration/redirects/_redirects'), 'utf8')).toContain(
      '/legacy/  /hello/  301',
    );
    await expect(access(join(cwd, 'content/posts/hello.md'))).rejects.toThrow();
    await expect(access(join(cwd, 'migration/redirects/_redirects'))).rejects.toThrow();
  });
});

describe('importGhostExport — Ghost project YAML files (#1010)', () => {
  let cwd: string;
  let exportFolder: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-project-yaml-')));
    exportFolder = join(cwd, 'ghost-export');
    await Bun.write(
      join(exportFolder, 'my-blog.ghost.json'),
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>hi</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('copies Ghost routes and redirects YAML from content into the project root', async () => {
    await Bun.write(
      join(exportFolder, 'content/settings/routes.yaml'),
      'routes:\n  /featured/:\n    template: featured\n',
    );
    await Bun.write(
      join(exportFolder, 'content/data/redirects.yml'),
      '- from: /old/\n  to: /new/\n  status: 301\n',
    );

    const summary = await importGhostExport({ cwd, file: exportFolder, onConflict: 'overwrite' });

    expect(summary.plannedPaths).toContain(join(cwd, 'routes.yaml'));
    expect(summary.plannedPaths).toContain(join(cwd, 'redirects.yml'));
    expect(await readFile(join(cwd, 'routes.yaml'), 'utf8')).toContain('/featured/');
    expect(await readFile(join(cwd, 'redirects.yml'), 'utf8')).toContain('from: /old/');
  });

  test('does not overwrite existing project routes or redirects files', async () => {
    await Bun.write(join(exportFolder, 'content/routes.yaml'), 'routes:\n  /ghost/: ghost\n');
    await Bun.write(join(exportFolder, 'content/redirects.yaml'), '- from: /ghost/\n  to: /\n');
    await Bun.write(join(cwd, 'routes.yml'), 'routes:\n  /existing/: existing\n');
    await Bun.write(join(cwd, 'redirects.yaml'), '- from: /existing/\n  to: /\n');

    const summary = await importGhostExport({ cwd, file: exportFolder, onConflict: 'overwrite' });

    expect(summary.plannedPaths).not.toContain(join(cwd, 'routes.yaml'));
    expect(summary.plannedPaths).not.toContain(join(cwd, 'redirects.yaml'));
    expect(await readFile(join(cwd, 'routes.yml'), 'utf8')).toContain('/existing/');
    expect(await readFile(join(cwd, 'redirects.yaml'), 'utf8')).toContain('/existing/');
    await expect(access(join(cwd, 'routes.yaml'))).rejects.toThrow();
  });

  test('plans project YAML copies in dry-run without writing them', async () => {
    await Bun.write(join(exportFolder, 'content/routes.yml'), 'routes:\n  /dry/: dry\n');
    await Bun.write(join(exportFolder, 'content/data/redirects.yaml'), '- from: /dry/\n  to: /\n');

    const summary = await importGhostExport({
      cwd,
      file: exportFolder,
      dryRun: true,
      onConflict: 'overwrite',
    });

    expect(summary.plannedPaths).toContain(join(cwd, 'routes.yml'));
    expect(summary.plannedPaths).toContain(join(cwd, 'redirects.yaml'));
    await expect(access(join(cwd, 'routes.yml'))).rejects.toThrow();
    await expect(access(join(cwd, 'redirects.yaml'))).rejects.toThrow();
  });

  test('copies project YAML files under the review output root when --output is used', async () => {
    const outputDir = join(cwd, 'review-import');
    await Bun.write(join(exportFolder, 'content/routes.yaml'), 'routes:\n  /review/: review\n');
    await Bun.write(
      join(exportFolder, 'content/redirects.yaml'),
      '- from: /review-old/\n  to: /\n',
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFolder,
      outputDir,
      onConflict: 'overwrite',
    });

    expect(summary.plannedPaths).toContain(join(outputDir, 'routes.yaml'));
    expect(summary.plannedPaths).toContain(join(outputDir, 'redirects.yaml'));
    expect(await readFile(join(outputDir, 'routes.yaml'), 'utf8')).toContain('/review/');
    expect(await readFile(join(outputDir, 'redirects.yaml'), 'utf8')).toContain('/review-old/');
    await expect(access(join(cwd, 'routes.yaml'))).rejects.toThrow();
    await expect(access(join(cwd, 'redirects.yaml'))).rejects.toThrow();
  });
});

describe('importGhostExport — Ghost settings config import (#1042)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-settings-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  function writeSettingsExport(): Promise<void> {
    return writeFile(
      exportFile,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [],
              settings: [
                { key: 'title', value: 'Ghost Publication', group: 'site' },
                { key: 'description', value: 'Imported from Ghost', group: 'site' },
                { key: 'url', value: 'https://ghost.example', group: 'site' },
                {
                  key: 'navigation',
                  value: JSON.stringify([
                    { label: 'Home', url: '/' },
                    { label: 'About', url: '/about/' },
                  ]),
                  group: 'site',
                },
                {
                  key: 'secondary_navigation',
                  value: JSON.stringify([{ label: 'RSS', url: '/rss/' }]),
                  group: 'site',
                },
              ],
            },
          },
        ],
      }),
      'utf8',
    );
  }

  test('writes site metadata and navigation into laurel.toml when no config exists', async () => {
    await writeSettingsExport();

    const summary = await importGhostExport({ cwd, file: exportFile });
    const configPath = join(cwd, 'laurel.toml');
    const parsed = TOML.parse(await readFile(configPath, 'utf8')) as {
      site?: { title?: string; description?: string; url?: string };
      navigation?: Array<{ label: string; url: string }>;
      secondary_navigation?: Array<{ label: string; url: string }>;
    };

    expect(summary.plannedPaths).toContain(configPath);
    expect(parsed.site?.title).toBe('Ghost Publication');
    expect(parsed.site?.description).toBe('Imported from Ghost');
    expect(parsed.site?.url).toBe('https://ghost.example');
    expect(parsed.navigation).toEqual([
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about/' },
    ]);
    expect(parsed.secondary_navigation).toEqual([{ label: 'RSS', url: '/rss/' }]);
  });

  test('default fill-merges missing keys into an existing laurel.toml without clobbering', async () => {
    await writeSettingsExport();
    const configPath = join(cwd, 'laurel.toml');
    await writeFile(
      configPath,
      [
        '[site]',
        'title = "Existing Site"',
        'description = "Keep me"',
        '',
        '[[navigation]]',
        'label = "Existing"',
        'url = "/existing/"',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await importGhostExport({ cwd, file: exportFile });
    const body = await readFile(configPath, 'utf8');
    const parsed = TOML.parse(body) as {
      site?: { title?: string; description?: string; url?: string };
      navigation?: Array<{ label: string; url: string }>;
      secondary_navigation?: Array<{ label: string; url: string }>;
    };

    // The config was missing `url` and `secondary_navigation`, so it is merged
    // (not skipped wholesale) — that is what lets imported settings (incl.
    // downloaded image paths) reach the build.
    expect(summary.skipped).toBe(0);
    expect(summary.plannedPaths).toContain(configPath);
    expect(captured.data).toContain('Merged');
    // Existing values win (fill mode never clobbers)...
    expect(parsed.site?.title).toBe('Existing Site');
    expect(parsed.site?.description).toBe('Keep me');
    expect(parsed.navigation).toEqual([{ label: 'Existing', url: '/existing/' }]);
    expect(body).not.toContain('Ghost Publication');
    // ...and the keys the config lacked are filled in from the import.
    expect(parsed.site?.url).toBe('https://ghost.example');
    expect(parsed.secondary_navigation).toEqual([{ label: 'RSS', url: '/rss/' }]);
  });

  test('default skip leaves a laurel.toml that already has every imported key untouched', async () => {
    await writeSettingsExport();
    const configPath = join(cwd, 'laurel.toml');
    const original = [
      '# keep my comments',
      '[site]',
      'title = "Existing Site"',
      'description = "Keep me"',
      'url = "https://kept.example"',
      '',
      '[[navigation]]',
      'label = "Existing"',
      'url = "/existing/"',
      '',
      '[[secondary_navigation]]',
      'label = "Kept"',
      'url = "/kept/"',
      '',
    ].join('\n');
    await writeFile(configPath, original, 'utf8');

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.skipped).toBe(1);
    expect(summary.plannedPaths).not.toContain(configPath);
    expect(captured.data).toContain(`Skipped (already complete): ${configPath}`);
    expect(await readFile(configPath, 'utf8')).toBe(original);
  });

  test('--on-conflict overwrite updates imported settings while preserving other config', async () => {
    await writeSettingsExport();
    const configPath = join(cwd, 'laurel.toml');
    await writeFile(
      configPath,
      [
        '[site]',
        'title = "Existing Site"',
        'description = "Keep me"',
        '',
        '[build]',
        'posts_per_page = 7',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });
    const parsed = TOML.parse(await readFile(configPath, 'utf8')) as {
      site?: { title?: string; description?: string };
      build?: { posts_per_page?: number };
      navigation?: Array<{ label: string; url: string }>;
    };

    expect(summary.overwritten).toBe(1);
    expect(summary.plannedPaths).toContain(configPath);
    expect(parsed.site?.title).toBe('Ghost Publication');
    expect(parsed.site?.description).toBe('Imported from Ghost');
    expect(parsed.build?.posts_per_page).toBe(7);
    expect(parsed.navigation).toEqual([
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about/' },
    ]);
  });
});

describe('importGhostExport — JSON size cap (#558)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-size-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('rejects an export whose JSON exceeds maxFileSizeBytes before parsing', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const fileSize = (await readFile(exportFile)).byteLength;
    expect(fileSize).toBeGreaterThan(10);

    await expect(
      importGhostExport({ cwd, file: exportFile, maxFileSizeBytes: 10 }),
    ).rejects.toThrow(/exceeds the configured cap/);

    const exists = await access(join(cwd, 'content/posts/hello.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test('default cap (256 MiB) admits a normal-sized export', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));

    const summary = await importGhostExport({ cwd, file: exportFile });

    expect(summary.posts).toBe(1);
  });

  test('explicit maxFileSizeBytes raises the cap as expected', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));
    const fileSize = (await readFile(exportFile)).byteLength;

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      maxFileSizeBytes: fileSize + 1,
    });

    expect(summary.posts).toBe(1);
  });

  test('maxFileSizeBytes=0 disables the size check', async () => {
    await writeFile(exportFile, makeExport([{ slug: 'hello', title: 'Hello' }]));

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      maxFileSizeBytes: 0,
    });

    expect(summary.posts).toBe(1);
  });

  test('size cap is enforced against the JSON inside a folder input, not the directory entry', async () => {
    const exportDir = join(cwd, 'ghost-export');
    await ensureDir(exportDir);
    const jsonPath = join(exportDir, 'ghost.json');
    await writeFile(jsonPath, makeExport([{ slug: 'hello', title: 'Hello' }]));

    await expect(importGhostExport({ cwd, file: exportDir, maxFileSizeBytes: 5 })).rejects.toThrow(
      /exceeds the configured cap/,
    );
  });
});

describe('importGhostExport — post HTML Turndown safety cap (#1157)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-html-cap-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('falls back to an empty Markdown body when rendered post HTML exceeds the cap', async () => {
    const body = 'x'.repeat(256);
    await writeFile(
      exportFile,
      makeExport([{ slug: 'oversized', title: 'Oversized', html: `<p>${body}</p>` }]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      maxPostHtmlSizeBytes: 64,
    });

    const out = await readFile(join(cwd, 'content/posts/oversized.md'), 'utf8');
    expect(summary.posts).toBe(1);
    expect(summary.bodiesEmpty).toBe(1);
    expect(out).toContain('title: "Oversized"');
    expect(out).not.toContain(body);
    expect(captured.data).toContain('exceeds the configured per-post HTML cap');
    expect(captured.data).toContain('Falling back to an empty Markdown body');
  });

  test('maxPostHtmlSizeBytes=0 disables the per-post HTML cap', async () => {
    const body = 'cap disabled body';
    await writeFile(
      exportFile,
      makeExport([{ slug: 'uncapped', title: 'Uncapped', html: `<p>${body}</p>` }]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      maxPostHtmlSizeBytes: 0,
    });

    const out = await readFile(join(cwd, 'content/posts/uncapped.md'), 'utf8');
    expect(summary.posts).toBe(1);
    expect(summary.bodiesEmpty).toBe(0);
    expect(out).toContain(body);
    expect(captured.data).toBe('');
  });
});

describe('importGhostExport — image URL scheme sanitization (#562)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-img-sanitize-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('strips javascript:/data:/file: URLs from post image fields and logs a warning', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Compromised',
                slug: 'compromised',
                html: '<p>body</p>',
                feature_image: 'javascript:alert(1)',
                og_image: 'data:text/html,<script>alert(1)</script>',
                twitter_image: 'file:///etc/passwd',
                status: 'published',
                published_at: '2024-01-01T00:00:00.000Z',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
    });

    expect(summary.posts).toBe(1);

    const postMd = await readFile(join(cwd, 'content/posts/compromised.md'), 'utf8');
    expect(postMd).not.toContain('javascript:');
    expect(postMd).not.toContain('data:text/html');
    expect(postMd).not.toContain('file:///');
    expect(postMd).not.toMatch(/^feature_image:/m);
    expect(postMd).not.toMatch(/^og_image:/m);
    expect(postMd).not.toMatch(/^twitter_image:/m);

    expect(captured.data).toContain('Refusing unsafe feature_image URL');
    expect(captured.data).toContain('Refusing unsafe og_image URL');
    expect(captured.data).toContain('Refusing unsafe twitter_image URL');
  });

  test('strips javascript: URLs from tag.feature_image and author profile_image / cover_image', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Post',
                slug: 'post',
                html: '<p>body</p>',
                status: 'published',
                published_at: '2024-01-01T00:00:00.000Z',
              },
            ],
            tags: [
              {
                id: 't1',
                slug: 'news',
                name: 'News',
                description: 'desc',
                feature_image: 'javascript:alert("tag")',
                meta_title: 'News',
              },
            ],
            users: [
              {
                id: 'u1',
                slug: 'casper',
                name: 'Casper',
                profile_image: 'data:text/html,<script>1</script>',
                cover_image: 'vbscript:msgbox(1)',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
    });

    expect(summary.tags).toBe(1);
    expect(summary.authors).toBe(1);

    const tagMd = await readFile(join(cwd, 'content/tags/news.md'), 'utf8');
    expect(tagMd).not.toContain('javascript:');
    expect(tagMd).not.toMatch(/^feature_image:/m);

    const authorMd = await readFile(join(cwd, 'content/authors/casper.md'), 'utf8');
    expect(authorMd).not.toContain('data:');
    expect(authorMd).not.toContain('vbscript:');
    expect(authorMd).not.toMatch(/^profile_image:/m);
    expect(authorMd).not.toMatch(/^cover_image:/m);

    expect(captured.data).toContain('Refusing unsafe feature_image URL');
    expect(captured.data).toContain('Refusing unsafe profile_image URL');
    expect(captured.data).toContain('Refusing unsafe cover_image URL');
  });

  test('treats leading whitespace + javascript: as unsafe (browsers strip whitespace before resolving)', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Sneaky',
                slug: 'sneaky',
                html: '<p>body</p>',
                feature_image: '\t javascript:alert(1)',
                status: 'published',
                published_at: '2024-01-01T00:00:00.000Z',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    const postMd = await readFile(join(cwd, 'content/posts/sneaky.md'), 'utf8');
    expect(postMd).not.toContain('javascript:');
    expect(postMd).not.toMatch(/^feature_image:/m);
    expect(captured.data).toContain('Refusing unsafe feature_image URL');
  });

  test('keeps http(s):// URLs and relative paths intact', async () => {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Legit',
                slug: 'legit',
                html: '<p>body</p>',
                feature_image: 'https://cdn.example.com/cover.jpg',
                og_image: '/content/images/og.jpg',
                twitter_image: 'content/images/tw.jpg',
                status: 'published',
                published_at: '2024-01-01T00:00:00.000Z',
              },
            ],
          },
        },
      ],
    };

    await writeFile(exportFile, JSON.stringify(ghostExport));

    await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    const postMd = await readFile(join(cwd, 'content/posts/legit.md'), 'utf8');
    expect(postMd).toContain('feature_image: "https://cdn.example.com/cover.jpg"');
    expect(postMd).toContain('og_image: "/content/images/og.jpg"');
    expect(postMd).toContain('twitter_image: "content/images/tw.jpg"');
    expect(captured.data).not.toContain('Refusing unsafe');
  });
});

describe('importGhostExport — code injection opt-in (#561)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-ci-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function writeExportWithInjection(): Promise<void> {
    const ghostExport = {
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'With Head',
                slug: 'with-head',
                html: '<p>body</p>',
                status: 'published',
                type: 'post',
                codeinjection_head: '<script src="https://attacker.example/x.js"></script>',
              },
              {
                id: 'p2',
                title: 'With Foot',
                slug: 'with-foot',
                html: '<p>body</p>',
                status: 'published',
                type: 'post',
                codeinjection_foot: '<script>alert(1)</script>',
              },
              {
                id: 'p3',
                title: 'Clean',
                slug: 'clean',
                html: '<p>body</p>',
                status: 'published',
                type: 'post',
              },
              {
                id: 'p4',
                title: 'Empty Strings',
                slug: 'empty-strings',
                html: '<p>body</p>',
                status: 'published',
                type: 'post',
                codeinjection_head: '',
                codeinjection_foot: '',
              },
            ],
          },
        },
      ],
    };
    return writeFile(exportFile, JSON.stringify(ghostExport));
  }

  test('default omits codeinjection fields and counts the affected posts', async () => {
    await writeExportWithInjection();
    const summary = await importGhostExport({ cwd, file: exportFile, onConflict: 'overwrite' });

    expect(summary.codeInjectionSkipped).toBe(2);

    const headMd = await readFile(join(cwd, 'content/posts/with-head.md'), 'utf8');
    expect(headMd).not.toContain('codeinjection_head');
    expect(headMd).not.toContain('attacker.example');
    const footMd = await readFile(join(cwd, 'content/posts/with-foot.md'), 'utf8');
    expect(footMd).not.toContain('codeinjection_foot');
    expect(footMd).not.toContain('alert(1)');
    const cleanMd = await readFile(join(cwd, 'content/posts/clean.md'), 'utf8');
    expect(cleanMd).not.toContain('codeinjection_head');
    const emptyMd = await readFile(join(cwd, 'content/posts/empty-strings.md'), 'utf8');
    expect(emptyMd).not.toContain('codeinjection_head');
    expect(emptyMd).not.toContain('codeinjection_foot');
  });

  test('keepCodeInjection: true preserves the fields verbatim and zeroes the counter', async () => {
    await writeExportWithInjection();
    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
      keepCodeInjection: true,
    });

    expect(summary.codeInjectionSkipped).toBe(0);

    const headMd = await readFile(join(cwd, 'content/posts/with-head.md'), 'utf8');
    expect(headMd).toContain(
      'codeinjection_head: "<script src=\\"https://attacker.example/x.js\\"></script>"',
    );
    const footMd = await readFile(join(cwd, 'content/posts/with-foot.md'), 'utf8');
    expect(footMd).toContain('codeinjection_foot: "<script>alert(1)</script>"');
  });
});

describe('importGhostExport — parallel render and write (#522, #523)', () => {
  let cwd: string;
  let exportFile: string;
  let captured: CapturedStderr;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-parallel-')));
    exportFile = join(cwd, 'export.json');
    captured = captureStderr();
  });

  afterEach(async () => {
    captured.restore();
    await rm(cwd, { recursive: true, force: true });
  });

  test('many distinct posts write to disk and the totals match the input count (#522)', async () => {
    // Backlog #522: serial writeFile per post was 150s at 50k posts. The
    // bounded fan-out has to produce exactly the same set of output files
    // as the serial implementation did — duplicates or drops would surface
    // as a mismatched count or a missing slug.
    const total = 200;
    const posts = Array.from({ length: total }, (_, i) => ({
      slug: `parallel-${i}`,
      title: `Parallel ${i}`,
      html: `<p>Body number ${i}.</p>`,
    }));
    await writeFile(exportFile, makeExport(posts));

    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.posts).toBe(total);

    const entries = await readdir(join(cwd, 'content/posts'));
    expect(entries.length).toBe(total);
    // Spot-check both ends so a mid-batch drop would surface.
    expect(await readFile(join(cwd, 'content/posts/parallel-0.md'), 'utf8')).toContain(
      'title: "Parallel 0"',
    );
    expect(await readFile(join(cwd, 'content/posts/parallel-199.md'), 'utf8')).toContain(
      'Body number 199.',
    );
  });

  test('turndown body rendering is consistent under the parallel fan-out (#523)', async () => {
    // Backlog #523: turndown was called sync in a serial loop. Wrapping
    // it in pLimit-driven parallelism preserves output bytes — same HTML
    // in, same Markdown out, regardless of which task happens to resolve
    // first. Use a body with several inline elements so we'd notice a
    // regression that drops a rule (e.g. only sometimes applies <strong>).
    const total = 60;
    const posts = Array.from({ length: total }, (_, i) => ({
      slug: `turndown-${i}`,
      title: `Turndown ${i}`,
      html: `<p>Para <strong>${i}</strong> with <em>emphasis</em> and a <a href="/x">link</a>.</p>`,
    }));
    await writeFile(exportFile, makeExport(posts));

    await importGhostExport({ cwd, file: exportFile });

    for (let i = 0; i < total; i++) {
      const md = await readFile(join(cwd, `content/posts/turndown-${i}.md`), 'utf8');
      expect(md).toContain(`Para **${i}** with _emphasis_ and a [link](/x).`);
    }
  });

  test('intra-export slug collisions are still detected under the parallel path (#1138, #522)', async () => {
    // The race window between writtenThisRun.has and the actual write
    // could let two same-slug posts both pass the gate without the
    // claimedInRun guard. Verify the original "first occurrence wins"
    // contract survives.
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'dup', title: 'First' },
        { slug: 'dup', title: 'Second' },
        { slug: 'dup', title: 'Third' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'overwrite',
    });

    expect(summary.posts).toBe(1);
    expect(summary.slugCollisions).toBe(2);
    expect(await readFile(join(cwd, 'content/posts/dup.md'), 'utf8')).toContain('title: "First"');
  });

  test('rename policy under parallel writes still picks unique numeric suffixes (#522)', async () => {
    // The rename branch walks nextAvailablePath, which has to see both the
    // writtenThisRun claims AND the on-disk state. Three same-slug posts
    // must land on three distinct files.
    await writeFile(
      exportFile,
      makeExport([
        { slug: 'shared', title: 'First' },
        { slug: 'shared', title: 'Second' },
        { slug: 'shared', title: 'Third' },
      ]),
    );

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      onConflict: 'rename',
    });

    expect(summary.posts).toBe(3);
    expect(summary.renamed).toBe(2);
    expect(summary.slugCollisions).toBe(0);
    const a = await readFile(join(cwd, 'content/posts/shared.md'), 'utf8');
    const b = await readFile(join(cwd, 'content/posts/shared-2.md'), 'utf8');
    const c = await readFile(join(cwd, 'content/posts/shared-3.md'), 'utf8');
    const titles = new Set([a, b, c].map((md) => md.match(/title: "(\w+)"/)?.[1] ?? ''));
    expect(titles).toEqual(new Set(['First', 'Second', 'Third']));
  });
});

describe('importGhostExport — source URL inference (#674)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-infer-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function fakeFetch(ok: Record<string, string>): { fetcher: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (url in ok) {
        return new Response(ok[url], { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetcher, calls };
  }

  // A Ghost export keeps `__GHOST_URL__` as the origin sentinel; the `url`
  // setting carries the real site URL for a self-hosted export.
  function exportWithUrlSetting(urlSetting: string): string {
    return JSON.stringify({
      db: [
        {
          data: {
            posts: [
              {
                id: 'p1',
                title: 'Hello',
                slug: 'hello',
                html: '<p><img src="__GHOST_URL__/content/images/2024/01/cover.jpg" alt="c" /></p>',
                feature_image: '__GHOST_URL__/content/images/2024/01/cover.jpg',
                status: 'published',
                type: 'post',
              },
            ],
            settings: [{ key: 'url', value: urlSetting }],
          },
        },
      ],
    });
  }

  test('infers the source URL from the export `url` setting and downloads images', async () => {
    await writeFile(exportFile, exportWithUrlSetting('https://oldblog.com'));
    const fetchUrl = 'https://oldblog.com/content/images/2024/01/cover.jpg';
    const { fetcher, calls } = fakeFetch({ [fetchUrl]: 'BYTES' });

    // The inferred-URL notice is informational, so it lands on stdout.
    const originalWrite = process.stdout.write.bind(process.stdout);
    let stdout = '';
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stdout.write;
    let summary: Awaited<ReturnType<typeof importGhostExport>>;
    try {
      summary = await importGhostExport({ cwd, file: exportFile, downloadImages: true, fetcher });
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(summary.imagesDownloaded).toBe(1);
    expect(calls).toContain(fetchUrl);
    expect(stdout).toContain('inferred from the export');
    const written = await readFile(join(cwd, 'content/images/2024/01/cover.jpg'), 'utf8');
    expect(written).toBe('BYTES');
  });

  test('warns and skips when no source URL is given and the export has no usable url', async () => {
    // `__GHOST_URL__` is stripped to empty, so it is not a usable absolute URL.
    await writeFile(exportFile, exportWithUrlSetting('__GHOST_URL__'));
    const { fetcher, calls } = fakeFetch({});

    const capture = captureStderr();
    let summary: Awaited<ReturnType<typeof importGhostExport>>;
    try {
      summary = await importGhostExport({ cwd, file: exportFile, downloadImages: true, fetcher });
    } finally {
      capture.restore();
    }

    expect(summary.imagesDownloaded).toBe(0);
    expect(calls).toEqual([]);
    expect(capture.data).toContain('--download-images was given without --source-url');
    // The reference stays root-relative (a broken link the warning flags).
    const md = await readFile(join(cwd, 'content/posts/hello.md'), 'utf8');
    expect(md).toContain('/content/images/2024/01/cover.jpg');
  });

  test('an explicit --source-url overrides the inferred one', async () => {
    await writeFile(exportFile, exportWithUrlSetting('https://inferred.example'));
    const explicit = 'https://explicit.example/content/images/2024/01/cover.jpg';
    const { fetcher, calls } = fakeFetch({ [explicit]: 'BYTES' });

    const summary = await importGhostExport({
      cwd,
      file: exportFile,
      downloadImages: true,
      sourceUrl: 'https://explicit.example',
      fetcher,
    });

    expect(summary.imagesDownloaded).toBe(1);
    expect(calls).toContain(explicit);
    expect(calls).not.toContain('https://inferred.example/content/images/2024/01/cover.jpg');
  });
});

describe('importGhostExport — alt from filename (#676)', () => {
  let cwd: string;
  let exportFile: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-ghost-alt-')));
    exportFile = join(cwd, 'export.json');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function exportWith(html: string): string {
    return JSON.stringify({
      db: [
        {
          data: {
            posts: [
              { id: 'p1', title: 'Post', slug: 'p', html, status: 'published', type: 'post' },
            ],
          },
        },
      ],
    });
  }

  function bodyOf(): Promise<string> {
    return readFile(join(cwd, 'content/posts/p.md'), 'utf8');
  }

  test('backfills empty alt from the filename when --alt-from-filename is set', async () => {
    await writeFile(
      exportFile,
      exportWith('<p><img src="/content/images/2024/01/my-cat-photo.jpg"></p>'),
    );
    const summary = await importGhostExport({ cwd, file: exportFile, altFromFilename: true });
    expect(summary.altBackfilled).toBe(1);
    expect(await bodyOf()).toContain('![My Cat Photo](/content/images/2024/01/my-cat-photo.jpg)');
  });

  test('leaves empty alt untouched by default', async () => {
    await writeFile(
      exportFile,
      exportWith('<p><img src="/content/images/2024/01/my-cat-photo.jpg"></p>'),
    );
    const summary = await importGhostExport({ cwd, file: exportFile });
    expect(summary.altBackfilled).toBe(0);
    expect(await bodyOf()).toContain('![](/content/images/2024/01/my-cat-photo.jpg)');
  });

  test('does not fabricate alt for letterless filenames', async () => {
    await writeFile(
      exportFile,
      exportWith('<p><img src="/content/images/2024/01/2024-01-01.jpg"></p>'),
    );
    const summary = await importGhostExport({ cwd, file: exportFile, altFromFilename: true });
    expect(summary.altBackfilled).toBe(0);
    expect(await bodyOf()).toContain('![](/content/images/2024/01/2024-01-01.jpg)');
  });

  test('preserves an existing alt', async () => {
    await writeFile(
      exportFile,
      exportWith('<p><img src="/content/images/a-b.jpg" alt="Real caption"></p>'),
    );
    const summary = await importGhostExport({ cwd, file: exportFile, altFromFilename: true });
    expect(summary.altBackfilled).toBe(0);
    expect(await bodyOf()).toContain('![Real caption](/content/images/a-b.jpg)');
  });

  test('escapes a bracket in the filename-derived alt so the image is not corrupted', async () => {
    await writeFile(exportFile, exportWith('<p><img src="/content/images/my-photo].jpg"></p>'));
    const summary = await importGhostExport({ cwd, file: exportFile, altFromFilename: true });
    expect(summary.altBackfilled).toBe(1);
    // The `]` is backslash-escaped so it cannot close the `![...]` label early.
    expect(await bodyOf()).toContain('\\]');
    expect(await bodyOf()).not.toMatch(/!\[[^\]]*\]\][^(]/);
  });
});
