import { unlink } from 'node:fs/promises';
import {
  type ImportProgressEvent,
  type ImportSummary,
  ON_CONFLICT_VALUES,
  importGhostExport,
} from '~/ghost/import.ts';
import type { DashboardGhostImportPayload } from '../commands/dashboard.ts';

// Wire format for the dashboard's streaming Ghost-import endpoint. One JSON
// object per line, in the order they happen — mirrors the build endpoint's
// NDJSON shape so the frontend can reuse the same line-reader pattern.
//
// The `progress` event wraps `ImportProgressEvent` so the import library's
// type can grow new variants without breaking the wire schema here.
type GhostImportStreamEvent =
  | { type: 'start'; startedAt: string }
  | { type: 'progress'; event: ImportProgressEvent }
  | { type: 'done'; summary: ImportSummary; mode: 'dry-run' | 'apply'; target: string }
  | { type: 'error'; message: string };

interface GhostImportStreamOptions {
  cwd: string;
  payload: DashboardGhostImportPayload;
  // Local path of a staged copy of the upload. Cleaned up after the stream
  // closes so a crash mid-import can't leak the staged file forever.
  stagedPath?: string;
  // Fires once the stream has settled (success or failure) so the caller can
  // broadcast change events / unlink temp dirs / etc. Runs inside the stream
  // start handler, before the controller closes.
  onComplete?: (result: { ok: boolean }) => void;
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') throw new Error(`invalid ${name}: ${String(value)}`);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`invalid ${name}: ${value}`);
  }
  return value;
}

export function createGhostImportStreamResponse(opts: GhostImportStreamOptions): Response {
  const encoder = new TextEncoder();
  const { payload } = opts;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const enqueue = (event: GhostImportStreamEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Consumer disconnected; further enqueues are no-ops.
        }
      };

      enqueue({ type: 'start', startedAt: new Date().toISOString() });

      void (async () => {
        let settledOk = false;
        try {
          const file = typeof payload.file === 'string' ? payload.file.trim() : '';
          if (!file) throw new Error('file is required');
          const onConflict = payload.onConflict ?? 'skip';
          if (!ON_CONFLICT_VALUES.includes(onConflict)) {
            throw new Error(`invalid onConflict: ${String(payload.onConflict)}`);
          }
          const dryRun = payload.dryRun !== false;
          const outputDir = cleanOptionalString(payload.outputDir);

          const summary = await importGhostExport({
            cwd: opts.cwd,
            file,
            onConflict,
            dryRun,
            outputDir,
            assetsDir: cleanOptionalString(payload.assetsDir),
            downloadImages: payload.downloadImages === true,
            sourceUrl: cleanOptionalString(payload.sourceUrl),
            keepCodeInjection: payload.keepCodeInjection === true,
            keepHtml: payload.keepHtml === true,
            maxFileSizeBytes: optionalNonNegativeInteger(
              payload.maxFileSizeBytes,
              'maxFileSizeBytes',
            ),
            maxPostHtmlSizeBytes: optionalNonNegativeInteger(
              payload.maxPostHtmlSizeBytes,
              'maxPostHtmlSizeBytes',
            ),
            maxImageSizeBytes: optionalNonNegativeInteger(
              payload.maxImageSizeBytes,
              'maxImageSizeBytes',
            ),
            onProgress: (event) => enqueue({ type: 'progress', event }),
          });

          enqueue({
            type: 'done',
            summary,
            mode: dryRun ? 'dry-run' : 'apply',
            target: outputDir ?? 'content/',
          });
          settledOk = true;
        } catch (err) {
          enqueue({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          opts.onComplete?.({ ok: settledOk });
          if (opts.stagedPath) {
            await unlink(opts.stagedPath).catch(() => {});
          }
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
