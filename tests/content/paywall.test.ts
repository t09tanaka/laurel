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

  test('truncate policy without marker falls back to word count', async () => {
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
});
