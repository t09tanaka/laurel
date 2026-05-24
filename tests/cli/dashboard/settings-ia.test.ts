import { describe, expect, test } from 'bun:test';
import {
  dashboardSettingsSubviewFor,
  dashboardShellSectionFor,
  normalizeDashboardView,
} from '../../../src/cli/dashboard/ui-state.ts';

describe('dashboard settings IA — view routing', () => {
  test('migration is a recognised top-level view', () => {
    expect(normalizeDashboardView('migration')).toBe('migration');
  });

  test('migration sits under the settings shell section', () => {
    expect(dashboardShellSectionFor('migration')).toBe('settings');
  });

  test('settings subnav reports "migration" for the migration view', () => {
    expect(dashboardSettingsSubviewFor('migration')).toBe('migration');
    expect(dashboardSettingsSubviewFor('settings')).toBe('site');
    expect(dashboardSettingsSubviewFor('authors')).toBe('authors');
    expect(dashboardSettingsSubviewFor('tags')).toBe('tags');
  });

  test('unknown view strings still fall back to posts', () => {
    expect(normalizeDashboardView('does-not-exist')).toBe('posts');
    expect(normalizeDashboardView(undefined)).toBe('posts');
  });
});
