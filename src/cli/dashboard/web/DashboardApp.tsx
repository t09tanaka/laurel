import type { JSX } from 'preact';
import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { BuildPanel, type BuildPhase } from './components/BuildPanel.tsx';
import { type CommandItem, CommandPalette } from './components/CommandPalette.tsx';
import { ComponentEditorView } from './components/ComponentEditorView.tsx';
import { ComponentExportModal } from './components/ComponentExportModal.tsx';
import { ComponentImportModal } from './components/ComponentImportModal.tsx';
import { ComponentsView } from './components/ComponentsView.tsx';
import { useConfirmHost } from './components/ConfirmDialog.tsx';
import { ContentTable } from './components/ContentTable.tsx';
import { CreateView } from './components/CreateView.tsx';
import { EditorView } from './components/EditorView.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { MigrationView } from './components/MigrationView.tsx';
import { Modal } from './components/Modal.tsx';
import { PageHeader } from './components/PageHeader.tsx';
import { SettingsSubnav } from './components/SettingsSubnav.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Sidebar, computeStatusRail } from './components/Sidebar.tsx';
import { SkeletonContentTable } from './components/SkeletonContentTable.tsx';
import { StatePanel } from './components/StatePanel.tsx';
import { TaxonomyEditorView } from './components/TaxonomyEditorView.tsx';
import { TaxonomyView } from './components/TaxonomyView.tsx';
import { ThemeMissingBanner } from './components/ThemeMissingBanner.tsx';
import { useToastHost } from './components/Toast.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { useEventStream } from './hooks/useEventStream.ts';
import { reduceUiState } from './hooks/useUiReducer.ts';
import {
  type BuildSummarySnapshot,
  fetchContent,
  fetchDashboardState,
  materializeTaxonomy,
  restoreTrash,
  streamBuild,
  trashContent,
} from './lib/api.ts';
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
import { clearDraftsForPath } from './lib/storage.ts';
import { CREATE_HEAD, createHeadFor, viewHeadFor } from './lib/view-head.ts';
import type {
  DashboardContentItem,
  DashboardEditorKind,
  DashboardState,
  DashboardUiState,
  DashboardView,
} from './types.ts';

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatBuildDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

const INITIAL_ROUTE = routeFromPath(location.pathname);

