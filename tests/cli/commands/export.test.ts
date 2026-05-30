import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEntryBundleZip } from '~/entry-bundle/index.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-export-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Export Test Site"',
      'description = "A site that exports cleanly"',
      'url = "https://export.test"',
      'locale = "en-US"',
      '',
      '[components.rss]',
      'enabled = true',
      'items = 5',
      'per_tag = false',
      'per_author = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'content/authors/jane.md'),
    ['---', 'name: Jane Doe', 'slug: jane', 'bio: writer', '---', ''].join('\n'),
  );
  await writeFile(
    join(dir, 'content/tags/release.md'),
    ['---', 'name: Release', 'slug: release', '---', ''].join('\n'),
  );
  await writeFile(
    join(dir, 'content/posts/hello-world.md'),
    [
      '---',
      'title: Hello World',
      'slug: hello-world',
      'published_at: 2025-01-01T00:00:00Z',
      'tags: [release]',
      'authors: [jane]',
      '---',
      '',
      'Body of post.',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'content/pages/about.md'),
    [
      '---',
      'title: About',
      'slug: about',
      'published_at: 2025-01-01T00:00:00Z',
      'feature_image: /content/images/about.txt',
      '---',
      '',
      'About page body with ![Cover](/content/images/about.txt).',
      '',
    ].join('\n'),
  );
  await writeFile(join(dir, 'content/images/about.txt'), 'about asset\n');
  return dir;
}

