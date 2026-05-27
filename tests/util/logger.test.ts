import { afterEach, describe, expect, test } from 'bun:test';
import {
  colorize,
  getLogLevel,
  getOutputMode,
  getWarningCount,
  getWarningsAsErrors,
  hasWarningsAsErrorsFailure,
  logger,
  refreshColorFromEnv,
  refreshLogLevelFromEnv,
  resetWarningCount,
  resetWarningsAsErrorsFailure,
  setColorEnabled,
  setLogLevel,
  setOutputMode,
  setWarningSubscriber,
  setWarningsAsErrors,
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

function withStreamTty<T>(stream: NodeJS.WriteStream, isTTY: boolean | undefined, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', {
    configurable: true,
    value: isTTY,
  });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor);
    } else {
      Reflect.deleteProperty(stream, 'isTTY');
    }
  }
}

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

const isoTimestampPrefix = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /;

describe('logger warning counter', () => {
  afterEach(() => {
    setWarningsAsErrors(false);
    resetWarningsAsErrorsFailure();
    setOutputMode('text');
    setLogLevel('info');
  });

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

  test('warnings-as-errors emits warn() as error while preserving the warning counter', () => {
    resetWarningCount();
    setWarningsAsErrors(true);
    expect(getWarningsAsErrors()).toBe(true);

    const { stderr } = withStreamTty(process.stderr, true, () =>
      captureStreams(() => {
        logger.warn('promoted warning');
      }),
    );

    expect(getWarningCount()).toBe(1);
    expect(hasWarningsAsErrorsFailure()).toBe(true);
    expect(stderr).toBe('[error] promoted warning\n');
  });

  test('warnings-as-errors changes JSON warn records to error level', () => {
    resetWarningCount();
    setWarningsAsErrors(true);
    setOutputMode('json');

    const { stderr } = captureStreams(() => {
      logger.warn('json warning');
    });

    const obj = JSON.parse(stderr.trim()) as { level: string; msg: string };
    expect(obj.level).toBe('error');
    expect(obj.msg).toBe('json warning');
    expect(getWarningCount()).toBe(1);
  });

  test('resetWarningCount does not clear the warnings-as-errors failure state', () => {
    resetWarningCount();
    resetWarningsAsErrorsFailure();
    setWarningsAsErrors(true);

    captureStreams(() => {
      logger.warn('still fatal');
    });
    resetWarningCount();

    expect(getWarningCount()).toBe(0);
    expect(hasWarningsAsErrorsFailure()).toBe(true);
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

describe('logger text timestamps', () => {
  test('non-TTY text logs include a leading ISO timestamp and level', () => {
    const { stdout, stderr } = withEnv('NECTAR_LOG_TIMESTAMPS', undefined, () =>
      withStreamTty(process.stdout, false, () =>
        withStreamTty(process.stderr, false, () =>
          captureStreams(() => {
            logger.info('build.done');
            logger.warn('build.warned');
          }),
        ),
      ),
    );

    expect(stdout).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] info build\.done\n$/);
    expect(stderr).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] warn build\.warned\n$/,
    );
  });

  test('TTY text logs keep the existing human-readable default', () => {
    const { stdout, stderr } = withEnv('NECTAR_LOG_TIMESTAMPS', undefined, () =>
      withStreamTty(process.stdout, true, () =>
        withStreamTty(process.stderr, true, () =>
          captureStreams(() => {
            logger.info('build.done');
            logger.warn('build.warned');
          }),
        ),
      ),
    );

    expect(stdout).toBe('build.done\n');
    expect(stderr).toBe('[warn] build.warned\n');
  });

  test('NECTAR_LOG_TIMESTAMPS=1 enables timestamps even for TTY text logs', () => {
    const { stdout } = withEnv('NECTAR_LOG_TIMESTAMPS', '1', () =>
      withStreamTty(process.stdout, true, () =>
        captureStreams(() => {
          logger.info('build.done');
        }),
      ),
    );

    expect(stdout).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] info build\.done\n$/);
  });

  test('json mode keeps the ts field instead of prefixing msg', () => {
    const prev = getOutputMode();
    setOutputMode('json');
    try {
      const { stdout } = withEnv('NECTAR_LOG_TIMESTAMPS', '1', () =>
        captureStreams(() => {
          logger.info('build.done');
        }),
      );
      const obj = JSON.parse(stdout.trim()) as { ts?: string; msg: string };
      expect(obj.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(obj.msg).toBe('build.done');
      expect(obj.msg).not.toMatch(isoTimestampPrefix);
    } finally {
      setOutputMode(prev);
    }
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
    const { stdout, stderr } = withStreamTty(process.stdout, true, () =>
      captureStreams(() => {
        logger.trace('t');
        logger.debug('d');
        logger.info('i');
      }),
    );
    expect(stdout).not.toContain('[trace]');
    expect(stdout).toContain('[debug] d');
    expect(stdout).toContain('i');
    expect(stderr).toBe('');
  });

  test('trace level emits everything including trace', () => {
    setLogLevel('trace');
    const { stdout, stderr } = withStreamTty(process.stdout, true, () =>
      captureStreams(() => {
        logger.trace('t');
        logger.debug('d');
        logger.info('i');
      }),
    );
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

  test('refreshLogLevelFromEnv warns on unknown NECTAR_LOG_LEVEL and falls back to info', () => {
    setLogLevel('trace');
    const { stderr } = captureStreams(() => {
      refreshLogLevelFromEnv({ NECTAR_LOG_LEVEL: 'verbose' });
    });

    expect(getLogLevel()).toBe('info');
    expect(stderr).toContain('Invalid NECTAR_LOG_LEVEL="verbose"');
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

  test('json mode emits one JSON object per line with msg/level and top-level fields', () => {
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
        a?: number;
        b?: string;
        fields?: unknown;
      };
      expect(obj.msg).toBe('hello');
      expect(obj.level).toBe('info');
      expect(obj.a).toBe(1);
      expect(obj.b).toBe('two');
      expect(obj.fields).toBeUndefined();
    } finally {
      setOutputMode(prev);
    }
  });

  test('json mode preserves core envelope fields when metadata uses reserved keys', () => {
    const prev = getOutputMode();
    setOutputMode('json');
    try {
      const { stdout } = captureStreams(() => {
        logger.info('hello', {
          msg: 'metadata message',
          level: 'trace',
          ts: 'yesterday',
          route: '/',
        });
      });
      const obj = JSON.parse(stdout.trim().split('\n')[0] ?? '') as {
        msg: string;
        level: string;
        ts: string;
        route?: string;
      };
      expect(obj.msg).toBe('hello');
      expect(obj.level).toBe('info');
      expect(obj.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(obj.route).toBe('/');
    } finally {
      setOutputMode(prev);
    }
  });

  test('json mode omits structured fields when none provided', () => {
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
    expect(colorize('hi', 'red')).toContain('\x1b[31m');
  });

  test('FORCE_COLOR=1 overrides NO_COLOR=1', () => {
    refreshColorFromEnv({ NO_COLOR: '1', FORCE_COLOR: '1' });
    expect(colorize('hi', 'red')).toContain('\x1b[31m');
  });

  test('FORCE_COLOR=1 enables color even when stderr is not a TTY', () => {
    refreshColorFromEnv({ FORCE_COLOR: '1' });
    expect(colorize('hi', 'red')).toContain('\x1b[31m');
  });
});

describe('logger warning subscriber', () => {
  afterEach(() => {
    setWarningSubscriber(undefined);
    resetWarningCount();
    setWarningsAsErrors(false);
    resetWarningsAsErrorsFailure();
  });

  test('subscriber receives the formatted message body without [warn] prefix', () => {
    const received: string[] = [];
    setWarningSubscriber((msg) => {
      received.push(msg);
      return true;
    });
    const { stderr } = captureStreams(() => {
      logger.warn('hello', 'world');
    });
    expect(received).toEqual(['hello world']);
    expect(stderr).toBe(''); // suppress=true → nothing written
  });

  test('subscriber returning false / undefined still lets the warning through', () => {
    const received: string[] = [];
    setWarningSubscriber((msg) => {
      received.push(msg);
      return false;
    });
    const { stderr } = captureStreams(() => {
      logger.warn('still printed');
    });
    expect(received).toEqual(['still printed']);
    expect(stderr).toContain('still printed');
  });

  test('warningCount increments even when subscriber suppresses output', () => {
    setWarningSubscriber(() => true);
    resetWarningCount();
    captureStreams(() => {
      logger.warn('one');
      logger.warn('two');
    });
    expect(getWarningCount()).toBe(2);
  });

  test('warningsAsErrors bypasses the subscriber (level promoted to error)', () => {
    const received: string[] = [];
    setWarningSubscriber((msg) => {
      received.push(msg);
      return true;
    });
    setWarningsAsErrors(true);
    const { stderr } = captureStreams(() => {
      logger.warn('promoted');
    });
    expect(received).toEqual([]); // subscriber not invoked once promoted to error
    expect(stderr).toContain('promoted');
  });
});
