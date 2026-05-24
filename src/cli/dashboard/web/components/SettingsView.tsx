import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  type GhostImportPayload,
  type PageBundleImportPayload,
  importGhost,
  importPageBundle,
  saveSiteSettings,
  saveThemeSettings,
} from '../lib/api.ts';
import type { DashboardState, SettingsCard } from '../types.ts';
import { StatePanel } from './StatePanel.tsx';

interface SettingsViewProps {
  state: DashboardState;
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onSiteDirtyChange: (dirty: boolean) => void;
  onThemeDirtyChange: (dirty: boolean) => void;
}

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const settings = props.state.settings;
  const site = props.state.site;
  const [setTitle, setSetTitle] = useState(site.title);
  const [setAccent, setSetAccent] = useState(site.accentColor);
  const [setDescription, setSetDescription] = useState(site.description);
  const [setUrl, setSetUrl] = useState(site.url);
  const [searchTerm, setSearchTerm] = useState('');
  const [siteNotice, setSiteNotice] = useState('');
  const [siteSettingsDirty, setSiteSettingsDirty] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: parent state callbacks are stable
  useEffect(() => {
    setSetTitle(site.title);
    setSetAccent(site.accentColor);
    setSetDescription(site.description);
    setSetUrl(site.url);
    setSiteSettingsDirty(false);
    props.onSiteDirtyChange(false);
  }, [site.title, site.description, site.url, site.accentColor]);

  function markDirty<T>(setter: (value: T) => void): (event: Event) => void {
    return (event) => {
      const value = (event.currentTarget as HTMLInputElement).value as unknown as T;
      setter(value);
      setSiteSettingsDirty(true);
      props.onSiteDirtyChange(true);
    };
  }

  async function handleSaveSite() {
    const updates = {
      title: setTitle,
      description: setDescription,
      url: setUrl,
      accent_color: setAccent,
    };
    const { status, data } = await saveSiteSettings({
      fingerprint: settings.fingerprint,
      updates,
    });
    if (status === 409) {
      props.onConflict(
        'nectar.toml changed on disk. Latest settings loaded; re-enter changes after review.',
      );
      await props.onSettingsSaved();
      return;
    }
    if (status >= 400) {
      setSiteNotice(data.error ?? 'Could not save settings');
      return;
    }
    setSiteSettingsDirty(false);
    props.onSiteDirtyChange(false);
    setSiteNotice('Saved to nectar.toml');
    await props.onSettingsSaved();
  }

  return (
    <div>
      <div class="panelHead">
        <h2>Project settings</h2>
        <span class="meta">{settings.configPath}</span>
      </div>
      <div class="settingsGrid">
        <label class="field">
          <span>Search settings</span>
          <input
            id="settingsSearch"
            placeholder="Press / to search"
            value={searchTerm}
            onInput={(event) => setSearchTerm((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>Site title</span>
          <input id="setTitle" value={setTitle} onInput={markDirty(setSetTitle)} />
        </label>
        <label class="field">
          <span>Accent color</span>
          <input id="setAccent" value={setAccent} onInput={markDirty(setSetAccent)} />
        </label>
        <label class="field wide">
          <span>Description</span>
          <input
            id="setDescription"
            value={setDescription}
            onInput={markDirty(setSetDescription)}
          />
        </label>
        <label class="field wide">
          <span>Site URL</span>
          <input id="setUrl" value={setUrl} onInput={markDirty(setSetUrl)} />
        </label>
        <div class="field wide">
          <output id="settingsNotice" class="notice">
            {siteNotice}
          </output>
          <button
            class="btn"
            id="saveSettings"
            type="button"
            onClick={() => {
              void handleSaveSite();
            }}
            disabled={!siteSettingsDirty}
          >
            Save site card
          </button>
        </div>
      </div>
      <ThemeSwitcherPanel
        state={props.state}
        onSettingsSaved={props.onSettingsSaved}
        onConflict={props.onConflict}
        onThemeDirtyChange={props.onThemeDirtyChange}
      />
      <PageBundleImportPanel onApplied={props.onSettingsSaved} />
      <GhostImportPanel onApplied={props.onSettingsSaved} />
      <SettingsCardsGrid cards={settings.cards} term={searchTerm} />
    </div>
  );
}

interface ThemeSwitcherProps {
  state: DashboardState;
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onThemeDirtyChange: (dirty: boolean) => void;
}

function ThemeSwitcherPanel(props: ThemeSwitcherProps): JSX.Element {
  const theme = props.state.settings.theme;
  const available = theme.available ?? [];
  const activeExists = available.some((item) => item.name === theme.name);
  const missingActive = theme.name && !activeExists;
  const [selected, setSelected] = useState<string>(activeExists ? theme.name : '');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: parent state callback is stable
  useEffect(() => {
    setSelected(activeExists ? theme.name : '');
    setDirty(false);
    props.onThemeDirtyChange(false);
  }, [theme.name, activeExists]);

  async function handleSave() {
    if (!selected) return;
    const { status, data } = await saveThemeSettings({
      fingerprint: props.state.settings.fingerprint,
      updates: { name: selected },
    });
    if (status === 409) {
      props.onConflict(
        'nectar.toml changed on disk. Latest theme settings loaded; choose again after review.',
      );
      await props.onSettingsSaved();
      return;
    }
    if (status >= 400) {
      setNotice(data.error ?? 'Could not save theme');
      return;
    }
    setDirty(false);
    props.onThemeDirtyChange(false);
    setNotice('Saved active theme');
    await props.onSettingsSaved();
  }

  const noOptions = available.length === 0 && !missingActive;
  return (
    <div class="settingsGrid">
      <article class="settingsCard field wide">
        <div>
          <h3>Active theme</h3>
          <span class="pill">nectar.toml</span>
        </div>
        <p class="meta">Choose the theme used by preview and the next build.</p>
        <div class="fields">
          <label class="field">
            <span>Theme directory</span>
            <input value={theme.dir ?? 'themes'} disabled />
          </label>
          <label class="field">
            <span>Theme</span>
            <select
              id="settingsThemeName"
              data-current={activeExists ? theme.name : ''}
              value={selected}
              disabled={noOptions}
              onChange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                setSelected(value);
                const isDirty = value !== (activeExists ? theme.name : '');
                setDirty(isDirty);
                props.onThemeDirtyChange(isDirty);
              }}
            >
              {missingActive ? (
                <option value="" disabled>
                  Missing: {theme.name}
                </option>
              ) : null}
              {available.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {item.active ? ' · active' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="editorActions">
          <button
            class="btn"
            id="saveThemeSettings"
            type="button"
            disabled={!dirty || !selected}
            onClick={() => {
              void handleSave();
            }}
          >
            Save active theme
          </button>
          <output id="themeSettingsNotice" class="notice">
            {notice}
          </output>
        </div>
        <div class="meta">
          {noOptions
            ? `No theme directories found under ${theme.dir ?? 'themes'}.`
            : missingActive
              ? 'Active theme is missing. Choose an installed theme before saving.'
              : 'Preview uses this theme immediately after saving; dist changes only after build.'}
        </div>
      </article>
    </div>
  );
}

interface ImportPanelProps {
  onApplied: () => Promise<void> | void;
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
    <div class="settingsGrid">
      <article class="settingsCard field wide">
        <div>
          <h3>Page bundle import</h3>
          <span class="pill">Focused</span>
        </div>
        <p class="meta">
          Import one saved Page collaboration bundle from a local path. Preview does not write
          files.
        </p>
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
            <div class="statePanel error">
              <b>Import failed</b>
              <p>{result.error}</p>
            </div>
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
    </div>
  );
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
    <div class="settingsGrid">
      <article class="settingsCard field wide">
        <div>
          <h3>Ghost import</h3>
          <span class="pill draft">Review first</span>
        </div>
        <p class="meta">
          Run a Ghost JSON, folder, or ZIP import from a local path. Preview does not write files.
        </p>
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
            <div class="statePanel error">
              <b>Import failed</b>
              <p>{result.error}</p>
            </div>
          ) : result?.summary ? (
            <GhostImportResultTable
              result={
                result as { mode?: string; target?: string; summary: Record<string, unknown> }
              }
            />
          ) : null}
        </div>
      </article>
    </div>
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

function SettingsCardsGrid({ cards, term }: { cards: SettingsCard[]; term: string }): JSX.Element {
  const q = term.toLowerCase();
  const filtered = cards.filter((card) =>
    `${card.section} ${card.title} ${card.summary} ${card.source} ${card.values.map((v) => `${v.label} ${v.value}`).join(' ')}`
      .toLowerCase()
      .includes(q),
  );
  return (
    <div class="settingsGrid" id="settingsCards">
      {filtered.length === 0 ? (
        <StatePanel kind="empty" message="No settings match this search." />
      ) : (
        filtered.map((card) => (
          <article class="settingsCard" key={card.id}>
            <div>
              <h3>{card.title}</h3>
              <span
                class={`pill ${card.status === 'warn' || card.status === 'danger' ? 'draft' : ''}`}
              >
                {card.section}
              </span>
            </div>
            <p class="meta">{card.summary}</p>
            <div class="slug">{card.source}</div>
            <table class="table">
              <tbody>
                {card.values.map((value) => (
                  <tr key={value.label}>
                    <th>{value.label}</th>
                    <td>{value.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {card.command ? <div class="meta">{card.command}</div> : null}
          </article>
        ))
      )}
    </div>
  );
}
