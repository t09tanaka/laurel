import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type GhostImportStreamEvent,
  importPageBundleUpload,
  streamGhostImport,
} from '../lib/api.ts';
import { StatePanel } from './StatePanel.tsx';

interface MigrationViewProps {
  onSettingsSaved: () => Promise<void> | void;
  onGhostImportSuccess: () => void;
}

export function MigrationView(props: MigrationViewProps): JSX.Element {
  return (
    <div class="migrationPage">
      {/* Section h2 dropped — the page-level viewTitle already says
       * "Migration". The two import cards below name themselves. */}
      <div class="migrationGrid">
        <GhostImportPanel
          onApplied={props.onSettingsSaved}
          onImportSuccess={props.onGhostImportSuccess}
        />
        <PageBundleImportPanel onApplied={props.onSettingsSaved} />
      </div>
    </div>
  );
}

interface ImportPanelProps {
  onApplied: () => Promise<void> | void;
}

interface GhostImportPanelProps extends ImportPanelProps {
  onImportSuccess: () => void;
}

function GhostImportPanel(props: GhostImportPanelProps): JSX.Element {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [result, setResult] = useState<{
    error?: string;
    mode?: string;
    target?: string;
    summary?: Record<string, unknown>;
  } | null>(null);

  return (
    <article class="settingsCard migrationCard field wide" data-migration="ghost">
      <header class="migrationCardHead">
        <div>
          <h3>Ghost import</h3>
          <p class="meta">
            Bring posts, pages, authors, tags, and (when a source URL is supplied) referenced images
            in from a Ghost export.
          </p>
        </div>
        <button
          type="button"
          class="btn secondary btnCompact"
          onClick={() => setUploadOpen(true)}
          id="openGhostImport"
        >
          Upload export
        </button>
      </header>
      <div id="ghostImportResult">
        {result?.error ? (
          <StatePanel kind="error" message={result.error} />
        ) : result?.summary ? (
          <GhostImportResultTable
            result={result as { mode?: string; target?: string; summary: Record<string, unknown> }}
          />
        ) : null}
      </div>
      {uploadOpen ? (
        <GhostImportModal
          onClose={() => setUploadOpen(false)}
          onResult={async (next) => {
            setResult(next);
            if (next.summary) {
              await props.onApplied();
              props.onImportSuccess();
            }
          }}
        />
      ) : null}
    </article>
  );
}

interface GhostImportModalProps {
  onClose: () => void;
  onResult: (result: {
    error?: string;
    mode?: string;
    target?: string;
    summary?: Record<string, unknown>;
  }) => Promise<void> | void;
}

interface GhostImportProgressState {
  downloaded: number;
  skipped: number;
  failed: number;
  currentUrl: string;
  processedPosts: number;
  totalPosts: number;
}

