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
