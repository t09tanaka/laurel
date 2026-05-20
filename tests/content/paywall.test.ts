import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';
import { buildPaywallStub, truncateMarkdownForPaywall } from '~/content/paywall.ts';

describe('truncateMarkdownForPaywall', () => {
  test('truncates at the <!-- members --> marker when present', () => {
    const body = 'Public intro.\n\n<!-- members -->\n\nSecret body that should not leak.';
    expect(truncateMarkdownForPaywall(body, 999)).toBe('Public intro.');
  });

  test('truncates at the <!-- members-only --> marker (issue #206 convention)', () => {
    const body = 'Public intro.\n\n<!-- members-only -->\n\nSecret body that should not leak.';
    expect(truncateMarkdownForPaywall(body, 999)).toBe('Public intro.');
  });

  test('truncates at the Ghost editor <!--kg-card-begin: paywall--> marker (issue #443)', () => {
    const body =
      'Public intro.\n\n<!--kg-card-begin: paywall-->\n\nSecret body that should not leak.';
    expect(truncateMarkdownForPaywall(body, 999)).toBe('Public intro.');
  });

  test('tolerates extra inner whitespace around the marker keyword', () => {
    expect(truncateMarkdownForPaywall('hi.\n\n<!--members-only-->\nsecret', 999)).toBe('hi.');
    expect(truncateMarkdownForPaywall('hi.\n\n<!--kg-card-begin:paywall-->\nsecret', 999)).toBe(
      'hi.',
    );
  });

  test('truncates by word count when no marker present', () => {
    const body = 'one two three four five six seven eight nine ten eleven twelve';
    expect(truncateMarkdownForPaywall(body, 5)).toBe('one two three four five');
  });

  test('returns empty string when word count is zero', () => {
    expect(truncateMarkdownForPaywall('any content', 0)).toBe('');
  });
});

describe('buildPaywallStub', () => {
  test('emits members stub with portal hook', () => {
    const html = buildPaywallStub('members');
    expect(html).toContain('class="gh-paywall-stub"');
    expect(html).toContain('data-paywall-visibility="members"');
    expect(html).toContain('data-portal="signup"');
    expect(html).toContain('subscribers only');
  });

  test('emits paid stub with paying-subscriber message', () => {
    const html = buildPaywallStub('paid');
    expect(html).toContain('data-paywall-visibility="paid"');
    expect(html).toContain('paying subscribers');
  });
});

interface FixtureOptions {
  marker?: boolean;
  visibility?: 'members' | 'paid' | 'public';
}

async function fixture(opts: FixtureOptions = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-paywall-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  const visibility = opts.visibility ?? 'members';
  const body = opts.marker
    ? 'Free intro paragraph.\n\n<!-- members -->\n\nSecret members-only paragraph that should be hidden.'
    : 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen';
  await writeFile(
    join(dir, 'content/posts/gated.md'),
    `---
title: "Gated"
date: 2026-01-01T00:00:00Z
visibility: ${visibility}
---

${body}
`,
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/public.md'),
    `---
title: "Public"
date: 2026-02-01T00:00:00Z
---

Always public.
`,
    'utf8',
  );
  return dir;
}

