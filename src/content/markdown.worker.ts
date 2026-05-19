import type { WorkerRequest, WorkerResponse } from './markdown-pool.ts';
import { renderMarkdown } from './markdown.ts';

// Inside a Web Worker scope `self` is the global object with `onmessage` /
// `postMessage`. `globalThis` works the same and avoids a Worker-vs-window
// type disagreement when this file is type-checked alongside main-thread code.
const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (data: WorkerResponse) => void;
};

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, body, options } = e.data;
  try {
    const result = await renderMarkdown(body, options);
    ctx.postMessage({ id, ok: true, result });
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
