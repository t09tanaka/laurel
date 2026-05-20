import { describe, expect, test } from 'bun:test';
import {
  canUseInteractiveProgress,
  createBuildProgressDisplay,
  detectCliProgressMode,
} from '~/cli/progress.ts';

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

describe('createBuildProgressDisplay', () => {
  test('returns undefined when disabled', () => {
    expect(createBuildProgressDisplay({ enabled: false })).toBeUndefined();
  });

  test('renders interactive phase and route progress in-place', () => {
    const chunks: string[] = [];
    let now = 0;
    const display = createBuildProgressDisplay({
      mode: 'interactive',
      now: () => now,
      stream: {
        write(chunk: string) {
          chunks.push(chunk);
        },
      },
    });

    expect(display).toBeDefined();
    display?.onProgress({
      type: 'phase-start',
      phase: 'render',
      label: 'Rendering routes',
      totalRoutes: 2,
    });
    now = 30_000;
    display?.onProgress({
      type: 'route-rendered',
      completedRoutes: 1,
      totalRoutes: 2,
      route: '/posts/hello/',
      reused: false,
    });
    display?.onProgress({
      type: 'asset-step',
      step: 2,
      totalSteps: 5,
      label: 'Content assets',
    });
    display?.onProgress({
      type: 'route-rendered',
      completedRoutes: 2,
      totalRoutes: 2,
      route: '/',
      reused: true,
    });
    display?.onProgress({
      type: 'phase-end',
      phase: 'render',
      label: 'Rendering routes',
      totalRoutes: 2,
    });
    display?.finish();

    const output = chunks.join('');
    expect(output).toContain('\r\x1b[2K');
    expect(output).toContain('Rendering 1/2... posts/hello (ETA 30s)');
    expect(output).toContain('Copying assets [2/5] Content assets');
    expect(output).toContain('Rendering 2/2... / cached');
    expect(output).toContain('done Rendering routes 2/2\n');
  });

  test('renders interactive phase status updates in-place', () => {
    const chunks: string[] = [];
    const display = createBuildProgressDisplay({
      mode: 'interactive',
      stream: {
        write(chunk: string) {
          chunks.push(chunk);
        },
      },
    });

    display?.onProgress({
      type: 'phase-status',
      phase: 'content',
      label: 'Loading theme…',
    });
    display?.onProgress({
      type: 'phase-status',
      phase: 'content',
      label: 'Compiling templates…',
    });
    display?.finish();

    const output = chunks.join('');
    expect(output).toContain('Loading theme…');
    expect(output).toContain('Compiling templates…');
    expect(output.endsWith('Compiling templates…\n')).toBe(true);
  });
});
