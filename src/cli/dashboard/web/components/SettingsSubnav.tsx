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
  { subview: 'site', label: 'Site', href: '/settings' },
  { subview: 'authors', label: 'Authors', href: '/authors' },
  { subview: 'tags', label: 'Tags', href: '/tags' },
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
