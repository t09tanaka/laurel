import type { ContentFingerprint } from '../types.ts';

export function fingerprintToken(fingerprint: ContentFingerprint): string {
  return [fingerprint.path, fingerprint.mtimeMs, fingerprint.size].join('@');
}

export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString();
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
