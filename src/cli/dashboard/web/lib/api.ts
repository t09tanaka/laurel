import type {
  ContentFingerprint,
  DashboardContentItem,
  DashboardEditorKind,
  DashboardState,
} from '../types.ts';

const TOKEN_META_NAME = 'nectar-dashboard-token';

function readToken(): string {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META_NAME}"]`);
  return meta?.content ?? '';
}

const TOKEN = readToken();

function writeHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-nectar-dashboard-token': TOKEN,
  };
}

export interface FetchStateOptions {
  postsPage: number;
  pagesPage: number;
  perPage?: number;
  query?: string;
  statusFilter?: string;
}

export async function fetchDashboardState(opts: FetchStateOptions): Promise<DashboardState> {
  const params = new URLSearchParams({
    posts_page: String(opts.postsPage),
    pages_page: String(opts.pagesPage),
    per_page: String(opts.perPage ?? 12),
  });
  if (opts.query) params.set('search', opts.query);
  if (opts.statusFilter) params.set('status', opts.statusFilter);
  const response = await fetch(`/api/state?${params}`);
  if (!response.ok) throw new Error(`State request failed with ${response.status}`);
  return (await response.json()) as DashboardState;
}

export async function fetchContent(
  kind: DashboardEditorKind,
  slug: string,
): Promise<DashboardContentItem> {
  const response = await fetch(`/api/content/${kind}/${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(`Could not open ${slug}`);
  return (await response.json()) as DashboardContentItem;
}

export type SaveContentResult =
  | { ok: true; fingerprint: ContentFingerprint; changedPath: string }
  | {
      ok: false;
      reason: 'conflict';
      current: DashboardContentItem;
      conflict: unknown;
      changedPath: string;
    }
  | { ok: false; reason: string; error?: string };

export async function saveContent(args: {
  kind: DashboardEditorKind;
  slug: string;
  fingerprint: ContentFingerprint;
  frontmatter: Record<string, unknown>;
  body: string;
}): Promise<{ status: number; data: SaveContentResult }> {
  const response = await fetch(`/api/content/${args.kind}/${encodeURIComponent(args.slug)}`, {
    method: 'PUT',
    headers: writeHeaders(),
    body: JSON.stringify({
      fingerprint: args.fingerprint,
      frontmatter: args.frontmatter,
      body: args.body,
    }),
  });
  return { status: response.status, data: (await response.json()) as SaveContentResult };
}

export async function approvePage(args: {
  slug: string;
  fingerprint: ContentFingerprint;
}): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`/api/approvals/pages/${encodeURIComponent(args.slug)}`, {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ fingerprint: args.fingerprint }),
  });
  return { status: response.status, data: await response.json() };
}

export async function materializeTaxonomy(
  kind: 'authors' | 'tags',
  slug: string,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`/api/taxonomy/${kind}/${slug}/file`, {
    method: 'POST',
    headers: writeHeaders(),
  });
  return { status: response.status, data: await response.json() };
}

export interface CreateItemPayload {
  kind: DashboardEditorKind;
  title: string;
}

export async function createItem(payload: CreateItemPayload): Promise<{
  status: number;
  data: { kind: DashboardEditorKind; slug: string; path: string; error?: string };
}> {
  const response = await fetch('/api/content', {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    data: (await response.json()) as {
      kind: DashboardEditorKind;
      slug: string;
      path: string;
      error?: string;
    },
  };
}

export async function saveSiteSettings(args: {
  fingerprint: ContentFingerprint;
  updates: Record<string, unknown>;
}): Promise<{
  status: number;
  data: { ok?: boolean; fingerprint?: ContentFingerprint; error?: string };
}> {
  const response = await fetch('/api/settings/site', {
    method: 'PATCH',
    headers: writeHeaders(),
    body: JSON.stringify(args),
  });
  return { status: response.status, data: await response.json() };
}

export async function saveThemeSettings(args: {
  fingerprint: ContentFingerprint;
  updates: Record<string, unknown>;
}): Promise<{
  status: number;
  data: { ok?: boolean; fingerprint?: ContentFingerprint; error?: string };
}> {
  const response = await fetch('/api/settings/theme', {
    method: 'PATCH',
    headers: writeHeaders(),
    body: JSON.stringify(args),
  });
  return { status: response.status, data: await response.json() };
}

export interface GhostImportPayload {
  file: string;
  dryRun: boolean;
  onConflict: 'skip' | 'rename' | 'overwrite';
  outputDir?: string;
}

export async function importGhost(
  payload: GhostImportPayload,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch('/api/import/ghost', {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json() };
}

export interface PageBundleImportPayload {
  file: string;
  dryRun: boolean;
  onConflict: 'skip' | 'rename' | 'overwrite';
}

export async function importPageBundle(
  payload: PageBundleImportPayload,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch('/api/page-bundles/import', {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json() };
}

export async function exportPageBundle(slug: string): Promise<unknown> {
  const response = await fetch(`/api/page-bundles/export/${encodeURIComponent(slug)}`);
  const data = await response.json();
  if (!response.ok)
    throw new Error((data as { error?: string }).error ?? 'Could not export page bundle');
  return data;
}
