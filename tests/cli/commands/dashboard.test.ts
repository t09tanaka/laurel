import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  filterUnavailablePreviewPictureSources,
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
import {
  dashboardPreviewImageOutputDir,
  generateDashboardImageVariantsNow,
} from '~/cli/dashboard/image-variant-queue.ts';
import { createDashboardUiState, reduceDashboardUiState } from '~/cli/dashboard/ui-state.ts';
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
      // every settings card now carries a category bucket and a sourceKind label
      const settingsCategories = new Set(state.settings.cards.map((card) => card.category));
      expect(settingsCategories).toEqual(
        new Set(['general', 'content', 'theme', 'build', 'structure', 'operations', 'advanced']),
      );
      expect(state.settings.cards.find((card) => card.id === 'site')?.category).toBe('general');
      expect(state.settings.cards.find((card) => card.id === 'site')?.sourceKind).toBe('config');
      expect(state.settings.cards.find((card) => card.id === 'theme')?.sourceKind).toBe('theme');
      expect(state.settings.cards.find((card) => card.id === 'content-paths')?.category).toBe(
        'content',
      );
      // migration tooling is intentionally NOT a settings card — it moved to /settings/migration
      expect(state.settings.cards.map((card) => card.id)).not.toContain('ghost-import');
      expect(state.settings.cards.map((card) => card.id)).not.toContain('page-bundle-import');
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

  test('exposes per-status counts that ignore the current status filter', async () => {
    const dir = await makeDashboardFixture();
    try {
      const unfiltered = await loadDashboardState({ cwd: dir, perPage: 10 });
      expect(unfiltered.posts.statusCounts).toBeDefined();
      const counts = unfiltered.posts.statusCounts;
      if (!counts) throw new Error('statusCounts missing');
      const totalReported = counts.draft + counts.published;
      expect(counts.all).toBeGreaterThanOrEqual(totalReported);
      expect(counts.all).toBe(unfiltered.posts.total);

      const draftsOnly = await loadDashboardState({ cwd: dir, status: 'draft', perPage: 10 });
      expect(draftsOnly.posts.items.every((item) => item.status === 'draft')).toBe(true);
      expect(draftsOnly.posts.statusCounts?.all).toBe(counts.all);
      expect(draftsOnly.posts.statusCounts?.draft).toBe(counts.draft);
      expect(draftsOnly.posts.statusCounts?.published).toBe(counts.published);
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

  test('marks generated taxonomy records in the API response', async () => {
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

  test('soft-deletes authors, tags and components and restores them via trash metadata', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      await mkdir(join(dir, 'content/components'), { recursive: true });
      await writeFile(
        join(dir, 'content/components/callout.md'),
        '---\nslug: callout\ndescription: Inline aside\n---\n\n```css\n.callout {}\n```\n\n```html\n<aside></aside>\n```\n',
        'utf8',
      );

      const cases: Array<{ kind: 'authors' | 'tags' | 'components'; slug: string; path: string }> =
        [
          { kind: 'authors', slug: 'casper', path: 'content/authors/casper.md' },
          { kind: 'tags', slug: 'news', path: 'content/tags/news.md' },
          { kind: 'components', slug: 'callout', path: 'content/components/callout.md' },
        ];

      for (const { kind, slug, path } of cases) {
        const item = await readDashboardContentItem({ cwd: dir, config, kind, slug });
        const trashed = await trashDashboardContentItem({
          cwd: dir,
          config,
          kind,
          slug,
          expectedFingerprint: item.fingerprint,
          now: new Date('2026-01-10T00:00:00Z'),
        });
        expect(trashed.ok).toBe(true);
        if (!trashed.ok) throw new Error(`expected trash result for ${kind}`);
        expect(trashed.entry.originalPath).toBe(path);
        expect(existsSync(join(dir, path))).toBe(false);

        const restored = await restoreDashboardTrashEntry({ cwd: dir, id: trashed.entry.id });
        expect(restored.ok).toBe(true);
        expect(existsSync(join(dir, path))).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('strips deleted tag from referencing post frontmatter and restores it on undo', async () => {
    const dir = await makeDashboardFixture();
    try {
      // A post that references the `news` tag in three shapes so the cascade
      // is exercised against block list, inline array, and a left-behind
      // sibling tag that must survive.
      await writeFile(
        join(dir, 'content/posts/tagged.md'),
        [
          '---',
          'title: Tagged Post',
          'date: 2026-01-04T00:00:00Z',
          'created_at: 2026-01-04T00:00:00Z',
          'tags: [news, keep-me]',
          '---',
          '',
          'Tagged body',
          '',
        ].join('\n'),
        'utf8',
      );
      const config = await loadConfig({ cwd: dir });
      const before = await readFile(join(dir, 'content/posts/tagged.md'), 'utf8');
      const tag = await readDashboardContentItem({ cwd: dir, config, kind: 'tags', slug: 'news' });

      const trashed = await trashDashboardContentItem({
        cwd: dir,
        config,
        kind: 'tags',
        slug: 'news',
        expectedFingerprint: tag.fingerprint,
        now: new Date('2026-01-10T00:00:00Z'),
      });
      expect(trashed.ok).toBe(true);
      if (!trashed.ok) throw new Error('expected trash result');

      const rewritten = await readFile(join(dir, 'content/posts/tagged.md'), 'utf8');
      expect(rewritten).not.toContain('news');
      expect(rewritten).toContain('keep-me');

      const restored = await restoreDashboardTrashEntry({ cwd: dir, id: trashed.entry.id });
      expect(restored.ok).toBe(true);
      expect(existsSync(join(dir, 'content/tags/news.md'))).toBe(true);
      // Undo puts the referencing post back byte-for-byte.
      expect(await readFile(join(dir, 'content/posts/tagged.md'), 'utf8')).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('deleting an unreferenced tag records no cascade and leaves posts untouched', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const postBefore = await readFile(join(dir, 'content/posts/new.md'), 'utf8');
      const tag = await readDashboardContentItem({ cwd: dir, config, kind: 'tags', slug: 'news' });

      const trashed = await trashDashboardContentItem({
        cwd: dir,
        config,
        kind: 'tags',
        slug: 'news',
        expectedFingerprint: tag.fingerprint,
        now: new Date('2026-01-10T00:00:00Z'),
      });
      expect(trashed.ok).toBe(true);
      if (!trashed.ok) throw new Error('expected trash result');
      expect(trashed.entry.affectedFiles ?? []).toHaveLength(0);
      expect(await readFile(join(dir, 'content/posts/new.md'), 'utf8')).toBe(postBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a stale-fingerprint taxonomy delete with a conflict', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({
        cwd: dir,
        config,
        kind: 'authors',
        slug: 'casper',
      });
      const result = await trashDashboardContentItem({
        cwd: dir,
        config,
        kind: 'authors',
        slug: 'casper',
        expectedFingerprint: { ...item.fingerprint, size: item.fingerprint.size + 1 },
        now: new Date('2026-01-10T00:00:00Z'),
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected conflict');
      expect(result.reason).toBe('conflict');
      // The file must still be on disk — a rejected delete is a no-op.
      expect(existsSync(join(dir, 'content/authors/casper.md'))).toBe(true);
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

  test('renaming a component rewrites {old} references in post and page bodies', async () => {
    const dir = await makeDashboardFixture();
    try {
      // Drop a component plus posts/pages that reference it in mixed
      // contexts. The rewrite should hit the paragraph and list item,
      // skip the fenced code block, and leave unrelated tokens alone.
      await mkdir(join(dir, 'content/components'), { recursive: true });
      await writeFile(
        join(dir, 'content/components/callout.md'),
        [
          '---',
          'slug: callout',
          'description: Inline aside',
          '---',
          '',
          '```css',
          '.callout { display: block; }',
          '```',
          '',
          '```html',
          '<aside class="callout">…</aside>',
          '```',
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(dir, 'content/posts/with-callout.md'),
        [
          '---',
          'title: With Callout',
          'date: 2026-02-01T00:00:00Z',
          'created_at: 2026-02-01T00:00:00Z',
          '---',
          '',
          'See {callout} for the aside.',
          '',
          '- {callout}',
          '- other item',
          '',
          '```html',
          '{callout} stays literal',
          '```',
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(dir, 'content/pages/no-refs.md'),
        '---\ntitle: No refs\n---\n\nNo shortcodes here.\n',
        'utf8',
      );

      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({
        cwd: dir,
        config,
        kind: 'components',
        slug: 'callout',
      });

      const renamed = await renameDashboardContentSlug({
        cwd: dir,
        config,
        kind: 'components',
        oldSlug: 'callout',
        newSlug: 'hero',
        expectedFingerprint: item.fingerprint,
        redirect: false,
      });

      expect(renamed.ok).toBe(true);
      if (!renamed.ok) throw new Error('expected rename result');
      expect(renamed.newPath).toBe('content/components/hero.md');
      expect(renamed.rewrittenReferences).toEqual({
        filesChanged: 1,
        occurrencesRewritten: 2,
      });

      const rewrittenPost = await readFile(join(dir, 'content/posts/with-callout.md'), 'utf8');
      expect(rewrittenPost).toContain('See {hero} for the aside.');
      expect(rewrittenPost).toContain('- {hero}');
      // Fenced code block must stay literal.
      expect(rewrittenPost).toContain('{callout} stays literal');

      const untouchedPage = await readFile(join(dir, 'content/pages/no-refs.md'), 'utf8');
      expect(untouchedPage).toContain('No shortcodes here.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('renaming a component with rewriteReferences=false leaves bodies alone', async () => {
    const dir = await makeDashboardFixture();
    try {
      await mkdir(join(dir, 'content/components'), { recursive: true });
      await writeFile(
        join(dir, 'content/components/callout.md'),
        '---\nslug: callout\n---\n\n```html\n<aside></aside>\n```\n',
        'utf8',
      );
      await writeFile(
        join(dir, 'content/posts/uses-callout.md'),
        '---\ntitle: Uses Callout\ndate: 2026-02-01T00:00:00Z\ncreated_at: 2026-02-01T00:00:00Z\n---\n\n{callout}\n',
        'utf8',
      );

      const config = await loadConfig({ cwd: dir });
      const item = await readDashboardContentItem({
        cwd: dir,
        config,
        kind: 'components',
        slug: 'callout',
      });

      const renamed = await renameDashboardContentSlug({
        cwd: dir,
        config,
        kind: 'components',
        oldSlug: 'callout',
        newSlug: 'hero',
        expectedFingerprint: item.fingerprint,
        rewriteReferences: false,
      });

      expect(renamed.ok).toBe(true);
      if (!renamed.ok) throw new Error('expected rename result');
      expect(renamed.rewrittenReferences).toBeNull();

      const post = await readFile(join(dir, 'content/posts/uses-callout.md'), 'utf8');
      // Body must still read `{callout}` even though the snippet is now `{hero}`.
      expect(post).toContain('{callout}');
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

  test('multipart Ghost import passes downloadImages and maxImageSizeBytes through to the importer', async () => {
    const dir = await makeDashboardFixture();
    try {
      const exportDir = join(dir, 'tmp-ghost-export-multipart');
      const zipPath = join(dir, 'dashboard-import-multipart.zip');
      await makeGhostExportZip(zipPath, exportDir);

      const fileBytes = await readFile(zipPath);
      const form = new FormData();
      form.append(
        'file',
        new File([new Uint8Array(fileBytes)], 'dashboard-import-multipart.zip', {
          type: 'application/zip',
        }),
      );
      form.append('dryRun', 'true');
      form.append('onConflict', 'overwrite');
      form.append('downloadImages', 'true');
      form.append('maxImageSizeBytes', String(5 * 1024 * 1024));

      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/import/ghost', { method: 'POST', body: form }),
        { cwd: dir, changeBus: createChangeBus() },
      );

      // Multipart Ghost-import responses stream NDJSON events (one JSON
      // object per line) so the dashboard overlay can render per-image
      // progress. The terminal event carries the import summary.
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type') ?? '').toContain('application/x-ndjson');
      const raw = await response.text();
      const events = raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map(
          (line) =>
            JSON.parse(line) as {
              type: string;
              summary?: { dryRun: boolean; posts: number; imagesDownloaded?: number };
              message?: string;
            },
        );
      const done = events.find((e) => e.type === 'done');
      expect(done?.summary?.dryRun).toBe(true);
      expect(done?.summary?.posts).toBe(1);

      const formBad = new FormData();
      formBad.append(
        'file',
        new File([new Uint8Array(fileBytes)], 'dashboard-import-multipart.zip', {
          type: 'application/zip',
        }),
      );
      formBad.append('dryRun', 'true');
      formBad.append('onConflict', 'overwrite');
      formBad.append('maxImageSizeBytes', 'not-a-number');
      const badResponse = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/import/ghost', { method: 'POST', body: formBad }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(badResponse.status).toBe(400);
      const badBody = (await badResponse.json()) as { error: string };
      expect(badBody.error).toContain('maxImageSizeBytes');
      // Validation must run before the upload is staged so a rejected
      // request never leaks a copy of the export under .nectar/.
      const stagedRoot = join(dir, '.nectar');
      const stagedEntries = await readdir(stagedRoot).catch(() => [] as string[]);
      expect(stagedEntries.some((name) => name.startsWith('import-ghost-'))).toBe(false);
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

  test('multipart Ghost import threads downloadImages + maxImageSizeBytes into the run', async () => {
    const dir = await makeDashboardFixture();
    try {
      const exportDir = join(dir, 'tmp-ghost-export-multipart');
      const zipPath = join(dir, 'dashboard-import-multipart.zip');
      await makeGhostExportZip(zipPath, exportDir);
      const zipBytes = await readFile(zipPath);

      const form = new FormData();
      form.append('file', new File([new Uint8Array(zipBytes)], 'ghost.zip'));
      form.append('dryRun', 'false');
      form.append('onConflict', 'overwrite');
      form.append('downloadImages', 'true');
      form.append('maxImageSizeBytes', String(2 * 1024 * 1024));

      const applied = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/import/ghost', { method: 'POST', body: form }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(applied.status).toBe(200);
      expect(applied.headers.get('content-type') ?? '').toContain('application/x-ndjson');
      const events = (await applied.text())
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map(
          (line) =>
            JSON.parse(line) as {
              type: string;
              summary?: { posts: number; imagesDownloaded: number; imagesFailed: number };
            },
        );
      const done = events.find((event) => event.type === 'done');
      expect(done?.summary?.posts).toBe(1);
      // Fixture post body has no external images, so download stays 0/0 but the
      // multipart pipeline must accept the flags without 400ing.
      expect(done?.summary?.imagesDownloaded).toBe(0);
      expect(done?.summary?.imagesFailed).toBe(0);

      const badForm = new FormData();
      badForm.append('file', new File([new Uint8Array(zipBytes)], 'ghost.zip'));
      badForm.append('dryRun', 'true');
      badForm.append('onConflict', 'skip');
      badForm.append('downloadImages', 'true');
      badForm.append('maxImageSizeBytes', 'not-a-number');
      const rejected = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/import/ghost', { method: 'POST', body: badForm }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(rejected.status).toBe(400);
      const rejectedBody = (await rejected.json()) as { error?: string };
      expect(rejectedBody.error).toMatch(/maxImageSizeBytes/);
      // Bad-request must not leave a half-staged upload behind under .nectar/.
      const stagedAfterReject = await readdir(join(dir, '.nectar')).catch(() => [] as string[]);
      expect(stagedAfterReject.filter((name) => name.startsWith('import-ghost-'))).toEqual([]);
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

      // GET /api/bundles/export is now a pure read — it must NOT mutate the source file
      const exported = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/export?kind=page&slug=about'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-type')).toBe('application/zip');
      const zipBytes = new Uint8Array(await exported.arrayBuffer());
      expect(zipBytes.length).toBeGreaterThan(0);

      // Source file must NOT have been mutated by the GET export (pure read,
      // neutral transport — no status stamping).
      const srcAfterExport = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
      expect(srcAfterExport).not.toContain('needs-review');

      // Dry-run import (rename conflict policy) → written:false, file not created
      const dryRunForm = new FormData();
      dryRunForm.append('file', new File([zipBytes], 'about.nectar.zip'));
      dryRunForm.append('onConflict', 'rename');
      dryRunForm.append('dryRun', 'true');
      const preview = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/import', {
          method: 'POST',
          body: dryRunForm,
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(preview.status).toBe(200);
      const previewBody = (await preview.json()) as {
        written: boolean;
        renamed: boolean;
        entryPath: string;
      };
      expect(previewBody.written).toBe(false);
      expect(previewBody.renamed).toBe(true);
      expect(previewBody.entryPath).toBe('content/pages/about-2.md');
      await expect(access(join(dir, 'content/pages/about-2.md'))).rejects.toThrow();

      // Apply import
      const applyForm = new FormData();
      applyForm.append('file', new File([zipBytes], 'about.nectar.zip'));
      applyForm.append('onConflict', 'rename');
      applyForm.append('dryRun', 'false');
      const applied = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/import', {
          method: 'POST',
          body: applyForm,
        }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(applied.status).toBe(200);
      const appliedBody = (await applied.json()) as {
        written: boolean;
        renamed: boolean;
        entryPath: string;
      };
      expect(appliedBody.written).toBe(true);
      expect(appliedBody.renamed).toBe(true);
      expect(appliedBody.entryPath).toBe('content/pages/about-2.md');
      expect(await readFile(join(dir, appliedBody.entryPath), 'utf8')).toContain(
        'About dashboard body',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('exports and imports entry zip bundles (posts + pages) via /api/bundles', async () => {
    const dir = await makeDashboardFixture();
    try {
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(join(dir, 'content/images/hero.txt'), 'hero asset\n', 'utf8');
      await writeFile(
        join(dir, 'content/posts/old.md'),
        [
          '---',
          'title: Old Post',
          'slug: old',
          'status: draft',
          'date: 2026-01-01T00:00:00Z',
          'created_at: 2026-01-01T00:00:00Z',
          'feature_image: /content/images/hero.txt',
          '---',
          '',
          'Old body.',
          '',
        ].join('\n'),
        'utf8',
      );

      // GET /api/bundles/export is now a pure read — source must not be mutated
      const exported = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/export?kind=post&slug=old'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-type')).toBe('application/zip');
      const zipBytes = new Uint8Array(await exported.arrayBuffer());
      expect(zipBytes.length).toBeGreaterThan(0);

      // GET alone must NOT mutate source (pure read, neutral transport)
      const srcAfterExport = await readFile(join(dir, 'content/posts/old.md'), 'utf8');
      expect(srcAfterExport).not.toContain('needs-review');
      expect(srcAfterExport).toContain('status: draft');

      // POST /api/bundles/import with multipart zip → written:true, status preserved
      const form = new FormData();
      form.append('file', new File([zipBytes], 'old.nectar.zip'));
      form.append('onConflict', 'overwrite');
      form.append('dryRun', 'false');
      const imported = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/import', { method: 'POST', body: form }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(imported.status).toBe(200);
      const importedBody = (await imported.json()) as {
        written: boolean;
        kind: string;
        slug: string;
        entryPath: string;
      };
      expect(importedBody.written).toBe(true);
      expect(importedBody.kind).toBe('post');
      expect(importedBody.slug).toBe('old');
      const importedSrc = await readFile(join(dir, importedBody.entryPath), 'utf8');
      expect(importedSrc).toContain('needs-review');

      // 400 for missing kind on GET export
      const bad = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/export?slug=old'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(bad.status).toBe(400);

      // 400 for invalid kind on GET export
      const badKind = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/bundles/export?kind=author&slug=old'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(badKind.status).toBe(400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('exports and imports components bundles via /api/components/bundle', async () => {
    const dir = await makeDashboardFixture();
    try {
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
          'utf8',
        );
      }

      // GET export of every component (read-only).
      const exported = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/components/bundle/export'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-type')).toBe('application/zip');
      const zipBytes = new Uint8Array(await exported.arrayBuffer());
      expect(zipBytes.length).toBeGreaterThan(0);

      // Import into a fresh target directory.
      const target = await realpath(await mkdtemp(join(tmpdir(), 'nectar-comp-import-')));
      await writeFile(
        join(target, 'nectar.toml'),
        ['[site]', 'title = "T"', 'url = "https://t.test"', ''].join('\n'),
        'utf8',
      );
      const form = new FormData();
      form.append('file', new File([zipBytes], 'components.nectar.zip'));
      form.append('onConflict', 'overwrite');
      form.append('dryRun', 'false');
      const imported = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/components/bundle/import', {
          method: 'POST',
          body: form,
        }),
        { cwd: target, changeBus: createChangeBus() },
      );
      expect(imported.status).toBe(200);
      const importedBody = (await imported.json()) as { written: number };
      expect(importedBody.written).toBe(2);
      expect(await readFile(join(target, 'content/components/callout.md'), 'utf8')).toContain(
        '```html',
      );
      await rm(target, { recursive: true, force: true });

      // Invalid slug filter is rejected.
      const badSlug = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/components/bundle/export?slugs=1bad'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(badSlug.status).toBe(400);

      // A partial export (one real slug + one that does not exist) still
      // succeeds but reports the skipped slug via a response header so a
      // programmatic caller can tell something was omitted.
      const partial = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/components/bundle/export?slugs=callout,ghost'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(partial.status).toBe(200);
      expect(partial.headers.get('x-nectar-missing-components')).toBe('ghost');
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

  test('activates the uploaded theme by writing [theme].name', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      const stagingDir = await mkdtemp(join(tmpdir(), 'nectar-theme-zip-'));
      const themeStaging = join(stagingDir, 'newcomer');
      await mkdir(themeStaging, { recursive: true });
      await writeFile(join(themeStaging, 'index.hbs'), '<h1>Newcomer</h1>\n', 'utf8');
      await writeFile(
        join(themeStaging, 'post.hbs'),
        '<!doctype html><html><head>{{ghost_head}}</head><body><main>{{content}}</main></body></html>',
        'utf8',
      );
      await writeFile(
        join(themeStaging, 'page.hbs'),
        '<!doctype html><html><head>{{ghost_head}}</head><body><main>{{content}}</main></body></html>',
        'utf8',
      );
      const zipPath = join(stagingDir, 'newcomer.zip');
      const zipProc = Bun.spawn(['zip', '-rq', zipPath, 'newcomer'], {
        cwd: stagingDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await zipProc.exited;
      if (zipProc.exitCode !== 0) {
        throw new Error(
          `failed to build test theme zip: ${await new Response(zipProc.stderr).text()}`,
        );
      }

      const zipBytes = await Bun.file(zipPath).bytes();
      const form = new FormData();
      form.append('file', new File([zipBytes], 'newcomer.zip', { type: 'application/zip' }));
      const changeBus = createChangeBus({ debounceMs: 1 });
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/themes/upload', {
          method: 'POST',
          body: form,
        }),
        { cwd: dir, changeBus },
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, name: 'newcomer', active: true });

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('name = "newcomer"');

      const settings = await readDashboardSettings({ cwd: dir });
      expect(settings.theme.name).toBe('newcomer');
      expect(settings.theme.available.find((theme) => theme.name === 'newcomer')).toMatchObject({
        active: true,
      });

      await rm(stagingDir, { recursive: true, force: true });
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

  test('saves site code injection without touching the gate when allow_code_injection is omitted', async () => {
    const dir = await makeDashboardFixture();
    try {
      const before = await readDashboardSettings({ cwd: dir });
      expect(before.site.codeinjectionHead).toBe('');
      expect(before.site.codeinjectionFoot).toBe('');
      expect(before.site.allowCodeInjection).toBe(false);

      const headHtml =
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>';
      const footHtml = '<script>console.log("foot")</script>';
      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: {
          codeinjection_head: headHtml,
          codeinjection_foot: footHtml,
        },
      });
      expect(written.ok).toBe(true);

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('codeinjection_head =');
      expect(raw).toContain('codeinjection_foot =');
      // No [build] section auto-inserted when allow_code_injection isn't in
      // the payload. The dashboard UI sends the boolean explicitly via its
      // own checkbox — this codepath models a partial-payload caller.
      expect(raw).not.toContain('[build]');
      // Existing [site] keys must still be present (regression check for
      // updateTomlSection refactor).
      expect(raw).toContain('title = "Dashboard Test"');

      const after = await readDashboardSettings({ cwd: dir });
      expect(after.site.codeinjectionHead).toBe(headHtml);
      expect(after.site.codeinjectionFoot).toBe(footHtml);
      expect(after.site.allowCodeInjection).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('explicit allow_code_injection=true flips the gate atomically with head/foot', async () => {
    const dir = await makeDashboardFixture();
    try {
      const before = await readDashboardSettings({ cwd: dir });
      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: {
          codeinjection_head: '<script>ga()</script>',
          allow_code_injection: true,
        },
      });
      expect(written.ok).toBe(true);

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('codeinjection_head = "<script>ga()</script>"');
      expect(raw).toContain('[build]');
      expect(raw).toContain('allow_code_injection = true');

      const after = await readDashboardSettings({ cwd: dir });
      expect(after.site.allowCodeInjection).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('explicit allow_code_injection=false flips the gate back off', async () => {
    const dir = await makeDashboardFixture();
    try {
      // Seed: head present, gate on.
      await writeFile(
        join(dir, 'nectar.toml'),
        [
          '[site]',
          'title = "Dashboard Test"',
          'url = "https://dashboard.test"',
          'codeinjection_head = "<script>old()</script>"',
          '',
          '[build]',
          'allow_code_injection = true',
          '',
        ].join('\n'),
        'utf8',
      );

      const before = await readDashboardSettings({ cwd: dir });
      expect(before.site.allowCodeInjection).toBe(true);

      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: { allow_code_injection: false },
      });
      expect(written.ok).toBe(true);

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('allow_code_injection = false');
      // Empty head/foot in payload (omitted) → existing values untouched.
      expect(raw).toContain('codeinjection_head = "<script>old()</script>"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('round-trips multi-line code injection with quotes and backslashes', async () => {
    const dir = await makeDashboardFixture();
    try {
      const multiline = [
        '<script>',
        '  (function() {',
        '    var key = "G-XXXX\\nnewline";',
        '    console.log(`hello\\tworld`);',
        '  })();',
        '</script>',
      ].join('\n');

      const before = await readDashboardSettings({ cwd: dir });
      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: { codeinjection_head: multiline, allow_code_injection: true },
      });
      expect(written.ok).toBe(true);

      const after = await readDashboardSettings({ cwd: dir });
      // The dashboard reads through the TOML parser, so any escape
      // round-trip mistake (basic-string \n re-escape, backslash collapse,
      // double-quote handling) would surface as a mismatch here.
      expect(after.site.codeinjectionHead).toBe(multiline);
      expect(after.site.allowCodeInjection).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('round-trips the site-wide social share image (og_image)', async () => {
    const dir = await makeDashboardFixture();
    try {
      const before = await readDashboardSettings({ cwd: dir });
      expect(before.site.ogImage).toBe('');

      const ogImage = '/content/images/social-card.png';
      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: { og_image: ogImage },
      });
      expect(written.ok).toBe(true);

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain(`og_image = "${ogImage}"`);
      // Existing [site] keys must survive the targeted update.
      expect(raw).toContain('title = "Dashboard Test"');

      const after = await readDashboardSettings({ cwd: dir });
      expect(after.site.ogImage).toBe(ogImage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects non-boolean allow_code_injection via the PATCH route', async () => {
    const dir = await makeDashboardFixture();
    try {
      const settings = await readDashboardSettings({ cwd: dir });
      const changeBus = createChangeBus();
      const request = new Request('http://127.0.0.1/api/settings/site', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1',
          'x-nectar-dashboard-token': 'test-token',
        },
        body: JSON.stringify({
          fingerprint: settings.fingerprint,
          updates: { allow_code_injection: 'true' },
        }),
      });
      const response = await handleDashboardRequest(request, {
        cwd: dir,
        changeBus,
        security: { token: 'test-token', origin: 'http://127.0.0.1', lanExposed: false },
        maxBodyBytes: 1024 * 1024,
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; field: string; expected: string };
      expect(body.field).toBe('allow_code_injection');
      expect(body.expected).toBe('boolean');

      // Gate must not have been touched — otherwise the silent-no-op path
      // would have written something.
      const after = await readDashboardSettings({ cwd: dir });
      expect(after.site.allowCodeInjection).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects unknown site settings fields via the PATCH route', async () => {
    const dir = await makeDashboardFixture();
    try {
      const settings = await readDashboardSettings({ cwd: dir });
      const changeBus = createChangeBus();
      const request = new Request('http://127.0.0.1/api/settings/site', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1',
          'x-nectar-dashboard-token': 'test-token',
        },
        body: JSON.stringify({
          fingerprint: settings.fingerprint,
          updates: { codeinjection_head: '<script>ok()</script>', not_a_field: 'x' },
        }),
      });
      const response = await handleDashboardRequest(request, {
        cwd: dir,
        changeBus,
        security: { token: 'test-token', origin: 'http://127.0.0.1', lanExposed: false },
        maxBodyBytes: 1024 * 1024,
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; fields: string[] };
      expect(body.fields).toContain('not_a_field');
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

  test('flags theme status as missing with a vendor hint when the theme directory does not exist', async () => {
    const dir = await makeDashboardFixture();
    try {
      const state = await loadDashboardState({ cwd: dir });
      const settings = await readDashboardSettings({ cwd: dir });

      // Fixture references `[theme] name = "source"` but never vendors the
      // directory, so both surfaces should flag it as missing and offer a
      // ready-to-paste git clone command pointing at the canonical Source
      // theme repo. This mirrors the `NectarError` that `loadTheme()` raises
      // at build time.
      expect(state.settings.theme.status.missing).toBe(true);
      expect(state.settings.theme.status.expectedPath).toBe('themes/source');
      expect(state.settings.theme.status.cloneCommand).toBe(
        'git clone https://github.com/TryGhost/Source themes/source',
      );
      expect(state.settings.theme.status.message).toContain('source');
      expect(state.settings.theme.status.hint).toContain('Vendor');

      expect(settings.theme.status.missing).toBe(true);
      expect(settings.theme.status.expectedPath).toBe('themes/source');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('marks theme status as present once the configured theme is vendored', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      const state = await loadDashboardState({ cwd: dir });

      expect(state.settings.theme.status.missing).toBe(false);
      expect(state.settings.theme.status.expectedPath).toBe('themes/source');
      expect(state.settings.theme.status.cloneCommand).toBeUndefined();
      expect(state.settings.theme.status.message).toBeUndefined();
      expect(state.settings.theme.status.hint).toBeUndefined();
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
      await writeFile(
        join(dir, 'themes/source/package.json'),
        JSON.stringify({ name: 'source', version: '1.0.0', config: { card_assets: true } }),
        'utf8',
      );
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(join(dir, 'content/images/cover.jpg'), 'image-bytes', 'utf8');
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
          '{{< bookmark url="https://example.com/" title="Example card" />}}',
          '',
        ].join('\n'),
        'utf8',
      );
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
      expect(html).toContain('/assets/ghost-card-assets.css?v=7');
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

      const cardCss = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/assets/ghost-card-assets.css?v=7'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(cardCss.status).toBe(200);
      expect(cardCss.headers.get('content-type')).toContain('text/css');
      expect(await cardCss.text()).toContain('.kg-bookmark-card');

      const cardJs = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/assets/ghost-card-assets.js?v=7'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(cardJs.status).toBe(200);
      expect(cardJs.headers.get('content-type')).toContain('application/javascript');
      expect(await cardJs.text()).toContain('kg-toggle-card');

      const traversal = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/preview/content?route=%2F..%2Fsecret'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(traversal.status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('filters preview picture sources whose generated files do not exist', async () => {
    const dir = await makeDashboardFixture();
    try {
      const config = await loadConfig({ cwd: dir });
      const cacheRoot = dashboardPreviewImageOutputDir(dir);
      await mkdir(join(cacheRoot, 'content/images/size/w600'), { recursive: true });
      await writeFile(
        join(cacheRoot, 'content/images/size/w600/existing.jpg.webp'),
        'webp',
        'utf8',
      );
      const html = [
        '<picture>',
        '<source type="image/webp" srcset="/content/images/size/w600/missing.jpg.webp 600w" sizes="100vw">',
        '<img src="/content/images/missing.jpg" alt="">',
        '</picture>',
        '<picture>',
        '<source type="image/webp" srcset="/content/images/size/w600/existing.jpg.webp 600w" sizes="100vw">',
        '<img src="/content/images/existing.jpg" alt="">',
        '</picture>',
      ].join('');

      const filtered = await filterUnavailablePreviewPictureSources(html, { cwd: dir, config });

      expect(filtered).not.toContain('missing.jpg.webp');
      expect(filtered).toContain('existing.jpg.webp');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('serves generated preview image variants from cache before falling back to originals', async () => {
    const dir = await makeDashboardFixture();
    try {
      await mkdir(join(dir, 'content/images'), { recursive: true });
      await writeFile(join(dir, 'content/images/photo.jpg'), 'original', 'utf8');
      const cacheRoot = dashboardPreviewImageOutputDir(dir);
      await mkdir(join(cacheRoot, 'content/images/size/w600'), { recursive: true });
      await writeFile(join(cacheRoot, 'content/images/size/w600/photo.jpg.webp'), 'webp', 'utf8');

      const generated = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/content/images/size/w600/photo.jpg.webp'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(generated.status).toBe(200);
      expect(await generated.text()).toBe('webp');

      const fallback = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/content/images/size/w1000/photo.jpg'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(fallback.status).toBe(200);
      expect(await fallback.text()).toBe('original');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('generates dashboard preview image variants into cache without modifying content images', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardThemeFixture(dir, 'source');
      await mkdir(join(dir, 'content/images'), { recursive: true });
      const sharp = (await import('sharp')).default;
      await sharp({
        create: {
          width: 1200,
          height: 800,
          channels: 3,
          background: '#336699',
        },
      })
        .jpeg()
        .toFile(join(dir, 'content/images/photo.jpg'));

      const generated = await generateDashboardImageVariantsNow({
        cwd: dir,
        reason: 'test',
      });
      const cacheRoot = dashboardPreviewImageOutputDir(dir);

      expect(generated).toBeGreaterThan(0);
      expect(existsSync(join(cacheRoot, 'content/images/size/w600/photo.jpg'))).toBe(true);
      expect(existsSync(join(cacheRoot, 'content/images/size/w600/photo.jpg.webp'))).toBe(true);
      expect(existsSync(join(dir, 'content/images/size/w600/photo.jpg'))).toBe(false);
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

  test('renders the minimal Preact dashboard shell with bundle references', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('<title>Nectar Dashboard</title>');
    expect(html).toContain('data-theme="system"');
    expect(html).toContain('<link rel="stylesheet" href="/assets/dashboard.css">');
    expect(html).toContain('<link rel="stylesheet" href="/api/themes/active/css">');
    expect(html).toContain('<script type="module" src="/assets/dashboard.js"></script>');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('href="#main"');

    // The CSRF token now ships via /api/dashboard/bootstrap, not a meta tag.
    expect(html).not.toContain('nectar-dashboard-token');
    // Inline `<style>` tag and bundled vanilla JS are gone — the shell only
    // loads the Preact bundle from the served assets.
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('createDashboardUiState');
    expect(html).not.toContain('renderStatePanelHtml');
  });

  test('serves the same shell HTML for all dashboard URL routes', async () => {
    for (const path of [
      '/',
      '/posts',
      '/pages',
      '/authors',
      '/tags',
      '/settings',
      '/settings/design',
      '/settings/integration',
      '/settings/migration',
      '/migration',
      '/posts/new',
      '/pages/new',
      '/authors/new',
      '/tags/new',
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
      const body = await response.text();
      expect(body).toContain('<title>Nectar Dashboard</title>');
      expect(body).toContain('<div id="root"></div>');
    }
  });

  test('reports a clear error when the dashboard bundle is missing on disk', async () => {
    const tmpCwd = await mkdtemp(join(tmpdir(), 'nectar-bundle-'));
    try {
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/assets/dashboard.js'),
        { cwd: tmpCwd, changeBus: createChangeBus() },
      );
      // The route is independent of cwd; it points at the published bundle
      // dir. When the bundle is absent the response is 503 with a build hint.
      if (response.status === 503) {
        expect(await response.text()).toContain('bun run build:dashboard-bundle');
      } else {
        // If the bundle is present (developer ran build before tests), the
        // response is 200 application/javascript — also acceptable.
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('javascript');
      }
    } finally {
      await rm(tmpCwd, { recursive: true, force: true });
    }
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
  });

  test('reduces search, paging, density, and conflict state predictably', () => {
    let state = createDashboardUiState({ postsPage: 3, pagesPage: 2 });

    state = reduceDashboardUiState(state, { type: 'search/set', query: 'draft' });
    expect(state.query).toBe('draft');
    expect(state.postsPage).toBe(1);
    expect(state.pagesPage).toBe(1);

    state = reduceDashboardUiState(state, { type: 'page/next', kind: 'posts', pages: 2 });
    expect(state.postsPage).toBe(2);

    state = reduceDashboardUiState(state, { type: 'density/toggle' });
    expect(state.density).toBe('compact');

    state = reduceDashboardUiState(state, {
      type: 'conflict',
      message: 'Changed on disk',
    });
    expect(state.loadStatus).toBe('conflict');
    expect(state.conflictMessage).toBe('Changed on disk');
  });
});

describe('GET /api/dashboard/bootstrap', () => {
  test('returns the per-process token and the resolved server mode', async () => {
    const dir = await makeDashboardFixture();
    try {
      const bus = createChangeBus();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/dashboard/bootstrap'),
        {
          cwd: dir,
          changeBus: bus,
          mode: 'dev',
          security: {
            origin: 'http://127.0.0.1:4322',
            token: 'unit-test-token',
            lanExposed: false,
          },
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { token: string; mode: 'dev' | 'prod' };
      expect(body.token).toBe('unit-test-token');
      expect(body.mode).toBe('dev');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('defaults mode to "prod" when the context omits it', async () => {
    const dir = await makeDashboardFixture();
    try {
      const bus = createChangeBus();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/dashboard/bootstrap'),
        {
          cwd: dir,
          changeBus: bus,
          security: {
            origin: 'http://127.0.0.1:4322',
            token: 'unit-test-token',
            lanExposed: false,
          },
        },
      );
      const body = (await response.json()) as { token: string; mode: 'dev' | 'prod' };
      expect(body.mode).toBe('prod');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns 403 when Origin header does not match security origin', async () => {
    const dir = await makeDashboardFixture();
    try {
      const bus = createChangeBus();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/dashboard/bootstrap', {
          headers: { origin: 'https://evil.example.com' },
        }),
        {
          cwd: dir,
          changeBus: bus,
          mode: 'dev',
          security: {
            origin: 'http://127.0.0.1:4322',
            token: 'unit-test-token',
            lanExposed: false,
          },
        },
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('forbidden');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns 403 when Referer is cross-origin and Origin is absent', async () => {
    const dir = await makeDashboardFixture();
    try {
      const bus = createChangeBus();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/dashboard/bootstrap', {
          headers: { referer: 'https://evil.example.com/login' },
        }),
        {
          cwd: dir,
          changeBus: bus,
          mode: 'dev',
          security: {
            origin: 'http://127.0.0.1:4322',
            token: 'unit-test-token',
            lanExposed: false,
          },
        },
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('forbidden');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('dashboard favicon (site.icon)', () => {
  test('writes site.icon to the [site] section and reads it back', async () => {
    const dir = await makeDashboardFixture();
    try {
      const before = await readDashboardSettings({ cwd: dir });
      expect(before.site.icon).toBe('');

      const written = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: { icon: '/content/images/favicon.png' },
      });
      expect(written.ok).toBe(true);

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('icon = "/content/images/favicon.png"');
      // Existing [site] keys untouched.
      expect(raw).toContain('title = "Dashboard Test"');

      const after = await readDashboardSettings({ cwd: dir });
      expect(after.site.icon).toBe('/content/images/favicon.png');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('clears site.icon by writing an empty string', async () => {
    const dir = await makeDashboardFixture();
    try {
      const seeded = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: (await readDashboardSettings({ cwd: dir })).fingerprint,
        updates: { icon: '/content/images/favicon.png' },
      });
      expect(seeded.ok).toBe(true);

      const before = await readDashboardSettings({ cwd: dir });
      const cleared = await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: before.fingerprint,
        updates: { icon: '' },
      });
      expect(cleared.ok).toBe(true);

      const raw = await readFile(join(dir, 'nectar.toml'), 'utf8');
      expect(raw).toContain('icon = ""');

      const after = await readDashboardSettings({ cwd: dir });
      expect(after.site.icon).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('loadDashboardState surfaces the configured site.icon', async () => {
    const dir = await makeDashboardFixture();
    try {
      await writeDashboardSiteSettings({
        cwd: dir,
        expectedFingerprint: (await readDashboardSettings({ cwd: dir })).fingerprint,
        updates: { icon: '/content/images/favicon.svg' },
      });
      const state = await loadDashboardState({ cwd: dir });
      expect(state.site.icon).toBe('/content/images/favicon.svg');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('POST /api/images accepts an .ico favicon and stores it with a .ico extension', async () => {
    const dir = await makeDashboardFixture();
    try {
      const form = new FormData();
      // Minimal ICO header bytes; content is irrelevant to the upload path.
      form.append(
        'file',
        new File([new Uint8Array([0, 0, 1, 0, 1, 0])], 'favicon.ico', { type: 'image/x-icon' }),
      );
      const changeBus = createChangeBus({ debounceMs: 1 });
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/images', { method: 'POST', body: form }),
        { cwd: dir, changeBus },
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as { path: string; name: string };
      expect(body.name).toMatch(/\.ico$/);
      expect(body.path).toMatch(/^\/content\/images\/.*\.ico$/);
      expect(existsSync(join(dir, body.path.replace(/^\//, '')))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
