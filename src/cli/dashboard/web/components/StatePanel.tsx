import type { JSX } from 'preact';
import { type SurfaceState, surfaceCopy } from '../lib/view-head.ts';

interface StatePanelProps {
  kind: SurfaceState;
  message?: string;
  onAction?: () => void;
}

export function StatePanel({ kind, message, onAction }: StatePanelProps): JSX.Element {
  const copy = surfaceCopy(kind, message ? { message } : {});
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
