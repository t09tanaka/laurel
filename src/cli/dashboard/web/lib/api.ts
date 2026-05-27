import type {
  ContentFingerprint,
  DashboardContentItem,
  DashboardEditorKind,
  DashboardState,
} from '../types.ts';

let dashboardToken = '';

export function setDashboardToken(token: string): void {
  dashboardToken = token;
}

function writeHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-nectar-dashboard-token': dashboardToken,
  };
}

export interface ComponentReferenceRewriteSummary {
  filesChanged: number;
  occurrencesRewritten: number;
}

export async function renameContentSlug(args: {
  kind: DashboardEditorKind;
  oldSlug: string;
  newSlug: string;
  fingerprint: ContentFingerprint;
  redirect?: boolean;
  // Components-only: when true (default), `{old}` references inside
  // post / page bodies are rewritten to `{new}` as part of the
  // rename so the build-side expander stays in sync. Pass `false`
  // to opt out (e.g. a scripted rename that wants to preview first).
  rewriteReferences?: boolean;
}): Promise<
  | {
      ok: true;
      newSlug: string;
      newPath: string;
      fingerprint: ContentFingerprint;
      rewrittenReferences: ComponentReferenceRewriteSummary | null;
    }
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
      rewriteReferences: args.rewriteReferences !== false,
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
  const rewrite = data.rewrittenReferences as Record<string, unknown> | null | undefined;
  const rewrittenReferences =
    rewrite && typeof rewrite === 'object'
      ? {
          filesChanged: Number(rewrite.filesChanged ?? 0),
          occurrencesRewritten: Number(rewrite.occurrencesRewritten ?? 0),
        }
      : null;
  return {
    ok: true,
    newSlug: String(data.newSlug),
    newPath: String(data.newPath),
    fingerprint: data.fingerprint as ContentFingerprint,
    rewrittenReferences,
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
    headers: { 'x-nectar-dashboard-token': dashboardToken },
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

export interface OgpResultMeta {
  url: string;
  title: string;
  description: string;
  icon: string;
  thumbnail: string;
  author: string;
  publisher: string;
}

export type OgpFetchResult =
  | { ok: true; meta: OgpResultMeta }
  | {
      ok: false;
      error:
        | 'invalid_url'
        | 'blocked'
        | 'timeout'
        | 'fetch_failed'
        | 'no_metadata'
        | 'request_failed';
    };

const OGP_KNOWN_ERRORS = [
  'invalid_url',
  'blocked',
  'timeout',
  'fetch_failed',
  'no_metadata',
] as const;
type OgpKnownError = (typeof OGP_KNOWN_ERRORS)[number];

function isOgpKnownError(v: unknown): v is OgpKnownError {
  return OGP_KNOWN_ERRORS.includes(v as OgpKnownError);
}

export async function fetchOgp(url: string): Promise<OgpFetchResult> {
  const res = await fetch('/api/ogp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nectar-dashboard-token': dashboardToken },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 400) return { ok: false, error: 'request_failed' };
  if (data.ok === true && typeof data.meta === 'object' && data.meta !== null) {
    return { ok: true, meta: data.meta as OgpResultMeta };
  }
  return { ok: false, error: isOgpKnownError(data.error) ? data.error : 'request_failed' };
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
    headers: { 'x-nectar-dashboard-token': dashboardToken },
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
  downloadImages?: boolean;
  maxImageSizeBytes?: number;
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

export interface GhostImportUploadArgs {
  file: File;
  dryRun: boolean;
  onConflict: 'skip' | 'rename' | 'overwrite';
  outputDir?: string;
  downloadImages?: boolean;
  maxImageSizeBytes?: number;
}

export async function importGhostUpload(
  args: GhostImportUploadArgs,
): Promise<{ status: number; data: unknown }> {
  const fd = new FormData();
  fd.append('file', args.file);
  fd.append('dryRun', String(args.dryRun));
  fd.append('onConflict', args.onConflict);
  if (args.outputDir) fd.append('outputDir', args.outputDir);
  if (args.downloadImages !== undefined) {
    fd.append('downloadImages', String(args.downloadImages));
  }
  if (args.maxImageSizeBytes !== undefined) {
    fd.append('maxImageSizeBytes', String(args.maxImageSizeBytes));
  }
  const response = await fetch('/api/import/ghost', {
    method: 'POST',
    headers: { 'x-nectar-dashboard-token': dashboardToken },
    body: fd,
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

export interface PageBundleImportUploadArgs {
  file: File;
  dryRun: boolean;
  onConflict: 'skip' | 'rename' | 'overwrite';
}

export async function importPageBundleUpload(
  args: PageBundleImportUploadArgs,
): Promise<{ status: number; data: unknown }> {
  const fd = new FormData();
  fd.append('file', args.file);
  fd.append('dryRun', String(args.dryRun));
  fd.append('onConflict', args.onConflict);
  const response = await fetch('/api/page-bundles/import', {
    method: 'POST',
    headers: { 'x-nectar-dashboard-token': dashboardToken },
    body: fd,
  });
  return { status: response.status, data: await response.json() };
}

export interface BuildSummarySnapshot {
  outputDir: string;
  routeCount: number;
  assetCount: number;
  outputBytes?: number;
  warningCount: number;
  renderedCount: number;
  skippedCount: number;
  durationMs: number;
}

export type BuildStreamEvent =
  | { type: 'start'; startedAt: string }
  | {
      type: 'progress';
      event:
        | { type: 'phase-start' | 'phase-end'; phase: string; label: string; totalRoutes?: number }
        | { type: 'phase-status'; phase: string; label: string }
        | { type: 'routes-planned'; totalRoutes: number }
        | {
            type: 'route-rendered';
            completedRoutes: number;
            totalRoutes: number;
            route: string;
            reused: boolean;
          }
        | { type: 'asset-step'; step: number; totalSteps: number; label: string };
    }
  | { type: 'done'; summary: BuildSummarySnapshot }
  | { type: 'error'; message: string };

export async function streamBuild(onEvent: (event: BuildStreamEvent) => void): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/build', {
      method: 'POST',
      headers: { 'x-nectar-dashboard-token': dashboardToken },
    });
  } catch (err) {
    onEvent({ type: 'error', message: err instanceof Error ? err.message : 'Network error' });
    return;
  }
  if (response.status === 409) {
    onEvent({
      type: 'error',
      message: 'A build is already running. Wait for it to finish, then retry.',
    });
    return;
  }
  if (!response.ok || !response.body) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 240);
    } catch {
      detail = '';
    }
    onEvent({
      type: 'error',
      message: `Build request failed (${response.status})${detail ? `: ${detail}` : ''}`,
    });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) {
        try {
          onEvent(JSON.parse(line) as BuildStreamEvent);
        } catch {
          // Skip malformed lines rather than aborting the entire build feed.
        }
      }
      nl = buffer.indexOf('\n');
    }
  }
  if (buffer.trim().length > 0) {
    try {
      onEvent(JSON.parse(buffer.trim()) as BuildStreamEvent);
    } catch {
      // ignore
    }
  }
}

export async function exportPageBundle(slug: string): Promise<unknown> {
  const response = await fetch(`/api/page-bundles/export/${encodeURIComponent(slug)}`);
  const data = await response.json();
  if (!response.ok)
    throw new Error((data as { error?: string }).error ?? 'Could not export page bundle');
  return data;
}
