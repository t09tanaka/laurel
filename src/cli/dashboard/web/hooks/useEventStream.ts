import { useEffect } from 'preact/hooks';

export function useEventStream(onSync: () => void): void {
  useEffect(() => {
    const source = new EventSource('/api/events');
    const handler = () => onSync();
    source.addEventListener('sync', handler);
    return () => {
      source.removeEventListener('sync', handler);
      source.close();
    };
  }, [onSync]);
}