describe('cli export', () => {
  test('--help advertises supported formats and flags', async () => {
    const { stdout, exitCode } = await runCli(['export', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('json');
    expect(stdout).toContain('ghost-json');
    expect(stdout).toContain('rss');
    expect(stdout).toContain('--output');
    expect(stdout).toContain('--pretty');
  });

  test('missing format prints usage error', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['export'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Missing required argument');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('unknown format prints usage error', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['export', 'yaml'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown export format');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export json emits a parseable document with site, posts, pages, tags, authors', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['export', 'json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        nectar: { schema: string };
        site: { title: string; url: string };
        posts: Array<{ slug: string; title: string; tags: string[] }>;
        pages: Array<{ slug: string; title: string }>;
        tags: Array<{ slug: string }>;
        authors: Array<{ slug: string }>;
      };
      expect(parsed.nectar.schema).toBe('nectar.export.v1');
      expect(parsed.site.title).toBe('Export Test Site');
      expect(parsed.site.url).toBe('https://export.test');
      expect(parsed.posts.length).toBe(1);
      expect(parsed.posts[0]?.slug).toBe('hello-world');
      expect(parsed.posts[0]?.tags).toContain('release');
      expect(parsed.pages.some((p) => p.slug === 'about')).toBe(true);
      expect(parsed.tags.some((t) => t.slug === 'release')).toBe(true);
      expect(parsed.authors.some((a) => a.slug === 'jane')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export ghost-json emits Ghost-shaped {db: [{data: {posts, tags, users, ...}}]}', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['export', 'ghost-json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as {
        db: Array<{
          meta: { exported_on: number; version: string };
          data: {
            posts: Array<{ slug: string; type: string }>;
            tags: Array<{ slug: string }>;
            users: Array<{ slug: string }>;
            posts_tags: Array<{ post_id: string; tag_id: string }>;
            posts_authors: Array<{ post_id: string; author_id: string }>;
            settings: Array<{ key: string; value: string | null; group: string }>;
          };
        }>;
      };
      expect(parsed.db.length).toBe(1);
      const data = parsed.db[0]?.data;
      expect(data?.posts.some((p) => p.slug === 'hello-world' && p.type === 'post')).toBe(true);
      expect(data?.posts.some((p) => p.slug === 'about' && p.type === 'page')).toBe(true);
      expect(data?.users.some((u) => u.slug === 'jane')).toBe(true);
      expect(data?.tags.some((t) => t.slug === 'release')).toBe(true);
      expect(data?.posts_tags.length).toBeGreaterThan(0);
      expect(data?.posts_authors.length).toBeGreaterThan(0);
      expect(data?.settings.some((s) => s.key === 'title' && s.value === 'Export Test Site')).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export rss emits a valid XML document with channel + items', async () => {
    const dir = await makeFixture();
    try {
      const { stdout, exitCode } = await runCli(['export', 'rss'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(stdout).toContain('<rss version="2.0"');
      expect(stdout).toContain('<channel>');
      expect(stdout).toContain('<title>Export Test Site</title>');
      expect(stdout).toContain('<link>https://export.test</link>');
      expect(stdout).toContain('<item>');
      expect(stdout).toContain('Hello World');
      expect(stdout).toContain('<guid isPermaLink="false">');
      expect(stdout).not.toContain(
        '<guid isPermaLink="true">https://export.test/hello-world/</guid>',
      );
      expect(stdout).toContain('</channel>');
      expect(stdout).toContain('</rss>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--output writes to a file instead of stdout', async () => {
    const dir = await makeFixture();
    try {
      const target = join(dir, 'exports', 'site.json');
      const { stdout, exitCode } = await runCli(['export', 'json', '--output', target], dir);
      expect(exitCode).toBe(0);
      // stdout should not contain the JSON body when --output is set
      expect(stdout).toBe('');
      const written = await readFile(target, 'utf8');
      const parsed = JSON.parse(written) as { site: { title: string } };
      expect(parsed.site.title).toBe('Export Test Site');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--pretty produces indented JSON', async () => {
    const dir = await makeFixture();
    try {
      const { stdout: compact } = await runCli(['export', 'json'], dir);
      const { stdout: pretty } = await runCli(['export', 'json', '--pretty'], dir);
      expect(compact.includes('\n  "')).toBe(false);
      expect(pretty).toContain('\n  "');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export entry writes a zip to --output path for a post, carrying status as-is', async () => {
    const dir = await makeFixture();
    try {
      // Neutral transport: the bundle carries whatever status the writer set
      // (no needs-review stamping on export).
      await writeFile(
        join(dir, 'content/posts/hello-world.md'),
        [
          '---',
          'title: Hello World',
          'slug: hello-world',
          'status: needs-review',
          '---',
          '',
          'Body of post.',
          '',
        ].join('\n'),
      );
      const outPath = join(dir, 'hello-world.nectar.zip');
      const { stdout, stderr, exitCode } = await runCli(
        ['export', 'entry', 'hello-world', '--output', outPath],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout.trim()).toBe('');
      const bytes = new Uint8Array(await Bun.file(outPath).arrayBuffer());
      const bundle = parseEntryBundleZip(bytes);
      expect(bundle.kind).toBe('post');
      expect(bundle.slug).toBe('hello-world');
      expect(bundle.frontmatter.status).toBe('needs-review');
      expect(bundle.body).toContain('Body of post');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export entry --kind page writes a zip for a page, carrying status as-is', async () => {
    const dir = await makeFixture();
    try {
      // A reviewer returning a verdict: the bundle carries "approved".
      await writeFile(
        join(dir, 'content/pages/about.md'),
        [
          '---',
          'title: About',
          'slug: about',
          'status: approved',
          'feature_image: /content/images/about.txt',
          '---',
          '',
          'About page body with ![Cover](/content/images/about.txt).',
          '',
        ].join('\n'),
      );
      const outPath = join(dir, 'about.nectar.zip');
      const { stderr, exitCode } = await runCli(
        ['export', 'entry', 'about', '--kind', 'page', '--output', outPath],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const bytes = new Uint8Array(await Bun.file(outPath).arrayBuffer());
      const bundle = parseEntryBundleZip(bytes);
      expect(bundle.kind).toBe('page');
      expect(bundle.slug).toBe('about');
      expect(bundle.frontmatter.status).toBe('approved');
      expect(bundle.assets.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export entry defaults output to <slug>.nectar.zip in cwd', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['export', 'entry', 'hello-world'], dir);
      expect(exitCode).toBe(0);
      // The post references the `release` tag, which has a definition file, so
      // export carries it along and notes it on stderr.
      expect(stderr).toContain('Bundled 1 tag definition(s): release');
      const bytes = new Uint8Array(
        await Bun.file(join(dir, 'hello-world.nectar.zip')).arrayBuffer(),
      );
      const bundle = parseEntryBundleZip(bytes);
      expect(bundle.slug).toBe('hello-world');
      expect(bundle.tags.map((t) => t.slug)).toEqual(['release']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export entry prints warning when assets are omitted', async () => {
    const dir = await makeFixture();
    try {
      // Remove the asset so it becomes omitted
      await rm(join(dir, 'content/images/about.txt'));
      const outPath = join(dir, 'about.nectar.zip');
      const { stderr, exitCode } = await runCli(
        ['export', 'entry', 'about', '--kind', 'page', '--output', outPath],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain('about.txt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export entry missing slug prints usage error', async () => {
    const dir = await makeFixture();
    try {
      const { stderr, exitCode } = await runCli(['export', 'entry'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Missing required argument');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function seedComponents(dir: string): Promise<void> {
    await mkdir(join(dir, 'content/components'), { recursive: true });
    for (const slug of ['callout', 'cta']) {
      await writeFile(
        join(dir, `content/components/${slug}.md`),
        [
          '---',
          `slug: ${slug}`,
          `description: ${slug} snippet`,
          '---',
          '',
          '```html',
          `<div class="${slug}">{${slug}}</div>`,
          '```',
          '',
        ].join('\n'),
      );
    }
  }

  test('export components writes a zip of every component to --output', async () => {
    const dir = await makeFixture();
    await seedComponents(dir);
    const outPath = join(dir, 'out', 'components.nectar.zip');
    try {
      const { stderr, exitCode } = await runCli(['export', 'components', '--output', outPath], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('Exported 2 component(s)');
      const bytes = new Uint8Array(await readFile(outPath));
      // The zip carries the manifest plus one file per component.
      expect(bytes.byteLength).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export components --slugs selects a subset and warns on unknown', async () => {
    const dir = await makeFixture();
    await seedComponents(dir);
    const outPath = join(dir, 'subset.nectar.zip');
    try {
      const { stderr, exitCode } = await runCli(
        ['export', 'components', '--slugs', 'callout,ghost', '--output', outPath],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain('Exported 1 component(s)');
      expect(stderr).toContain('ghost');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('export components defaults output to components.nectar.zip in cwd', async () => {
    const dir = await makeFixture();
    await seedComponents(dir);
    try {
      const { exitCode } = await runCli(['export', 'components'], dir);
      expect(exitCode).toBe(0);
      const bytes = new Uint8Array(await readFile(join(dir, 'components.nectar.zip')));
      expect(bytes.byteLength).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
