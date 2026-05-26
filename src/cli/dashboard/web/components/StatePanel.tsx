import type { JSX } from 'preact';
import { type SurfaceState, surfaceCopy } from '../lib/view-head.ts';

interface StatePanelProps {
  kind: SurfaceState;
  title?: string;
  message?: string;
  onAction?: () => void;
}

export function StatePanel({ kind, title, message, onAction }: StatePanelProps): JSX.Element {
  const overrides: Partial<{ title: string; message: string }> = {};
  if (title) overrides.title = title;
  if (message) overrides.message = message;
  const copy = surfaceCopy(kind, overrides);
  return (
    <output class={`statePanel ${kind}`}>
      <b>{copy.title}</b>
      <p>{copy.message}</p>
      {copy.actionLabel ? (
        <button
          class="btn secondary"
          type="button"
          data-state-action={kind === 'error' ? 'refresh' : kind}
          onClick={onAction}
        >
          {copy.actionLabel}
        </button>
      ) : null}
    </output>
  );
}
