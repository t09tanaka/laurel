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

export async function renameContentSlug(args: {
  kind: DashboardEditorKind;
  oldSlug: string;
  newSlug: string;
  fingerprint: ContentFingerprint;
  redirect?: boolean;
}): Promise<
  | { ok: true; newSlug: string; newPath: string; fingerprint: ContentFingerprint }
  | { ok: false; reason: string; error?: string }
> {
  const url = `/api/content/${args.kind}/${encodeURIComponent(args.oldSlug)}/rename`;
  const res = await fetch(url, {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({
      fingerprint: args.fingerprint,
      newSlug: args.newSlug,
      redirect: args.redirect ?? false,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 400) {
    return {
      ok: false,
      reason: String(data.reason ?? 'unknown'),
      error: typeof data.error === 'string' ? data.error : `rename failed (${res.status})`,
    };
  }
  return {
    ok: true,
    newSlug: String(data.newSlug),
    newPath: String(data.newPath),
    fingerprint: data.fingerprint as ContentFingerprint,
  };
}

/* multipart upload — no content-type header (browser sets boundary). */
export async function uploadImage(
  file: File,
): Promise<{ ok: true; path: string; name: string; size: number } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/images', {
    method: 'POST',
    headers: { 'x-nectar-dashboard-token': TOKEN },
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 400) {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : `upload failed (${res.status})`,
    };
  }
  return {
    ok: true,
    path: String(data.path),
    name: String(data.name),
    size: Number(data.size ?? 0),
  };
}

export async function uploadTheme(
  file: File,
  name?: string,
): Promise<{ ok: true; name: string; dir: string } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.append('file', file);
  if (name) fd.append('name', name);
  const res = await fetch('/api/themes/upload', {
    method: 'POST',
    headers: { 'x-nectar-dashboard-token': TOKEN },
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 400) {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : `theme upload failed (${res.status})`,
    };
  }
  return { ok: true, name: String(data.name ?? ''), dir: String(data.dir ?? '') };
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
