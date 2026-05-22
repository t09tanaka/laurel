export type DashboardView = 'posts' | 'pages' | 'authors' | 'tags' | 'settings';
export type DashboardContentView = 'posts' | 'pages';
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
  return view === 'pages' || view === 'authors' || view === 'tags' || view === 'settings'
    ? view
    : 'posts';
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
      return {
        ...state,
        query: action.query,
        postsPage: 1,
        pagesPage: 1,
      };
    case 'status/set':
      return {
        ...state,
        statusFilter: action.statusFilter,
        postsPage: 1,
        pagesPage: 1,
      };
    case 'page/next': {
      const pageKey = action.kind === 'posts' ? 'postsPage' : 'pagesPage';
      return {
        ...state,
        [pageKey]: Math.min(state[pageKey] + 1, Math.max(1, action.pages)),
      };
    }
    case 'page/prev': {
      const pageKey = action.kind === 'posts' ? 'postsPage' : 'pagesPage';
      return {
        ...state,
        [pageKey]: Math.max(1, state[pageKey] - 1),
      };
    }
    case 'density/toggle':
      return {
        ...state,
        density: state.density === 'compact' ? 'comfortable' : 'compact',
      };
    case 'theme/set':
      return {
        ...state,
        theme: action.theme,
      };
    case 'load/start':
      return {
        ...state,
        loadStatus: 'loading',
        lastError: '',
        conflictMessage: '',
      };
    case 'load/success':
      return {
        ...state,
        loadStatus: 'ready',
        lastError: '',
      };
    case 'load/error':
      return {
        ...state,
        loadStatus: 'error',
        lastError: action.message,
      };
    case 'conflict':
      return {
        ...state,
        loadStatus: 'conflict',
        conflictMessage: action.message,
      };
  }
}

export function dashboardStateHelperScript(): string {
  return [
    `const DEFAULT_DASHBOARD_UI_STATE=${JSON.stringify(DEFAULT_DASHBOARD_UI_STATE)};`,
    normalizeDashboardView.toString(),
    createDashboardUiState.toString(),
    reduceDashboardUiState.toString(),
  ].join('\n');
}
