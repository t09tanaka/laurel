import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export interface CommandItem {
  id: string;
  kind: 'navigate' | 'open' | 'action';
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
}

/**
 * Modern admin command palette. Opens with ⌘K (registered at the app
 * level). Filters items by case-insensitive prefix + substring match.
 * Keyboard nav: ↑/↓ to move, Enter to run, Esc to close.
 */
export function CommandPalette({ open, items, onClose }: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Reset query + selection on every open so palette starts fresh.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Filter by simple lowercase substring across label + hint + keywords.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const hay = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  // Clamp active selection to filtered length.
  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [filtered.length, active]);

  // Scroll the active item into view when it changes.
  useEffect(() => {
    if (!open) return;
    const root = listRef.current;
    if (!root) return;
    const el = root.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[active];
      if (item) {
        onClose();
        item.run();
      }
    }
  }

  return (
    <div
      class="cmdkBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        class="cmdkPanel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        <div class="cmdkHeader">
          <input
            ref={inputRef}
            class="cmdkInput"
            type="text"
            placeholder="Jump to a file or run a command…"
            value={query}
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          />
          <kbd class="cmdkEsc">Esc</kbd>
        </div>
        <ul class="cmdkList" ref={listRef}>
          {filtered.length === 0 ? (
            <li class="cmdkEmpty">No matches</li>
          ) : (
            filtered.map((item, i) => (
              <li
                key={item.id}
                class={`cmdkItem ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onClose();
                  item.run();
                }}
              >
                <span class={`cmdkKind cmdkKind-${item.kind}`} aria-hidden="true">
                  {item.kind === 'open' ? '↗' : item.kind === 'navigate' ? '→' : '✦'}
                </span>
                <span class="cmdkLabel">{item.label}</span>
                {item.hint ? <span class="cmdkHint">{item.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
        <div class="cmdkFooter">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
