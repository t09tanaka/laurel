import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { saveSiteSettings, saveThemeSettings } from '../lib/api.ts';
import type { DashboardState, SettingsCardSourceKind } from '../types.ts';

interface SettingsViewProps {
  state: DashboardState;
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onSiteDirtyChange: (dirty: boolean) => void;
  onThemeDirtyChange: (dirty: boolean) => void;
  onOpenMigration: () => void;
}

/* Dashboard surfaces only Site identity + Theme switcher. Everything
 * else (content paths, build config, structure/routes, operations,
 * advanced) lives in nectar.toml for developers to edit directly — it
 * doesn't belong in an editorial dashboard. */

const SOURCE_KIND_LABEL: Record<SettingsCardSourceKind, string> = {
  config: 'nectar.toml',
  theme: 'themes/',
  content: 'content/',
  runtime: 'runtime',
  cli: 'CLI',
  docs: 'docs/',
};

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const site = props.state.site;

  // With only two settings panels (Site identity + Theme) the dashboard
  // stacks them vertically in a single column. The category nav rail
  // and drawer that used to switch between many categories were dropped
  // when the category count fell to two.
  return (
    <div class="settingsLayout settingsLayoutStacked">
      <div class="settingsDetail">
        <SiteIdentityPanel
          state={props.state}
          site={site}
          onSettingsSaved={props.onSettingsSaved}
          onConflict={props.onConflict}
          onSiteDirtyChange={props.onSiteDirtyChange}
        />
        <ThemeSwitcherPanel
          state={props.state}
          onSettingsSaved={props.onSettingsSaved}
          onConflict={props.onConflict}
          onThemeDirtyChange={props.onThemeDirtyChange}
        />
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
          <p class="meta">Saved to the <code>[site]</code> section of nectar.toml.</p>
        </div>
        <SourcePill kind="config" label={SOURCE_KIND_LABEL.config} />
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
  return (
    <section class="themeSwitcherPanel" aria-label="Theme switcher">
      <header class="settingsPanelHead">
        <div>
          <h3>Active theme</h3>
          <p class="meta">
            Preview uses this theme immediately after saving; dist updates after the next build.
          </p>
        </div>
        <SourcePill kind="config" label={SOURCE_KIND_LABEL.config} />
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
    </section>
  );
}

function SourcePill({
  kind,
  label,
}: { kind: SettingsCardSourceKind | string; label: string }): JSX.Element {
  return (
    <span class={`sourcePill sourcePill-${kind}`} data-source={kind}>
      {label}
    </span>
  );
}

