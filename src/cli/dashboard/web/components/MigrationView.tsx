import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { importGhostUpload, importPageBundleUpload } from '../lib/api.ts';
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
  const [file, setFile] = useState<File | null>(null);
  const [onConflict, setOnConflict] = useState<'skip' | 'rename' | 'overwrite'>('skip');
  const [downloadImages, setDownloadImages] = useState(true);
  const [maxImageSize, setMaxImageSize] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    error?: string;
    mode?: string;
    target?: string;
    summary?: Record<string, unknown>;
  } | null>(null);

  async function run() {
    if (!file) {
      setResult({ error: 'Pick a Ghost export (.zip or .json) first.' });
      return;
    }
    let maxImageSizeBytes: number | undefined;
    const trimmedSize = maxImageSize.trim();
    if (trimmedSize.length > 0) {
      const parsed = parseSizeSpec(trimmedSize);
      if (parsed === null) {
        setResult({
          error: `Invalid max image size: "${trimmedSize}". Use values like "10MB", "1GB", or "0" to disable the cap.`,
        });
        return;
      }
      maxImageSizeBytes = parsed;
    }
    if (!confirm('Import writes Markdown and assets into the configured content dir. Continue?')) {
      return;
    }
    setBusy(true);
    setNotice(downloadImages ? 'Importing files and downloading images…' : 'Importing files…');
    try {
      const { status, data } = await importGhostUpload({
        file,
        onConflict,
        downloadImages,
        maxImageSizeBytes,
      });
      if (status >= 400) {
        const error = (data as { error?: string }).error;
        setResult({ error: error ?? 'Import failed' });
        return;
      }
      setResult(data as typeof result);
      await props.onApplied();
      props.onImportSuccess();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setNotice('');
    }
  }

  return (
    <article class="settingsCard migrationCard field wide" data-migration="ghost">
      <header class="migrationCardHead">
        <div>
          <h3>Ghost import</h3>
          <p class="meta">
            Drop a Ghost export (.zip or ghost-export.json). Imported posts land in the content dir
            configured in nectar.toml.
          </p>
        </div>
      </header>
      <UploadDropzone
        accept=".zip,.json,application/zip,application/json"
        file={file}
        disabled={busy}
        hint="Click or drop a Ghost export (.zip / .json)"
        onPick={setFile}
        match={(name) => /\.(zip|json)$/i.test(name)}
      />
      <div class="fields">
        <label class="field">
          <span>Conflict policy</span>
          <select
            id="ghostImportConflict"
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
      <label class="field wide" data-field="ghost-download-images">
        <input
          type="checkbox"
          id="ghostImportDownloadImages"
          checked={downloadImages}
          onChange={(event) => setDownloadImages((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>Download referenced images</span>
      </label>
      <p class="meta wide">
        Fetch image URLs in posts and frontmatter, save under <code>content/images/</code>, and
        rewrite references to site-relative paths. Skipped during preview.
      </p>
      {downloadImages ? (
        <details class="advancedPanel" data-field="ghost-image-advanced">
          <summary>Advanced</summary>
          <label class="field wide">
            <span>Max image size</span>
            <input
              id="ghostImportMaxImageSize"
              placeholder="10MB"
              value={maxImageSize}
              onInput={(event) => setMaxImageSize((event.currentTarget as HTMLInputElement).value)}
            />
            <span class="meta">
              Per-image cap. Accepts <code>10MB</code>, <code>1GB</code>, or <code>0</code> to
              disable. Defaults to 10MB when blank.
            </span>
          </label>
        </details>
      ) : null}
      <div class="editorActions">
        <button
          class="btn"
          id="applyGhostImport"
          type="button"
          disabled={busy || !file}
          onClick={() => {
            void run();
          }}
        >
          Import files
        </button>
      </div>
      <output class="notice" id="ghostImportNotice">
        {notice}
      </output>
      <div id="ghostImportResult">
        {result?.error ? (
          <StatePanel kind="error" message={result.error} />
        ) : result?.summary ? (
          <GhostImportResultTable
            result={result as { mode?: string; target?: string; summary: Record<string, unknown> }}
          />
        ) : null}
      </div>
    </article>
  );
}

interface UploadDropzoneProps {
  accept: string;
  file: File | null;
  disabled: boolean;
  hint: string;
  onPick: (file: File) => void;
  match: (name: string) => boolean;
}

function UploadDropzone(props: UploadDropzoneProps): JSX.Element {
  return (
    <label
      class={`themeUploadDrop${props.disabled ? ' busy' : ''}`}
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
          const picked = (event.currentTarget as HTMLInputElement).files?.[0];
          if (picked) props.onPick(picked);
        }}
      />
      <span class="themeUploadHint">
        {props.file ? `${props.file.name} (${formatBytes(props.file.size)})` : props.hint}
      </span>
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mirrors src/cli/commands/import-ghost.ts:parseSizeSpec. Kept duplicated to
// avoid pulling node-targeted CLI modules into the dashboard browser bundle.
function parseSizeSpec(input: string): number | null {
  const s = input.trim();
  if (s.length === 0) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?b)?$/i.exec(s);
  if (!m) return null;
  const numeric = m[1];
  if (numeric === undefined) return null;
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = (m[2] ?? 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };
  const mult = multipliers[unit];
  if (mult === undefined) return null;
  return Math.floor(value * mult);
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
