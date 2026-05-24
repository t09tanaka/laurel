import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  type GhostImportPayload,
  type PageBundleImportPayload,
  importGhost,
  importPageBundle,
} from '../lib/api.ts';
import { StatePanel } from './StatePanel.tsx';

interface MigrationViewProps {
  onSettingsSaved: () => Promise<void> | void;
}

export function MigrationView(props: MigrationViewProps): JSX.Element {
  return (
    <div class="migrationPage">
      <div class="panelHead">
        <h2>Migration</h2>
        <span class="meta">
          Bring posts, pages, and assets in from Ghost or saved Page bundles.
        </span>
      </div>
      <div class="migrationGrid">
        <GhostImportPanel onApplied={props.onSettingsSaved} />
        <PageBundleImportPanel onApplied={props.onSettingsSaved} />
      </div>
    </div>
  );
}

interface ImportPanelProps {
  onApplied: () => Promise<void> | void;
}

function GhostImportPanel(props: ImportPanelProps): JSX.Element {
  const [file, setFile] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [onConflict, setOnConflict] = useState<'skip' | 'rename' | 'overwrite'>('skip');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    error?: string;
    mode?: string;
    target?: string;
    summary?: Record<string, unknown>;
  } | null>(null);

  async function run(dryRun: boolean) {
    if (!file.trim()) {
      setResult({ error: 'Ghost export path is required.' });
      return;
    }
    if (
      !dryRun &&
      !confirm('Import writes Markdown and assets into the selected target. Continue?')
    ) {
      return;
    }
    setBusy(true);
    setNotice(dryRun ? 'Previewing import...' : 'Importing files...');
    try {
      const payload: GhostImportPayload = {
        file: file.trim(),
        dryRun,
        onConflict,
      };
      if (outputDir.trim()) payload.outputDir = outputDir.trim();
      const { status, data } = await importGhost(payload);
      if (status >= 400) {
        const error = (data as { error?: string }).error;
        setResult({ error: error ?? 'Import failed' });
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
    <article class="settingsCard migrationCard field wide" data-migration="ghost">
      <header class="migrationCardHead">
        <div>
          <h3>Ghost import</h3>
          <p class="meta">
            Run a Ghost JSON, folder, or ZIP import from a local path. Preview never writes files.
          </p>
        </div>
        <SourcePill kind="cli" label="nectar import-ghost" />
      </header>
      <label class="field wide">
        <span>Export path</span>
        <input
          id="ghostImportFile"
          placeholder="/path/to/ghost-export.zip"
          value={file}
          onInput={(event) => setFile((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
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
        <label class="field">
          <span>Output dir</span>
          <input
            id="ghostImportOutput"
            placeholder="content/"
            value={outputDir}
            onInput={(event) => setOutputDir((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="editorActions">
        <button
          class="btn secondary"
          id="previewGhostImport"
          type="button"
          disabled={busy}
          onClick={() => {
            void run(true);
          }}
        >
          Preview import
        </button>
        <button
          class="btn"
          id="applyGhostImport"
          type="button"
          disabled={busy}
          onClick={() => {
            void run(false);
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

function PageBundleImportPanel(props: ImportPanelProps): JSX.Element {
  const [file, setFile] = useState('');
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
    if (!file.trim()) {
      setResult({ error: 'Page bundle path is required.' });
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
    setNotice(dryRun ? 'Previewing page import...' : 'Importing page...');
    try {
      const { status, data } = await importPageBundle({
        file: file.trim(),
        dryRun,
        onConflict,
      } as PageBundleImportPayload);
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
            Import one saved Page collaboration bundle from a local path. Preview never writes
            files.
          </p>
        </div>
        <SourcePill kind="cli" label="nectar import-page" />
      </header>
      <label class="field wide">
        <span>Bundle path</span>
        <input
          id="pageBundleImportFile"
          placeholder="/path/to/about.page.json"
          value={file}
          onInput={(event) => setFile((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
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
          disabled={busy}
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
          disabled={busy}
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

function SourcePill({ kind, label }: { kind: string; label: string }): JSX.Element {
  return (
    <span class={`sourcePill sourcePill-${kind}`} data-source={kind}>
      {label}
    </span>
  );
}
