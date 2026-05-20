import { describe, expect, test } from 'bun:test';
import {
  bunEngineWarning,
  packageBunEngine,
  satisfiesMinimumVersion,
  warnIfBunEngineMismatch,
} from '~/cli/bun-engine.ts';

describe('bun engine startup warning', () => {
  test('reads the package engines.bun constraint', () => {
    expect(packageBunEngine()).toBe('>=1.3.0');
  });

  test('compares Bun versions against the minimum engines.bun constraint', () => {
    expect(satisfiesMinimumVersion('1.3.0', '>=1.3.0')).toBe(true);
    expect(satisfiesMinimumVersion('1.3.14', '>=1.3.0')).toBe(true);
    expect(satisfiesMinimumVersion('1.4.0', '>=1.3.0')).toBe(true);
    expect(satisfiesMinimumVersion('1.2.99', '>=1.3.0')).toBe(false);
  });

  test('builds a warning only when the detected Bun version is too old', () => {
    expect(bunEngineWarning('1.2.99', '>=1.3.0')).toContain('Bun 1.2.99');
    expect(bunEngineWarning('1.3.0', '>=1.3.0')).toBeUndefined();
    expect(bunEngineWarning(undefined, '>=1.3.0')).toBeUndefined();
  });

  test('does not warn when running from a Node bundle without a Bun global', () => {
    const messages: string[] = [];
    warnIfBunEngineMismatch((message) => messages.push(message), undefined, '>=1.3.0');
    expect(messages).toEqual([]);
  });
});
