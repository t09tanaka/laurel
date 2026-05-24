import type { JSX } from 'preact';

interface ToolbarProps {
  query: string;
  showNew: boolean;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onNew: () => void;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div class="toolbar" aria-label="Dashboard tools">
      <label class="srOnly" for="search">
        Filter current view
      </label>
      <input
        class="search"
        id="search"
        placeholder="Filter current view"
        value={props.query}
        onInput={(event) => props.onSearch((event.currentTarget as HTMLInputElement).value)}
      />
      <button class="btn secondary" id="refresh" onClick={props.onRefresh} type="button">
        Refresh
      </button>
      <button
        class="btn"
        id="newItem"
        onClick={props.onNew}
        type="button"
        style={props.showNew ? undefined : 'display:none'}
      >
        New
      </button>
    </div>
  );
}
