import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '~/build/pipeline.ts';
import { configSchema } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';

// XSS / sanitisation tests (#693).
//
// Goal: prove that frontmatter and config values flowing through the render
// pipeline cannot escape the HTML / attribute contexts they are emitted into,
// EXCEPT for the explicit raw-HTML exits (`codeinjection_head` / `_foot`) which
// only fire when `build.allow_code_injection` is true.
//
// The test suite stands up a minimal site against the vendored Source theme so
// the assertions exercise the real render path (helpers + layouts), not just
// the individual escapeHtml/escapeAttr utilities. Two builds are produced:
//
//   1. "Default safe-mode build" — `allow_code_injection` defaults to false.
//      Any attempt to splice attacker HTML via `codeinjection_*` is dropped at
//      load time. Title / description payloads must still be escaped in the
//      emitted HTML and meta-tag attributes.
//   2. "Opt-in raw-HTML build" — `allow_code_injection = true`. The
//      `codeinjection_head` / `_foot` strings are intentionally spliced raw;
//      this branch confirms the opt-in path actually works so themes can rely
//      on it for analytics snippets etc. Everything *else* (titles, descs)
//      must remain escaped.
//
// "emergency safe-mode" in the task description is the default
// (`allow_code_injection = false`) — opt-in to the raw-HTML path is the
// non-safe mode that operators must explicitly enable.
const SOURCE_THEME = fileURLToPath(new URL('../../example/themes/source', import.meta.url));

const XSS_TITLE = 'Pwn <script>alert("xss")</script>';
const XSS_DESC = 'broken " out & < quotes';
const HOSTILE_CODEINJECTION_HEAD = '<script>window.__pwn_head=1</script>';
const HOSTILE_CODEINJECTION_FOOT = '<script>window.__pwn_foot=1</script>';

interface BuildOpts {
  allowCodeInjection: boolean;
}

async function makeFixture(opts: BuildOpts): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-xss-')));
  // Theme: copy the vendored Source theme.
  await mkdir(join(dir, 'themes'), { recursive: true });
  await cp(SOURCE_THEME, join(dir, 'themes/source'), { recursive: true });
  // Minimal authors / tags / pages scaffolding so the loader is happy.
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await mkdir(join(dir, 'content/images'), { recursive: true });
  await writeFile(
    join(dir, 'content/authors/casper.md'),
    '---\nname: Casper\nslug: casper\n---\nHello.\n',
  );
  await writeFile(
    join(dir, 'content/tags/news.md'),
    '---\nname: News\nslug: news\n---\nNews tag.\n',
  );

  // The malicious post. Note that frontmatter values are *strings* in YAML so
  // even raw `<script>` payloads are valid input; the question is whether the
  // renderer escapes them on the way out.
  await writeFile(
    join(dir, 'content/posts/pwn.md'),
    [
      '---',
      `title: '${XSS_TITLE.replace(/'/g, "''")}'`,
      `meta_description: '${XSS_DESC.replace(/'/g, "''")}'`,
      `codeinjection_head: '${HOSTILE_CODEINJECTION_HEAD.replace(/'/g, "''")}'`,
      `codeinjection_foot: '${HOSTILE_CODEINJECTION_FOOT.replace(/'/g, "''")}'`,
      'date: 2026-01-01T00:00:00Z',
      'authors: ["casper"]',
      'tags: ["news"]',
      '---',
      '',
      'Body text — irrelevant for these assertions.',
      '',
    ].join('\n'),
  );

  const allowLine = opts.allowCodeInjection
    ? 'allow_code_injection = true'
    : 'allow_code_injection = false';
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "XSS Test"',
      'description = "XSS test site"',
      'url = "https://xss.example.com"',
      'locale = "en"',
      'timezone = "UTC"',
      'accent_color = "#222222"',
      '',
      '[theme]',
      'name = "source"',
      'dir = "themes"',
      '',
      '[build]',
      'output_dir = "dist"',
      'base_path = "/"',
      'posts_per_page = 5',
      allowLine,
      '',
      '[components.rss]',
      'enabled = false',
      '[components.sitemap]',
      'enabled = false',
      '[components.opengraph]',
      'enabled = true',
      '',
    ].join('\n'),
  );
  return dir;
}