const INITIAL_STATE: DashboardUiState = {
  view: INITIAL_ROUTE.view,
  postsPage: 1,
  pagesPage: 1,
  density: 'comfortable',
  query: '',
  statusFilter: '',
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
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [themeSettingsDirty, setThemeSettingsDirty] = useState(false);
  const [codeInjectionSettingsDirty, setCodeInjectionSettingsDirty] = useState(false);
  const [buildPhase, setBuildPhase] = useState<BuildPhase>('idle');
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [buildProgress, setBuildProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [buildSummary, setBuildSummary] = useState<BuildSummarySnapshot | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildPanelOpen, setBuildPanelOpen] = useState(false);
  const [canDownload, setCanDownload] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastHost = useToastHost();
  const confirmHost = useConfirmHost();

  const hasSettingsDirty = siteSettingsDirty || themeSettingsDirty || codeInjectionSettingsDirty;

  const confirmDiscard = useCallback(
    async (body: string): Promise<boolean> => {
      if (!editorDirty && !hasSettingsDirty) return true;
      const ok = await confirmHost.api.ask({
        title: 'Discard unsaved changes?',
        body,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        intent: 'danger',
      });
      if (!ok) return false;
      if (editor) {
        setEditor(null);
        setEditorDirty(false);
      }
      setSiteSettingsDirty(false);
      setThemeSettingsDirty(false);
      setCodeInjectionSettingsDirty(false);
      return true;
    },
    [editorDirty, hasSettingsDirty, editor, confirmHost.api],
  );

  const load = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (
        !options.force &&
        !(await confirmDiscard(
          'Refresh files? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
        ))
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
    document.body.classList.toggle('densityCompact', ui.density === 'compact');
  }, [ui.density]);

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
        const initialEditor = INITIAL_ROUTE.editor;
        if (!initialEditor) return;
        try {
          const item = await fetchContent(initialEditor.kind, initialEditor.slug);
          setEditor(item);
          dispatch({ type: 'view/set', view: item.kind });
        } catch {
          toastHost.api.push({
            intent: 'error',
            title: 'Not found',
            message: `No ${initialEditor.kind === 'pages' ? 'page' : initialEditor.kind === 'authors' ? 'author' : initialEditor.kind === 'tags' ? 'tag' : 'post'} "${initialEditor.slug}".`,
          });
        }
      })();
    }
  }, []);

  // popstate routing
  useEffect(() => {
    async function onPop() {
      const route = routeFromPath(location.pathname);
      if (
        !(await confirmDiscard(
          'Leave this page? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
        ))
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
          } catch {
            // Surface a toast so direct hits on a removed / renamed
            // slug aren't silent (#2091). URL is left intact so the
            // user can correct it; the list fallback covers display.
            toastHost.api.push({
              intent: 'error',
              title: 'Not found',
              message: `No ${routeEditor.kind === 'pages' ? 'page' : routeEditor.kind === 'authors' ? 'author' : routeEditor.kind === 'tags' ? 'tag' : 'post'} "${routeEditor.slug}".`,
            });
          }
        })();
      }
    }
    const handler = () => {
      void onPop();
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [confirmDiscard, editor, ui.view, toastHost.api]);

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

  // Global ⌘K / Ctrl+K — opens the command palette from anywhere.
  // Ignored when typing in an editor or input so users can keep typing K.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isCmdK) return;
      event.preventDefault();
      setCmdkOpen((open) => !open);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Scroll to top when the view changes — without this, a long scroll on
  // posts is preserved when jumping to Pages/Settings, which feels broken.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route surface changes intentionally trigger scroll reset
  useEffect(() => {
    window.scrollTo(0, 0);
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [ui.view, editor?.slug, createMode]);

  async function navigateView(view: DashboardView, mode: 'push' | 'replace' = 'push') {
    if (
      !(await confirmDiscard(
        'Leave this page? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
      ))
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

  async function navigateCreate(kind: DashboardEditorKind) {
    if (
      !(await confirmDiscard(
        'Open create page? Unsaved settings will be discarded; unsaved editor changes stay only in this browser draft until you save.',
      ))
    )
      return;
    setEditor(null);
    setEditorDirty(false);
    setCreateMode(kind);
    document.body.classList.add('createOpen');
    syncPath(pathForCreate(kind), 'push');
  }

  function handleNew() {
    const kind: DashboardEditorKind =
      ui.view === 'posts' || ui.view === 'pages' || ui.view === 'authors' || ui.view === 'tags'
        ? ui.view
        : 'posts';
    navigateCreate(kind);
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

  async function handleCloseEditor() {
    if (
      !(await confirmDiscard(
        'Close editor? Unsaved changes stay only in this browser draft until you save.',
      ))
    )
      return;
    setEditor(null);
    setEditorDirty(false);
    syncPath(pathForView(ui.view), 'push');
  }

  async function handleEditorSaved() {
    setEditorDirty(false);
    // Reload the workspace state so the sidebar / list show the
    // saved file, but keep the editor open — bouncing back to the
    // list on every Save is a hostile interaction for writers.
    await load({ force: true });
    if (!editor) return;
    try {
      const next = await fetchContent(editor.kind, editor.slug);
      setEditor(next);
    } catch {
      setEditor(null);
      syncPath(pathForView(ui.view), 'replace');
    }
  }

  /** Handle slug rename: re-fetch the editor against the new slug, update
   * the URL, and reload the workspace state so the sidebar / list reflect
   * the new filename. */
  async function handleEditorRenamed(
    kind: DashboardContentItem['kind'],
    newSlug: string,
  ): Promise<void> {
    setEditorDirty(false);
    await load({ force: true });
    try {
      const next = await fetchContent(kind, newSlug);
      setEditor(next);
      syncPath(pathForEditor(kind, newSlug), 'replace');
    } catch {
      setEditor(null);
      syncPath(pathForView(ui.view), 'replace');
    }
  }

  function handleEditorConflict(message: string, current: DashboardContentItem) {
    dispatch({ type: 'conflict', message });
    setEditor(current);
  }

  // Soft-delete the open post / page: confirm, move to trash, then drop the
  // editor and bounce back to the list. Pages/posts only — the backend trash
  // route rejects authors/tags, and the editor only renders Delete for content.
  async function handleEditorDelete(): Promise<void> {
    if (!editor || (editor.kind !== 'posts' && editor.kind !== 'pages')) return;
    const label = editor.kind === 'pages' ? 'page' : 'post';
    const confirmed = await confirmHost.api.ask({
      title: `Delete this ${label}?`,
      body: `"${editor.slug}" moves to trash (.nectar/trash). You can restore it from there until it's purged. Any unsaved edits are discarded.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep editing',
      intent: 'danger',
    });
    if (!confirmed) return;
    const { status, data } = await trashContent({
      kind: editor.kind,
      slug: editor.slug,
      fingerprint: editor.fingerprint,
    });
    if (status === 409 && !data.ok && data.reason === 'conflict' && 'current' in data) {
      toastHost.api.push({
        intent: 'warn',
        title: 'Changed on disk',
        message: 'This file changed on disk. Reloaded the latest version — review before deleting.',
      });
      setEditor(data.current);
      return;
    }
    if (status >= 400 || !data.ok) {
      const message =
        ('error' in data ? data.error : undefined) ?? `Could not delete ${label} (${status}).`;
      toastHost.api.push({ intent: 'error', title: 'Delete failed', message });
      return;
    }
    clearDraftsForPath(editor.path);
    const trashedSlug = editor.slug;
    const trashId = data.ok ? data.entry.id : undefined;
    setEditor(null);
    setEditorDirty(false);
    toastHost.api.push({
      intent: 'success',
      title: 'Moved to trash',
      message: `"${trashedSlug}" was moved to trash.`,
      // Generous window so the undo is a genuine safety net, not a race.
      duration: 7000,
      action: trashId
        ? {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                const { status: restoreStatus, data: restored } = await restoreTrash(trashId);
                if (restoreStatus >= 400 || !restored.ok) {
                  const message =
                    ('error' in restored ? restored.error : undefined) ??
                    `Could not restore "${trashedSlug}".`;
                  toastHost.api.push({ intent: 'error', title: 'Restore failed', message });
                  return;
                }
                toastHost.api.push({
                  intent: 'success',
                  title: 'Restored',
                  message: `"${trashedSlug}" is back in ${label}s.`,
                });
                await load({ force: true });
              })();
            },
          }
        : undefined,
    });
    await load({ force: true });
    syncPath(pathForView(ui.view), 'push');
  }

  const handleDownloadZip = useCallback(() => {
    // Programmatic anchor click so the download fires without navigating
    // away from the dashboard — important for the auto-download path
    // because the user is still viewing the build log.
    const anchor = document.createElement('a');
    anchor.href = '/api/build/export.zip';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const handleBuildClick = useCallback(async () => {
    if (buildPhase === 'running') {
      setBuildPanelOpen(true);
      return;
    }
    setBuildPhase('running');
    setBuildLog([]);
    setBuildProgress(null);
    setBuildSummary(null);
    setBuildError(null);
    setBuildPanelOpen(true);
    await streamBuild((event) => {
      if (event.type === 'start') {
        setBuildLog((log) => [...log, `[${formatClock(event.startedAt)}] Build started`]);
      } else if (event.type === 'progress') {
        const e = event.event;
        if (e.type === 'phase-start') {
          setBuildLog((log) => [...log, `→ ${e.label}`]);
        } else if (e.type === 'phase-status') {
          setBuildLog((log) => [...log, `  ${e.label}`]);
        } else if (e.type === 'routes-planned') {
          setBuildProgress({ completed: 0, total: e.totalRoutes });
          setBuildLog((log) => [...log, `  ${e.totalRoutes} routes planned`]);
        } else if (e.type === 'route-rendered') {
          setBuildProgress({ completed: e.completedRoutes, total: e.totalRoutes });
        } else if (e.type === 'asset-step') {
          setBuildLog((log) => [...log, `  ${e.step}/${e.totalSteps} ${e.label}`]);
        }
      } else if (event.type === 'done') {
        setBuildPhase('done');
        setBuildSummary(event.summary);
        setCanDownload(true);
        setBuildLog((log) => [
          ...log,
          `Built ${event.summary.routeCount} routes, ${event.summary.assetCount} assets`,
        ]);
        toastHost.api.push({
          intent: 'success',
          title: 'Build complete · downloading zip',
          message: `${event.summary.routeCount} routes · ${formatBuildDuration(event.summary.durationMs)}`,
        });
        // Auto-download the freshly built site after a short delay so the
        // success toast and final log line land before the browser's
        // download UI takes focus. The sidebar "Zip" pill and the panel's
        // Download zip button remain available for re-download.
        setTimeout(handleDownloadZip, 300);
      } else if (event.type === 'error') {
        setBuildPhase('error');
        setBuildError(event.message);
        toastHost.api.push({
          intent: 'error',
          title: 'Build failed',
          message: event.message,
        });
      }
    });
  }, [buildPhase, toastHost.api, handleDownloadZip]);

  const handleBuildPanelClose = useCallback(() => {
    setBuildPanelOpen(false);
  }, []);

  async function handleMaterialize(kind: 'authors' | 'tags', slug: string) {
    const { status, data } = await materializeTaxonomy(kind, slug);
    if (status >= 400) {
      alert((data as { error?: string }).error ?? 'Could not create taxonomy file');
      return;
    }
    await load({ force: true });
  }

  const rail = computeStatusRail(state);
  const section = shellSectionFor(ui.view);
  const inSettings = section === 'settings';
  const headCopy = createMode
    ? createMode === 'posts' ||
      createMode === 'pages' ||
      createMode === 'authors' ||
      createMode === 'tags'
      ? createHeadFor(createMode)
      : CREATE_HEAD
    : viewHeadFor(ui.view);
  // Settings subviews (site / design / integration / migration) all
  // sit under the settings shell and don't accept "New" — the toolbar
  // button would dump the user into a post-create flow that has nothing
  // to do with the settings panel they're looking at.
  const showNewButton = !createMode && !editor && !inSettings;
  // Zip import lands posts/pages (entry bundles) or components (bulk bundle),
  // so offer it alongside New in those list views.
  const showImportButton =
    showNewButton && (ui.view === 'posts' || ui.view === 'pages' || ui.view === 'components');
  // Bulk export is components-only and pointless with nothing to export, so it
  // appears next to Import on the components list once at least one exists.
  const showExportButton =
    showNewButton && ui.view === 'components' && (state?.components.total ?? 0) > 0;
  // Filter input only makes sense when there's actually a list to filter.
  // Editors, the create form, settings, and migration have no view-scoped
  // search target, so hide the input there.
  const showFilterInput =
    !createMode &&
    !editor &&
    (ui.view === 'posts' ||
      ui.view === 'pages' ||
      ui.view === 'components' ||
      ui.view === 'authors' ||
      ui.view === 'tags');
  const surfaceState =
    ui.loadStatus === 'error' ? 'error' : ui.loadStatus === 'conflict' ? 'conflict' : 'loading';

  // Command palette items — all posts/pages + workspace actions. Built each
  // render but cheap (linear in item count).
  const commandItems: CommandItem[] = [];
  if (state) {
    for (const p of state.posts.items) {
      commandItems.push({
        id: `post:${p.slug}`,
        kind: 'open',
        label: p.title,
        hint: `post · ${p.slug}`,
        keywords: `${p.slug} post`,
        run: () => {
          void openEditor('posts', p.slug);
        },
      });
    }
    for (const p of state.pages.items) {
      commandItems.push({
        id: `page:${p.slug}`,
        kind: 'open',
        label: p.title,
        hint: `page · ${p.slug}`,
        keywords: `${p.slug} page`,
        run: () => {
          void openEditor('pages', p.slug);
        },
      });
    }
  }
  commandItems.push(
    {
      id: 'nav:posts',
      kind: 'navigate',
      label: 'Go to Posts',
      hint: 'workspace',
      keywords: 'navigate posts list',
      run: () => navigateView('posts'),
    },
    {
      id: 'nav:pages',
      kind: 'navigate',
      label: 'Go to Pages',
      hint: 'workspace',
      keywords: 'navigate pages list',
      run: () => navigateView('pages'),
    },
    {
      id: 'nav:settings',
      kind: 'navigate',
      label: 'Open Settings',
      hint: 'workspace',
      keywords: 'navigate settings configuration',
      run: () => navigateView('settings'),
    },
    {
      id: 'nav:migration',
      kind: 'navigate',
      label: 'Open Migration',
      hint: 'settings',
      keywords: 'ghost import wordpress migration',
      run: () => navigateView('migration'),
    },
    {
      id: 'action:new-post',
      kind: 'action',
      label: 'New post',
      hint: 'create',
      keywords: 'new create post draft',
      run: () => navigateCreate('posts'),
    },
    {
      id: 'action:new-page',
      kind: 'action',
      label: 'New page',
      hint: 'create',
      keywords: 'new create page',
      run: () => navigateCreate('pages'),
    },
    {
      id: 'action:force-sync',
      kind: 'action',
      label: 'Re-read disk',
      hint: 'sync',
      keywords: 'force refresh sync reload disk',
      run: () => {
        void load({ force: true });
      },
    },
  );

  return (
    <div class="shell">
      <a class="skipToMain" href="#main">
        Skip to main content
      </a>
      <ThemeMissingBanner status={state?.settings.theme.status} />
      <Sidebar
        section={section}
        siteTitle={state?.site.title ?? ''}
        siteUrl={state?.site.url}
        postsTotal={state?.posts.total}
        pagesTotal={state?.pages.total}
        componentsTotal={state?.components?.total}
        authorsTotal={state?.authors?.total}
        tagsTotal={state?.tags?.total}
        syncLabel={rail.sync.label}
        syncState={rail.sync.state}
        buildLabel={rail.build.label}
        buildState={rail.build.state}
        previewLabel={rail.preview.label}
        previewState={rail.preview.state}
        buildPhase={buildPhase}
        buildProgress={buildProgress}
        canDownload={canDownload}
        onBuildClick={() => {
          void handleBuildClick();
        }}
        onDownloadClick={handleDownloadZip}
        onNavigate={(target) => navigateView(target)}
        onForceSync={() => {
          void load({ force: true }).then(() => {
            toastHost.api.push({
              intent: 'success',
              message: 'Re-read disk · workspace is up to date.',
              duration: 2500,
            });
          });
        }}
      />
      <BuildPanel
        open={buildPanelOpen}
        phase={buildPhase}
        log={buildLog}
        progress={buildProgress}
        summary={buildSummary}
        error={buildError}
        onClose={handleBuildPanelClose}
        onDownload={handleDownloadZip}
        onRetry={() => {
          void handleBuildClick();
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
                showFilter={showFilterInput}
                showImport={showImportButton}
                showExport={showExportButton}
                onSearch={handleSearch}
                onNew={handleNew}
                onImport={() => setImportOpen(true)}
                onExport={() => setExportOpen(true)}
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
            key={ui.view}
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
                resultCount={(ui.view === 'posts' ? state.posts : state.pages).total}
                statusFilter={ui.statusFilter}
                query={ui.query}
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
            ) : ui.view === 'components' ? (
              <ComponentsView
                list={state.components}
                query={ui.query}
                onEdit={(slug) => {
                  void openEditor('components', slug);
                }}
              />
            ) : ui.view === 'migration' ? (
              <MigrationView
                onSettingsSaved={() => load({ force: true })}
                onGhostImportSuccess={() => {
                  void navigateView('posts');
                }}
              />
            ) : (
              <SettingsView
                state={state}
                subview={
                  ui.view === 'design'
                    ? 'design'
                    : ui.view === 'integration'
                      ? 'integration'
                      : 'site'
                }
                onSettingsSaved={() => load({ force: true })}
                onConflict={(message) => dispatch({ type: 'conflict', message })}
                onSiteDirtyChange={setSiteSettingsDirty}
                onThemeDirtyChange={setThemeSettingsDirty}
                onCodeInjectionDirtyChange={setCodeInjectionSettingsDirty}
              />
            )}
          </section>
        ) : null}
        {editor ? (
          editor.kind === 'authors' || editor.kind === 'tags' ? (
            <TaxonomyEditorView
              current={editor}
              onCloseEditor={handleCloseEditor}
              onSaved={handleEditorSaved}
              onRenamed={handleEditorRenamed}
              onConflict={handleEditorConflict}
              onDirtyChange={setEditorDirty}
            />
          ) : editor.kind === 'components' ? (
            <ComponentEditorView
              current={editor}
              onCloseEditor={handleCloseEditor}
              onSaved={handleEditorSaved}
              onRenamed={handleEditorRenamed}
              onConflict={handleEditorConflict}
              onDirtyChange={setEditorDirty}
            />
          ) : (
            <EditorView
              current={editor}
              state={state}
              onCloseEditor={handleCloseEditor}
              onSaved={handleEditorSaved}
              onRenamed={handleEditorRenamed}
              onConflict={handleEditorConflict}
              onDirtyChange={setEditorDirty}
              onDelete={handleEditorDelete}
            />
          )
        ) : null}
      </main>
      <CommandPalette open={cmdkOpen} items={commandItems} onClose={() => setCmdkOpen(false)} />
      <Modal open={importOpen} onClose={() => setImportOpen(false)}>
        {ui.view === 'components' ? (
          <ComponentImportModal
            onClose={() => setImportOpen(false)}
            onImported={() => void load({ force: true })}
            toast={toastHost.api}
          />
        ) : (
          <ImportModal
            onClose={() => setImportOpen(false)}
            onImported={() => void load({ force: true })}
            toast={toastHost.api}
          />
        )}
      </Modal>
      <Modal open={exportOpen} onClose={() => setExportOpen(false)}>
        <ComponentExportModal
          components={(state?.components.items ?? []).map((c) => ({
            slug: c.slug,
            description: c.description,
          }))}
          onClose={() => setExportOpen(false)}
          toast={toastHost.api}
        />
      </Modal>
      {confirmHost.node}
      {toastHost.node}
    </div>
  );
}

export { normalizeView };
