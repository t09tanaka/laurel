import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { saveSiteSettings, saveThemeSettings } from '../lib/api.ts';
import type {
  DashboardState,
  SettingsCard,
  SettingsCardCategory,
  SettingsCardSourceKind,
} from '../types.ts';

interface SettingsViewProps {
  state: DashboardState;
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onSiteDirtyChange: (dirty: boolean) => void;
  onThemeDirtyChange: (dirty: boolean) => void;
  onOpenMigration: () => void;
}

interface CategoryDefinition {
  id: SettingsCardCategory;
  label: string;
  hint: string;
}

/* Dashboard surfaces only the categories a writer actually touches:
 * site identity and theme. The other categories (content paths, build
 * config, structure/routes, operations, advanced) live in nectar.toml
 * for developers to edit directly — they don't belong in an editorial
 * dashboard. */
const CATEGORY_DEFINITIONS: ReadonlyArray<CategoryDefinition> = [
  { id: 'general', label: 'Site', hint: 'Site identity and defaults you edit often.' },
  { id: 'theme', label: 'Theme', hint: 'Active theme and design surface stats.' },
];

const SOURCE_KIND_LABEL: Record<SettingsCardSourceKind, string> = {
  config: 'nectar.toml',
  theme: 'themes/',
  content: 'content/',
  runtime: 'runtime',
  cli: 'CLI',
  docs: 'docs/',
};

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const settings = props.state.settings;
  const site = props.state.site;
  const [activeCategory, setActiveCategory] = useState<SettingsCardCategory>('general');

  const cardsByCategory = useMemo(() => groupByCategory(settings.cards), [settings.cards]);
  const categories = useMemo(
    () => CATEGORY_DEFINITIONS.filter((category) => cardsByCategory.has(category.id)),
    [cardsByCategory],
  );

  useEffect(() => {
    if (!cardsByCategory.has(activeCategory)) {
      const fallback = categories[0]?.id ?? 'general';
      setActiveCategory(fallback);
    }
  }, [cardsByCategory, categories, activeCategory]);

  const activeCategoryDef =
    CATEGORY_DEFINITIONS.find((category) => category.id === activeCategory) ??
    CATEGORY_DEFINITIONS[0];

  return (
    <div class="settingsLayout" data-active-category={activeCategory}>
      <details class="settingsCategoryDrawer">
        <summary>
          <span class="settingsCategoryDrawerLabel">{activeCategoryDef?.label ?? 'General'}</span>
          <span class="settingsCategoryDrawerHint">Tap to switch category</span>
        </summary>
        <CategoryNav
          categories={categories}
          activeCategory={activeCategory}
          onSelect={setActiveCategory}
          counts={cardsByCategory}
        />
      </details>
      <aside class="settingsCategoryNav" aria-label="Settings categories">
        <CategoryNav
          categories={categories}
          activeCategory={activeCategory}
          onSelect={setActiveCategory}
          counts={cardsByCategory}
        />
      </aside>
      <div class="settingsDetail">
        <div class="panelHead settingsDetailHead">
          <div>
            <h2>{activeCategoryDef?.label ?? 'Settings'}</h2>
            <span class="meta">{activeCategoryDef?.hint ?? settings.configPath}</span>
          </div>
          <span class="settingsConfigPath" title="Active config">
            {settings.configPath}
          </span>
        </div>
        {activeCategory === 'general' ? (
          <SiteIdentityPanel
            state={props.state}
            site={site}
            onSettingsSaved={props.onSettingsSaved}
            onConflict={props.onConflict}
            onSiteDirtyChange={props.onSiteDirtyChange}
          />
        ) : null}
        {activeCategory === 'theme' ? (
          <ThemeSwitcherPanel
            state={props.state}
            onSettingsSaved={props.onSettingsSaved}
            onConflict={props.onConflict}
            onThemeDirtyChange={props.onThemeDirtyChange}
          />
        ) : null}
        {/* Only general + theme surface in the dashboard now — their data
         * is fully rendered by the panels above. The card grid is no
         * longer needed. */}
      </div>
    </div>
  );
}

interface CategoryNavProps {
  categories: ReadonlyArray<CategoryDefinition>;
  activeCategory: SettingsCardCategory;
  onSelect: (category: SettingsCardCategory) => void;
  counts: Map<SettingsCardCategory, SettingsCard[]>;
}

function CategoryNav(props: CategoryNavProps): JSX.Element {
  return (
    <ul class="settingsCategoryList">
      {props.categories.map((category) => {
        const count = props.counts.get(category.id)?.length ?? 0;
        const isActive = category.id === props.activeCategory;
        return (
          <li key={category.id}>
            <button
              type="button"
              class={`settingsCategoryItem${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'true' : undefined}
              data-category={category.id}
              onClick={() => {
                props.onSelect(category.id);
                const drawer =
                  document.querySelector<HTMLDetailsElement>('.settingsCategoryDrawer');
                if (drawer?.open) drawer.open = false;
              }}
            >
              <span class="settingsCategoryItemLabel">{category.label}</span>
              <span class="settingsCategoryItemCount">{count}</span>
            </button>
          </li>
        );
      })}
    </ul>
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
          <p class="meta">Inline edits write straight to [site] in nectar.toml.</p>
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
          >
            Save site card
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

function groupByCategory(cards: SettingsCard[]): Map<SettingsCardCategory, SettingsCard[]> {
  const map = new Map<SettingsCardCategory, SettingsCard[]>();
  for (const card of cards) {
    const list = map.get(card.category);
    if (list) list.push(card);
    else map.set(card.category, [card]);
  }
  return map;
}
