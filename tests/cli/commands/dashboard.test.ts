import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDashboardState,
  readDashboardContentItem,
  readDashboardSettings,
  writeDashboardContentItem,
  writeDashboardSiteSettings,
} from '~/cli/commands/dashboard.ts';
import { loadConfig } from '~/config/loader.ts';

async function makeDashboardFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-dashboard-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Dashboard Test"',
      'description = "Local editorial surface"',
      'url = "https://dashboard.test"',
      'accent_color = "#2f6f63"',
      '',
      '[theme]',
      'name = "source"',
      'dir = "themes"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/old.md'),
    [
      '---',
      'title: Old Post',
      'date: 2026-01-01T00:00:00Z',
      'created_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      'Old body',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/posts/new.md'),
    [
      '---',
      'title: New Post',
      'date: 2026-01-03T00:00:00Z',
      'created_at: 2026-01-03T00:00:00Z',
      '---',
      '',
      'New body',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/pages/about.md'),
    [
      '---',
      'title: About',
      'date: 2026-01-02T00:00:00Z',
      'created_at: 2026-01-02T00:00:00Z',
      '---',
      '',
      'About body',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
  await writeFile(join(dir, 'content/tags/news.md'), '---\nname: News\n---\n', 'utf8');
  return dir;
}

describe('dashboard data', () => {
  test('loads file-backed dashboard state with created-at pagination', async () => {
    const dir = await makeDashboardFixture();
    try {
      const state = await loadDashboardState({ cwd: dir, page: 1, perPage: 1 });

      expect(state.site.title).toBe('Dashboard Test');
      expect(state.posts.total).toBe(2);
      expect(state.posts.pages).toBe(2);
      expect(state.posts.items.map((item) => item.slug)).toEqual(['new']);
      expect(state.posts.items[0]?.path).toBe('content/posts/new.md');
      expect(state.pages.items.map((item) => item.slug)).toEqual(['about']);
      expect(state.authors.items.map((item) => item.slug)).toEqual(['casper']);
      expect(state.tags.items[0]?.editable).toBe(true);
      expect(state.tags.items[0]?.path).toBe('content/tags/news.md');
      expect(state.settings.configPath).toBe('nectar.toml');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes content only when the source fingerprint still matches', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({ cwd: dir, config, kind: 'posts', slug: 'new' });
      expect(item.body).toContain('New body');

      await writeFile(
        join(dir, 'content/posts/new.md'),
        [
          '---',
          'title: New Post',
          'date: 2026-01-03T00:00:00Z',
          'created_at: 2026-01-03T00:00:00Z',
          '---',
          '',
          'Changed outside the dashboard',
          '',
        ].join('\n'),
        'utf8',
      );

      const stale = await writeDashboardContentItem({
        cwd: dir,
        config,
        kind: 'posts',
        slug: 'new',
        expectedFingerprint: item.fingerprint,
        frontmatter: item.frontmatter,
        body: 'Dashboard body',
      });

      expect(stale.ok).toBe(false);
      if (stale.ok) throw new Error('expected conflict');
      expect(stale.reason).toBe('conflict');
      expect(await readFile(join(dir, 'content/posts/new.md'), 'utf8')).toContain(
        'Changed outside the dashboard',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes site settings only when nectar.toml still matches', async () => {
    const dir = await makeDashboardFixture();
    try {
      const settings = await readDashboardSettings({ cwd: dir });
      expect(settings.site.title).toBe('Dashboard Test');

      await writeFile(
        join(dir, 'nectar.toml'),
        [
          '[site]',
          'title = "Changed Outside"',
          'description = "Local editorial surface"',
          'url = "https://dashboard.test"',
          'accent_color = "#2f6f63"',
          '',
        ].join('\n'),
        'utf8',
      );

      const stale = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: settings.fingerprint,
        updates: { title: 'Dashboard Saved' },
      });

      expect(stale.ok).toBe(false);
      if (stale.ok) throw new Error('expected settings conflict');
      expect(stale.reason).toBe('conflict');
      expect(await readFile(join(dir, 'nectar.toml'), 'utf8')).toContain('Changed Outside');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('loads and creates settings when nectar.toml does not exist yet', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-dashboard-no-config-')));
    try {
      const settings = await readDashboardSettings({ cwd: dir });
      expect(settings.configPath).toBe('nectar.toml');
      expect(settings.fingerprint).toEqual({ path: 'nectar.toml', mtimeMs: 0, size: 0 });

      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: settings.fingerprint,
        updates: { title: 'Created Dashboard Config', url: 'https://created.test' },
      });

      expect(written.ok).toBe(true);
      expect(await readFile(join(dir, 'nectar.toml'), 'utf8')).toContain(
        'title = "Created Dashboard Config"',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