function GhostImportModal({ onClose, onResult }: GhostImportModalProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [onConflict, setOnConflict] = useState<'skip' | 'rename' | 'overwrite'>('skip');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceUrlTouched, setSourceUrlTouched] = useState(false);
  const [sourceUrlSubmitted, setSourceUrlSubmitted] = useState(false);
  const [maxImageSizeMb, setMaxImageSizeMb] = useState('10');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [progress, setProgress] = useState<GhostImportProgressState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Validate the Max image size field on every keystroke so the user sees
  // "out of range" feedback immediately instead of only after submitting.
  // Empty is allowed — the backend defaults to 10MB when omitted.
  const maxImageSizeError = (() => {
    const trimmed = maxImageSizeMb.trim();
    if (trimmed === '') return '';
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
      return 'Enter an integer between 1 and 10 MB.';
    }
    return '';
  })();
  const sourceUrlError = (() => {
    const trimmed = sourceUrl.trim();
    if (trimmed === '') return 'Enter the public URL of the source Ghost site.';
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return '';
    } catch {
      // handled by the shared message below
    }
    return `Invalid source URL: "${trimmed}". Expected an absolute URL like https://oldblog.com.`;
  })();
  const visibleSourceUrlError = sourceUrlTouched || sourceUrlSubmitted ? sourceUrlError : '';

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function handleCancelImport(): void {
    abortRef.current?.abort();
  }

  async function run() {
    if (!file) {
      setLocalError('Pick a Ghost export (.zip or .json) first.');
      return;
    }
    setSourceUrlSubmitted(true);
    let maxImageSizeBytes: number | undefined;
    const trimmedSize = maxImageSizeMb.trim();
    if (trimmedSize.length > 0) {
      const parsed = Number(trimmedSize);
      // Mirror the input's HTML constraints (min=1, max=10, step=1) as a JS
      // backstop — users can still paste arbitrary text into a `type=number`
      // field on most browsers.
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
        setLocalError(
          `Invalid max image size: "${trimmedSize}". Enter an integer between 1 and 10 MB.`,
        );
        return;
      }
      // Convert MB → bytes for the backend. The UI is MB-only on purpose;
      // the bytes wire format keeps server-side validation and the CLI
      // `--max-image-size` flag honest.
      maxImageSizeBytes = parsed * 1024 * 1024;
    }
    const trimmedSource = sourceUrl.trim();
    if (sourceUrlError) {
      return;
    }
    setLocalError('');
    setBusy(true);
    setProgress({
      downloaded: 0,
      skipped: 0,
      failed: 0,
      currentUrl: '',
      processedPosts: 0,
      totalPosts: 0,
    });

    const controller = new AbortController();
    abortRef.current = controller;
    let settled = false;
    try {
      await streamGhostImport(
        {
          file,
          onConflict,
          sourceUrl: trimmedSource || undefined,
          maxImageSizeBytes,
        },
        (event: GhostImportStreamEvent) => {
          if (event.type === 'progress') {
            const inner = event.event;
            if (inner.type === 'posts') {
              setProgress((prev) =>
                prev
                  ? { ...prev, processedPosts: inner.processedPosts, totalPosts: inner.totalPosts }
                  : prev,
              );
            } else if (inner.type === 'image') {
              setProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      downloaded: inner.downloaded,
                      skipped: inner.skipped,
                      failed: inner.failed,
                      currentUrl: inner.status === 'fetching' ? inner.url : prev.currentUrl,
                    }
                  : prev,
              );
            }
          } else if (event.type === 'done') {
            settled = true;
            void onResult({
              mode: event.mode,
              target: event.target,
              summary: event.summary as Record<string, unknown>,
            });
            onClose();
          } else if (event.type === 'error') {
            settled = true;
            void onResult({ error: event.message });
            setLocalError(event.message);
          }
        },
        controller.signal,
      );
      if (!settled) {
        // Stream ended without emitting a terminal event — treat as success
        // would be misleading, so surface a generic error.
        setLocalError('Import ended unexpectedly without a result.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void onResult({ error: message });
      setLocalError(message);
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div
      class="modalBackdrop"
      role="presentation"
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
      }}
    >
      <dialog class="modalDialog" aria-modal="true" aria-label="Upload Ghost export" open>
        <header class="modalHead">
          <h3>Upload Ghost export</h3>
          <button
            type="button"
            class="modalClose"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p class="meta">
          Drop a Ghost export <code>.zip</code> or <code>ghost-export.json</code>. Imported posts
          land in the content dir configured in <code>nectar.toml</code>.
        </p>
        <UploadDropzone
          accept=".zip,.json,application/zip,application/json"
          file={file}
          disabled={busy}
          hint="Click or drop a Ghost export (.zip / .json)"
          onPick={setFile}
          onClear={() => setFile(null)}
          match={(name) => /\.(zip|json)$/i.test(name)}
        />
        <div class="fields">
          <label class="field">
            <span>Conflict policy</span>
            <select
              id="ghostImportConflict"
              value={onConflict}
              disabled={busy}
              onChange={(event) =>
                setOnConflict(
                  (event.currentTarget as HTMLSelectElement).value as
                    | 'skip'
                    | 'rename'
                    | 'overwrite',
                )
              }
            >
              <option value="skip">skip</option>
              <option value="rename">rename</option>
              <option value="overwrite">overwrite</option>
            </select>
          </label>
        </div>
        <label class="field wide">
          <span>Source URL *</span>
          <input
            id="ghostImportSourceUrl"
            type="url"
            placeholder="https://oldblog.com"
            value={sourceUrl}
            required
            disabled={busy}
            aria-invalid={visibleSourceUrlError ? 'true' : 'false'}
            aria-describedby={visibleSourceUrlError ? 'ghostImportSourceUrlError' : undefined}
            onInput={(event) => setSourceUrl((event.currentTarget as HTMLInputElement).value)}
            onBlur={() => setSourceUrlTouched(true)}
          />
          {visibleSourceUrlError ? (
            <span id="ghostImportSourceUrlError" class="fieldError" role="alert">
              {visibleSourceUrlError}
            </span>
          ) : (
            <span class="meta">
              Public URL of the source Ghost site. Ghost exports store image URLs as{' '}
              <code>__GHOST_URL__/content/images/...</code>, and the downloader needs a real base to
              resolve them. Include the subpath if the blog is mounted under one (e.g.{' '}
              <code>https://example.com/ja/blog</code>).
            </span>
          )}
        </label>
        <details class="advancedPanel" data-field="ghost-image-advanced">
          <summary>Advanced</summary>
          <label class="field wide">
            <span>Max image size</span>
            <div class="inputWithSuffix">
              <input
                id="ghostImportMaxImageSize"
                type="number"
                min="1"
                max="10"
                step="1"
                inputMode="numeric"
                placeholder="10"
                value={maxImageSizeMb}
                disabled={busy}
                aria-invalid={maxImageSizeError ? 'true' : 'false'}
                aria-describedby={maxImageSizeError ? 'ghostImportMaxImageSizeError' : undefined}
                onInput={(event) =>
                  setMaxImageSizeMb((event.currentTarget as HTMLInputElement).value)
                }
              />
              <span class="inputSuffix" aria-hidden="true">
                MB
              </span>
            </div>
            {maxImageSizeError ? (
              <span id="ghostImportMaxImageSizeError" class="fieldError" role="alert">
                {maxImageSizeError}
              </span>
            ) : (
              <span class="meta">
                Per-image cap in MB. Integer between 1 and 10. Defaults to 10MB when blank.
              </span>
            )}
          </label>
        </details>
        <div class="editorActions">
          <button
            class="btn"
            id="applyGhostImport"
            type="button"
            disabled={busy || !file || !!maxImageSizeError}
            onClick={() => {
              void run();
            }}
          >
            Import files
          </button>
        </div>
        {localError ? <StatePanel kind="error" message={localError} /> : null}
      </dialog>
      {busy && progress ? (
        <GhostImportProgress state={progress} onCancel={handleCancelImport} />
      ) : null}
    </div>
  );
}

