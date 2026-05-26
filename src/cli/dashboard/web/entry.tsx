import { render } from 'preact';
import { DashboardApp } from './DashboardApp.tsx';
import { setDashboardToken } from './lib/api.ts';

interface BootstrapResponse {
  token: string;
  mode: 'dev' | 'prod';
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Dashboard root element missing. Expected <div id="root"> in the shell HTML.');
  }
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
