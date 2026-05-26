import {
  type DashboardEditorKind,
  type DashboardView,
  dashboardSettingsSubviewFor,
  dashboardShellSectionFor,
  normalizeDashboardView,
} from '../../ui-state.ts';
import type { DashboardRoute } from '../types.ts';

const PAGE_PATHS: Record<DashboardView, string> = {
  posts: '/posts',
  pages: '/pages',
  components: '/components',
  authors: '/authors',
  tags: '/tags',
  settings: '/settings',
  design: '/settings/design',
  integration: '/settings/integration',
  migration: '/settings/migration',
};

const EDITOR_KINDS: ReadonlyArray<DashboardEditorKind> = [
  'posts',
  'pages',
  'components',
  'authors',
  'tags',
];

const SETTINGS_SUB_PATHS = ['design', 'integration', 'migration'] as const;
type SettingsSubPath = (typeof SETTINGS_SUB_PATHS)[number];

function isSettingsSubPath(value: string): value is SettingsSubPath {
  return (SETTINGS_SUB_PATHS as ReadonlyArray<string>).includes(value);
}

export const normalizeView = normalizeDashboardView;
export const shellSectionFor = dashboardShellSectionFor;
export const settingsSubviewFor = dashboardSettingsSubviewFor;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isEditorKind(value: string): value is DashboardEditorKind {
  return (EDITOR_KINDS as ReadonlyArray<string>).includes(value);
}

export function routeFromPath(pathname: string): DashboardRoute {
  const parts = pathname.split('/').filter(Boolean).map(decode);
  // /settings/{design,integration,migration} drives both the shell section
  // (settings) and the subnav selection. Keep the bare /migration alias as
  // a back-compat for direct links from before the IA split.
  const settingsSub =
    parts.length === 2 && parts[0] === 'settings' && parts[1] && isSettingsSubPath(parts[1])
      ? (parts[1] as SettingsSubPath)
      : null;
  const bareMigration = parts.length === 1 && parts[0] === 'migration';
  const view: DashboardView = settingsSub
    ? settingsSub
    : bareMigration
      ? 'migration'
      : normalizeView(parts[0] || 'posts');
  const editorKind = parts[0];
  const create =
    parts.length === 2 && parts[1] === 'new' && editorKind && isEditorKind(editorKind)
      ? { kind: editorKind }
      : null;
  const editor =
    parts.length === 3 && parts[2] === 'edit' && editorKind && isEditorKind(editorKind) && parts[1]
      ? { kind: editorKind, slug: parts[1] }
      : null;
  return { view, create, editor };
}

export function pathForView(view: DashboardView): string {
  return PAGE_PATHS[normalizeView(view)] ?? PAGE_PATHS.posts;
}

export function pathForCreate(kind: DashboardEditorKind): string {
  return `${pathForView(kind)}/new`;
}

export function pathForEditor(kind: DashboardEditorKind, slug: string): string {
  return `${pathForView(kind)}/${encodeURIComponent(slug)}/edit`;
}

type HistoryMode = 'push' | 'replace';

export function syncPath(target: string, mode: HistoryMode = 'push'): void {
  if (location.pathname === target) return;
  history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', target);
}