interface GhostImportProgressProps {
  state: GhostImportProgressState;
  onCancel: () => void;
}

// Full-screen overlay that takes over the dashboard while a Ghost import is
// in flight. Renders running counters fed by the NDJSON event stream so the
// operator can see what's happening on multi-minute imports instead of
// staring at a generic spinner. Cancel aborts the underlying fetch.
function GhostImportProgress({ state, onCancel }: GhostImportProgressProps): JSX.Element {
  const total = state.downloaded + state.skipped + state.failed;
  return (
    <div class="ghostImportOverlay" aria-live="polite" aria-label="Importing Ghost export">
      <div class="ghostImportOverlayCard">
        <header class="ghostImportOverlayHead">
          <p class="ghostImportOverlayKicker">Ghost import</p>
          <h2 class="ghostImportOverlayTitle">Importing&nbsp;…</h2>
        </header>
        <dl class="ghostImportOverlayStats">
          <div>
            <dt>Images</dt>
            <dd>{total}</dd>
          </div>
          <div>
            <dt>Downloaded</dt>
            <dd>{state.downloaded}</dd>
          </div>
          <div>
            <dt>Skipped</dt>
            <dd>{state.skipped}</dd>
          </div>
          <div data-tone={state.failed > 0 ? 'failed' : undefined}>
            <dt>Failed</dt>
            <dd>{state.failed}</dd>
          </div>
        </dl>
        {state.totalPosts > 0 ? (
          <p class="ghostImportOverlayPosts">
            Posts written {state.processedPosts} / {state.totalPosts}
          </p>
        ) : null}
        <div class="ghostImportOverlayCurrent">
          <span class="ghostImportOverlayCurrentLabel">Fetching</span>
          <code class="ghostImportOverlayCurrentUrl" title={state.currentUrl}>
            {state.currentUrl || '—'}
          </code>
        </div>
        <div class="ghostImportOverlayActions">
          <button type="button" class="btn secondary" onClick={onCancel}>
            Cancel import
          </button>
        </div>
      </div>
    </div>
  );
}