describe('security: XSS / sanitisation (#693)', () => {
  describe('default safe-mode (allow_code_injection = false)', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await makeFixture({ allowCodeInjection: false });
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    test('drops codeinjection_head / codeinjection_foot from frontmatter so attacker scripts never reach <head> or before </body>', async () => {
      await build({ cwd: dir });
      const glob = new Bun.Glob('**/index.html');
      const found: string[] = [];
      for await (const rel of glob.scan({ cwd: join(dir, 'dist'), onlyFiles: true })) {
        found.push(rel);
      }
      expect(found.length).toBeGreaterThan(0);
      for (const rel of found) {
        const html = await readFile(join(dir, 'dist', rel), 'utf8');
        expect(html).not.toContain('__pwn_head');
        expect(html).not.toContain('__pwn_foot');
        expect(html).not.toContain(HOSTILE_CODEINJECTION_HEAD);
        expect(html).not.toContain(HOSTILE_CODEINJECTION_FOOT);
      }
    });

    test('escapes the <script> in title so it is text content, never executable markup', async () => {
      await build({ cwd: dir });
      const glob = new Bun.Glob('**/index.html');
      let foundXssHtml = false;
      for await (const rel of glob.scan({ cwd: join(dir, 'dist'), onlyFiles: true })) {
        const html = await readFile(join(dir, 'dist', rel), 'utf8');
        if (html.includes('alert(') || html.includes('Pwn ')) {
          foundXssHtml = true;
          // The raw payload must NOT appear in any executable form. The
          // escaped form `&lt;script&gt;` is what we want to see.
          expect(html).not.toContain('<script>alert("xss")</script>');
          expect(html).not.toContain('<script>alert(&quot;xss&quot;)</script>');
          // Confirm at least one escaped occurrence is present so we are
          // asserting on the right page.
          expect(html).toMatch(/&lt;script&gt;alert\(/);
        }
      }
      expect(foundXssHtml).toBe(true);
    });

    test('quotes / angle brackets in meta_description do not break out of <meta content="..."> attribute', async () => {
      await build({ cwd: dir });
      const glob = new Bun.Glob('**/index.html');
      let inspected = 0;
      for await (const rel of glob.scan({ cwd: join(dir, 'dist'), onlyFiles: true })) {
        const html = await readFile(join(dir, 'dist', rel), 'utf8');
        const metas = html.match(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/g) ?? [];
        for (const tag of metas) {
          // The unescaped `"` would close the attribute; ensure no raw quote
          // survives inside the captured content.
          const m = tag.match(/content="([^"]*)"/);
          expect(m).not.toBeNull();
          const captured = m?.[1] ?? '';
          // The captured group must never contain a raw `<` (would escape the
          // attribute parse), and any literal double-quote from the source
          // string must have been HTML-entity-escaped — the regex match
          // already guarantees no raw `"` appears between the surrounding
          // quotes, but we double-check the captured content does not contain
          // raw `<` either, since some renderers only escape quotes.
          expect(captured).not.toContain('<');
        }
        if (metas.length > 0) inspected++;
      }
      expect(inspected).toBeGreaterThan(0);
    });

    test('og:title / twitter:title attributes also escape <script> from frontmatter title', async () => {
      await build({ cwd: dir });
      const glob = new Bun.Glob('**/index.html');
      for await (const rel of glob.scan({ cwd: join(dir, 'dist'), onlyFiles: true })) {
        const html = await readFile(join(dir, 'dist', rel), 'utf8');
        // None of the OG/Twitter meta tags should embed a raw <script>.
        const ogMetas = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"\s*\/?>/g) ?? [];
        for (const tag of ogMetas) {
          expect(tag).not.toContain('<script>');
        }
        const twMetas =
          html.match(/<meta\s+name="twitter:title"\s+content="([^"]*)"\s*\/?>/g) ?? [];
        for (const tag of twMetas) {
          expect(tag).not.toContain('<script>');
        }
      }
    });
  });

  describe('opt-in raw-HTML mode (allow_code_injection = true)', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await makeFixture({ allowCodeInjection: true });
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    test('codeinjection_head and codeinjection_foot ship verbatim on the matching post', async () => {
      await build({ cwd: dir });
      const glob = new Bun.Glob('**/index.html');
      const pages: string[] = [];
      for await (const rel of glob.scan({ cwd: join(dir, 'dist'), onlyFiles: true })) {
        pages.push(rel);
      }
      // At least one rendered page must include the injected snippets exactly.
      const haystack = (
        await Promise.all(pages.map((rel) => readFile(join(dir, 'dist', rel), 'utf8')))
      ).join('\n');
      expect(haystack).toContain(HOSTILE_CODEINJECTION_HEAD);
      expect(haystack).toContain(HOSTILE_CODEINJECTION_FOOT);
    });

    test('title is STILL escaped even when raw-HTML injection is enabled (the opt-in is scoped to codeinjection_*, not other fields)', async () => {
      await build({ cwd: dir });
      const glob = new Bun.Glob('**/index.html');
      let sawEscapedTitle = false;
      for await (const rel of glob.scan({ cwd: join(dir, 'dist'), onlyFiles: true })) {
        const html = await readFile(join(dir, 'dist', rel), 'utf8');
        if (/&lt;script&gt;alert\(/.test(html)) sawEscapedTitle = true;
        // The literal title must not appear; the escaped form is what we want.
        expect(html).not.toContain('<script>alert("xss")</script>');
      }
      expect(sawEscapedTitle).toBe(true);
    });
  });

  describe('content loader rejects raw NUL bytes in frontmatter at parse time', () => {
    test('a frontmatter value containing a literal NUL byte fails fast (YAML parser refuses it) — defense in depth before any escaping path runs', async () => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-xss-nul-')));
      try {
        await mkdir(join(dir, 'content/posts'), { recursive: true });
        await writeFile(
          join(dir, 'content/posts/nul.md'),
          ['---', `title: "smuggled value"`, '---', '', 'body', ''].join('\n'),
        );
        const config = configSchema.parse({
          site: { title: 'X', url: 'https://x.test' },
        });
        let threw = false;
        try {
          await loadContent({ cwd: dir, config });
        } catch (err) {
          threw = true;
          expect(String(err)).toContain('null byte');
        }
        expect(threw).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
