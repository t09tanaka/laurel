import { describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type DashboardState,
  applyDashboardBulkAction,
  createChangeBus,
  createDashboardTaxonomyFile,
  handleDashboardRequest,
  listDashboardContentTemplates,
  listDashboardInternalLinks,
  listDashboardTrash,
  loadDashboardState,
  readDashboardContentItem,
  readDashboardSettings,
  renameDashboardContentSlug,
  renderDashboardHtml,
  restoreDashboardTrashEntry,
  trashDashboardContentItem,
  writeDashboardContentItem,
  writeDashboardSiteSettings,
  writeDashboardThemeSettings,
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

async function writeDashboardThemeFixture(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, 'themes', name, 'assets'), { recursive: true });
  await writeFile(join(dir, 'themes', name, 'index.hbs'), `<h1>${name}</h1>\n`, 'utf8');
  await writeFile(
    join(dir, 'themes', name, 'post.hbs'),
    '<!doctype html><html><head>{{ghost_head}}</head><body><main><h1>{{title}}</h1>{{content}}</main></body></html>',
    'utf8',
  );
  await writeFile(
    join(dir, 'themes', name, 'page.hbs'),
    '<!doctype html><html><head>{{ghost_head}}</head><body><main><h1>{{title}}</h1>{{content}}</main></body></html>',
    'utf8',
  );
  await writeFile(join(dir, 'themes', name, 'assets/app.css'), 'body { color: black; }', 'utf8');
}