describe('visibility_policy', () => {
  test('default truncate policy injects paywall stub and hides remainder', async () => {
    const cwd = await fixture({ marker: true });
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated).toBeDefined();
    expect(gated?.html).toContain('Free intro paragraph');
    expect(gated?.html).not.toContain('Secret members-only paragraph');
    expect(gated?.html).toContain('gh-paywall-stub');
    expect(gated?.html).toContain('data-portal="signup"');
  });

  test('truncate policy without marker emits stub only by default (no body leak)', async () => {
    const cwd = await fixture({ marker: false });
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.html).toContain('gh-paywall-stub');
    expect(gated?.html).not.toContain('one two');
    expect(gated?.plaintext.split(/\s+/).filter(Boolean)).toHaveLength(0);
    expect(gated?.feed_html).toContain('gh-paywall-stub');
    expect(gated?.feed_html).not.toContain('one two');
  });

  test('truncate policy emits an opt-in word-count preview when paywall_word_count is set', async () => {
    const cwd = await fixture({ marker: false });
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      content: { paywall_word_count: 5 },
    });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.plaintext.split(/\s+/).filter(Boolean)).toHaveLength(5);
    expect(gated?.html).toContain('gh-paywall-stub');
  });

  test('render-full policy leaves the post body untouched', async () => {
    const cwd = await fixture({ marker: true });
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      content: { visibility_policy: 'render-full' },
    });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.html).toContain('Secret members-only paragraph');
    expect(gated?.html).not.toContain('gh-paywall-stub');
  });

  test('render-full policy still produces paywall-safe feed_html for gated posts', async () => {
    const cwd = await fixture({ marker: true });
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      content: { visibility_policy: 'render-full' },
    });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.feed_html).toContain('Free intro paragraph');
    expect(gated?.feed_html).not.toContain('Secret members-only paragraph');
    expect(gated?.feed_html).toContain('gh-paywall-stub');
    expect(gated?.feed_excerpt).not.toContain('Secret members-only paragraph');
  });

  test('public posts have feed_html identical to html', async () => {
    const cwd = await fixture({ visibility: 'public' });
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.feed_html).toBe(gated?.html ?? '');
    expect(gated?.feed_excerpt).toBe(gated?.excerpt ?? '');
  });

  test('skip policy drops the gated post from the route graph', async () => {
    const cwd = await fixture({ marker: true });
    const config = configSchema.parse({
      site: { title: 'X', url: 'https://x.test' },
      content: { visibility_policy: 'skip' },
    });
    const graph = await loadContent({ cwd, config });
    expect(graph.posts.find((p) => p.slug === 'gated')).toBeUndefined();
    expect(graph.posts.find((p) => p.slug === 'public')).toBeDefined();
  });

  test('public posts are unaffected by visibility_policy', async () => {
    const cwd = await fixture({ visibility: 'public' });
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.html).not.toContain('gh-paywall-stub');
  });

  test('paid visibility receives paid-tier stub message', async () => {
    const cwd = await fixture({ marker: true, visibility: 'paid' });
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.html).toContain('data-paywall-visibility="paid"');
    expect(gated?.html).toContain('paying subscribers');
  });

  // #208 — every post exposes `access: false` for the anonymous static viewer
  // so `{{#unless this.access}}` themes hit the locked branch uniformly.
  test('exposes post.access = false on every post (anonymous viewer)', async () => {
    const cwd = await fixture({ visibility: 'public' });
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const publicPost = graph.posts.find((p) => p.slug === 'public');
    const members = graph.posts.find((p) => p.slug === 'gated');
    expect(publicPost?.access).toBe(false);
    expect(members?.access).toBe(false);
  });

  test('exposes page.access = false on every page (anonymous viewer)', async () => {
    const cwd = await fixture({ visibility: 'public' });
    // Materialize a sibling page so the loader walks `content/pages/`.
    await writeFile(
      join(cwd, 'content/pages/about.md'),
      `---\ntitle: "About"\ndate: 2026-01-01T00:00:00Z\n---\n\nAbout body.\n`,
      'utf8',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const page = graph.pages.find((p) => p.slug === 'about');
    expect(page?.access).toBe(false);
  });

  async function markerFixture(body: string, visibility: 'public' | 'members' = 'members') {
    const tmp = await mkdtemp(join(tmpdir(), 'nectar-paywall-marker-'));
    await mkdir(join(tmp, 'content/posts'), { recursive: true });
    await mkdir(join(tmp, 'content/pages'), { recursive: true });
    await mkdir(join(tmp, 'content/authors'), { recursive: true });
    await writeFile(
      join(tmp, 'content/posts/gated.md'),
      `---\ntitle: "Gated"\ndate: 2026-01-01T00:00:00Z\nvisibility: ${visibility}\n---\n\n${body}\n`,
      'utf8',
    );
    return tmp;
  }

  // #443 / #206 — both alternate paywall markers split the body so the
  // members-only paragraph never lands in `post.html`.
  test('respects <!-- members-only --> marker end-to-end through the loader', async () => {
    const cwd = await markerFixture(
      'Free intro paragraph.\n\n<!-- members-only -->\n\nSecret paragraph behind the wall.',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.html).toContain('Free intro paragraph');
    expect(gated?.html).not.toContain('Secret paragraph behind the wall');
    expect(gated?.html).toContain('gh-paywall-stub');
  });

  test('respects the Ghost <!--kg-card-begin: paywall--> marker end-to-end', async () => {
    const cwd = await markerFixture(
      'Free intro paragraph.\n\n<!--kg-card-begin: paywall-->\n\nSecret paragraph behind the wall.',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const gated = graph.posts.find((p) => p.slug === 'gated');
    expect(gated?.html).toContain('Free intro paragraph');
    expect(gated?.html).not.toContain('Secret paragraph behind the wall');
    expect(gated?.html).toContain('gh-paywall-stub');
  });

  test('paywall marker has no effect on public-visibility posts', async () => {
    const cwd = await markerFixture(
      'Intro.\n\n<!-- members-only -->\n\nStill public body — the marker is a no-op on public posts.',
      'public',
    );
    const config = configSchema.parse({ site: { title: 'X', url: 'https://x.test' } });
    const graph = await loadContent({ cwd, config });
    const free = graph.posts.find((p) => p.slug === 'gated');
    expect(free?.html).toContain('Intro');
    expect(free?.html).toContain('Still public body');
    expect(free?.html).not.toContain('gh-paywall-stub');
  });
});
