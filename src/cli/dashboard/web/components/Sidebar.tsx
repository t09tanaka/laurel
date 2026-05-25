import type { JSX } from 'preact';
import type { DashboardShellSection, DashboardState } from '../types.ts';

export interface RecentEntry {
  kind: 'posts' | 'pages';
  slug: string;
  title: string;
}

interface SidebarProps {
  section: DashboardShellSection;
  siteTitle: string;
  siteUrl?: string;
  postsTotal?: number;
  pagesTotal?: number;
  recents?: RecentEntry[];
  syncLabel: string;
  syncState: string;
  buildLabel: string;
  buildState: string;
  previewLabel: string;
  previewState: string;
  onNavigate: (target: 'posts' | 'pages' | 'settings') => void;
  onOpenEntry?: (kind: 'posts' | 'pages', slug: string) => void;
  onForceSync: () => void;
}

function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function Sidebar(props: SidebarProps): JSX.Element {
  return (
    <aside class="side" aria-label="Dashboard navigation">
      <div class="sideTop">
        <div class="brand">
          {/* A faint hexagon — honey-cell glyph, ties the "Nectar" name to
           * a wordless mark without leaning on emoji or external assets. */}
          <svg
            class="brandMark"
            viewBox="0 0 20 20"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <polygon
              points="10,1.5 17.4,5.75 17.4,14.25 10,18.5 2.6,14.25 2.6,5.75"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
            <circle cx="10" cy="10" r="1.6" fill="currentColor" opacity="0.5" />
          </svg>
          <span class="brandWord">Nectar</span>
        </div>
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
                  <span class="recentItemTitle">{entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Sidebar footer — Settings link + a tiny sync pip. Theme toggle
       * removed (dark theme dropped per user direction). */}
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
          <span>Settings</span>
        </a>
        {(() => {
          const host = hostnameOf(props.siteUrl);
          if (!host || !props.siteUrl) return null;
          return (
            <a
              class="sideFooterSite"
              href={props.siteUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Open published site at ${host}`}
              title={`View site · ${host}`}
            >
              <svg
                class="sideFooterIcon"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path
                  d="M9.5 3.5h3v3M12.3 3.7L7 9M6 4.5H4.2c-.55 0-1 .45-1 1v6.3c0 .55.45 1 1 1h6.3c.55 0 1-.45 1-1V10"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </a>
          );
        })()}
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
        {/* Show count only when there is content; an "0" or empty digit
         * adds visual noise without information. */}
        {typeof props.count === 'number' && props.count > 0 ? String(props.count) : ''}
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
