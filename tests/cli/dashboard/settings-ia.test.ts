import { describe, expect, test } from 'bun:test';
import {
  dashboardSettingsSubviewFor,
  dashboardShellSectionFor,
  normalizeDashboardView,
} from '../../../src/cli/dashboard/ui-state.ts';

describe('dashboard settings IA — view routing', () => {
  test('settings sub-views are recognised top-level views', () => {
    expect(normalizeDashboardView('design')).toBe('design');
    expect(normalizeDashboardView('integration')).toBe('integration');
    expect(normalizeDashboardView('migration')).toBe('migration');
  });

  test('all four settings sub-views sit under the settings shell section', () => {
    expect(dashboardShellSectionFor('settings')).toBe('settings');
    expect(dashboardShellSectionFor('design')).toBe('settings');
    expect(dashboardShellSectionFor('integration')).toBe('settings');
    expect(dashboardShellSectionFor('migration')).toBe('settings');
  });

  test('taxonomy views are their own workspace sections, not settings', () => {
    expect(dashboardShellSectionFor('authors')).toBe('authors');
    expect(dashboardShellSectionFor('tags')).toBe('tags');
  });

  test('settings subnav reports the matching subview for each view', () => {
    expect(dashboardSettingsSubviewFor('settings')).toBe('site');
    expect(dashboardSettingsSubviewFor('design')).toBe('design');
    expect(dashboardSettingsSubviewFor('integration')).toBe('integration');
    expect(dashboardSettingsSubviewFor('migration')).toBe('migration');
  });

  test('unknown view strings still fall back to posts', () => {
    expect(normalizeDashboardView('does-not-exist')).toBe('posts');
    expect(normalizeDashboardView(undefined)).toBe('posts');
  });
});
