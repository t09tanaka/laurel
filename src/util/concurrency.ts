// Tiny p-limit replacement: bounds how many promise-returning tasks run in
// parallel. Used by the build emit phase so per-file fs writes (writeHtml,
// copyAssets, copyContentAssets) can fan out concurrently without exhausting
// the file-descriptor table on large sites.
type LimitedRunner = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitedRunner {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`pLimit: concurrency must be a positive integer, got ${concurrency}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (!run) return;
    active += 1;
    run();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}
