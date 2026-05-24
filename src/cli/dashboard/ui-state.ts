// Pure reducer + types shared between the Preact bundle (src/cli/dashboard/web/)
// and the test suite. No Preact imports — kept free of DOM types so it can be
// compiled under the CLI tsconfig.

export type DashboardView = 'posts' | 'pages' | 'authors' | 'tags' | 'settings' | 'migration';
export type DashboardContentView = 'posts' | 'pages';
export type DashboardEditorKind = 'posts' | 'pages' | 'authors' | 'tags';
export type DashboardShellSection = 'posts' | 'pages' | 'settings';
export type DashboardSettingsSubview = 'site' | 'authors' | 'tags' | 'migration';
export type DashboardDensity = 'comfortable' | 'compact';
export type DashboardTheme = 'system' | 'light' | 'dark';
export type DashboardLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'conflict';

export interface DashboardUiState {
  view: DashboardView;
  postsPage: number;
  pagesPage: number;
  density: DashboardDensity;
  query: string;
  statusFilter: string;
  theme: DashboardTheme;
  loadStatus: DashboardLoadStatus;
  lastError: string;
  conflictMessage: string;
}

export type DashboardUiAction =
  | { type: 'view/set'; view: string }
  | { type: 'search/set'; query: string }
  | { type: 'status/set'; statusFilter: string }
  | { type: 'page/next'; kind: DashboardContentView; pages: number }
  | { type: 'page/prev'; kind: DashboardContentView }
  | { type: 'density/toggle' }
  | { type: 'theme/set'; theme: DashboardTheme }
  | { type: 'load/start' }
  | { type: 'load/success' }
  | { type: 'load/error'; message: string }
  | { type: 'conflict'; message: string };

export const DEFAULT_DASHBOARD_UI_STATE: DashboardUiState = {
  view: 'posts',
  postsPage: 1,
  pagesPage: 1,
  density: 'comfortable',
  query: '',
  statusFilter: '',
  theme: 'system',
  loadStatus: 'idle',
  lastError: '',
  conflictMessage: '',
};

export function normalizeDashboardView(view: string | undefined): DashboardView {
  return view === 'pages' ||
    view === 'authors' ||
    view === 'tags' ||
    view === 'settings' ||
    view === 'migration'
    ? view
    : 'posts';
}

export function dashboardShellSectionFor(view: DashboardView): DashboardShellSection {
  if (view === 'pages') return 'pages';
  if (view === 'authors' || view === 'tags' || view === 'settings' || view === 'migration') {
    return 'settings';
  }
  return 'posts';
}

export function dashboardSettingsSubviewFor(view: DashboardView): DashboardSettingsSubview {
  if (view === 'authors') return 'authors';
  if (view === 'tags') return 'tags';
  if (view === 'migration') return 'migration';
  return 'site';
}

export function createDashboardUiState(
  overrides: Partial<DashboardUiState> = {},
): DashboardUiState {
  return {
    ...DEFAULT_DASHBOARD_UI_STATE,
    ...overrides,
    view: normalizeDashboardView(overrides.view),
    postsPage: Math.max(1, Math.trunc(overrides.postsPage ?? 1)),
    pagesPage: Math.max(1, Math.trunc(overrides.pagesPage ?? 1)),
  };
}

export function reduceDashboardUiState(
  state: DashboardUiState,
  action: DashboardUiAction,
): DashboardUiState {
  switch (action.type) {
    case 'view/set':
      return {
        ...state,
        view: normalizeDashboardView(action.view),
        query: '',
        statusFilter: '',
      };
    case 'search/set':
      return { ...state, query: action.query, postsPage: 1, pagesPage: 1 };
    case 'status/set':
      return { ...state, statusFilter: action.statusFilter, postsPage: 1, pagesPage: 1 };
    case 'page/next': {
      const key = action.kind === 'posts' ? 'postsPage' : 'pagesPage';
      return { ...state, [key]: Math.min(state[key] + 1, Math.max(1, action.pages)) };
    }
    case 'page/prev': {
      const key = action.kind === 'posts' ? 'postsPage' : 'pagesPage';
      return { ...state, [key]: Math.max(1, state[key] - 1) };
    }
    case 'density/toggle':
      return {
        ...state,
        density: state.density === 'compact' ? 'comfortable' : 'compact',
      };
    case 'theme/set':
      return { ...state, theme: action.theme };
    case 'load/start':
      return { ...state, loadStatus: 'loading', lastError: '', conflictMessage: '' };
    case 'load/success':
      return { ...state, loadStatus: 'ready', lastError: '' };
    case 'load/error':
      return { ...state, loadStatus: 'error', lastError: action.message };
    case 'conflict':
      return { ...state, loadStatus: 'conflict', conflictMessage: action.message };
  }
}
