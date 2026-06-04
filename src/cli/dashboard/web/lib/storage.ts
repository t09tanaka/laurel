import type { DashboardContentItem, DraftPayload, RevisionPayload } from '../types.ts';
import { fingerprintToken } from './format.ts';

const DRAFT_PREFIX = 'laurel:dashboard:draft:';
const REVISION_PREFIX = 'laurel:dashboard:revision:';
const REVISION_LIMIT = 5;

function storageAreas(): Storage[] {
  const areas: Storage[] = [];
  try {
    if (typeof window !== 'undefined' && window.localStorage) areas.push(window.localStorage);
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) areas.push(window.sessionStorage);
  } catch {}
  return areas;
}

function safeSet(key: string, value: string): boolean {
  for (const area of storageAreas()) {
    try {
      area.setItem(key, value);
      return true;
    } catch {}
  }
  return false;
}

function safeRemove(key: string): void {
  for (const area of storageAreas()) {
    try {
      area.removeItem(key);
    } catch {}
  }
}

function readStoredJson<T>(key: string): T | null {
  for (const area of storageAreas()) {
    try {
      const raw = area.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {}
  }
  return null;
}

function keysWithPrefix(prefix: string): string[] {
  const keys = new Set<string>();
  for (const area of storageAreas()) {
    try {
      for (let i = 0; i < area.length; i += 1) {
        const key = area.key(i);
        if (key?.startsWith(prefix)) keys.add(key);
      }
    } catch {}
  }
  return [...keys];
}

export function draftKey(item: DashboardContentItem): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(item.path)}:${encodeURIComponent(fingerprintToken(item.fingerprint))}`;
}

export function revisionKey(item: DashboardContentItem): string {
  return `${REVISION_PREFIX}${encodeURIComponent(item.path)}`;
}

export function saveDraft(payload: DraftPayload): void {
  safeSet(
    `${DRAFT_PREFIX}${encodeURIComponent(payload.path)}:${encodeURIComponent(fingerprintToken(payload.fingerprint))}`,
    JSON.stringify(payload),
  );
}

export function clearDraftsForPath(path: string): void {
  const prefix = `${DRAFT_PREFIX}${encodeURIComponent(path)}:`;
  keysWithPrefix(prefix).forEach(safeRemove);
}

export function findLatestDraftForPath(path: string): DraftPayload | null {
  const prefix = `${DRAFT_PREFIX}${encodeURIComponent(path)}:`;
  const drafts = keysWithPrefix(prefix)
    .map((key) => readStoredJson<DraftPayload>(key))
    .filter((value): value is DraftPayload => Boolean(value));
  drafts.sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''));
  return drafts[0] ?? null;
}

export function appendRevision(item: DashboardContentItem, revision: RevisionPayload): void {
  const key = revisionKey(item);
  const existing = readStoredJson<RevisionPayload[]>(key) ?? [];
  existing.push(revision);
  safeSet(key, JSON.stringify(existing.slice(-REVISION_LIMIT)));
}

export function readRevisions(item: DashboardContentItem): RevisionPayload[] {
  const value = readStoredJson<RevisionPayload[]>(revisionKey(item));
  return Array.isArray(value) ? value : [];
}
