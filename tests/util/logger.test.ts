import { afterEach, describe, expect, test } from 'bun:test';
import {
  colorize,
  getLogLevel,
  getOutputMode,
  getWarningCount,
  logger,
  refreshColorFromEnv,
  resetWarningCount,
  setColorEnabled,
  setLogLevel,
  setOutputMode,
} from '~/util/logger.ts';

describe('logger warning counter', () => {
  test('warn() increments the counter; resetWarningCount() clears it', () => {
    resetWarningCount();
    expect(getWarningCount()).toBe(0);

    logger.warn('first');
    logger.warn('second');
    expect(getWarningCount()).toBe(2);

    resetWarningCount();
    expect(getWarningCount()).toBe(0);
  });

  test('non-warn levels do not increment the counter', () => {
    resetWarningCount();
    logger.debug('d');
    logger.info('i');
    logger.error('e');
    expect(getWarningCount()).toBe(0);
  });
});

describe('logger stream routing', () => {
  function captureStreams(fn: () => void): { stdout: string; stderr: string } {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let stdout = '';
    let stderr = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    return { stdout, stderr };
  }

  test('all log levels write to stderr; stdout stays empty', () => {
    const { stdout, stderr } = captureStreams(() => {
      logger.info('progress message');
      logger.warn('a warning');
      logger.error('a problem');
      logger.debug('debug detail');
    });
    expect(stdout).toBe('');
    expect(stderr).toContain('progress message');
    expect(stderr).toContain('a warning');
    expect(stderr).toContain('a problem');
  });
});

describe('setLogLevel', () => {
  function captureStderr(fn: () => void): string {
    const orig = process.stderr.write.bind(process.stderr);
    let out = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stderr.write = orig;
    }
    return out;
  }

  afterEach(() => {
    setLogLevel('info');
  });

  test('warn level suppresses info, debug, and trace but keeps warn/error', () => {
    setLogLevel('warn');
    const out = captureStderr(() => {
      logger.trace('t');
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    });
    expect(out).not.toContain('t\n');
    expect(out).not.toContain('d\n');
    expect(out).not.toContain('i\n');
    expect(out).toContain('w');
    expect(out).toContain('e');
  });

  test('debug level emits debug but suppresses trace', () => {
    setLogLevel('debug');
    const out = captureStderr(() => {
      logger.trace('t');
      logger.debug('d');
      logger.info('i');
    });
    expect(out).not.toContain('[trace]');
    expect(out).toContain('[debug] d');
    expect(out).toContain('i');
  });

  test('trace level emits everything including trace', () => {
    setLogLevel('trace');
    const out = captureStderr(() => {
      logger.trace('t');
      logger.debug('d');
      logger.info('i');
    });
    expect(out).toContain('[trace] t');
    expect(out).toContain('[debug] d');
    expect(out).toContain('i');
  });

  test('getLogLevel reflects the current threshold', () => {
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
    setLogLevel('trace');
    expect(getLogLevel()).toBe('trace');
  });
});

describe('logger structured fields', () => {
  function captureStderr(fn: () => void): string {
    const orig = process.stderr.write.bind(process.stderr);
    let out = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stderr.write = orig;
    }
    return out;
  }

  test('text mode renders trailing fields as key=value pairs', () => {
    const out = captureStderr(() => {
      logger.info('built', { routes: 12, output: '/tmp/dist' });
    });
    expect(out).toContain('built');
    expect(out).toContain('routes=12');
    expect(out).toContain('output=/tmp/dist');
  });

  test('json mode emits one JSON object per line with msg/level/fields', () => {
    const prev = getOutputMode();
    setOutputMode('json');
    try {
      const out = captureStderr(() => {
        logger.info('hello', { a: 1, b: 'two' });
      });
      const line = out.trim().split('\n')[0] ?? '';
      const obj = JSON.parse(line) as {
        msg: string;
        level: string;
        fields?: { a: number; b: string };
      };
      expect(obj.msg).toBe('hello');
      expect(obj.level).toBe('info');
      expect(obj.fields).toEqual({ a: 1, b: 'two' });
    } finally {
      setOutputMode(prev);
    }
  });

  test('json mode omits fields when none provided', () => {
    const prev = getOutputMode();
    setOutputMode('json');
    try {
      const out = captureStderr(() => {
        logger.info('plain');
      });
      const obj = JSON.parse(out.trim().split('\n')[0] ?? '') as {
        msg: string;
        fields?: unknown;
      };
      expect(obj.msg).toBe('plain');
      expect(obj.fields).toBeUndefined();
    } finally {
      setOutputMode(prev);
    }
  });
});

describe('logger color detection', () => {
  test('colorize is a no-op when color is disabled', () => {
    setColorEnabled(false);
    expect(colorize('hi', 'red')).toBe('hi');
  });

  test('colorize wraps text with ANSI when enabled', () => {
    setColorEnabled(true);
    expect(colorize('hi', 'red')).toContain('\x1b[31m');
    expect(colorize('hi', 'red')).toContain('\x1b[0m');
  });

  test('NO_COLOR=1 disables via refreshColorFromEnv', () => {
    setColorEnabled(true);
    refreshColorFromEnv({ NO_COLOR: '1' });
    expect(colorize('hi', 'red')).toBe('hi');
  });

  test('NECTAR_NO_COLOR=0 + FORCE_COLOR=1 re-enables even when NO_COLOR=1', () => {
    refreshColorFromEnv({ NO_COLOR: '1', NECTAR_NO_COLOR: '0', FORCE_COLOR: '1' });
    // Explicit `NECTAR_NO_COLOR=0` skips the NO_COLOR check; FORCE_COLOR=1
    // then turns color on. This is the documented escape hatch for CI
    // images that set NO_COLOR globally.
    expect(colorize('hi', 'red')).toContain('\x1b[31m');
  });

  test('FORCE_COLOR=1 enables color even when stderr is not a TTY', () => {
    refreshColorFromEnv({ FORCE_COLOR: '1' });
    expect(colorize('hi', 'red')).toContain('\x1b[31m');
  });
});
