import { describe, expect, test } from 'bun:test';
import { pLimit } from '~/util/concurrency.ts';

describe('pLimit', () => {
  test('caps the number of concurrent runners (#1102)', async () => {
    const limit = pLimit(4);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 50 }, (_, i) =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active -= 1;
        return i;
      }),
    );
    const results = await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(results.length).toBe(50);
    expect(results[0]).toBe(0);
    expect(results[49]).toBe(49);
  });

  test('propagates rejections without blocking subsequent tasks (#1102)', async () => {
    const limit = pLimit(2);
    const settled = await Promise.allSettled([
      limit(() => Promise.reject(new Error('boom'))),
      limit(() => Promise.resolve('ok-1')),
      limit(() => Promise.resolve('ok-2')),
    ]);
    expect(settled[0]?.status).toBe('rejected');
    expect(settled[1]).toEqual({ status: 'fulfilled', value: 'ok-1' });
    expect(settled[2]).toEqual({ status: 'fulfilled', value: 'ok-2' });
  });

  test('rejects invalid concurrency values (#1102)', () => {
    expect(() => pLimit(0)).toThrow(/positive integer/);
    expect(() => pLimit(-1)).toThrow(/positive integer/);
    expect(() => pLimit(1.5)).toThrow(/positive integer/);
  });

  test('with concurrency=1 serialises tasks (#1102)', async () => {
    const limit = pLimit(1);
    const order: number[] = [];
    await Promise.all([
      limit(async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(1);
      }),
      limit(async () => {
        order.push(2);
      }),
      limit(async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});
