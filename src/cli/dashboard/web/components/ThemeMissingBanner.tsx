import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ThemeStatus } from '../types.ts';

interface ThemeMissingBannerProps {
  status: ThemeStatus | undefined;
}

// Global strip across the top of the shell that surfaces the same
// `Theme directory not found` error `loadTheme()` raises at build time.
// Mounted as a direct child of `.shell` (not inside `<main>`) so it spans
// the sidebar + content columns — otherwise the alert reads as a
// posts-scoped error. Dismissible for the current render but re-mounts on
// reload so the operator can't lose track of an unfixed misconfiguration.
// Persistence intentionally lives in component state, not
// session/localStorage — reloading the page is the recovery path when the
// operator vendors the theme.
//
// Side effect: publishes the rendered banner height as `--banner-height` on
// the document root so the sticky sidebar can shrink to `calc(100vh -
// var(--banner-height))` and keep its footer (Settings link) visible. The
// banner wraps on narrow widths so the height is observed live rather than
// hard-coded. Cleaned up to `0px` when the banner unmounts (dismissed or
// theme resolved) so the sidebar returns to full viewport height.
export function ThemeMissingBanner({ status }: ThemeMissingBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const visible = Boolean(status?.missing) && !dismissed;
  useEffect(() => {
    if (!visible) return;
    const node = bannerRef.current;
    if (!node) return;
    const root = document.documentElement;
    const publish = (height: number): void => {
      root.style.setProperty('--banner-height', `${height}px`);
    };
    publish(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        root.style.setProperty('--banner-height', '0px');
      };
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      publish(entry.contentRect.height);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.setProperty('--banner-height', '0px');
    };
  }, [visible]);
  if (!visible || !status) return null;
  const message = status.message ?? `Theme not found at ${status.expectedPath}.`;
  return (
    <div class="themeMissingBanner" role="alert" aria-live="polite" ref={bannerRef}>
      <span class="themeMissingBannerIcon" aria-hidden="true">
        ⚠
      </span>
      <div class="themeMissingBannerCopy">
        <p class="themeMissingBannerHeadline">{message}</p>
        <p class="themeMissingBannerHint">
          Download a Ghost-compatible theme into{' '}
          <code class="themeMissingBannerPath">{status.expectedPath}</code> to preview or build the
          site.{' '}
          <a class="themeMissingBannerLink" href="/settings/design">
            Open Design tab
          </a>
          {' · '}
          <a
            class="themeMissingBannerLink"
            href="https://ghost.org/themes/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Browse Ghost themes ↗
          </a>
        </p>
      </div>
      <button
        type="button"
        class="themeMissingBannerDismiss"
        aria-label="Dismiss theme missing alert"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
