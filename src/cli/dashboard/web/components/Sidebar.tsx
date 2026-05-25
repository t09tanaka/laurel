import type { JSX } from 'preact';
import type { DashboardShellSection, DashboardState, DashboardTheme } from '../types.ts';

export interface RecentEntry {
  kind: 'posts' | 'pages';
  slug: string;
  title: string;
}

interface SidebarProps {
  section: DashboardShellSection;
  siteTitle: string;
  postsTotal?: number;
  pagesTotal?: number;
  recents?: RecentEntry[];
  syncLabel: string;
  syncState: string;
  buildLabel: string;
  buildState: string;
  previewLabel: string;
  previewState: string;
  theme: DashboardTheme;
  onNavigate: (target: 'posts' | 'pages' | 'settings') => void;
  onOpenEntry?: (kind: 'posts' | 'pages', slug: string) => void;
  onCycleTheme: () => void;
  onForceSync: () => void;
}

const THEME_LABEL: Record<DashboardTheme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const THEME_NEXT: Record<DashboardTheme, DashboardTheme> = {
  system: 'dark',
  dark: 'light',
  light: 'system',
};

export function Sidebar(props: SidebarProps): JSX.Element {
  return (
    <aside class="side" aria-label="Dashboard navigation">
      <div class="sideTop">
        <div class="brand">Nectar</div>
        {/* Tagline removed — the brand mark is enough. The site title is
         * visible on the Settings page where users actually need it. */}
      </div>
      <nav class="nav" aria-label="Primary">
        <NavLink
          href="/posts"
          view="posts"
          section="posts"
          active={props.section === 'posts'}
          label="Posts"
          count={props.postsTotal}
          onNavigate={() => props.onNavigate('posts')}
        />
        <NavLink
          href="/pages"
          view="pages"
          section="pages"
          active={props.section === 'pages'}
          label="Pages"
          count={props.pagesTotal}
          onNavigate={() => props.onNavigate('pages')}
        />
      </nav>
      {props.recents && props.recents.length > 0 ? (
        <div class="recents" aria-label="Recently edited">
          <div class="recentsHead">Recently</div>
          <ul class="recentsList">
            {props.recents.slice(0, 5).map((entry) => (
              <li key={`${entry.kind}/${entry.slug}`}>
                <button
                  type="button"
                  class="recentItem"
                  onClick={() => props.onOpenEntry?.(entry.kind, entry.slug)}
                  title={`${entry.kind === 'posts' ? 'Post' : 'Page'}: ${entry.title}`}
                >
                  <span class="recentItemKind" aria-hidden="true">
                    {entry.kind === 'posts' ? 'P' : 'p'}
                  </span>
                  <span class="recentItemTitle">{entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Sidebar footer — Settings link (less frequent than Posts/Pages so
       * lives below the fold), plus a theme toggle dot and sync pip. */}
      <div class="sideFooter">
        <a
          href="/settings"
          class={`sideFooterSettings${props.section === 'settings' ? ' active' : ''}`}
          aria-current={props.section === 'settings' ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            props.onNavigate('settings');
          }}
        >
          Settings
        </a>
        <button
          type="button"
          class="themeToggle"
          data-theme={props.theme}
          aria-label={`Theme: ${THEME_LABEL[props.theme]}. Switch to ${THEME_LABEL[THEME_NEXT[props.theme]]}.`}
          title={`Theme: ${THEME_LABEL[props.theme]}`}
          onClick={props.onCycleTheme}
        >
          <span class="themeMark" aria-hidden="true" />
        </button>
        <button
          type="button"
          id="syncRail"
          class="syncPip"
          data-state={props.syncState}
          onClick={props.onForceSync}
          title={`Sync · ${props.syncLabel} · click to re-read`}
          aria-label={`Sync state: ${props.syncLabel}. Click to re-read from disk.`}
        >
          <span class="syncPipMark" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

interface NavLinkProps {
  href: string;
  view: string;
  section: string;
  active: boolean;
  label: string;
  count?: number | undefined;
  onNavigate: () => void;
}

function NavLink(props: NavLinkProps): JSX.Element {
  const attrs: Record<string, string> = {
    'data-view': props.view,
    'data-section': props.section,
  };
  if (props.active) attrs['aria-current'] = 'page';
  return (
    <a
      href={props.href}
      class={props.active ? 'active' : ''}
      {...attrs}
      onClick={(event) => {
        event.preventDefault();
        props.onNavigate();
      }}
    >
      <span class="navLabel">{props.label}</span>
      <span class="navCount" aria-hidden="true">
        {typeof props.count === 'number' ? String(props.count) : ''}
      </span>
    </a>
  );
}

export interface StatusRailValues {
  sync: { label: string; state: string };
  build: { label: string; state: string };
  preview: { label: string; state: string };
}

export function computeStatusRail(state: DashboardState | null): StatusRailValues {
  if (!state) {
    return {
      sync: { label: 'reading disk', state: 'reading' },
      build: { label: 'waiting', state: 'neutral' },
      preview: { label: 'saved output', state: 'neutral' },
    };
  }
  const freshness = state.build?.freshness ?? {};
  const pending =
    (freshness.stale ?? 0) + (freshness.missing ?? 0) + (freshness['build-required'] ?? 0);
  const current = freshness.current ?? 0;
  const syncStatus = state.sync?.status ?? 'synced';
  const syncLabel =
    syncStatus === 'changed-on-disk' ? 'changed on disk' : String(syncStatus).replace(/-/g, ' ');
  const syncState =
    syncStatus === 'synced'
      ? 'success'
      : syncStatus === 'changed-on-disk'
        ? 'caution'
        : syncStatus === 'conflict' || syncStatus === 'save-failed'
          ? 'danger'
          : 'reading';
  return {
    sync: { label: syncLabel, state: syncState },
    build: {
      label: pending ? `${pending} pending` : `${state.build?.routeCount ?? 0} current`,
      state: pending ? 'caution' : 'success',
    },
    preview: {
      label: current ? `${current} current` : pending ? 'build required' : '0 current',
      state: current || !pending ? 'success' : 'caution',
    },
  };
}
