import { existsSync, statSync } from 'node:fs';
import { resolveOutputDir } from '~/build/output-dir.ts';
import { type BuildProgressEvent, type BuildSummary, build } from '~/build/pipeline.ts';
import { loadConfig } from '~/config/loader.ts';
import { createDistZipStream } from './zip-writer.ts';

// Process-level mutex. Two concurrent builds against the same output dir would
// race on the staging→commit swap and leave dist/ in a half-written state.
// We refuse the second request with 409 so the user sees an explicit signal
// instead of a corrupted output.
let buildInFlight = false;

export function isBuildInFlight(): boolean {
  return buildInFlight;
}

interface BuildRunOptions {
  cwd: string;
  configPath?: string | undefined;
  onComplete?: ((result: { ok: boolean }) => void) | undefined;
}

interface BuildStreamEvent {
  type: 'start' | 'progress' | 'done' | 'error';
  startedAt?: string;
  event?: BuildProgressEvent;
  summary?: BuildSummarySnapshot;
  message?: string;
}

interface BuildSummarySnapshot {
  outputDir: string;
  routeCount: number;
  assetCount: number;
  outputBytes?: number | undefined;
  warningCount: number;
  renderedCount: number;
  skippedCount: number;
  durationMs: number;
}

function serializeSummary(summary: BuildSummary, durationMs: number): BuildSummarySnapshot {
  return {
    outputDir: summary.outputDir,
    routeCount: summary.routeCount,
    assetCount: summary.assetCount,
    outputBytes: summary.outputBytes,
    warningCount: summary.warningCount,
    renderedCount: summary.renderedCount,
    skippedCount: summary.skippedCount,
    durationMs,
  };
}

export function createBuildStreamResponse(opts: BuildRunOptions): Response {
  if (buildInFlight) {
    return new Response(JSON.stringify({ error: 'A build is already running' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  buildInFlight = true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const enqueue = (event: BuildStreamEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Consumer disconnected; we cannot push further events.
        }
      };

      const startedAt = Date.now();
      enqueue({ type: 'start', startedAt: new Date(startedAt).toISOString() });

      let ok = false;
      try {
        const summary = await build({
          cwd: opts.cwd,
          configPath: opts.configPath,
          progress: (event: BuildProgressEvent) => enqueue({ type: 'progress', event }),
        });
        enqueue({ type: 'done', summary: serializeSummary(summary, Date.now() - startedAt) });
        ok = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue({ type: 'error', message });
      } finally {
        buildInFlight = false;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by client disconnect; nothing to do.
        }
        try {
          opts.onComplete?.({ ok });
        } catch {
          // Completion hook is best-effort; do not propagate.
        }
      }
    },
    cancel() {
      // Client disconnected mid-build. The build itself cannot be cancelled
      // safely (would leave the staging dir behind), so we let it run to
      // completion and just release the mutex when it finishes via the
      // `finally` above.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Tell reverse proxies not to buffer the response so progress lines
      // reach the dashboard as the build emits them.
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function createExportZipResponse(opts: BuildRunOptions): Promise<Response> {
  const config = await loadConfig({ cwd: opts.cwd, configPath: opts.configPath });
  const outputDir = resolveOutputDir(opts.cwd, config.build.output_dir);

  if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
    return new Response(
      JSON.stringify({
        error:
          'No built site yet. Run a build first (Build site button) and then download the zip.',
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const stream = createDistZipStream(outputDir);
  const filename = `${zipBaseName(config.site.title)}-${timestampForFilename()}.zip`;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function zipBaseName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'site';
}

function timestampForFilename(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
