import { describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createDashboardVisualPlan,
  dashboardVisualScenarios,
  dashboardVisualViewports,
} from '../../../scripts/dashboard-visual-qa.ts';

describe('dashboard visual QA script helpers', () => {
  test('plans stable desktop, laptop, and mobile captures for the dashboard fixture', () => {
    const project = join(import.meta.dir, '..', '..', 'fixtures', 'dashboard-visual-project');
    const output = join(import.meta.dir, '..', '..', '..', '.nectar', 'dashboard-visual-qa');
    const plan = createDashboardVisualPlan({ project, output });

    expect(dashboardVisualViewports.map((viewport) => viewport.name)).toEqual([
      'desktop',
      'laptop',
      'mobile',
    ]);
    expect(dashboardVisualScenarios.map((scenario) => scenario.name)).toEqual([
      'posts',
      'pages',
      'authors',
      'tags',
      'settings',
      'migration',
      'create',
      'editor',
      'conflict',
      'empty',
    ]);
    expect(dashboardVisualScenarios.map((scenario) => scenario.route)).toEqual([
      '/posts',
      '/pages',
      '/authors',
      '/tags',
      '/settings',
      '/settings/migration',
      '/posts/new',
      '/posts/future-post/edit',
      '/posts/future-post/edit',
      '/posts',
    ]);
    expect(plan.screenshots).toContain(join(output, 'desktop-posts.png'));
    expect(plan.screenshots).toContain(join(output, 'desktop-authors.png'));
    expect(plan.screenshots).toContain(join(output, 'desktop-tags.png'));
    expect(plan.screenshots).toContain(join(output, 'desktop-create.png'));
    expect(plan.htmlSnapshots).toContain(join(output, 'mobile-empty.html'));
    expect(plan.commands).toContain(
      'bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project',
    );
  });

  test('fixture resolves its active theme for Markdown previews', () => {
    const project = join(import.meta.dir, '..', '..', 'fixtures', 'dashboard-visual-project');
    const themePath = join(project, 'themes', 'source');

    expect(existsSync(themePath)).toBe(true);
    expect(lstatSync(themePath).isSymbolicLink()).toBe(true);
    expect(resolve(join(project, 'themes'), readlinkSync(themePath))).toBe(
      resolve(import.meta.dir, '..', '..', '..', 'example', 'themes', 'source'),
    );
  });
});
