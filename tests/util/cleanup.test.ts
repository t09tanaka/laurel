import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { type CleanupContext, type CleanupProcess, createCleanupRegistry } from '~/util/cleanup.ts';

class FakeProcess extends EventEmitter implements CleanupProcess {
  exitCode?: number;
  readonly exitCalls: number[] = [];

  override once(event: string, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  override removeListener(event: string, listener: (...args: unknown[]) => void): this {
    return super.removeListener(event, listener);
  }

  exit(code?: number): never {
    this.exitCalls.push(code ?? 0);
    throw new Error(`fake exit ${code ?? 0}`);
  }
}

describe('CleanupRegistry', () => {
  test('runs registered callbacks in registration order', async () => {
    const registry = createCleanupRegistry();
    const order: string[] = [];

    registry.register(async () => {
      order.push('first:start');
      await Promise.resolve();
      order.push('first:end');
    });
    registry.register(() => {
      order.push('second');
    });

    await registry.run();

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  test('runs cleanup callbacks at most once even when invoked repeatedly', async () => {
    const registry = createCleanupRegistry();
    let calls = 0;
    registry.register(() => {
      calls += 1;
    });

    await Promise.all([
      registry.run({ trigger: 'manual' }),
      registry.run({ trigger: 'SIGTERM', signal: 'SIGTERM' }),
      registry.run({ trigger: 'exit', exitCode: 0 }),
    ]);
    await registry.run();

    expect(calls).toBe(1);
    expect(registry.size).toBe(0);
  });

  test('waitForSignal resolves after signal-triggered cleanup', async () => {
    const registry = createCleanupRegistry();
    const proc = new FakeProcess();
    const contexts: CleanupContext[] = [];

    registry.register(async (context) => {
      await Promise.resolve();
      contexts.push(context);
    });

    const wait = registry.waitForSignal({ process: proc, signals: ['SIGTERM'] });
    proc.emit('SIGTERM');

    await expect(wait).resolves.toBe('SIGTERM');
    expect(contexts).toEqual([{ trigger: 'SIGTERM', signal: 'SIGTERM' }]);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  test('installProcessHooks wires default signals and exit through the same idempotent run', async () => {
    const registry = createCleanupRegistry();
    const proc = new FakeProcess();
    const contexts: CleanupContext[] = [];
    let resolveCleanup: (() => void) | undefined;
    const cleanupDone = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });

    registry.register((context) => {
      contexts.push(context);
      resolveCleanup?.();
    });
    const uninstall = registry.installProcessHooks({ process: proc, exitAfterSignal: false });

    expect(proc.listenerCount('SIGINT')).toBe(1);
    expect(proc.listenerCount('SIGTERM')).toBe(1);
    expect(proc.listenerCount('SIGHUP')).toBe(1);
    expect(proc.listenerCount('exit')).toBe(1);

    proc.emit('SIGHUP');
    await cleanupDone;
    proc.emit('exit', 7);

    expect(contexts).toEqual([{ trigger: 'SIGHUP', signal: 'SIGHUP' }]);
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
    expect(proc.listenerCount('SIGHUP')).toBe(0);
    expect(proc.listenerCount('exit')).toBe(0);
    uninstall();
  });
});
