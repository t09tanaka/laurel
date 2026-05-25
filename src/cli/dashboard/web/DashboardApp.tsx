import type { JSX } from 'preact';
import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { ContentTable } from './components/ContentTable.tsx';
import { CreateView } from './components/CreateView.tsx';
import { EditorView } from './components/EditorView.tsx';
import { MigrationView } from './components/MigrationView.tsx';
import { PageHeader } from './components/PageHeader.tsx';
import { SettingsSubnav } from './components/SettingsSubnav.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Sidebar, computeStatusRail } from './components/Sidebar.tsx';
import { SkeletonContentTable } from './components/SkeletonContentTable.tsx';
import { StatePanel } from './components/StatePanel.tsx';
import { TaxonomyView } from './components/TaxonomyView.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { useEventStream } from './hooks/useEventStream.ts';
import { reduceUiState } from './hooks/useUiReducer.ts';
import { fetchContent, fetchDashboardState, materializeTaxonomy } from './lib/api.ts';
import {
  normalizeView,
  pathForCreate,
  pathForEditor,
  pathForView,
  routeFromPath,
  settingsSubviewFor,
  shellSectionFor,
  syncPath,
} from './lib/routes.ts';
import { readThemePreference, writeThemePreference } from './lib/storage.ts';
import { CREATE_HEAD, viewHeadFor } from './lib/view-head.ts';
import type {
  DashboardContentItem,
  DashboardEditorKind,
  DashboardState,
  DashboardUiState,
  DashboardView,
} from './types.ts';

const INITIAL_ROUTE = routeFromPath(location.pathname);

const INITIAL_STATE: DashboardUiState = {
  view: INITIAL_ROUTE.view,
  postsPage: 1,
  pagesPage: 1,
  density: 'comfortable',
  query: '',
  statusFilter: '',
  theme: readThemePreference(),
  loadStatus: 'idle',
  lastError: '',
  conflictMessage: '',
};