async function makeGhostExportZip(zipPath: string, sourceDir: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, 'dashboard.ghost.2026-05-22.json'),
    JSON.stringify({
      db: [
        {
          data: {
            posts: [
              {
                id: 'p-dashboard-import',
                title: 'Dashboard Import',
                slug: 'dashboard-import',
                html: '<p>Imported from the dashboard.</p>',
                status: 'published',
                type: 'post',
              },
            ],
          },
        },
      ],
    }),
    'utf8',
  );
  const cwd = dirname(sourceDir);
  const target = sourceDir.slice(cwd.length + 1);
  const proc = Bun.spawn(['zip', '-rq', zipPath, target], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(
      `Failed to build dashboard import test zip: ${await new Response(proc.stderr).text()}`,
    );
  }
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
      expect(state.build.freshness.current).toBe(2);
      expect(state.posts.items[0]?.preview.state).toBe('current');
      expect(state.posts.items[0]?.preview.detail).toContain('saved Markdown');
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

  test('reports image assets, feature image existence, and markdown insert helpers', async () => {
    const dir = await makeDashboardFixture();
    try {
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(join(dir, 'content/images/cover.svg'), '<svg></svg>', 'utf8');
      await writeFile(
        join(dir, 'content/posts/new.md'),
        [
          '---',
          'title: New Post',
          'date: 2026-01-03T00:00:00Z',
          'created_at: 2026-01-03T00:00:00Z',
          'feature_image: /content/images/cover.svg',
          'feature_image_alt: Cover',
          '---',
          '',
          '![Inline](/content/images/missing.png)',
          '',
        ].join('\n'),
        'utf8',
      );

      const state = await loadDashboardState({ cwd: dir });
      const item = state.posts.items.find((post) => post.slug === 'new');
      expect(item?.featureImage.exists).toBe(true);
      expect(item?.featureImage.markdown).toBe('![cover](/content/images/cover.svg)');
      expect(state.settings.operations.assets.images).toBe(1);
      expect(state.settings.operations.assets.featureImages.missing).toBe(0);

      const config = await loadConfig({ cwd: dir });
      const current = await readDashboardContentItem({
        cwd: dir,
        config,
        kind: 'posts',
        slug: 'new',
      });
      expect(current.assets.markdownImages[0]?.exists).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('applies safe bulk actions only when each fingerprint matches', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const oldPost = await readDashboardContentItem({
        cwd: dir,
        config,
        kind: 'posts',
        slug: 'old',
      });
      const newPost = await readDashboardContentItem({
        cwd: dir,
        config,
        kind: 'posts',
        slug: 'new',
      });
      await writeFile(
        join(dir, 'content/posts/new.md'),
        '---\ntitle: Changed\n---\n\nOutside\n',
        'utf8',
      );

      const result = await applyDashboardBulkAction({
        cwd: dir,
        config,
        action: 'add-tag',
        value: 'Bulk Tag',
        targets: [
          { kind: 'posts', slug: 'old', fingerprint: oldPost.fingerprint },
          { kind: 'posts', slug: 'new', fingerprint: newPost.fingerprint },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected bulk action');
      expect(result.changed.map((item) => item.slug)).toEqual(['old']);
      expect(result.skipped).toEqual([{ kind: 'posts', slug: 'new', reason: 'conflict' }]);
      expect(await readFile(join(dir, 'content/posts/old.md'), 'utf8')).toContain('bulk-tag');
      expect(await readFile(join(dir, 'content/posts/new.md'), 'utf8')).toContain('Outside');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('moves dashboard content to trash and restores through metadata without purge', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({ cwd: dir, config, kind: 'posts', slug: 'old' });

      const trashed = await trashDashboardContentItem({
        cwd: dir,
        config,
        kind: 'posts',
        slug: 'old',
        expectedFingerprint: item.fingerprint,
        now: new Date('2026-01-10T00:00:00Z'),
      });

      expect(trashed.ok).toBe(true);
      if (!trashed.ok) throw new Error('expected trash result');
      expect(trashed.entry.originalPath).toBe('content/posts/old.md');
      expect(await listDashboardTrash({ cwd: dir })).toMatchObject({
        exists: true,
        entries: [expect.objectContaining({ slug: 'old', kind: 'posts' })],
      });
      expect(await readFile(join(dir, trashed.entry.trashPath), 'utf8')).toContain('Old Post');

      const restored = await restoreDashboardTrashEntry({ cwd: dir, id: trashed.entry.id });
      expect(restored.ok).toBe(true);
      expect(await readFile(join(dir, 'content/posts/old.md'), 'utf8')).toContain('Old Post');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('renames slugs with fingerprint checks and optional redirect suggestions', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({ cwd: dir, config, kind: 'posts', slug: 'old' });

      const renamed = await renameDashboardContentSlug({
        cwd: dir,
        config,
        kind: 'posts',
        oldSlug: 'old',
        newSlug: 'renamed-old',
        expectedFingerprint: item.fingerprint,
        redirect: true,
      });

      expect(renamed.ok).toBe(true);
      if (!renamed.ok) throw new Error('expected rename result');
      expect(renamed.newPath).toBe('content/posts/renamed-old.md');
      expect(renamed.redirectSuggestion).toMatchObject({
        redirectFrom: '/old/',
        redirectTo: '/renamed-old/',
      });
      expect(await readFile(join(dir, 'content/posts/renamed-old.md'), 'utf8')).toContain(
        'slug: renamed-old',
      );
      expect(await readFile(join(dir, 'redirects.yaml'), 'utf8')).toContain('from: "/old/"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('loads content templates and internal link helpers for markdown-first creation', async () => {
    const dir = await makeDashboardFixture();
    try {
      await mkdir(join(dir, '.nectar/templates/content'), { recursive: true });
      await writeFile(
        join(dir, '.nectar/templates/content/review.md'),
        '---\ntitle: {{title}}\nslug: {{slug}}\nstatus: draft\n---\n\nReview {{title}}\n',
        'utf8',
      );

      const templates = await listDashboardContentTemplates({ cwd: dir });
      expect(templates.map((template) => template.id)).toContain('project:review');
      const links = await listDashboardInternalLinks({
        cwd: dir,
        config: await loadConfig({ cwd: dir }),
      });
      expect(links.find((link) => link.slug === 'about')?.markdown).toBe('[About](/about/)');

      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/content', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'posts',
            title: 'Template Post',
            template: 'project:review',
          }),
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(response.status).toBe(201);
      expect(await readFile(join(dir, 'content/posts/template-post.md'), 'utf8')).toContain(
        'Review Template Post',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('previews and applies a Ghost zip import through the dashboard API', async () => {
    const dir = await makeDashboardFixture();
    try {
      const exportDir = join(dir, 'tmp-ghost-export');
      const zipPath = join(dir, 'dashboard-import.zip');
      await makeGhostExportZip(zipPath, exportDir);

      const preview = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/import/ghost', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: zipPath, dryRun: true, onConflict: 'overwrite' }),
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );

      expect(preview.status).toBe(200);
      const previewBody = (await preview.json()) as { summary: { dryRun: boolean; posts: number } };
      expect(previewBody.summary).toMatchObject({ dryRun: true, posts: 1 });
      await expect(access(join(dir, 'content/posts/dashboard-import.md'))).rejects.toThrow();

      const applied = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/import/ghost', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: zipPath, dryRun: false, onConflict: 'overwrite' }),
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );

      expect(applied.status).toBe(200);
      const appliedBody = (await applied.json()) as { summary: { dryRun: boolean; posts: number } };
      expect(appliedBody.summary).toMatchObject({ dryRun: false, posts: 1 });
      expect(await readFile(join(dir, 'content/posts/dashboard-import.md'), 'utf8')).toContain(
        'Imported from the dashboard.',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('exports and imports page collaboration bundles through the dashboard API', async () => {
    const dir = await makeDashboardFixture();
    try {
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(join(dir, 'content/images/about.txt'), 'about asset\n', 'utf8');
      await writeFile(
        join(dir, 'content/pages/about.md'),
        [
          '---',
          'title: About',
          'slug: about',
          'feature_image: /content/images/about.txt',
          '---',
          '',
          'About dashboard body.',
          '',
        ].join('\n'),
        'utf8',
      );

      const exported = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/page-bundles/export/about'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(exported.status).toBe(200);
      const bundle = (await exported.json()) as {
        nectar: { schema: string };
        page: { slug: string; body: string };
        assets: Array<{ path: string; content: string }>;
      };
      expect(bundle.nectar.schema).toBe('nectar.page.v1');
      expect(bundle.page.slug).toBe('about');
      expect(bundle.page.body).toContain('About dashboard body');
      expect(bundle.assets[0]?.path).toBe('content/images/about.txt');

      const bundlePath = join(dir, 'about.page.json');
      await writeFile(
        bundlePath,
        JSON.stringify({
          ...bundle,
          page: {
            ...bundle.page,
            frontmatter: { title: 'Imported Dashboard About', slug: 'about' },
            body: 'Imported dashboard body.\n',
          },
        }),
        'utf8',
      );

      const preview = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/page-bundles/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: bundlePath, dryRun: true, onConflict: 'rename' }),
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(preview.status).toBe(200);
      const previewBody = (await preview.json()) as {
        dryRun: boolean;
        result: { pagePath: string };
      };
      expect(previewBody.dryRun).toBe(true);
      expect(previewBody.result.pagePath).toBe('content/pages/about-2.md');
      await expect(access(join(dir, 'content/pages/about-2.md'))).rejects.toThrow();

      const applied = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/page-bundles/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: bundlePath, dryRun: false, onConflict: 'rename' }),
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(applied.status).toBe(200);
      const appliedBody = (await applied.json()) as {
        dryRun: boolean;
        result: { pagePath: string };
      };
      expect(appliedBody.dryRun).toBe(false);
      expect(appliedBody.result.pagePath).toBe('content/pages/about-2.md');
      expect(await readFile(join(dir, 'content/pages/about-2.md'), 'utf8')).toContain(
        'Imported dashboard body.',
      );
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

  test('switches the active theme only to an existing theme directory', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await writeDashboardThemeFixture(dir, 'casper');
      await mkdir(join(dir, 'themes/not-a-theme'), { recursive: true });

      const settings = await readDashboardSettings({ cwd: dir });
      expect(settings.theme.name).toBe('source');
      expect(settings.theme.available.map((theme) => theme.name)).toEqual(['casper', 'source']);
      expect(settings.theme.available.find((theme) => theme.name === 'source')).toMatchObject({
        path: 'themes/source',
        active: true,
      });

      const written = await writeDashboardThemeSettings({
        cwd: dir,
        expectedFingerprint: settings.fingerprint,
        updates: { name: 'casper' },
      });

      expect(written.ok).toBe(true);
      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('[theme]');
      expect(raw).toContain('name = "casper"');
      expect(raw).toContain('dir = "themes"');
      expect(raw).toContain('title = "Dashboard Test"');

      const missing = await writeDashboardThemeSettings({
        cwd: dir,
        expectedFingerprint: written.ok ? written.fingerprint : settings.fingerprint,
        updates: { name: 'missing-theme' },
      });

      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error('expected invalid theme result');
      expect(missing.reason).toBe('invalid-theme');
      expect(await readFile(join(dir, 'nectar.toml'), 'utf8')).toContain('name = "casper"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes theme settings through the dashboard API with conflict and validation guards', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await writeDashboardThemeFixture(dir, 'casper');
      const settings = await readDashboardSettings({ cwd: dir });
      const changeBus = createChangeBus({ debounceMs: 1 });

      const invalid = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/settings/theme', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fingerprint: settings.fingerprint,
            updates: { name: 'casper', dir: 'themes' },
          }),
        }),
        { cwd: dir, changeBus },
      );
      expect(invalid.status).toBe(400);

      await writeFile(
        join(dir, 'nectar.toml'),
        (await readFile(join(dir, 'nectar.toml'), 'utf8')).replace(
          'name = "source"',
          'name = "casper"',
        ),
        'utf8',
      );
      const stale = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/settings/theme', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fingerprint: settings.fingerprint,
            updates: { name: 'source' },
          }),
        }),
        { cwd: dir, changeBus },
      );
      expect(stale.status).toBe(409);
      expect(await readFile(join(dir, 'nectar.toml'), 'utf8')).toContain('name = "casper"');

      const current = await readDashboardSettings({ cwd: dir });
      const ok = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/settings/theme', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fingerprint: current.fingerprint,
            updates: { name: 'source' },
          }),
        }),
        { cwd: dir, changeBus },
      );
      expect(ok.status).toBe(200);
      expect(await readFile(join(dir, 'nectar.toml'), 'utf8')).toContain('name = "source"');
      expect(changeBus.snapshot().lastEvent).toMatchObject({
        reason: 'theme-settings-write',
        kind: 'settings',
        changedPath: 'nectar.toml',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('approves a saved page snapshot and marks later edits as stale', async () => {
    const dir = await makeDashboardFixture();
    try {
      const current = await readDashboardContentItem({
        cwd: dir,
        config: await loadConfig({ cwd: dir }),
        kind: 'pages',
        slug: 'about',
      });
      const changeBus = createChangeBus({ debounceMs: 1 });

      const approved = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/approvals/pages/about', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fingerprint: current.fingerprint,
            approvedBy: 'Takuto',
          }),
        }),
        { cwd: dir, changeBus },
      );

      expect(approved.status).toBe(201);
      expect(await readFile(join(dir, '.nectar/approvals/pages/about.json'), 'utf8')).toContain(
        '"approvedBy": "Takuto"',
      );
      expect(await readFile(join(dir, '.nectar/approvals/pages/about.md'), 'utf8')).toContain(
        'About body',
      );

      let state = await loadDashboardState({ cwd: dir, perPage: 10 });
      const approvedPage = state.pages.items.find((page) => page.slug === 'about');
      expect(approvedPage?.approval?.status).toBe('approved');

      await writeFile(
        join(dir, 'content/pages/about.md'),
        [
          '---',
          'title: About',
          'date: 2026-01-02T00:00:00Z',
          'created_at: 2026-01-02T00:00:00Z',
          '---',
          '',
          'Changed after approval',
          '',
        ].join('\n'),
        'utf8',
      );

      state = await loadDashboardState({ cwd: dir, perPage: 10 });
      const stalePage = state.pages.items.find((page) => page.slug === 'about');
      expect(stalePage?.approval?.status).toBe('stale');
      expect(changeBus.snapshot().lastEvent).toMatchObject({
        reason: 'page-approval-write',
        kind: 'pages',
        changedPath: '.nectar/approvals/pages/about.json',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('appends a missing theme section without moving top-level config keys', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'casper');
      await writeFile(
        join(dir, 'nectar.toml'),
        [
          'plugins = []',
          '',
          '[site]',
          'title = "Dashboard Test"',
          'url = "https://dashboard.test"',
          '',
        ].join('\n'),
        'utf8',
      );
      const settings = await readDashboardSettings({ cwd: dir });
      const written = await writeDashboardThemeSettings({
        cwd: dir,
        expectedFingerprint: settings.fingerprint,
        updates: { name: 'casper' },
      });

      expect(written.ok).toBe(true);
      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw.indexOf('plugins = []')).toBeLessThan(raw.indexOf('[site]'));
      expect(raw.indexOf('[theme]')).toBeGreaterThan(raw.indexOf('[site]'));
      expect(raw).toContain('name = "casper"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('inserts missing theme keys before TOML array tables', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await writeFile(
        join(dir, 'nectar.toml'),
        [
          '[site]',
          'title = "Dashboard Test"',
          'url = "https://dashboard.test"',
          '',
          '[theme]',
          'dir = "themes"',
          '',
          '[[navigation]]',
          'label = "Home"',
          'url = "/"',
          '',
        ].join('\n'),
        'utf8',
      );

      const settings = await readDashboardSettings({ cwd: dir });
      const written = await writeDashboardThemeSettings({
        cwd: dir,
        expectedFingerprint: settings.fingerprint,
        updates: { name: 'source' },
      });

      expect(written.ok).toBe(true);
      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw.indexOf('name = "source"')).toBeGreaterThan(raw.indexOf('[theme]'));
      expect(raw.indexOf('name = "source"')).toBeLessThan(raw.indexOf('[[navigation]]'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes theme settings to the last explicit config layer', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await writeDashboardThemeFixture(dir, 'casper');
      const basePath = join(dir, 'base.toml');
      const localPath = join(dir, 'local.toml');
      await writeFile(
        basePath,
        '[site]\ntitle = "Layered"\nurl = "https://dashboard.test"\n\n[theme]\nname = "source"\ndir = "themes"\n',
        'utf8',
      );
      await writeFile(localPath, '[theme]\nname = "source"\n', 'utf8');

      const settings = await readDashboardSettings({
        cwd: dir,
        configPath: 'base.toml,local.toml',
      });
      expect(settings.configPath).toBe('local.toml');

      await writeFile(
        basePath,
        '[site]\ntitle = "Changed Outside"\nurl = "https://dashboard.test"\n\n[theme]\nname = "source"\ndir = "themes"\n',
        'utf8',
      );
      const stale = await writeDashboardThemeSettings({
        cwd: dir,
        configPath: 'base.toml,local.toml',
        expectedFingerprint: settings.fingerprint,
        updates: { name: 'casper' },
      });
      expect(stale.ok).toBe(false);
      if (stale.ok) throw new Error('expected layered settings conflict');
      expect(stale.reason).toBe('conflict');

      const current = await readDashboardSettings({
        cwd: dir,
        configPath: 'base.toml,local.toml',
      });
      const written = await writeDashboardThemeSettings({
        cwd: dir,
        configPath: 'base.toml,local.toml',
        expectedFingerprint: current.fingerprint,
        updates: { name: 'casper' },
      });

      expect(written.ok).toBe(true);
      expect(await readFile(basePath, 'utf8')).toContain('name = "source"');
      expect(await readFile(localPath, 'utf8')).toContain('name = "casper"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('keeps settings readable when theme.dir is not a directory', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeFile(join(dir, 'themes-file'), 'not a directory\n', 'utf8');
      await writeFile(
        join(dir, 'nectar.toml'),
        '[site]\ntitle = "Dashboard Test"\nurl = "https://dashboard.test"\n\n[theme]\nname = "source"\ndir = "themes-file"\n',
        'utf8',
      );

      const settings = await readDashboardSettings({ cwd: dir });
      expect(settings.theme.available).toEqual([]);
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

  test('renders Markdown previews through the active theme without reading dist', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(join(dir, 'content/images/cover.jpg'), 'image-bytes', 'utf8');
      await mkdir(join(dir, 'dist/new'), { recursive: true });
      await writeFile(join(dir, 'dist/new/index.html'), '<!doctype html><p>Stale dist</p>', 'utf8');
      await writeFile(join(dir, 'dist/secret.html'), '<!doctype html><p>Secret</p>', 'utf8');

      const state = await loadDashboardState({ cwd: dir, perPage: 10 });
      const item = state.posts.items.find((post) => post.slug === 'new');
      expect(item?.preview.state).toBe('current');
      expect(item?.preview.artifactPath).toBeNull();
      expect(item?.preview.sourcePath).toBe('content/posts/new.md');
      expect(item?.preview.openUrl).toBe('/preview/content?route=%2Fnew%2F');
      expect(item?.preview.sandbox.allowScripts).toBe(true);
      expect(item?.preview.sandbox.allowSameOrigin).toBe(false);
      expect(state.build.freshness.current).toBe(3);

      const ok = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/preview/content?route=%2Fnew%2F'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(ok.status).toBe(200);
      const html = await ok.text();
      expect(html).toContain('<h1>New Post</h1>');
      expect(html).toContain('<p>New body</p>');
      expect(html).not.toContain('Stale dist');

      const contentAsset = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/content/images/cover.jpg'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(contentAsset.status).toBe(200);
      expect(await contentAsset.text()).toBe('image-bytes');

      const themeAsset = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/assets/app.css'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(themeAsset.status).toBe(200);
      expect(await themeAsset.text()).toContain('color: black');

      const traversal = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/preview/content?route=%2F..%2Fsecret'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(traversal.status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('keeps Markdown previews current when dist is stale', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await mkdir(join(dir, 'dist/new'), { recursive: true });
      await writeFile(join(dir, 'dist/new/index.html'), '<!doctype html><p>Old build</p>', 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 15));
      await writeFile(
        join(dir, 'content/posts/new.md'),
        [
          '---',
          'title: New Post',
          'date: 2026-01-03T00:00:00Z',
          'created_at: 2026-01-03T00:00:00Z',
          '---',
          '',
          'Saved after the build artifact',
          '',
        ].join('\n'),
        'utf8',
      );

      const state = await loadDashboardState({ cwd: dir, perPage: 10 });
      const item = state.posts.items.find((post) => post.slug === 'new');
      expect(item?.preview.state).toBe('current');
      expect(item?.preview.detail).toContain('saved Markdown');
      expect(state.build.freshness.current).toBe(3);
      const ok = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/preview/content?route=%2Fnew%2F'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(await ok.text()).toContain('Saved after the build artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('resolves Markdown preview routes from base-path URLs', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeFile(
        join(dir, 'nectar.toml'),
        [
          '[site]',
          'title = "Dashboard Test"',
          'description = "Local editorial surface"',
          'url = "https://dashboard.test"',
          '',
          '[theme]',
          'name = "source"',
          'dir = "themes"',
          '',
          '[build]',
          'base_path = "/blog/"',
          '',
        ].join('\n'),
        'utf8',
      );
      await mkdir(join(dir, 'dist/new'), { recursive: true });
      await writeFile(join(dir, 'dist/new/index.html'), '<!doctype html><p>Base path</p>', 'utf8');

      const state = await loadDashboardState({ cwd: dir, perPage: 10 });
      const item = state.posts.items.find((post) => post.slug === 'new');
      expect(item?.url).toBe('/blog/new/');
      expect(item?.preview.route).toBe('/new/');
      expect(item?.preview.state).toBe('current');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('measures /api/state latency for a large content set without a cache layer', async () => {
    const dir = await makeDashboardFixture();
    try {
      for (let i = 0; i < 300; i += 1) {
        const id = String(i).padStart(3, '0');
        await writeFile(
          join(dir, `content/posts/bench-${id}.md`),
          [
            '---',
            `title: Bench ${id}`,
            `date: 2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
            `created_at: 2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
            '---',
            '',
            `Bench body ${id}`,
            '',
          ].join('\n'),
          'utf8',
        );
      }

      const started = performance.now();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/state?per_page=12'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      const latencyMs = performance.now() - started;
      const state = (await response.json()) as DashboardState;

      expect(response.status).toBe(200);
      expect(state.posts.total).toBe(302);
      expect(state.posts.items).toHaveLength(12);
      expect(latencyMs).toBeLessThan(4000);
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
    expect(html).toContain('aria-label="File-backed status"');
    expect(html).toContain('id="buildStatus"');
    expect(html).toContain('id="previewStatus"');
    expect(html).toContain('id="search"');
    expect(html).not.toContain('id="density"');
    expect(html).not.toContain('id="theme"');
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('createDashboardUiState');
    expect(html).toContain('renderStatePanelHtml');
    expect(html).toContain('warningBadge');
    expect(html).toContain('previewCell');
    expect(html).toContain('sandbox="');
    expect(html).not.toContain('allow-same-origin');
  });

  test('serves dashboard sections as independent pages', async () => {
    const html = renderDashboardHtml();

    expect(html).toContain('href="/posts" data-view="posts"');
    expect(html).toContain('href="/pages" data-view="pages"');
    expect(html).toContain('href="/authors" data-view="authors"');
    expect(html).toContain('href="/tags" data-view="tags"');
    expect(html).toContain('href="/settings" data-view="settings"');
    expect(html).toContain('function initialViewFromPath');
    expect(html).toContain('function editorRouteFromPath');
    expect(html).toContain('function syncPathForView');

    for (const path of [
      '/posts',
      '/pages',
      '/authors',
      '/tags',
      '/settings',
      '/posts/future-post/edit',
      '/pages/about/edit',
      '/authors/alice/edit',
      '/tags/news/edit',
    ]) {
      const response = await handleDashboardRequest(new Request(`http://127.0.0.1:4322${path}`), {
        cwd: process.cwd(),
        changeBus: createChangeBus(),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Nectar Dashboard</title>');
    }
  });

  test('renders dashboard shell with the note-derived design system tokens', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('--text-primary:#15171a');
    expect(html).toContain('--background-secondary:#f5f6f8');
    expect(html).toContain('--surface-raised:#fff');
    expect(html).toContain('--border-default:#e5e8eb');
    expect(html).toContain('--success:#179c47');
    expect(html).toContain('--danger:#e5484d');
    expect(html).toContain('--focus:#30cf43');
    expect(html).toContain('--main-width:1040px');
    expect(html).toContain('--sidebar-width:232px');
    expect(html).toContain('--surface-secondary:#58d66d');
    expect(html).toContain('"Helvetica Neue","Hiragino Sans","Hiragino Kaku Gothic ProN"');
    expect(html).toContain('font-feature-settings:"palt"');
    expect(html).toContain('--article-width:720px');
    expect(html).toContain('font:15px/1.5 var(--font-sans)');
    expect(html).toContain('max-width:var(--main-width)');
    expect(html).toContain('max-width:620px');
    expect(html).toContain('line-height:2');
    expect(html).not.toContain('Avenir Next');
    expect(html).not.toContain('font-family:Georgia');
  });

  test('renders compact toolbar controls without escaped icon text or drawer opacity', () => {
    const html = renderDashboardHtml();

    expect(html).not.toContain('id="density"');
    expect(html).not.toContain('id="theme"');
    expect(html).not.toContain('id="command"');
    expect(html).not.toContain('\\u2195');
    expect(html).not.toContain('\\u2318K');
    expect(html).not.toContain('from{transform:translateX(18px);opacity:.7');
    expect(html).toContain('@keyframes slideIn{from{transform:translateX(18px)}');
    expect(html).toContain('.panel{min-width:0');
    expect(html).toContain('@media (max-width:560px)');
    expect(html).toContain('.table{min-width:100%;table-layout:fixed}');
    expect(html).toContain('min-height:calc(100dvh - 48px)');
    expect(html).toContain('body.editorOpen .shell');
    expect(html).toContain('.nav a span{display:inline;');
    expect(html).toContain("document.body.classList.add('editorOpen')");
    expect(html).toContain("document.body.classList.remove('editorOpen')");
  });

  test('keeps list rows focused and hides file details until requested', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('<details class="listFilters"><summary>Filters</summary>');
    expect(html).toContain('<table class="table contentTable">');
    expect(html).toContain('<th>Title</th><th>Status</th><th>Created</th>');
    expect(html).toContain('<details class="rowDetails"><summary>Details</summary>');
    expect(html).toContain('function primaryActionsCell');
    expect(html).toContain('function rowDetailsCell');
    expect(html).not.toContain('<th>Preview</th><th>Path</th>');
    expect(html).not.toContain('id="contentSearch"');
  });

  test('renders editor and create flows as independent dashboard pages', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('<section class="editor editorPage" id="editor"');
    expect(html).not.toContain('<aside class="editor"');
    expect(html).not.toContain('<section class="editor editorPage" id="editor" role="dialog"');
    expect(html).toContain('body.editorOpen .top');
    expect(html).toContain('body.editorOpen #contentPanel');
    expect(html).toContain('renderCreatePage');
    expect(html).toContain('id="createPage"');
    expect(html).toContain('submitCreateItem');
    expect(html).toContain('pathForEditor(kind,item.slug)');
    expect(html).toContain('/edit');
    expect(html).toContain('openRouteEditor');
    expect(html).toContain('syncPathForEditor');
    expect(html).toContain('openEditor(data.kind,data.slug)');
    expect(html).not.toContain("prompt('Title or name')");
  });

  test('renders recovery, guard, keyboard, media, and snippet editor affordances', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('NECTAR_DRAFT_PREFIX');
    expect(html).toContain('NECTAR_REVISION_PREFIX');
    expect(html).toContain('beforeunload');
    expect(html).toContain('id="restoreDraft"');
    expect(html).toContain('id="rollbackEditor"');
    expect(html).toContain('id="previewEditor"');
    expect(html).toContain('id="approvePage"');
    expect(html).toContain('<details class="advancedPanel" id="mediaPanel">');
    expect(html).toContain('<details class="advancedPanel" id="formatPanel">');
    expect(html).toContain('<details class="advancedPanel" id="recoveryPanel">');
    expect(html).toContain('data-snippet="bold"');
    expect(html).toContain('data-snippet="callout"');
    expect(html).toContain('id="editFeatureImage"');
    expect(html).toContain('id="editFeatureImageAlt"');
    expect(html).toContain('id="editFeatureImageCaption"');
    expect(html).toContain('id="insertMedia"');
    expect(html).not.toContain('aria-label="Editor shortcuts"');
    expect(html).not.toContain('Cmd/Ctrl');
    expect(html).toContain('Approve saved page');
    expect(html).toContain('position:sticky');
    expect(html).toContain('class="editor editorPage"');
  });

  test('opens editor preview through the active theme route', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('currentPreview=null');
    expect(html).toContain('currentPreview=findSummary(kind,slug)?.preview||null');
    expect(html).toContain('function findCurrentPreviewUrl');
    expect(html).toContain("window.open(route,'_blank','noopener')");
    expect(html).toContain('saved Markdown through active theme');
    expect(html).not.toContain('function findCurrentRoute()');
    expect(html).not.toContain("key==='p'");
    expect(html).not.toContain("key==='k'");
  });

  test('renders Ghost import controls for review-first dashboard imports', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('id="ghostImportFile"');
    expect(html).toContain('id="previewGhostImport"');
    expect(html).toContain('id="applyGhostImport"');
    expect(html).toContain('/api/import/ghost');
    expect(html).toContain('renderGhostImportResult');
  });

  test('renders page bundle controls for focused collaboration', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('data-export-page=');
    expect(html).toContain('id="pageBundleImportFile"');
    expect(html).toContain('id="previewPageBundleImport"');
    expect(html).toContain('id="applyPageBundleImport"');
    expect(html).toContain('/api/page-bundles/export/');
    expect(html).toContain('/api/page-bundles/import');
    expect(html).toContain('renderPageBundleImportResult');
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
