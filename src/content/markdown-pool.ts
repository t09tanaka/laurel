import { availableParallelism } from 'node:os';
import { logger } from '~/util/logger.ts';
import { renderMarkdown } from './markdown.ts';
import type { RenderMarkdownOptions, RenderedMarkdown } from './markdown.ts';

export interface MarkdownPool {
  render(body: string, options?: RenderMarkdownOptions): Promise<RenderedMarkdown>;
  close(): Promise<void>;
}

export interface MarkdownPoolOptions {
  // Number of `renderMarkdown` calls expected during the pool's lifetime.
  // Used to skip worker spawn for small workloads where the spawn cost would
  // dominate over the actual rendering cost.
  estimatedJobs: number;
}

// Workers add ~50ms+ of spawn/load overhead each. Below this many jobs the
// in-process path is faster end-to-end. Tuned conservatively; the existing
// 32-wide Promise.all batching already overlaps I/O with parsing at small
// sizes, so the worker pool's job is to lift CPU-bound parsing off the main
// thread for content-heavy sites.
const MIN_JOBS_FOR_WORKERS = 50;
const MAX_WORKERS = 8;

export function createMarkdownPool(options: MarkdownPoolOptions): MarkdownPool {
  const workerCount = decideWorkerCount(options.estimatedJobs);
  if (workerCount <= 0) return createInProcessPool();
  try {
    return createWorkerPool(workerCount);
  } catch (err) {
    logger.warn(
      `Failed to start markdown worker pool (${err instanceof Error ? err.message : String(err)}); falling back to in-process rendering.`,
    );
    return createInProcessPool();
  }
}

function decideWorkerCount(estimatedJobs: number): number {
  if (process.env.NECTAR_NO_WORKERS === '1') return 0;
  if (estimatedJobs < MIN_JOBS_FOR_WORKERS) return 0;
  const cores = availableParallelism();
  if (cores <= 1) return 0;
  // Leave one core for the main thread (which still drives I/O, frontmatter
  // parsing, image dimension lookups, etc).
  return Math.min(MAX_WORKERS, Math.max(1, cores - 1));
}

function createInProcessPool(): MarkdownPool {
  return {
    render: (body, options) => renderMarkdown(body, options),
    close: async () => {
      // no-op
    },
  };
}

interface PendingJob {
  body: string;
  options: RenderMarkdownOptions;
  resolve: (r: RenderedMarkdown) => void;
  reject: (e: Error) => void;
}

export interface WorkerRequest {
  id: number;
  body: string;
  options: RenderMarkdownOptions;
}

export type WorkerResponse =
  | { id: number; ok: true; result: RenderedMarkdown }
  | { id: number; ok: false; error: string };

function createWorkerPool(count: number): MarkdownPool {
  const workers: Worker[] = [];
  const pending = new Map<number, PendingJob>();
  let nextId = 0;
  let nextWorker = 0;
  let closed = false;
  // Bun's `new Worker(url)` is async — a missing/broken worker file surfaces
  // via an `error` event, not a synchronous throw. When that happens we have
  // to assume the worker is unusable, re-run any in-flight job on the main
  // thread, and route subsequent calls to the in-process renderer. Bundled
  // dist/cli.mjs typically hits this path because Bun's bundler currently
  // leaves the worker URL un-rewritten — see the note in scripts/build-cli.ts.
  let degraded = false;

  function degradeAndDrain(reason: string) {
    if (degraded) return;
    degraded = true;
    logger.warn(`${reason}; falling back to in-process markdown rendering.`);
    for (const w of workers) w.terminate();
    workers.length = 0;
    const drained = Array.from(pending.values());
    pending.clear();
    for (const job of drained) {
      renderMarkdown(job.body, job.options).then(job.resolve, job.reject);
    }
  }

  const url = new URL('./markdown.worker.ts', import.meta.url).href;
  for (let i = 0; i < count; i += 1) {
    const worker = new Worker(url, { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as WorkerResponse;
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.ok) {
        job.resolve(data.result);
      } else {
        job.reject(new Error(data.error));
      }
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      if (closed) return;
      degradeAndDrain(`markdown worker failed: ${e.message || 'unknown error'}`);
    });
    workers.push(worker);
  }

  return {
    render(body, options) {
      const opts = options ?? {};
      if (closed) {
        return Promise.reject(new Error('markdown pool is closed'));
      }
      if (degraded) {
        return renderMarkdown(body, opts);
      }
      return new Promise<RenderedMarkdown>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { body, options: opts, resolve, reject });
        const idx = nextWorker % workers.length;
        nextWorker += 1;
        const worker = workers[idx];
        if (!worker) {
          pending.delete(id);
          // Lost the pool somehow; route directly through in-process.
          renderMarkdown(body, opts).then(resolve, reject);
          return;
        }
        const request: WorkerRequest = { id, body, options: opts };
        worker.postMessage(request);
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const w of workers) {
        w.terminate();
      }
      workers.length = 0;
      for (const [, job] of pending) {
        job.reject(new Error('markdown pool closed before job finished'));
      }
      pending.clear();
    },
  };
}
