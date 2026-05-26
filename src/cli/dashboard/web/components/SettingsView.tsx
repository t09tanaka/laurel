import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { DashboardSettingsSubview } from '../../ui-state.ts';
import { saveSiteSettings, saveThemeSettings, uploadTheme } from '../lib/api.ts';
import type { DashboardState } from '../types.ts';

interface SettingsViewProps {
  state: DashboardState;
  subview: DashboardSettingsSubview;
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onSiteDirtyChange: (dirty: boolean) => void;
  onThemeDirtyChange: (dirty: boolean) => void;
  onCodeInjectionDirtyChange: (dirty: boolean) => void;
}

/* Dashboard surfaces only Site identity, Theme switcher, and Code
 * injection. Everything else (content paths, build config, structure /
 * routes, operations, advanced) lives in nectar.toml for developers to
 * edit directly — it doesn't belong in an editorial dashboard.
 *
 * Settings is split into four narrow subviews so the IA matches the
 * category of what each panel saves:
 *   - Site         → SiteIdentityPanel (title, URL, accent, description)
 *   - Design       → ThemeSwitcherPanel (active theme + upload)
 *   - Integration  → CodeInjectionPanel (GA4, custom <meta>, widgets)
 *   - Migration    → handled by MigrationView upstream, not this component
 *
 * Code injection is an exception to the editorial-restraint default
 * because dropping a GA4 / analytics snippet is a routine operator
 * task that doesn't justify hand-editing TOML. See issue #533 for the
 * scope decision. */

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const site = props.state.site;

  return (
    <div class="settingsLayout settingsLayoutStacked">
      <div class="settingsDetail">
        {props.subview === 'site' ? (
          <SiteIdentityPanel
            state={props.state}
            site={site}
            onSettingsSaved={props.onSettingsSaved}
            onConflict={props.onConflict}
            onSiteDirtyChange={props.onSiteDirtyChange}
          />
        ) : null}
        {props.subview === 'design' ? (
          <ThemeSwitcherPanel
            state={props.state}
            onSettingsSaved={props.onSettingsSaved}
            onConflict={props.onConflict}
            onThemeDirtyChange={props.onThemeDirtyChange}
          />
        ) : null}
        {props.subview === 'integration' ? (
          <CodeInjectionPanel
            state={props.state}
            site={site}
            onSettingsSaved={props.onSettingsSaved}
            onConflict={props.onConflict}
            onCodeInjectionDirtyChange={props.onCodeInjectionDirtyChange}
          />
        ) : null}
      </div>
    </div>
  );
}

interface SiteIdentityProps {
  state: DashboardState;
  site: DashboardState['site'];
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onSiteDirtyChange: (dirty: boolean) => void;
}

function SiteIdentityPanel(props: SiteIdentityProps): JSX.Element {
  const { site } = props;
  const settings = props.state.settings;
  const [setTitle, setSetTitle] = useState(site.title);
  const [setAccent, setSetAccent] = useState(site.accentColor);
  const [setDescription, setSetDescription] = useState(site.description);
  const [setUrl, setSetUrl] = useState(site.url);
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
    <section class="siteIdentityPanel" aria-label="Site identity inline edit">
      <header class="settingsPanelHead">
        <div>
          <h3>Site identity</h3>
          <p class="meta">
            Saved to the <code>[site]</code> section of nectar.toml.
          </p>
        </div>
      </header>
      <div class="settingsGrid siteIdentityGrid">
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
        <div class="field wide siteIdentityActions">
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
            title={siteSettingsDirty ? 'Save site identity to nectar.toml' : 'No changes to save'}
          >
            Save changes
          </button>
        </div>
      </div>
    </section>
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
  const [uploadOpen, setUploadOpen] = useState(false);
  return (
    <section class="themeSwitcherPanel" aria-label="Themes">
      <header class="settingsPanelHead">
        <div>
          <h3>Themes</h3>
          <p class="meta">
            Preview uses this theme immediately after saving; dist updates after the next build.
          </p>
        </div>
        <button type="button" class="btn secondary btnCompact" onClick={() => setUploadOpen(true)}>
          Upload
        </button>
      </header>
      <article class="settingsCard field wide">
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
            title={
              !dirty
                ? 'No changes to save'
                : !selected
                  ? 'Pick a theme first'
                  : 'Save the active theme to nectar.toml'
            }
          >
            Save changes
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
              : null}
        </div>
      </article>
      {uploadOpen ? (
        <ThemeUploadModal
          themeDir={theme.dir ?? 'themes'}
          onClose={() => setUploadOpen(false)}
          onUploaded={async () => {
            await props.onSettingsSaved();
          }}
        />
      ) : null}
    </section>
  );
}

