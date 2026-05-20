import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintContent } from '~/build/lint.ts';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';

interface Fixture {
  cwd: string;
  files: Record<string, string>;
}

async function makeFixture(files: Record<string, string>): Promise<Fixture> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-lint-')));
  const baseConfig = ['[site]', 'title = "Lint Test"'].join('\n');
  await Bun.write(join(cwd, 'nectar.toml'), files['nectar.toml'] ?? baseConfig);
  for (const [path, contents] of Object.entries(files)) {
    if (path === 'nectar.toml') continue;
    await Bun.write(join(cwd, path), contents);
  }
  return { cwd, files };
}

async function loadAll(cwd: string) {
  const config = await loadConfig({ cwd });
  const content = await loadContent({ cwd, config });
  return { config, content };
}

describe('lintContent', () => {
  let cwd: string | undefined;
  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  test('clean project produces no issues', async () => {
    const fx = await makeFixture({
      'content/posts/hello.md': ['---', 'title: Hello', 'date: 2026-01-01', '---', 'body'].join(
        '\n',
      ),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  test('flags missing required title', async () => {
    const fx = await makeFixture({
      'content/posts/no-title.md': ['---', 'date: 2026-01-01', '---', 'body'].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'missing-title')).toBe(true);
  });

  test('flags unknown frontmatter keys', async () => {
    const fx = await makeFixture({
      'content/posts/typo.md': [
        '---',
        'title: Typo',
        'tittle: oops',
        'date: 2026-01-01',
        '---',
        'body',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    const unknown = report.warnings.find((w) => w.code === 'unknown-frontmatter');
    expect(unknown).toBeDefined();
    expect(unknown?.message).toContain("'tittle'");
  });

  test('flags malformed dates', async () => {
    const fx = await makeFixture({
      'content/posts/bad.md': ['---', 'title: Bad', 'date: not-a-real-date', '---', 'body'].join(
        '\n',
      ),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'malformed-date')).toBe(true);
  });

  test('reports duplicate slugs as errors', async () => {
    const fx = await makeFixture({
      'content/posts/a.md': [
        '---',
        'title: First',
        'slug: shared',
        'date: 2026-01-01',
        '---',
        'a',
      ].join('\n'),
      'content/posts/b.md': [
        '---',
        'title: Second',
        'slug: shared',
        'date: 2026-01-02',
        '---',
        'b',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    const dupes = report.errors.filter((e) => e.code === 'duplicate-slug');
    expect(dupes.length).toBe(2);
    expect(dupes[0]?.message).toContain("'shared'");
  });

  test('reports missing image assets', async () => {
    const fx = await makeFixture({
      'content/posts/with-image.md': [
        '---',
        'title: With Image',
        'date: 2026-01-01',
        'feature_image: /content/images/nope.png',
        '---',
        'body',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    const missing = report.warnings.find((w) => w.code === 'missing-asset');
    expect(missing).toBeDefined();
    expect(missing?.message).toContain('nope.png');
  });

  test('does not flag image that exists on disk', async () => {
    const fx = await makeFixture({
      'content/posts/with-image.md': [
        '---',
        'title: With Image',
        'date: 2026-01-01',
        'feature_image: /content/images/cover.png',
        '---',
        'body',
      ].join('\n'),
      'content/images/cover.png': 'fake-png',
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'missing-asset')).toBe(false);
  });

  test('skips remote image URLs', async () => {
    const fx = await makeFixture({
      'content/posts/remote.md': [
        '---',
        'title: Remote',
        'date: 2026-01-01',
        'feature_image: https://example.com/content/images/foo.png',
        '---',
        'body',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'missing-asset')).toBe(false);
  });

  test('flags navigation pointing at missing page', async () => {
    const fx = await makeFixture({
      'nectar.toml': [
        '[site]',
        'title = "Nav Test"',
        '',
        '[[navigation]]',
        'label = "About"',
        'url = "/about/"',
      ].join('\n'),
      'content/posts/hello.md': ['---', 'title: Hello', 'date: 2026-01-01', '---', 'body'].join(
        '\n',
      ),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    const dead = report.warnings.find((w) => w.code === 'navigation-dead-link');
    expect(dead).toBeDefined();
    expect(dead?.message).toContain('About');
  });

  test('navigation matching an existing page passes', async () => {
    const fx = await makeFixture({
      'nectar.toml': [
        '[site]',
        'title = "Nav Test"',
        '',
        '[[navigation]]',
        'label = "About"',
        'url = "/about/"',
      ].join('\n'),
      'content/pages/about.md': ['---', 'title: About', '---', 'body'].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'navigation-dead-link')).toBe(false);
  });

  test('navigation pointing at missing tag is flagged', async () => {
    const fx = await makeFixture({
      'nectar.toml': [
        '[site]',
        'title = "Nav Test"',
        '',
        '[[navigation]]',
        'label = "News"',
        'url = "/tag/news/"',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'navigation-dead-link')).toBe(true);
  });

  test('checkLinks: flags broken relative .md cross-link', async () => {
    const fx = await makeFixture({
      'content/posts/a.md': [
        '---',
        'title: A',
        'date: 2026-01-01',
        '---',
        'See [other](./missing.md) and [self](./b.md).',
      ].join('\n'),
      'content/posts/b.md': ['---', 'title: B', 'date: 2026-01-02', '---', 'b'].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content, checkLinks: true });
    const broken = report.warnings.filter((w) => w.code === 'broken-link');
    expect(broken.length).toBe(1);
    expect(broken[0]?.message).toContain('missing.md');
  });

  test('checkLinks: relative .md links are silent when off by default', async () => {
    const fx = await makeFixture({
      'content/posts/a.md': [
        '---',
        'title: A',
        'date: 2026-01-01',
        '---',
        'See [other](./nope.md).',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'broken-link')).toBe(false);
  });

  test('checkLinks: flags missing relative image reference', async () => {
    const fx = await makeFixture({
      'content/posts/a.md': [
        '---',
        'title: A',
        'date: 2026-01-01',
        '---',
        '![alt](./images/missing.png)',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content, checkLinks: true });
    expect(report.warnings.some((w) => w.code === 'broken-image-link')).toBe(true);
  });

  test('checkLinks: ignores links inside code blocks', async () => {
    const fx = await makeFixture({
      'content/posts/a.md': [
        '---',
        'title: A',
        'date: 2026-01-01',
        '---',
        '```',
        '[ghost](./nope.md)',
        '```',
        'and inline `[also](./nope.md)`',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content, checkLinks: true });
    expect(report.warnings.some((w) => w.code === 'broken-link')).toBe(false);
  });

  test('checkExternal: probes navigation URLs with the injected fetch', async () => {
    const fx = await makeFixture({
      'nectar.toml': [
        '[site]',
        'title = "External"',
        '',
        '[[navigation]]',
        'label = "Up"',
        'url = "https://example.com/up"',
        '',
        '[[navigation]]',
        'label = "Down"',
        'url = "https://example.com/down"',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const calls: string[] = [];
    const report = await lintContent({
      cwd,
      config,
      content,
      checkExternal: true,
      externalFetch: async (url) => {
        calls.push(url);
        return url.endsWith('/down') ? { ok: false, status: 404 } : { ok: true, status: 200 };
      },
    });
    expect(calls.sort()).toEqual(['https://example.com/down', 'https://example.com/up']);
    const broken = report.warnings.filter((w) => w.code === 'external-link-broken');
    expect(broken.length).toBe(1);
    expect(broken[0]?.message).toContain('/down');
  });

  test('checkExternal: stays silent when not opted in', async () => {
    const fx = await makeFixture({
      'nectar.toml': [
        '[site]',
        'title = "External"',
        '',
        '[[navigation]]',
        'label = "Up"',
        'url = "https://example.com/up"',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    let calls = 0;
    const report = await lintContent({
      cwd,
      config,
      content,
      externalFetch: async () => {
        calls++;
        return { ok: true, status: 200 };
      },
    });
    expect(calls).toBe(0);
    expect(report.warnings.some((w) => w.code === 'external-link-broken')).toBe(false);
  });

  test('navigation absolute URLs and anchors are ignored', async () => {
    const fx = await makeFixture({
      'nectar.toml': [
        '[site]',
        'title = "Nav Test"',
        '',
        '[[navigation]]',
        'label = "Twitter"',
        'url = "https://twitter.com/example"',
        '',
        '[[navigation]]',
        'label = "Top"',
        'url = "#top"',
      ].join('\n'),
    });
    cwd = fx.cwd;
    const { config, content } = await loadAll(cwd);
    const report = await lintContent({ cwd, config, content });
    expect(report.warnings.some((w) => w.code === 'navigation-dead-link')).toBe(false);
  });
});
