import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createChangeBus,
  createDashboardTaxonomyFile,
  handleDashboardRequest,
  loadDashboardState,
  readDashboardContentItem,
  readDashboardSettings,
  renderDashboardHtml,
  writeDashboardContentItem,
  writeDashboardSiteSettings,
} from '~/cli/commands/dashboard.ts';
import { createDashboardUiState, reduceDashboardUiState } from '~/cli/dashboard/state.ts';
import { renderDashboardSurfaceStateHtml } from '~/cli/dashboard/view-state.ts';
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
      'authors:',
      '  - missing-author',
      'tags:',
      '  - missing-tag',
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
      expect(state.authors.items.map((item) => item.slug)).toEqual(['casper', 'missing-author']);
      expect(state.tags.items.find((item) => item.slug === 'news')?.editable).toBe(true);
      expect(state.tags.items.find((item) => item.slug === 'news')?.path).toBe(
        'content/tags/news.md',
      );
      expect(state.settings.contentDirs.assets).toBe('content/images');
      expect(state.settings.configPath).toBe('nectar.toml');
      expect(state.sync.status).toBe('synced');
      expect(state.sync.loadStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(state.sync.loadFinishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(state.build.outputDir).toBe('dist');
      expect(state.git.isRepo).toBe(false);
      expect(state.settings.cards.map((card) => card.id)).toContain('content-health');
      expect(state.settings.cards.map((card) => card.id)).toEqual(
        expect.arrayContaining([
          'dashboard-frontend-bundle',
          'dashboard-i18n-policy',
          'dashboard-rollout-telemetry',
        ]),
      );
      expect(state.settings.operations.cliAssets.map((asset) => asset.command)).toContain('deploy');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('filters, searches, and sorts dashboard content through the state contract', async () => {
    const dir = await makeDashboardFixture();
    try {
      const state = await loadDashboardState({
        cwd: dir,
        kind: 'posts',
        status: 'published',
        search: 'old',
        sort: 'created_asc',
        perPage: 10,
      });

      expect(state.posts.items.map((item) => item.slug)).toEqual(['old']);
      expect(state.posts.query).toEqual({
        kind: 'posts',
        status: 'published',
        search: 'old',
        sort: 'created_asc',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('filters content by metadata slug search and status', async () => {
    const dir = await makeDashboardFixture();
    try {
      const state = await loadDashboardState({
        cwd: dir,
        search: 'missing-tag',
        status: 'published',
      });

      expect(state.posts.items.map((item) => item.slug)).toEqual(['new']);
      expect(state.pages.items).toEqual([]);
      expect(state.settings.operations.search.fields).toEqual([
        'title',
        'slug',
        'path',
        'tags',
        'authors',
        'status',
      ]);
      expect(state.settings.operations.search.bodySearch).toBe('deferred');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('marks generated and orphaned taxonomy records in the API response', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/tagged.md'),
        [
          '---',
          'title: Tagged Post',
          'date: 2026-01-04T00:00:00Z',
          'created_at: 2026-01-04T00:00:00Z',
          'tags:',
          '  - Ghosted',
          '---',
          '',
          'Tagged body',
          '',
        ].join('\n'),
        'utf8',
      );

      const state = await loadDashboardState({ cwd: dir });

      const fileBacked = state.tags.items.find((item) => item.slug === 'news');
      expect(fileBacked?.editable).toBe(true);
      expect(fileBacked?.orphaned).toBe(true);
      const generated = state.tags.items.find((item) => item.slug === 'ghosted');
      expect(generated?.editable).toBe(false);
      expect(generated?.missing).toBe(true);
      expect(generated?.generated).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('creates backing files for generated taxonomy records', async () => {
    const dir = await makeDashboardFixture();
    try {
      const before = await loadDashboardState({ cwd: dir });
      const generated = before.tags.items.find((item) => item.slug === 'missing-tag');
      expect(generated?.source).toBe('generated');
      expect(generated?.editable).toBe(false);

      const result = await createDashboardTaxonomyFile({
        cwd: dir,
        kind: 'tags',
        slug: 'missing-tag',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected taxonomy file to be created');
      expect(result.path).toBe('content/tags/missing-tag.md');
      expect(await readFile(join(dir, 'content/tags/missing-tag.md'), 'utf8')).toContain(
        'name: Missing Tag',
      );
      const after = await loadDashboardState({ cwd: dir });
      expect(after.tags.items.find((item) => item.slug === 'missing-tag')?.source).toBe('file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('surfaces accessibility content warnings in list summaries', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeFile(
        join(dir, 'content/posts/a11y-risk.md'),
        [
          '---',
          'title: A very long accessibility review title that should be checked before narrow responsive layouts ship',
          'date: 2026-01-04T00:00:00Z',
          'created_at: 2026-01-04T00:00:00Z',
          'feature_image: /content/images/a11y.png',
          '---',
          '',
          '![](/content/images/inline.png)',
          '',
        ].join('\n'),
        'utf8',
      );

      const state = await loadDashboardState({ cwd: dir, page: 1, perPage: 1 });
      const item = state.posts.items[0];

      expect(item?.slug).toBe('a11y-risk');
      expect(item?.warnings.map((warning) => warning.code)).toEqual([
        'long-title',
        'feature-image-alt',
        'inline-image-alt',
        'missing-description',
      ]);
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
      if (stale.reason !== 'conflict') throw new Error('expected content conflict');
      expect(stale.changedPath).toBe('content/posts/new.md');
      expect(stale.conflict.body.current).toContain('Changed outside the dashboard');
      expect(stale.conflict.body.draft).toBe('Dashboard body');
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

  test('serializes dashboard writes through the content formatter', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({ cwd: dir, config, kind: 'posts', slug: 'new' });

      const written = await writeDashboardContentItem({
        cwd: dir,
        config,
        kind: 'posts',
        slug: 'new',
        expectedFingerprint: item.fingerprint,
        frontmatter: { ...item.frontmatter, primary_tag: ' Missing-Tag ' },
        body: 'Formatted body',
      });

      expect(written.ok).toBe(true);
      const raw = await readFile(join(dir, 'content/posts/new.md'), 'utf8');
      expect(raw).toContain('primary_tag: missing-tag');
      expect(raw).toContain('\n---\n\nFormatted body\n');
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
      if (!written.ok) throw new Error('expected settings write');
      expect(written.changedPath).toBe('nectar.toml');
      expect(await readFile(join(dir, 'nectar.toml'), 'utf8')).toContain(
        'title = "Created Dashboard Config"',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects dashboard writes through symlinks that resolve outside content directories', async () => {
    const dir = await makeDashboardFixture();
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'nectar-dashboard-outside-')));
    try {
      await writeFile(join(outside, 'secret.md'), '---\nname: Secret\n---\n', 'utf8');
      await symlink(join(outside, 'secret.md'), join(dir, 'content/tags/secret.md'));

      const config = await loadConfig({ cwd: dir });
      const result = await writeDashboardContentItem({
        cwd: dir,
        config,
        kind: 'tags',
        slug: 'secret',
        expectedFingerprint: { path: 'content/tags/secret.md', mtimeMs: 0, size: 0 },
        frontmatter: { name: 'Leaked' },
        body: '',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected forbidden symlink write');
      expect(result.reason).toBe('forbidden');
      expect(await readFile(join(outside, 'secret.md'), 'utf8')).toContain('Secret');
    } finally {
      await rm(outside, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('protects write APIs with same-origin token checks and request body limits', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({ cwd: dir, config, kind: 'posts', slug: 'new' });
      const changeBus = createChangeBus({ debounceMs: 1 });
      const base = {
        cwd: dir,
        changeBus,
        security: {
          origin: 'http://127.0.0.1:4322',
          token: 'dashboard-token',
          lanExposed: false,
        },
        maxBodyBytes: 180,
      };
      const body = JSON.stringify({
        fingerprint: item.fingerprint,
        frontmatter: item.frontmatter,
        body: 'Saved',
      });

      const csrf = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/content/posts/new', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            origin: 'http://evil.test',
            'x-nectar-dashboard-token': 'dashboard-token',
          },
          body,
        }),
        base,
      );
      expect(csrf.status).toBe(403);

      const tooLarge = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/content/posts/new', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            origin: 'http://127.0.0.1:4322',
            'x-nectar-dashboard-token': 'dashboard-token',
            'content-length': '181',
          },
          body,
        }),
        base,
      );
      expect(tooLarge.status).toBe(413);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('records debounced file activity for sync metadata and SSE payloads', async () => {
    const bus = createChangeBus({ debounceMs: 1 });

    bus.broadcast({
      reason: 'file-change',
      kind: 'posts',
      changedPath: 'content/posts/new.md',
    });
    bus.broadcast({
      reason: 'file-change',
      kind: 'posts',
      changedPath: 'content/posts/new.md',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const snapshot = bus.snapshot();
    expect(snapshot.lastEvent?.reason).toBe('file-change');
    expect(snapshot.lastEvent?.changedPath).toBe('content/posts/new.md');
    expect(snapshot.activity).toHaveLength(1);
  });

  test('renders dashboard shell with accessibility and responsive QA hooks', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('href="#main"');
    expect(html).toContain('data-theme="system"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('id="paletteModal"');
    expect(html).toContain('id="density"');
    expect(html).toContain('id="theme"');
    expect(html).toContain('id="search"');
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('createDashboardUiState');
    expect(html).toContain('renderStatePanelHtml');
    expect(html).toContain('warningBadge');
  });
});

describe('dashboard frontend state helpers', () => {
  test('normalizes initial UI state without accepting invalid pages or views', () => {
    const state = createDashboardUiState({
      view: 'missing' as never,
      postsPage: -8,
      pagesPage: 0,
    });

    expect(state.view).toBe('posts');
    expect(state.postsPage).toBe(1);
    expect(state.pagesPage).toBe(1);
    expect(state.theme).toBe('system');
  });

  test('reduces search, paging, density, theme, and conflict state predictably', () => {
    let state = createDashboardUiState({ postsPage: 3, pagesPage: 2 });

    state = reduceDashboardUiState(state, { type: 'search/set', query: 'draft' });
    expect(state.query).toBe('draft');
    expect(state.postsPage).toBe(1);
    expect(state.pagesPage).toBe(1);

    state = reduceDashboardUiState(state, { type: 'page/next', kind: 'posts', pages: 2 });
    expect(state.postsPage).toBe(2);

    state = reduceDashboardUiState(state, { type: 'density/toggle' });
    expect(state.density).toBe('compact');

    state = reduceDashboardUiState(state, { type: 'theme/set', theme: 'dark' });
    expect(state.theme).toBe('dark');

    state = reduceDashboardUiState(state, {
      type: 'conflict',
      message: 'Changed on disk',
    });
    expect(state.loadStatus).toBe('conflict');
    expect(state.conflictMessage).toBe('Changed on disk');
  });

  test('renders escaped dashboard surface states', () => {
    const html = renderDashboardSurfaceStateHtml('error', {
      message: '<script>alert(1)</script>',
    });

    expect(html).toContain('statePanel error');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('data-state-action="error"');
  });
});