interface ThemeUploadModalProps {
  themeDir: string;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
}

function ThemeUploadModal({ themeDir, onClose, onUploaded }: ThemeUploadModalProps): JSX.Element {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Esc closes; focus is delegated to the file input.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function handleFile(file: File) {
    if (busy) return;
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    const result = await uploadTheme(file);
    setBusy(false);
    if (!result.ok) {
      setStatus(`Upload failed: ${result.error}`);
      return;
    }
    setStatus(`Installed "${result.name}" under ${themeDir}/`);
    await onUploaded();
    // brief acknowledgement, then close
    setTimeout(() => onClose(), 700);
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
      <dialog class="modalDialog" aria-modal="true" aria-label="Upload theme" open>
        <header class="modalHead">
          <h3>Upload theme</h3>
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
          Drop a Ghost-compatible theme .zip; it extracts into <code>{themeDir}/</code> and becomes
          selectable in the Theme list.
        </p>
        <label
          class={`themeUploadDrop${busy ? ' busy' : ''}`}
          onDragOver={(event) => {
            if (event.dataTransfer?.types?.includes('Files')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(event) => {
            const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
              /\.zip$/i.test(f.name),
            );
            if (!file) return;
            event.preventDefault();
            void handleFile(file);
          }}
        >
          <input
            type="file"
            accept=".zip,application/zip"
            class="srOnly"
            disabled={busy}
            onChange={(event) => {
              const file = (event.currentTarget as HTMLInputElement).files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <span class="themeUploadHint">{busy ? 'Uploading…' : 'Click or drop a .zip'}</span>
        </label>
        {status ? (
          <output class="notice" aria-live="polite">
            {status}
          </output>
        ) : null}
      </dialog>
    </div>
  );
}

interface CodeInjectionProps {
  state: DashboardState;
  site: DashboardState['site'];
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onCodeInjectionDirtyChange: (dirty: boolean) => void;
}

/* Site-wide Code Injection panel — issue #533.
 *
 * Mirrors Ghost's "Code injection" admin surface: a header textarea
 * splices into {{ghost_head}} on every page, a footer textarea splices
 * before </body>. Storage lands in `[site].codeinjection_head` /
 * `[site].codeinjection_foot` of nectar.toml.
 *
 * `build.allow_code_injection` is an explicit checkbox — NOT auto-flipped
 * from head/foot non-emptiness — because the same gate also activates
 * per-post `codeinjection_head` / `codeinjection_foot` frontmatter (see
 * src/content/loader.ts §asRawCodeInjection). If a content contributor
 * had previously merged a malicious frontmatter snippet while the gate
 * was off, silently flipping it on for an operator-initiated GA save
 * would suddenly ship that snippet. The checkbox makes the operator
 * acknowledge that consequence before the snippets actually run. */
function CodeInjectionPanel(props: CodeInjectionProps): JSX.Element {
  const { site } = props;
  const settings = props.state.settings;
  const [head, setHead] = useState(site.codeinjectionHead);
  const [foot, setFoot] = useState(site.codeinjectionFoot);
  const [enabled, setEnabled] = useState(site.allowCodeInjection);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: parent state callback is stable
  useEffect(() => {
    setHead(site.codeinjectionHead);
    setFoot(site.codeinjectionFoot);
    setEnabled(site.allowCodeInjection);
    setDirty(false);
    props.onCodeInjectionDirtyChange(false);
  }, [site.codeinjectionHead, site.codeinjectionFoot, site.allowCodeInjection]);

  function markDirty(): void {
    setDirty(true);
    props.onCodeInjectionDirtyChange(true);
  }

  function bindTextarea(setter: (value: string) => void): (event: Event) => void {
    return (event) => {
      setter((event.currentTarget as HTMLTextAreaElement).value);
      markDirty();
    };
  }

  function handleEnabledToggle(event: Event): void {
    setEnabled((event.currentTarget as HTMLInputElement).checked);
    markDirty();
  }

  async function handleSave() {
    const updates = {
      codeinjection_head: head,
      codeinjection_foot: foot,
      allow_code_injection: enabled,
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
      setNotice(data.error ?? 'Could not save code injection');
      return;
    }
    setDirty(false);
    props.onCodeInjectionDirtyChange(false);
    setNotice('Saved to nectar.toml.');
    await props.onSettingsSaved();
  }

  const hasSnippet = head.length > 0 || foot.length > 0;
  return (
    <section class="codeInjectionPanel" aria-label="Code injection">
      <header class="settingsPanelHead">
        <div>
          <h3>Code injection</h3>
          <p class="meta">
            Raw HTML spliced into the Ghost theme's <code>{'{{ghost_head}}'}</code> and{' '}
            <code>{'{{ghost_foot}}'}</code> helpers on every page. Saved to the <code>[site]</code>{' '}
            section of nectar.toml as <code>codeinjection_head</code> /{' '}
            <code>codeinjection_foot</code>. Values are emitted verbatim — operators are responsible
            for what they paste. Enabling also activates per-post <code>codeinjection_head</code> /{' '}
            <code>codeinjection_foot</code> frontmatter, so only enable if every contributor with
            write access to <code>content/</code> is trusted to add arbitrary HTML or JS.
          </p>
        </div>
      </header>
      <div class="settingsGrid">
        <label class="field wide">
          <span>Site header</span>
          <textarea
            id="codeInjectionHead"
            class="codeInjectionTextarea"
            rows={10}
            spellcheck={false}
            placeholder="<!-- e.g. Google Analytics, custom <meta>, third-party <link> --><script async src=&quot;https://www.googletagmanager.com/gtag/js?id=G-XXXX&quot;></script>"
            value={head}
            onInput={bindTextarea(setHead)}
          />
        </label>
        <label class="field wide">
          <span>Site footer</span>
          <textarea
            id="codeInjectionFoot"
            class="codeInjectionTextarea"
            rows={6}
            spellcheck={false}
            placeholder="<!-- e.g. Plausible, Fathom, chat widgets that load before </body> -->"
            value={foot}
            onInput={bindTextarea(setFoot)}
          />
        </label>
        <label class="field wide codeInjectionGate">
          <input
            type="checkbox"
            id="codeInjectionEnabled"
            checked={enabled}
            onChange={handleEnabledToggle}
          />
          <span>Enable code injection</span>
        </label>
        {hasSnippet && !enabled ? (
          <p class="meta wide codeInjectionGateNote">
            <strong>The saved snippets will not run until this is checked.</strong>
          </p>
        ) : null}
        <div class="field wide siteIdentityActions">
          <output id="codeInjectionNotice" class="notice">
            {notice}
          </output>
          <button
            class="btn"
            id="saveCodeInjection"
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!dirty}
            title={dirty ? 'Save code injection to nectar.toml' : 'No changes to save'}
          >
            Save changes
          </button>
        </div>
      </div>
    </section>
  );
}
