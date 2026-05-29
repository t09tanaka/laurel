import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Modal } from './Modal.tsx';

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: 'default' | 'danger';
}

interface PendingRequest extends ConfirmRequest {
  resolve: (value: boolean) => void;
}

export interface ConfirmApi {
  ask: (request: ConfirmRequest) => Promise<boolean>;
}

/**
 * Promise-based confirm dialog host. Replaces native window.confirm() with
 * a modal that matches the dashboard's design language. Esc cancels, Enter
 * confirms, click outside cancels.
 */
export function useConfirmHost(): { api: ConfirmApi; node: JSX.Element } {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const ask = useCallback((request: ConfirmRequest): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ ...request, resolve });
    });
  }, []);

  const respond = useCallback((value: boolean) => {
    setPending((current) => {
      if (current) current.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    // Focus the cancel button by default for safety (Enter confirms, Esc cancels).
    const t = setTimeout(() => {
      (pending.intent === 'danger' ? cancelRef.current : confirmRef.current)?.focus();
    }, 0);
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        respond(false);
      } else if (event.key === 'Enter') {
        // Only auto-confirm on Enter when not focused inside a textarea/select.
        const target = event.target as HTMLElement | null;
        if (target?.matches('textarea, select, [contenteditable]')) return;
        event.preventDefault();
        respond(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, respond]);

  const api = useMemo<ConfirmApi>(() => ({ ask }), [ask]);

  // Modal keeps the panel mounted through its close animation and freezes the
  // last content, so the panel stays intact while `pending` clears on dismiss.
  const node = (
    <Modal open={pending !== null} onClose={() => respond(false)} backdropClass="confirmBackdrop">
      {pending ? (
        <div
          class={`confirmPanel ${pending.intent === 'danger' ? 'confirmPanel-danger' : ''}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirmTitle"
        >
          <h2 class="confirmTitle" id="confirmTitle">
            {pending.title}
          </h2>
          {pending.body ? <p class="confirmBody">{pending.body}</p> : null}
          <div class="confirmActions">
            <button
              type="button"
              class="btn secondary"
              ref={cancelRef}
              onClick={() => respond(false)}
            >
              {pending.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              class={`btn ${pending.intent === 'danger' ? 'btn-danger' : ''}`}
              ref={confirmRef}
              onClick={() => respond(true)}
            >
              {pending.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );

  return { api, node };
}
