import { useReducer } from 'preact/hooks';
import {
  DEFAULT_DASHBOARD_UI_STATE,
  type DashboardUiState,
  reduceDashboardUiState,
} from '../../ui-state.ts';

export {
  DEFAULT_DASHBOARD_UI_STATE,
  reduceDashboardUiState as reduceUiState,
} from '../../ui-state.ts';

export function useUiReducer(initial: Partial<DashboardUiState> = {}) {
  return useReducer(reduceDashboardUiState, { ...DEFAULT_DASHBOARD_UI_STATE, ...initial });
}
