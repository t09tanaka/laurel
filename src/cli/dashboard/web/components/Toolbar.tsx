import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface ToolbarProps {
  query: string;
  showNew: boolean;
  showFilter: boolean;
  onSearch: (value: string) => void;
  onNew: () => void;
  onOpenCmdk: () => void;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      ) {
        return;
      }
      event.preventDefault();
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="toolbar" aria-label="Dashboard tools">
      {props.showFilter ? (
        <>
          <label class="srOnly" for="search">
            Filter current view
          </label>
          <div class="searchWrap">
            <svg
              class="searchIcon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
              <line
                x1="10.4"
                y1="10.4"
                x2="13.5"
                y2="13.5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            <input
              class="search"
              id="search"
              ref={searchRef}
              placeholder="Filter"
              value={props.query}
              onInput={(event) => props.onSearch((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && props.query) {
                  event.preventDefault();
                  props.onSearch('');
                }
              }}
            />
            {props.query ? (
              <button
                type="button"
                class="searchClear"
                aria-label="Clear filter"
                onClick={() => {
                  props.onSearch('');
                  searchRef.current?.focus();
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <button
        type="button"
        class="cmdkTrigger"
        onClick={props.onOpenCmdk}
        title="Jump to a file or run a command"
        aria-label="Open command palette"
      >
        <svg
          class="cmdkIcon"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <line
            x1="10.4"
            y1="10.4"
            x2="13.5"
            y2="13.5"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
        <kbd>⌘</kbd>
        <kbd>K</kbd>
      </button>
      <button
        class={`btn${props.showNew ? '' : ' hidden'}`}
        id="newItem"
        onClick={props.onNew}
        type="button"
      >
        <span class="btnIcon" aria-hidden="true">+</span>
        <span>New</span>
      </button>
    </div>
  );
}
