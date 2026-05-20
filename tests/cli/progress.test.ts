import { describe, expect, test } from 'bun:test';
import { canUseInteractiveProgress, detectCliProgressMode } from '~/cli/progress.ts';

describe('detectCliProgressMode', () => {
  const ttyStreams = {
    stdout: { isTTY: true },
    stderr: { isTTY: true },
  };

  test('enables interactive progress when stdout and stderr are TTYs', () => {
    expect(
      detectCliProgressMode({
        env: {},
        outputMode: 'text',
        ...ttyStreams,
      }),
    ).toBe('interactive');
  });

  test('uses plain progress logs when stdout is piped', () => {
    expect(
      detectCliProgressMode({
        env: {},
        outputMode: 'text',
        stdout: { isTTY: false },
        stderr: { isTTY: true },
      }),
    ).toBe('plain');
  });

  test('uses plain progress logs when stderr is piped', () => {
    expect(
      detectCliProgressMode({
        env: {},
        outputMode: 'text',
        stdout: { isTTY: true },
        stderr: { isTTY: false },
      }),
    ).toBe('plain');
  });

  test('uses plain progress logs in CI even if streams are TTYs', () => {
    expect(
      detectCliProgressMode({
        env: { CI: 'true' },
        outputMode: 'text',
        ...ttyStreams,
      }),
    ).toBe('plain');
  });

  test('treats CI=0 as a local interactive environment', () => {
    expect(
      detectCliProgressMode({
        env: { CI: '0' },
        outputMode: 'text',
        ...ttyStreams,
      }),
    ).toBe('interactive');
  });

  test('uses plain progress logs for JSON output mode', () => {
    expect(
      detectCliProgressMode({
        env: {},
        outputMode: 'json',
        ...ttyStreams,
      }),
    ).toBe('plain');
  });

  test('uses plain progress logs for dumb terminals', () => {
    expect(
      detectCliProgressMode({
        env: { TERM: 'dumb' },
        outputMode: 'text',
        ...ttyStreams,
      }),
    ).toBe('plain');
  });

  test('canUseInteractiveProgress mirrors the detected mode', () => {
    expect(
      canUseInteractiveProgress({
        env: {},
        outputMode: 'text',
        ...ttyStreams,
      }),
    ).toBe(true);
    expect(
      canUseInteractiveProgress({
        env: { GITHUB_ACTIONS: '1' },
        outputMode: 'text',
        ...ttyStreams,
      }),
    ).toBe(false);
  });
});
