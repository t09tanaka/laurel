import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ThemeStatus } from '../types.ts';

interface ThemeMissingBannerProps {
  status: ThemeStatus | undefined;
}

// Top-of-dashboard alert that surfaces the same `Theme directory not found`
// error `loadTheme()` raises at build time. Dismissible for the current
// render but re-mounts on reload so the operator can't lose track of an
// unfixed misconfiguration. Persistence intentionally lives in component
// state, not session/localStorage — reloading the page is the recovery path
// when the operator vendors the theme.
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
        {status.hint ? <p class="themeMissingBannerHint">{status.hint}</p> : null}
        {status.cloneCommand ? (
          <pre class="themeMissingBannerCommand">
            <code>{status.cloneCommand}</code>
          </pre>
        ) : null}
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
