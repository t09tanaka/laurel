import { useEffect, useRef } from 'preact/hooks';

/**
 * Subscribe to /api/events 'sync' messages and call `onSync` for each.
 *
 * The callback identity changes on most parent renders (it usually closes over
 * dirty flags or other UI state), but the EventSource must persist for the
 * lifetime of the component — reconnecting on every keystroke produces a flood
 * of HTTP requests and races server-sent events. Keeping the latest callback
 * in a ref and re-entering useEffect only on mount/unmount keeps the stream
 * stable while still firing the freshest handler when an event arrives.
 */
export function useEventStream(onSync: () => void): void {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  useEffect(() => {
    const source = new EventSource('/api/events');
    const handler = () => onSyncRef.current();
    source.addEventListener('sync', handler);
    return () => {
      source.removeEventListener('sync', handler);
      source.close();
    };
  }, []);
}
