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
  authors: '/authors',
  tags: '/tags',
  settings: '/settings',
  migration: '/settings/migration',
};

const EDITOR_KINDS: ReadonlyArray<DashboardEditorKind> = ['posts', 'pages', 'authors', 'tags'];

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
  const settingsNested = parts[0] === 'settings' && parts[1] === 'migration';
  // /migration is the bare alias for /settings/migration; both should land
  // on the migration view so direct links never hit the 404 fallback.
  const bareMigration = parts.length === 1 && parts[0] === 'migration';
  const view =
    settingsNested || bareMigration ? 'migration' : normalizeView(parts[0] || 'posts');
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
