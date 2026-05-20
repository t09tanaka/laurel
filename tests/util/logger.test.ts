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
  test('info writes to stdout while warn and error write to stderr', () => {
    const { stdout, stderr } = captureStreams(() => {
      logger.info('progress message');
      logger.warn('a warning');
      logger.error('a problem');
      logger.debug('debug detail');
    });
    expect(stdout).toContain('progress message');
    expect(stderr).not.toContain('progress message');
    expect(stderr).toContain('a warning');
    expect(stderr).toContain('a problem');
  });
});

describe('setLogLevel', () => {
  afterEach(() => {
    setLogLevel('info');
  });

  test('warn level suppresses info, debug, and trace but keeps warn/error', () => {
    setLogLevel('warn');
    const { stdout, stderr } = captureStreams(() => {
      logger.trace('t');
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    });
    expect(stdout).not.toContain('t\n');
    expect(stdout).not.toContain('d\n');
    expect(stdout).not.toContain('i\n');
    expect(stderr).toContain('w');
    expect(stderr).toContain('e');
  });

  test('debug level emits debug but suppresses trace', () => {
    setLogLevel('debug');
    const { stdout, stderr } = captureStreams(() => {
      logger.trace('t');
      logger.debug('d');
      logger.info('i');
    });
    expect(stdout).not.toContain('[trace]');
    expect(stdout).toContain('[debug] d');
    expect(stdout).toContain('i');
    expect(stderr).toBe('');
  });

  test('trace level emits everything including trace', () => {
    setLogLevel('trace');
    const { stdout, stderr } = captureStreams(() => {
      logger.trace('t');
      logger.debug('d');
      logger.info('i');
    });
    expect(stdout).toContain('[trace] t');
    expect(stdout).toContain('[debug] d');
    expect(stdout).toContain('i');
    expect(stderr).toBe('');
  });

  test('getLogLevel reflects the current threshold', () => {
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
    setLogLevel('trace');
    expect(getLogLevel()).toBe('trace');
  });
});

describe('logger structured fields', () => {
  test('text mode renders trailing fields as key=value pairs', () => {
    const { stdout, stderr } = captureStreams(() => {
      logger.info('built', { routes: 12, output: '/tmp/dist' });
    });
    expect(stdout).toContain('built');
    expect(stdout).toContain('routes=12');
    expect(stdout).toContain('output=/tmp/dist');
    expect(stderr).toBe('');
  });

  test('json mode emits one JSON object per line with msg/level/fields', () => {
    const prev = getOutputMode();
    setOutputMode('json');
    try {
      const { stdout, stderr } = captureStreams(() => {
        logger.info('hello', { a: 1, b: 'two' });
      });
      expect(stderr).toBe('');
      const line = stdout.trim().split('\n')[0] ?? '';
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
      const { stdout, stderr } = captureStreams(() => {
        logger.info('plain');
      });
      expect(stderr).toBe('');
      const obj = JSON.parse(stdout.trim().split('\n')[0] ?? '') as {
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
