export type CleanupSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';
export type CleanupTrigger = CleanupSignal | 'exit' | 'manual';

export interface CleanupContext {
  trigger: CleanupTrigger;
  signal?: CleanupSignal;
  exitCode?: number;
}

export type CleanupCallback = (context: CleanupContext) => void | Promise<void>;

export interface CleanupRegistrationOptions {
  name?: string;
}

export interface CleanupRunOptions {
  trigger?: CleanupTrigger;
  signal?: CleanupSignal;
  exitCode?: number;
}

export interface CleanupProcess {
  once(event: CleanupSignal | 'exit', listener: (...args: unknown[]) => void): unknown;
  removeListener(event: CleanupSignal | 'exit', listener: (...args: unknown[]) => void): unknown;
  exit?(code?: number): never;
  exitCode?: number;
}

export interface ProcessCleanupHookOptions {
  process?: CleanupProcess;
  signals?: readonly CleanupSignal[];
  includeExit?: boolean;
  exitAfterSignal?: boolean;
  onError?: (error: unknown, context: CleanupContext) => void;
}

export interface WaitForSignalOptions {
  process?: CleanupProcess;
  signals?: readonly CleanupSignal[];
  runCleanup?: boolean;
}

interface CleanupEntry {
  id: number;
  name: string;
  callback: CleanupCallback;
  active: boolean;
}

const DEFAULT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const SIGNAL_EXIT_CODES: Record<CleanupSignal, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

export class CleanupRegistry {
  #entries: CleanupEntry[] = [];
  #nextId = 1;
  #runPromise: Promise<void> | undefined;
  #hasRun = false;

  get size(): number {
    return this.#entries.filter((entry) => entry.active).length;
  }

  register(callback: CleanupCallback, options: CleanupRegistrationOptions = {}): () => void {
    if (this.#hasRun) return () => {};

    const entry: CleanupEntry = {
      id: this.#nextId,
      name: options.name ?? `cleanup-${this.#nextId}`,
      callback,
      active: true,
    };
    this.#nextId += 1;
    this.#entries.push(entry);

    return () => {
      entry.active = false;
    };
  }

  run(options: CleanupRunOptions = {}): Promise<void> {
    if (this.#runPromise) return this.#runPromise;
    if (this.#hasRun) return Promise.resolve();

    this.#hasRun = true;
    const context: CleanupContext = {
      trigger: options.trigger ?? 'manual',
      signal: options.signal,
      exitCode: options.exitCode,
    };
    const entries = this.#entries.filter((entry) => entry.active);
    this.#entries = [];

    this.#runPromise = runCleanupEntries(entries, context);
    return this.#runPromise;
  }

  waitForSignal(options: WaitForSignalOptions = {}): Promise<CleanupSignal> {
    const target = options.process ?? (process as unknown as CleanupProcess);
    const signals = options.signals ?? DEFAULT_SIGNALS;
    const runCleanup = options.runCleanup ?? true;

    return new Promise<CleanupSignal>((resolve, reject) => {
      const listeners = new Map<CleanupSignal, () => void>();
      const removeListeners = (): void => {
        for (const [signal, listener] of listeners) {
          target.removeListener(signal, listener);
        }
      };

      for (const signal of signals) {
        const listener = (): void => {
          removeListeners();
          if (!runCleanup) {
            resolve(signal);
            return;
          }
          this.run({ trigger: signal, signal }).then(
            () => resolve(signal),
            (error: unknown) => reject(error),
          );
        };
        listeners.set(signal, listener);
        target.once(signal, listener);
      }
    });
  }

  installProcessHooks(options: ProcessCleanupHookOptions = {}): () => void {
    const target = options.process ?? (process as unknown as CleanupProcess);
    const signals = options.signals ?? DEFAULT_SIGNALS;
    const includeExit = options.includeExit ?? true;
    const exitAfterSignal = options.exitAfterSignal ?? false;
    const onError = options.onError;
    const listeners = new Map<CleanupSignal | 'exit', (...args: unknown[]) => void>();
    let uninstalled = false;

    const removeListeners = (): void => {
      if (uninstalled) return;
      uninstalled = true;
      for (const [event, listener] of listeners) {
        target.removeListener(event, listener);
      }
      listeners.clear();
    };

    for (const signal of signals) {
      const listener = (): void => {
        const context: CleanupContext = { trigger: signal, signal };
        removeListeners();
        this.run(context)
          .catch((error: unknown) => {
            onError?.(error, context);
            if (!onError) target.exitCode = 1;
          })
          .finally(() => {
            if (exitAfterSignal) exitProcessForSignal(target, signal);
          });
      };
      listeners.set(signal, listener);
      target.once(signal, listener);
    }

    if (includeExit) {
      const listener = (code?: unknown): void => {
        const exitCode = typeof code === 'number' ? code : undefined;
        const context: CleanupContext = { trigger: 'exit', exitCode };
        void this.run(context).catch((error: unknown) => {
          onError?.(error, context);
        });
      };
      listeners.set('exit', listener);
      target.once('exit', listener);
    }

    return removeListeners;
  }
}

export function createCleanupRegistry(): CleanupRegistry {
  return new CleanupRegistry();
}

async function runCleanupEntries(
  entries: readonly CleanupEntry[],
  context: CleanupContext,
): Promise<void> {
  const errors: Array<{ name: string; error: unknown }> = [];
  for (const entry of entries) {
    try {
      await entry.callback(context);
    } catch (error) {
      errors.push({ name: entry.name, error });
    }
  }

  if (errors.length === 0) return;
  if (errors.length === 1) {
    const first = errors[0];
    if (!first) return;
    throw new Error(`Cleanup callback failed: ${first.name}`, { cause: first.error });
  }
  throw new AggregateError(
    errors.map((entry) => entry.error),
    `Cleanup callbacks failed: ${errors.map((entry) => entry.name).join(', ')}`,
  );
}

function exitProcessForSignal(target: CleanupProcess, signal: CleanupSignal): void {
  const code = SIGNAL_EXIT_CODES[signal];
  if (target.exit) {
    target.exit(code);
  }
  target.exitCode = code;
}
