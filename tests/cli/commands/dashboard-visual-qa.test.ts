import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
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
      'settings',
      'editor',
      'conflict',
      'empty',
    ]);
    expect(plan.screenshots).toContain(join(output, 'desktop-posts.png'));
    expect(plan.htmlSnapshots).toContain(join(output, 'mobile-empty.html'));
    expect(plan.commands).toContain(
      'bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project',
    );
  });
});
