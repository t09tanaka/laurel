import type { JSX } from 'preact';
import type { DashboardSettingsSubview } from '../types.ts';

interface SettingsSubnavProps {
  active: DashboardSettingsSubview;
  onNavigate: (target: DashboardSettingsSubview) => void;
}

interface Entry {
  subview: DashboardSettingsSubview;
  label: string;
  href: string;
}

const ENTRIES: ReadonlyArray<Entry> = [
  // "General" used to be a catch-all stacking site identity, theme, code
  // injection, authors, and tags. Split into four narrow surfaces so the
  // category in the subnav matches the category of the panel.
  { subview: 'site', label: 'Site', href: '/settings' },
  { subview: 'design', label: 'Design', href: '/settings/design' },
  { subview: 'integration', label: 'Integration', href: '/settings/integration' },
  { subview: 'migration', label: 'Migration', href: '/settings/migration' },
];

export function SettingsSubnav(props: SettingsSubnavProps): JSX.Element {
  return (
    <nav class="subnav" id="settingsSubnav" aria-label="Settings sections">
      {ENTRIES.map((entry) => {
        const active = entry.subview === props.active;
        const attrs: Record<string, string> = { 'data-subview': entry.subview };
        if (active) attrs['aria-current'] = 'page';
        return (
          <a
            key={entry.subview}
            href={entry.href}
            class={active ? 'active' : ''}
            {...attrs}
            onClick={(event) => {
              event.preventDefault();
              props.onNavigate(entry.subview);
            }}
          >
            {entry.label}
          </a>
        );
      })}
    </nav>
  );
}
