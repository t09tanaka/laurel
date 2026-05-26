import { render } from 'preact';
import { DashboardApp } from './DashboardApp.tsx';
import { setDashboardToken } from './lib/api.ts';

interface BootstrapResponse {
  token: string;
  mode: 'dev' | 'prod';
}

// The bookmark NodeView in the editor borrows the active theme's
// screen.css rescoped to .proseBookmarkScope. The dev shell HTML cannot
// reference /api/themes/active/css directly because Bun's HTML bundler
// would try to resolve it as a local asset; injecting at runtime keeps
// dev and prod symmetric.
const THEME_CSS_HREF = '/api/themes/active/css';

function ensureActiveThemeCssLink(): void {
  if (document.querySelector(`link[href="${THEME_CSS_HREF}"]`) !== null) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = THEME_CSS_HREF;
  document.head.appendChild(link);
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Dashboard root element missing. Expected <div id="root"> in the shell HTML.');
  }
  ensureActiveThemeCssLink();
  const response = await fetch('/api/dashboard/bootstrap', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Dashboard bootstrap failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as BootstrapResponse;
  setDashboardToken(body.token);
  render(<DashboardApp />, root);
}

bootstrap().catch((err: unknown) => {
  const root = document.getElementById('root');
  if (root) {
    root.textContent = err instanceof Error ? err.message : 'Dashboard failed to start.';
  }
});
