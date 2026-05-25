import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { saveSiteSettings, saveThemeSettings } from '../lib/api.ts';
import type {
  DashboardState,
  SettingsCard,
  SettingsCardCategory,
  SettingsCardMode,
  SettingsCardSourceKind,
} from '../types.ts';
import { StatePanel } from './StatePanel.tsx';

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

// Single source of truth for category ordering on the Site subview.
const SETTINGS_CARDS_ORDER: ReadonlyArray<SettingsCardCategory> = [
  'general',
  'content',
  'theme',
  'build',
  'structure',
  'operations',
  'advanced',
];

const CATEGORY_DEFINITIONS: Record<SettingsCardCategory, CategoryDefinition> = {
  general: { id: 'general', label: 'General', hint: 'Site identity and defaults you edit often.' },
  content: { id: 'content', label: 'Content', hint: 'Where Markdown content lives on disk.' },
  theme: { id: 'theme', label: 'Theme', hint: 'Active theme and design surface stats.' },
  build: { id: 'build', label: 'Build', hint: 'Output, URL shape, and generated surfaces.' },
  structure: {
    id: 'structure',
    label: 'Structure',
    hint: 'Navigation, redirects, and routes.',
  },
  operations: {
    id: 'operations',
    label: 'Operations',
    hint: 'Health checks, assets, bulk actions.',
  },
  advanced: {
    id: 'advanced',
    label: 'Advanced',
    hint: 'Rarely-touched, dangerous, or scope notes.',
  },
};

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
  const [searchTerm, setSearchTerm] = useState('');

  const cardsByCategory = useMemo(() => groupByCategory(settings.cards), [settings.cards]);
  const orderedCategories = useMemo(
    () => SETTINGS_CARDS_ORDER.filter((id) => cardsByCategory.has(id)),
    [cardsByCategory],
  );

  const trimmedSearch = searchTerm.trim().toLowerCase();
  const filteredByCategory = useMemo(() => {
    if (!trimmedSearch) return cardsByCategory;
    const next = new Map<SettingsCardCategory, SettingsCard[]>();
    for (const [category, cards] of cardsByCategory) {
      const matches = cards.filter((card) => matchesSearch(card, trimmedSearch));
      if (matches.length > 0) next.set(category, matches);
    }
    return next;
  }, [cardsByCategory, trimmedSearch]);

  const visibleCategories = useMemo(
    () => SETTINGS_CARDS_ORDER.filter((id) => filteredByCategory.has(id)),
    [filteredByCategory],
  );

  const totalMatches = useMemo(() => {
    if (!trimmedSearch) return null;
    let count = 0;
    for (const list of filteredByCategory.values()) count += list.length;
    return count;
  }, [filteredByCategory, trimmedSearch]);

  return (
    <div class="settingsLayout">
      <aside class="settingsCategoryNav" aria-label="Settings categories">
        <CategoryNav categories={orderedCategories} counts={cardsByCategory} />
      </aside>
      <div class="settingsDetail">
        <div class="panelHead settingsDetailHead">
          <div>
            <h2>Settings</h2>
            <span class="meta">
              {trimmedSearch
                ? `${totalMatches ?? 0} match${totalMatches === 1 ? '' : 'es'} across ${visibleCategories.length} categor${visibleCategories.length === 1 ? 'y' : 'ies'}`
                : `${orderedCategories.length} categor${orderedCategories.length === 1 ? 'y' : 'ies'} grouped by purpose`}
            </span>
          </div>
          <span class="settingsConfigPath" title="Active config">
            {settings.configPath}
          </span>
        </div>
        <label class="field settingsSearch">
          <span>Search settings</span>
          <input
            id="settingsSearch"
            placeholder="Press / to search across all settings"
            value={searchTerm}
            onInput={(event) => setSearchTerm((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        {trimmedSearch && visibleCategories.length === 0 ? (
          <StatePanel kind="empty" message={`No settings match "${searchTerm.trim()}".`} />
        ) : (
          visibleCategories.map((id) => {
            const def = CATEGORY_DEFINITIONS[id];
            const cards = filteredByCategory.get(id) ?? [];
            return (
              <CategorySection
                key={id}
                definition={def}
                cards={cards}
                editorial={
                  trimmedSearch
                    ? null
                    : renderEditorialFor(id, {
                        state: props.state,
                        site,
                        onSettingsSaved: props.onSettingsSaved,
                        onConflict: props.onConflict,
                        onSiteDirtyChange: props.onSiteDirtyChange,
                        onThemeDirtyChange: props.onThemeDirtyChange,
                        onOpenMigration: props.onOpenMigration,
                      })
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}

interface CategoryNavProps {
  categories: ReadonlyArray<SettingsCardCategory>;
  counts: Map<SettingsCardCategory, SettingsCard[]>;
}

function CategoryNav(props: CategoryNavProps): JSX.Element {
  return (
    <ul class="settingsCategoryList">
      {props.categories.map((id) => {
        const def = CATEGORY_DEFINITIONS[id];
        const count = props.counts.get(id)?.length ?? 0;
        return (
          <li key={id}>
            <a
              class="settingsCategoryItem"
              href={`#settings-category-${id}`}
              data-category={id}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(`settings-category-${id}`);
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            >
              <span class="settingsCategoryItemLabel">{def.label}</span>
              <span class="settingsCategoryItemCount">{count}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

interface CategorySectionProps {
  definition: CategoryDefinition;
  cards: SettingsCard[];
  editorial: JSX.Element | null;
}

function CategorySection(props: CategorySectionProps): JSX.Element {
  const { definition, cards, editorial } = props;
  return (
    <section
      class="settingsCategorySection"
      id={`settings-category-${definition.id}`}
      data-category={definition.id}
      aria-label={definition.label}
    >
      <header class="settingsCategoryHead">
        <div>
          <h3 class="settingsCategoryTitle">{definition.label}</h3>
          <p class="settingsCategoryHint meta">{definition.hint}</p>
        </div>
        <span class="settingsCategoryCount" title={`${cards.length} cards`}>
          {cards.length}
        </span>
      </header>
      {editorial}
      <SettingsCardsGrid cards={cards} />
    </section>
  );
}

interface EditorialContext {
  state: DashboardState;
  site: DashboardState['site'];
  onSettingsSaved: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onSiteDirtyChange: (dirty: boolean) => void;
  onThemeDirtyChange: (dirty: boolean) => void;
  onOpenMigration: () => void;
}

function renderEditorialFor(
  category: SettingsCardCategory,
  ctx: EditorialContext,
): JSX.Element | null {
  switch (category) {
    case 'general':
      return (
        <SiteIdentityPanel
          state={ctx.state}
          site={ctx.site}
          onSettingsSaved={ctx.onSettingsSaved}
          onConflict={ctx.onConflict}
          onSiteDirtyChange={ctx.onSiteDirtyChange}
        />
      );
    case 'theme':
      return (
        <ThemeSwitcherPanel
          state={ctx.state}
          onSettingsSaved={ctx.onSettingsSaved}
          onConflict={ctx.onConflict}
          onThemeDirtyChange={ctx.onThemeDirtyChange}
        />
      );
    case 'advanced':
      return <MigrationEntryCard onOpen={ctx.onOpenMigration} />;
    default:
      return null;
  }
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

function MigrationEntryCard({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <section class="migrationEntryCard" aria-label="Migration entry">
      <div>
        <h3>Migration</h3>
        <p class="meta">
          Ghost JSON/ZIP and Page bundle imports moved to a dedicated page. They write Markdown and
          assets — full-screen confirmation gates apply.
        </p>
      </div>
      <button type="button" class="btn" id="openMigrationPage" onClick={onOpen}>
        Open Migration page
      </button>
    </section>
  );
}

function SettingsCardsGrid({ cards }: { cards: SettingsCard[] }): JSX.Element {
  if (cards.length === 0) {
    return (
      <div class="settingsGrid" data-empty="true">
        <StatePanel kind="empty" message="No settings in this category." />
      </div>
    );
  }
  return (
    <div class="settingsGrid">
      {cards.map((card) => (
        <SettingsCardArticle key={card.id} card={card} />
      ))}
    </div>
  );
}

function SettingsCardArticle({ card }: { card: SettingsCard }): JSX.Element {
  const mode: SettingsCardMode = card.mode ?? 'read-only';
  return (
    <article
      class="settingsCard"
      data-category={card.category}
      data-source-kind={card.sourceKind}
      data-mode={mode}
    >
      <header class="settingsCardHead">
        <div>
          <h3>{card.title}</h3>
          <span class="settingsCardSection">{card.section}</span>
        </div>
        <span class={`pill ${modePillClass(mode, card.status)}`} data-mode={mode}>
          {modeLabel(mode)}
        </span>
      </header>
      <p class="meta">{card.summary}</p>
      <div class="settingsCardSource">
        <SourcePill kind={card.sourceKind} label={SOURCE_KIND_LABEL[card.sourceKind]} />
        <code class="settingsCardSourcePath" title={card.source}>
          {card.source}
        </code>
      </div>
      {card.values.length > 0 ? (
        <table class="table">
          <tbody>
            {card.values.map((value) => (
              <tr key={value.label} data-status={value.status ?? undefined}>
                <th>{value.label}</th>
                <td>{value.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {renderModeFooter(card, mode)}
    </article>
  );
}

function renderModeFooter(card: SettingsCard, mode: SettingsCardMode): JSX.Element | null {
  if (mode === 'editable') {
    return (
      <div class="settingsCardModeFoot" data-mode="editable">
        <span class="meta">Inline edits are surfaced above when supported.</span>
      </div>
    );
  }
  if (mode === 'cli-action' || mode === 'dangerous-cli-only') {
    if (!card.command) return null;
    return (
      <div class="settingsCardModeFoot" data-mode={mode}>
        <code class="settingsCardCommand">{card.command}</code>
        {mode === 'dangerous-cli-only' ? (
          <span class="settingsCardWarn">Destructive — confirm before running.</span>
        ) : null}
      </div>
    );
  }
  if (mode === 'scope-note') {
    return (
      <div class="settingsCardModeFoot" data-mode="scope-note">
        <span class="meta">Scope note — currently out of scope; tracked for reference.</span>
      </div>
    );
  }
  if (card.command) {
    return (
      <div class="settingsCardModeFoot" data-mode="read-only">
        <code class="settingsCardCommand">{card.command}</code>
      </div>
    );
  }
  return null;
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

function modeLabel(mode: SettingsCardMode): string {
  switch (mode) {
    case 'editable':
      return 'editable';
    case 'cli-action':
      return 'CLI action';
    case 'dangerous-cli-only':
      return 'dangerous · CLI';
    case 'scope-note':
      return 'scope note';
    case 'read-only':
      return 'read-only';
    default:
      return 'card';
  }
}

function modePillClass(mode: SettingsCardMode, status: string | undefined): string {
  if (mode === 'dangerous-cli-only') return 'draft';
  if (status === 'warn' || status === 'danger') return 'draft';
  return '';
}

function matchesSearch(card: SettingsCard, query: string): boolean {
  const haystack = `${card.section} ${card.title} ${card.summary} ${card.source} ${card.values
    .map((value) => `${value.label} ${value.value}`)
    .join(' ')}`.toLowerCase();
  return haystack.includes(query);
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