interface UploadDropzoneProps {
  accept: string;
  file: File | null;
  disabled: boolean;
  hint: string;
  onPick: (file: File) => void;
  // Optional reset hook for the × button on the filled card. When omitted
  // the remove affordance is hidden; clicking the card still re-opens the
  // file picker so the operator can replace.
  onClear?: () => void;
  match: (name: string) => boolean;
}

function UploadDropzone(props: UploadDropzoneProps): JSX.Element {
  const filled = props.file !== null;
  return (
    <label
      class={`themeUploadDrop${props.disabled ? ' busy' : ''}${filled ? ' filled' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        const candidate = Array.from(event.dataTransfer?.files ?? []).find((f) =>
          props.match(f.name),
        );
        if (!candidate) return;
        event.preventDefault();
        props.onPick(candidate);
      }}
    >
      <input
        type="file"
        accept={props.accept}
        class="srOnly"
        disabled={props.disabled}
        onChange={(event) => {
          const input = event.currentTarget as HTMLInputElement;
          const picked = input.files?.[0];
          if (picked) props.onPick(picked);
          // Reset so picking the same file twice in a row still fires.
          input.value = '';
        }}
      />
      {filled && props.file ? (
        <div class="themeUploadCard">
          <span class="themeUploadCardGlyph" aria-hidden="true" />
          <div class="themeUploadCardBody">
            <span class="themeUploadCardName">{props.file.name}</span>
            <span class="themeUploadCardMeta">
              {formatBytes(props.file.size)} · click to replace
            </span>
          </div>
          {props.onClear ? (
            <button
              type="button"
              class="themeUploadCardClear"
              aria-label="Remove file"
              disabled={props.disabled}
              onClick={(event) => {
                // Stop the click from bubbling to the wrapping <label>,
                // which would otherwise re-open the file picker the
                // instant the user tries to clear.
                event.preventDefault();
                event.stopPropagation();
                props.onClear?.();
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : (
        <span class="themeUploadHint">{props.hint}</span>
      )}
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PageBundleImportPanel(props: ImportPanelProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [onConflict, setOnConflict] = useState<'skip' | 'rename' | 'overwrite'>('skip');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    error?: string;
    result?: {
      written?: boolean;
      pagePath?: string;
      skipped?: boolean;
      renamed?: boolean;
      assetPaths?: string[];
    };
    dryRun?: boolean;
  } | null>(null);

  async function run(dryRun: boolean) {
    if (!file) {
      setResult({ error: 'Pick a page bundle (.json or .zip) first.' });
      return;
    }
    if (
      !dryRun &&
      onConflict === 'overwrite' &&
      !confirm('Overwrite an existing page if the bundle slug already exists?')
    ) {
      return;
    }
    if (
      !dryRun &&
      !confirm('Import writes one Page and bundled assets into this project. Continue?')
    ) {
      return;
    }
    setBusy(true);
    setNotice(dryRun ? 'Previewing page import…' : 'Importing page…');
    try {
      const { status, data } = await importPageBundleUpload({
        file,
        dryRun,
        onConflict,
      });
      if (status >= 400) {
        const error = (data as { error?: string }).error;
        setResult({ error: error ?? 'Page import failed' });
        return;
      }
      setResult(data as typeof result);
      if (!dryRun) await props.onApplied();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setNotice('');
    }
  }

  return (
    <article class="settingsCard migrationCard field wide" data-migration="page-bundle">
      <header class="migrationCardHead">
        <div>
          <h3>Page bundle import</h3>
          <p class="meta">
            Drop one saved Page collaboration bundle (.json or .zip). Preview never writes files.
          </p>
        </div>
      </header>
      <UploadDropzone
        accept=".json,.zip,application/json,application/zip"
        file={file}
        disabled={busy}
        hint="Click or drop a page bundle (.json / .zip)"
        onPick={setFile}
        onClear={() => setFile(null)}
        match={(name) => /\.(json|zip)$/i.test(name)}
      />
      <div class="fields">
        <label class="field">
          <span>Conflict policy</span>
          <select
            id="pageBundleImportConflict"
            value={onConflict}
            onChange={(event) =>
              setOnConflict(
                (event.currentTarget as HTMLSelectElement).value as 'skip' | 'rename' | 'overwrite',
              )
            }
          >
            <option value="skip">skip</option>
            <option value="rename">rename</option>
            <option value="overwrite">overwrite</option>
          </select>
        </label>
      </div>
      <div class="editorActions">
        <button
          class="btn secondary"
          id="previewPageBundleImport"
          type="button"
          disabled={busy || !file}
          onClick={() => {
            void run(true);
          }}
        >
          Preview import
        </button>
        <button
          class="btn"
          id="applyPageBundleImport"
          type="button"
          disabled={busy || !file}
          onClick={() => {
            void run(false);
          }}
        >
          Import page
        </button>
      </div>
      <output class="notice" id="pageBundleImportNotice">
        {notice}
      </output>
      <div id="pageBundleImportResult">
        {result?.error ? (
          <StatePanel kind="error" message={result.error} />
        ) : result?.result ? (
          <table class="table">
            <tbody>
              <tr>
                <th>mode</th>
                <td>{result.dryRun ? 'dry-run' : 'apply'}</td>
              </tr>
              <tr>
                <th>page path</th>
                <td>{result.result.pagePath ?? ''}</td>
              </tr>
              <tr>
                <th>written</th>
                <td>{result.result.written ? 'yes' : 'no'}</td>
              </tr>
              <tr>
                <th>skipped</th>
                <td>{result.result.skipped ? 'yes' : 'no'}</td>
              </tr>
              <tr>
                <th>renamed</th>
                <td>{result.result.renamed ? 'yes' : 'no'}</td>
              </tr>
              <tr>
                <th>assets</th>
                <td>{(result.result.assetPaths ?? []).length}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </div>
    </article>
  );
}

function GhostImportResultTable({
  result,
}: { result: { mode?: string; target?: string; summary: Record<string, unknown> } }): JSX.Element {
  const s = result.summary;
  const rows: Array<[string, string | number]> = [
    ['mode', result.mode ?? ''],
    ['target', result.target ?? 'content/'],
    ['posts', Number(s.posts ?? 0)],
    ['pages', Number(s.pages ?? 0)],
    ['drafts', Number(s.drafts ?? 0)],
    ['tags', Number(s.tags ?? 0)],
    ['authors', Number(s.authors ?? 0)],
    ['assets copied', Number(s.assetsCopied ?? 0)],
    ['images downloaded', Number(s.imagesDownloaded ?? 0)],
    ['images failed', Number(s.imagesFailed ?? 0)],
    ['skipped', Number(s.skipped ?? 0)],
    ['overwritten', Number(s.overwritten ?? 0)],
    ['renamed', Number(s.renamed ?? 0)],
    ['status filtered', Number(s.statusFiltered ?? 0)],
    ['tag filtered', Number(s.tagFiltered ?? 0)],
    ['date filtered', Number(s.dateFiltered ?? 0)],
    ['empty bodies', Number(s.bodiesEmpty ?? 0)],
    ['slug collisions', Number(s.slugCollisions ?? 0)],
    ['redirects', Number(s.redirectsImported ?? 0)],
    ['slug redirects', Number(s.slugRedirects ?? 0)],
    ['code injection skipped', Number(s.codeInjectionSkipped ?? 0)],
    ['HTML preserved', Number(s.htmlPreserved ?? 0)],
  ];
  const plannedPaths = Array.isArray(s.plannedPaths) ? (s.plannedPaths as unknown[]).length : 0;
  return (
    <>
      <table class="table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plannedPaths ? <div class="meta">{plannedPaths} planned path(s)</div> : null}
    </>
  );
}
