import { describe, expect, test } from 'bun:test';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';

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
