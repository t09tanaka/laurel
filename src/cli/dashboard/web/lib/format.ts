import type { ContentFingerprint } from '../types.ts';

export function fingerprintToken(fingerprint: ContentFingerprint): string {
  return [fingerprint.path, fingerprint.mtimeMs, fingerprint.size].join('@');
}

// Single formatter used everywhere a date appears in the dashboard.
// Until #523 adds a locale switcher we follow navigator.language so
// the relative ("6 days ago" / "6日前") and absolute ("Jan 1, 2026" /
// "2026年1月1日") halves at least stay in the same language. Cached
// because Intl constructors are non-trivial.
const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const ABS_FMT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function formatDate(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const min = Math.round(diffMs / 60_000);
  const hour = Math.round(diffMs / 3_600_000);
  const day = Math.round(diffMs / 86_400_000);
  if (absMs < 60_000) return RTF.format(0, 'second');
  if (absMs < 3_600_000) return RTF.format(min, 'minute');
  if (absMs < 86_400_000) return RTF.format(hour, 'hour');
  if (absMs < 7 * 86_400_000) return RTF.format(day, 'day');
  return ABS_FMT.format(date);
}

export function matches(text: string, query: string): boolean {
  return !query || String(text).toLowerCase().includes(query);
}

export function normalizeMediaPath(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw;
  return `/${raw.replace(/^\.?\//, '')}`;
}
