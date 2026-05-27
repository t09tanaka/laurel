import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
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
export function ThemeMissingBanner({ status }: ThemeMissingBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (!status?.missing) return null;
  if (dismissed) return null;
  const message = status.message ?? `Theme not found at ${status.expectedPath}.`;
  return (
    <div class="themeMissingBanner" role="alert" aria-live="polite">
      <span class="themeMissingBannerIcon" aria-hidden="true">
        ⚠
      </span>
      <div class="themeMissingBannerCopy">
        <p class="themeMissingBannerHeadline">{message}</p>
        <p class="themeMissingBannerHint">
          Download a Ghost-compatible theme into{' '}
          <code class="themeMissingBannerPath">{status.expectedPath}</code> to preview or build the
          site.{' '}
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
