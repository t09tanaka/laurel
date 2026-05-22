import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentSourceFingerprint } from './model.ts';

export type ApprovalKind = 'pages';
export type ApprovalStatus = 'approved' | 'needs-approval' | 'stale';

export interface ApprovalReceipt {
  kind: ApprovalKind;
  slug: string;
  path: string;
  fingerprint: ContentSourceFingerprint;
  approvedAt: string;
  approvedBy: string;
  source: 'dashboard';
}

export interface ApprovalState {
  status: ApprovalStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  path: string;
  snapshotPath: string | null;
}

export interface ApprovalBuildGate {
  mode: 'current' | 'snapshot' | 'skip';
  receipt: ApprovalReceipt | null;
  snapshotMarkdown?: string;
}

export function approvalDir(cwd: string, kind: ApprovalKind): string {
  return join(cwd, '.nectar', 'approvals', kind);
}

export function approvalReceiptPath(cwd: string, kind: ApprovalKind, slug: string): string {
  return join(approvalDir(cwd, kind), `${slug}.json`);
}

export function approvalSnapshotPath(cwd: string, kind: ApprovalKind, slug: string): string {
  return join(approvalDir(cwd, kind), `${slug}.md`);
}

export function sameContentFingerprint(
  a: ContentSourceFingerprint | null | undefined,
  b: ContentSourceFingerprint | null | undefined,
): boolean {
  return (
    a !== undefined &&
    a !== null &&
    b !== undefined &&
    b !== null &&
    a.path === b.path &&
    a.mtimeMs === b.mtimeMs &&
    a.size === b.size
  );
}

export async function readApprovalReceipt(
  cwd: string,
  kind: ApprovalKind,
  slug: string,
): Promise<ApprovalReceipt | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(approvalReceiptPath(cwd, kind, slug), 'utf8'),
    );
    return isApprovalReceipt(parsed, kind, slug) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readApprovalState({
  cwd,
  kind,
  slug,
  path,
  fingerprint,
}: {
  cwd: string;
  kind: ApprovalKind;
  slug: string;
  path: string;
  fingerprint: ContentSourceFingerprint | null;
}): Promise<ApprovalState> {
  const receipt = await readApprovalReceipt(cwd, kind, slug);
  const snapshotPath = approvalSnapshotRelativePath(kind, slug, 'md');
  if (!receipt || receipt.path !== path) {
    return {
      status: 'needs-approval',
      approvedAt: null,
      approvedBy: null,
      path,
      snapshotPath: null,
    };
  }
  return {
    status: sameContentFingerprint(receipt.fingerprint, fingerprint) ? 'approved' : 'stale',
    approvedAt: receipt.approvedAt,
    approvedBy: receipt.approvedBy,
    path,
    snapshotPath,
  };
}

export async function writeApprovalReceipt({
  cwd,
  kind,
  slug,
  path,
  fingerprint,
  approvedBy,
  markdown,
  now = new Date(),
}: {
  cwd: string;
  kind: ApprovalKind;
  slug: string;
  path: string;
  fingerprint: ContentSourceFingerprint;
  approvedBy?: string;
  markdown: string;
  now?: Date;
}): Promise<{ receipt: ApprovalReceipt; changedPath: string; snapshotPath: string }> {
  const dir = approvalDir(cwd, kind);
  await mkdir(dir, { recursive: true });
  const receipt: ApprovalReceipt = {
    kind,
    slug,
    path,
    fingerprint,
    approvedAt: now.toISOString(),
    approvedBy: normalizeApprover(approvedBy),
    source: 'dashboard',
  };
  const snapshot = approvalSnapshotPath(cwd, kind, slug);
  const receiptPath = approvalReceiptPath(cwd, kind, slug);
  await writeFile(snapshot, markdown, 'utf8');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return {
    receipt,
    changedPath: approvalSnapshotRelativePath(kind, slug, 'json'),
    snapshotPath: approvalSnapshotRelativePath(kind, slug, 'md'),
  };
}

export async function resolveApprovalBuildGate({
  cwd,
  kind,
  slug,
  path,
  fingerprint,
}: {
  cwd: string;
  kind: ApprovalKind;
  slug: string;
  path: string;
  fingerprint: ContentSourceFingerprint;
}): Promise<ApprovalBuildGate> {
  const receipt = await readApprovalReceipt(cwd, kind, slug);
  if (!receipt || receipt.path !== path) return { mode: 'skip', receipt: null };
  if (sameContentFingerprint(receipt.fingerprint, fingerprint)) return { mode: 'current', receipt };
  try {
    return {
      mode: 'snapshot',
      receipt,
      snapshotMarkdown: await readFile(approvalSnapshotPath(cwd, kind, slug), 'utf8'),
    };
  } catch {
    return { mode: 'skip', receipt };
  }
}

function approvalSnapshotRelativePath(
  kind: ApprovalKind,
  slug: string,
  ext: 'json' | 'md',
): string {
  return `.nectar/approvals/${kind}/${slug}.${ext}`;
}

function normalizeApprover(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Dashboard';
}

function isApprovalReceipt(
  value: unknown,
  kind: ApprovalKind,
  slug: string,
): value is ApprovalReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<ApprovalReceipt>;
  return (
    receipt.kind === kind &&
    receipt.slug === slug &&
    typeof receipt.path === 'string' &&
    typeof receipt.approvedAt === 'string' &&
    typeof receipt.approvedBy === 'string' &&
    receipt.source === 'dashboard' &&
    isFingerprint(receipt.fingerprint)
  );
}

function isFingerprint(value: unknown): value is ContentSourceFingerprint {
  if (!value || typeof value !== 'object') return false;
  const fingerprint = value as Partial<ContentSourceFingerprint>;
  return (
    typeof fingerprint.path === 'string' &&
    typeof fingerprint.mtimeMs === 'number' &&
    typeof fingerprint.size === 'number'
  );
}
