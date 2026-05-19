import { describe, expect, test } from 'bun:test';

describe('smoke', () => {
  test('toolchain is wired up', () => {
    expect(typeof Bun.version).toBe('string');
  });
});
