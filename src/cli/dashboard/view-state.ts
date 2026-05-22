export type DashboardSurfaceState = 'loading' | 'error' | 'conflict' | 'empty';

export interface DashboardSurfaceStateCopy {
  title: string;
  message: string;
  actionLabel?: string;
}

const COPY: Record<DashboardSurfaceState, DashboardSurfaceStateCopy> = {
  loading: {
    title: 'Reading files',
    message: 'Loading the latest saved Markdown and config state from disk.',
  },
  error: {
    title: 'Dashboard could not load',
    message: 'Keep your files unchanged and refresh after fixing the reported problem.',
    actionLabel: 'Refresh',
  },
  conflict: {
    title: 'External change detected',
    message: 'The file changed on disk. Reloaded latest content so you can review before saving.',
    actionLabel: 'Review latest',
  },
  empty: {
    title: 'No files match this view',
    message: 'Try a different search, status filter, or section.',
  },
};

export function dashboardSurfaceStateCopy(
  state: DashboardSurfaceState,
  override: Partial<DashboardSurfaceStateCopy> = {},
): DashboardSurfaceStateCopy {
  return { ...COPY[state], ...override };
}

export function renderDashboardSurfaceStateHtml(
  state: DashboardSurfaceState,
  override: Partial<DashboardSurfaceStateCopy> = {},
): string {
  const copy = dashboardSurfaceStateCopy(state, override);
  const action = copy.actionLabel
    ? `<button class="btn secondary" data-state-action="${state}">${escapeHtml(copy.actionLabel)}</button>`
    : '';
  return `<div class="statePanel ${state}" role="status" aria-live="polite"><b>${escapeHtml(
    copy.title,
  )}</b><p>${escapeHtml(copy.message)}</p>${action}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] ?? char;
  });
}
