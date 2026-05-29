import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

type ToastIntent = 'info' | 'success' | 'warn' | 'error';

interface ToastInput {
  intent?: ToastIntent;
  title?: string;
  message: string;
  duration?: number;
  /** Optional inline action (e.g. Undo). Runs `onClick`, then auto-dismisses
   * the toast. Kept to a single action to stay within the toast's footprint. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
  intent: ToastIntent;
}

export interface ToastApi {
  push: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
}

/**
 * Toast notification host. Hooks expose `push(toast)` to enqueue. Stack
 * renders bottom-right, newest on top, auto-dismiss after duration ms
 * (default 4000), click-to-dismiss any time.
 */
export function useToastHost(): { api: ToastApi; node: JSX.Element } {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((it) => it.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = idRef.current++;
      const item: ToastItem = { ...input, id, intent: input.intent ?? 'info' };
      setItems((list) => [...list, item]);
      const duration = input.duration ?? 4000;
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  const node = (
    <section class="toastHost" aria-label="Notifications">
      {items.map((item) => (
        <div
          key={item.id}
          class={`toast toast-${item.intent}`}
          role={item.intent === 'error' ? 'alert' : 'status'}
        >
          <div class="toastBody">
            {item.title ? <div class="toastTitle">{item.title}</div> : null}
            <div class="toastMessage">{item.message}</div>
          </div>
          {item.action ? (
            <button
              type="button"
              class="toastAction"
              onClick={() => {
                item.action?.onClick();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            class="toastClose"
            aria-label="Dismiss notification"
            onClick={() => dismiss(item.id)}
          >
            ×
          </button>
          {(item.duration ?? 4000) > 0 ? (
            <span
              class="toastProgress"
              style={{ animationDuration: `${item.duration ?? 4000}ms` }}
            />
          ) : null}
        </div>
      ))}
    </section>
  );

  return { api, node };
}
