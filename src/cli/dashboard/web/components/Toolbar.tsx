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
        <kbd>⌘</kbd>
        <kbd>K</kbd>
      </button>
      <button
        class={`btn${props.showNew ? '' : ' hidden'}`}
        id="newItem"
        onClick={props.onNew}
        type="button"
      >
        New
      </button>
    </div>
  );
}
