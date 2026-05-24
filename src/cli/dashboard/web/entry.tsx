import { render } from 'preact';
import { DashboardApp } from './DashboardApp.tsx';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Dashboard root element missing. Expected <div id="root"> in the shell HTML.');
}
render(<DashboardApp />, root);
