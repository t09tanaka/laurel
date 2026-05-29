import { useEffect, useState } from 'preact/hooks';

export interface ModalTransition {
  /** Whether the overlay should be in the DOM at all. */
  mounted: boolean;
  /** Whether the exit animation is currently playing. */
  closing: boolean;
}

/**
 * Keeps a modal mounted long enough to play a close animation.
 *
 * Dashboard modals are conditionally rendered, so flipping `open` to false
 * normally rips the element out before any exit animation can run. This hook
 * holds the element for `durationMs` after close, exposing `closing` so the
 * caller can apply the reverse-motion class, then unmounts. The delay is
 * skipped under prefers-reduced-motion so dismissal stays instant.
 *
 * Keep `durationMs` in sync with the longest modal exit keyframe in
 * styles.css (`modalPanelOut`, 0.24s).
 */
export function useModalTransition(open: boolean, durationMs = 240): ModalTransition {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setMounted(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [open, durationMs]);

  return { mounted, closing };
}