export function DashboardApp(): JSX.Element {
  const [ui, dispatch] = useReducer(reduceUiState, INITIAL_STATE);
  const [state, setState] = useState<DashboardState | null>(null);
  const [editor, setEditor] = useState<DashboardContentItem | null>(null);
  const [createMode, setCreateMode] = useState<DashboardEditorKind | null>(
    INITIAL_ROUTE.create?.kind ?? null,
  );
  const [editorDirty, setEditorDirty] = useState(false);
  const [siteSettingsDirty, setSiteSettingsDirty] = useState(false);
  const [themeSettingsDirty, setThemeSettingsDirty] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSettingsDirty = siteSettingsDirty || themeSettingsDirty;

  const confirmDiscard = useCallback(
    (message: string): boolean => {
      if (!editorDirty && !hasSettingsDirty) return true;
      if (!confirm(message)) return false;
      if (editor) {
        setEditor(null);
        setEditorDirty(false);
      }
      setSiteSettingsDirty(false);
      setThemeSettingsDirty(false);
      return true;
    },
    [editorDirty, hasSettingsDirty, editor],
  );

  const load = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (
        !options.force &&
        !confirmDiscard(
          'Refresh files? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
        )
      ) {
        return;
      }
      dispatch({ type: 'load/start' });
      try {
        const next = await fetchDashboardState({
          postsPage: ui.postsPage,
          pagesPage: ui.pagesPage,
          query: ui.query,
          statusFilter: ui.statusFilter,
        });
        setState(next);
        dispatch({ type: 'load/success' });
      } catch (err) {
        dispatch({ type: 'load/error', message: err instanceof Error ? err.message : String(err) });
      }
    },
    [confirmDiscard, ui.postsPage, ui.pagesPage, ui.query, ui.statusFilter],
  );

  // initial + view-driven loads — load is a useCallback whose deps already cover
  // the route inputs (postsPage/pagesPage/statusFilter/query). Including `load`
  // alone is enough to refire when any of those change.
  useEffect(() => {
    void load({ force: true });
  }, [load]);

  // theme application
  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme;
    document.body.classList.toggle('densityCompact', ui.density === 'compact');
  }, [ui.theme, ui.density]);

  // title sync
  useEffect(() => {
    if (!state) return;
    document.title = `${state.site.title} · ${viewHeadFor(ui.view).title} · Nectar Dashboard`;
  }, [state, ui.view]);

  // open route editor if URL points to /:kind/:slug/edit on first mount only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot mount effect
  useEffect(() => {
    if (INITIAL_ROUTE.editor && !editor) {
      void (async () => {
        try {
          if (!INITIAL_ROUTE.editor) return;
          const item = await fetchContent(INITIAL_ROUTE.editor.kind, INITIAL_ROUTE.editor.slug);
          setEditor(item);
          dispatch({ type: 'view/set', view: item.kind });
        } catch (err) {
          dispatch({
            type: 'load/error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }
  }, []);

  // popstate routing
  useEffect(() => {
    function onPop() {
      const route = routeFromPath(location.pathname);
      if (
        !confirmDiscard(
          'Leave this page? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
        )
      ) {
        if (editor) syncPath(pathForEditor(editor.kind, editor.slug), 'push');
        else syncPath(pathForView(ui.view), 'push');
        return;
      }
      setEditor(null);
      setEditorDirty(false);
      setCreateMode(route.create?.kind ?? null);
      dispatch({ type: 'view/set', view: route.view });
      const routeEditor = route.editor;
      if (routeEditor) {
        void (async () => {
          try {
            const item = await fetchContent(routeEditor.kind, routeEditor.slug);
            setEditor(item);
          } catch {}
        })();
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [confirmDiscard, editor, ui.view]);

  // beforeunload warning
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (editorDirty || hasSettingsDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editorDirty, hasSettingsDirty]);

  // event stream
  useEventStream(
    useCallback(() => {
      if (editorDirty || hasSettingsDirty) return;
      void load({ force: true });
    }, [load, editorDirty, hasSettingsDirty]),
  );

  function navigateView(view: DashboardView, mode: 'push' | 'replace' = 'push') {
    if (
      !confirmDiscard(
        'Leave this page? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
      )
    )
      return;
    setEditor(null);
    setEditorDirty(false);
    setCreateMode(null);
    dispatch({ type: 'view/set', view });
    syncPath(pathForView(view), mode);
  }

  function handleSearch(value: string) {
    dispatch({ type: 'search/set', query: value });
    if (ui.view === 'posts' || ui.view === 'pages') {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        void load({ force: true });
      }, 180);
    }
  }

  function handleNew() {
    if (
      !confirmDiscard(
        'Open create page? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
      )
    )
      return;
    const kind: DashboardEditorKind =
      ui.view === 'posts' || ui.view === 'pages' || ui.view === 'authors' || ui.view === 'tags'
        ? ui.view
        : 'posts';
    setEditor(null);
    setEditorDirty(false);
    setCreateMode(kind);
    document.body.classList.add('createOpen');
    syncPath(pathForCreate(kind), 'push');
  }

  function handleCreated(kind: DashboardEditorKind, slug: string) {
    setCreateMode(null);
    document.body.classList.remove('createOpen');
    void load({ force: true }).then(async () => {
      await openEditor(kind, slug);
    });
  }

  function cancelCreate() {
    setCreateMode(null);
    document.body.classList.remove('createOpen');
    syncPath(pathForView(ui.view), 'push');
  }

  async function openEditor(kind: DashboardEditorKind, slug: string) {
    try {
      const item = await fetchContent(kind, slug);
      setEditor(item);
      dispatch({ type: 'view/set', view: kind });
      syncPath(pathForEditor(kind, slug), 'push');
    } catch (err) {
      dispatch({ type: 'load/error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function handleCloseEditor() {
    if (
      !confirmDiscard(
        'Close editor? Unsaved changes stay only in this browser draft until you save.',
      )
    )
      return;
    setEditor(null);
    setEditorDirty(false);
    syncPath(pathForView(ui.view), 'push');
  }

  async function handleEditorSaved() {
    setEditor(null);
    setEditorDirty(false);
    syncPath(pathForView(ui.view), 'replace');
    await load({ force: true });
  }

  function handleEditorConflict(message: string, current: DashboardContentItem) {
    dispatch({ type: 'conflict', message });
    setEditor(current);
  }

  async function handleMaterialize(kind: 'authors' | 'tags', slug: string) {
    const { status, data } = await materializeTaxonomy(kind, slug);
    if (status >= 400) {
      alert((data as { error?: string }).error ?? 'Could not create taxonomy file');
      return;
    }
    await load({ force: true });
  }

  function cycleTheme() {
    const next = ui.theme === 'system' ? 'dark' : ui.theme === 'dark' ? 'light' : 'system';
    dispatch({ type: 'theme/set', theme: next });
    writeThemePreference(next);
  }

  const rail = computeStatusRail(state);
  const section = shellSectionFor(ui.view);
  const inSettings = section === 'settings';
  const headCopy = createMode ? CREATE_HEAD : viewHeadFor(ui.view);
  const showNewButton = !createMode && !editor && ui.view !== 'settings' && ui.view !== 'migration';
  const surfaceState =
    ui.loadStatus === 'error' ? 'error' : ui.loadStatus === 'conflict' ? 'conflict' : 'loading';

  return (
    <div class="shell">
      <Sidebar
        section={section}
        siteTitle={state?.site.title ?? ''}
        postsTotal={state?.posts.total}
        pagesTotal={state?.pages.total}
        syncLabel={rail.sync.label}
        syncState={rail.sync.state}
        buildLabel={rail.build.label}
        buildState={rail.build.state}
        previewLabel={rail.preview.label}
        previewState={rail.preview.state}
        theme={ui.theme}
        onNavigate={(target) => navigateView(target)}
        onCycleTheme={cycleTheme}
        onForceSync={() => {
          void load({ force: true });
        }}
      />
      <main class="main" id="main" tabIndex={-1}>
        {editor ? null : (
          <PageHeader
            copy={headCopy}
            toolbar={
              <Toolbar
                query={ui.query}
                showNew={showNewButton}
                onSearch={handleSearch}
                onNew={handleNew}
              />
            }
          />
        )}
        {inSettings && !editor && !createMode ? (
          <SettingsSubnav
            active={settingsSubviewFor(ui.view)}
            onNavigate={(target) => navigateView(target === 'site' ? 'settings' : target)}
          />
        ) : null}
        {!editor && createMode ? (
          <section class="panel" id="contentPanel" aria-live="polite">
            <CreateView
              defaultKind={createMode}
              onCreated={handleCreated}
              onCancel={cancelCreate}
            />
          </section>
        ) : null}
        {!editor && !createMode ? (
          <section
            class="panel"
            id="contentPanel"
            aria-live="polite"
            aria-busy={ui.loadStatus === 'loading'}
          >
            {!state ? (
              ui.loadStatus === 'loading' && (ui.view === 'posts' || ui.view === 'pages') ? (
                <SkeletonContentTable />
              ) : (
                <StatePanel
                  kind={surfaceState}
                  {...(ui.loadStatus === 'error' ? { message: ui.lastError } : {})}
                  onAction={() => {
                    void load({ force: true });
                  }}
                />
              )
            ) : ui.view === 'posts' || ui.view === 'pages' ? (
              <ContentTable
                kind={ui.view}
                list={ui.view === 'posts' ? state.posts : state.pages}
                resultCount={state.settings.operations.search.resultCount}
                statusFilter={ui.statusFilter}
                onStatusFilterChange={(value) =>
                  dispatch({ type: 'status/set', statusFilter: value })
                }
                onPrev={() => dispatch({ type: 'page/prev', kind: ui.view as 'posts' | 'pages' })}
                onNext={() =>
                  dispatch({
                    type: 'page/next',
                    kind: ui.view as 'posts' | 'pages',
                    pages: (ui.view === 'posts' ? state.posts : state.pages).pages,
                  })
                }
                onOpen={(slug) => {
                  void openEditor(ui.view as 'posts' | 'pages', slug);
                }}
              />
            ) : ui.view === 'authors' || ui.view === 'tags' ? (
              <TaxonomyView
                kind={ui.view}
                list={ui.view === 'authors' ? state.authors : state.tags}
                query={ui.query}
                onEdit={(slug) => {
                  void openEditor(ui.view as 'authors' | 'tags', slug);
                }}
                onMaterialize={(slug) => {
                  void handleMaterialize(ui.view as 'authors' | 'tags', slug);
                }}
              />
            ) : ui.view === 'migration' ? (
              <MigrationView onSettingsSaved={() => load({ force: true })} />
            ) : (
              <SettingsView
                state={state}
                onSettingsSaved={() => load({ force: true })}
                onConflict={(message) => dispatch({ type: 'conflict', message })}
                onSiteDirtyChange={setSiteSettingsDirty}
                onThemeDirtyChange={setThemeSettingsDirty}
                onOpenMigration={() => navigateView('migration')}
              />
            )}
          </section>
        ) : null}
        {editor ? (
          <EditorView
            current={editor}
            state={state}
            onCloseEditor={handleCloseEditor}
            onSaved={handleEditorSaved}
            onConflict={handleEditorConflict}
            onDirtyChange={setEditorDirty}
          />
        ) : null}
      </main>
    </div>
  );
}

export { normalizeView };
