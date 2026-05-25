import type { ContentFingerprint } from '../types.ts';

export function fingerprintToken(fingerprint: ContentFingerprint): string {
  return [fingerprint.path, fingerprint.mtimeMs, fingerprint.size].join('@');
}

export function formatDate(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const diffH = Math.round(diffMs / 3_600_000);
  const diffD = Math.round(diffMs / 86_400_000);
  // Relative formatting for recent timestamps; absolute beyond a week.
  if (diffMs < 0 && diffMs > -86_400_000)
    return `in ${Math.abs(diffH) || 1}h`;
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 2) return 'yesterday';
  if (diffD < 7) return `${diffD}d ago`;
  // Older entries: "Jan 1, 2026" style — international and editorial.
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
