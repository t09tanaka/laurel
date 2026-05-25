import { describe, expect, it } from 'bun:test';
import { formatDate } from '../../../src/cli/dashboard/web/lib/format.ts';

describe('formatDate', () => {
  it('returns empty for invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('');
  });

  it('formats a "just now" value via Intl.RelativeTimeFormat', () => {
    const out = formatDate(new Date());
    // Intl output varies by locale ("now", "just now", "今"). Just
    // confirm it's a non-empty short string and not the old
    // hard-coded "0m ago".
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/^\d+m ago$/);
  });

  it('uses a relative form for sub-week deltas', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000);
    const out = formatDate(sixDaysAgo);
    // Should NOT be an absolute date (no four-digit year).
    expect(out).not.toMatch(/\b\d{4}\b/);
  });

  it('uses an absolute form once a week has passed', () => {
    const monthAgo = new Date(Date.now() - 30 * 86_400_000);
    const out = formatDate(monthAgo);
    // Absolute date should contain a four-digit year for any locale
    // Intl.DateTimeFormat ships (en, ja, etc.).
    expect(out).toMatch(/\d{4}/);
  });
});
