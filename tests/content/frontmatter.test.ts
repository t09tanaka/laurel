import { describe, expect, test } from 'bun:test';
import { asDateISO } from '~/content/frontmatter.ts';
import { getWarningCount, resetWarningCount } from '~/util/logger.ts';

describe('asDateISO', () => {
  test('parses ISO date strings', () => {
    resetWarningCount();
    const out = asDateISO('2026-01-02T03:04:05Z');
    expect(out).toBe('2026-01-02T03:04:05.000Z');
    expect(getWarningCount()).toBe(0);
  });

  test('returns Date instances as ISO', () => {
    resetWarningCount();
    const out = asDateISO(new Date('2026-05-19T00:00:00Z'));
    expect(out).toBe('2026-05-19T00:00:00.000Z');
    expect(getWarningCount()).toBe(0);
  });

  test('uses fallback silently when value is undefined', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO(undefined, fallback)).toBe(fallback);
    expect(getWarningCount()).toBe(0);
  });

  test('uses fallback silently when value is an empty string', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO('   ', fallback)).toBe(fallback);
    expect(getWarningCount()).toBe(0);
  });

  test('warns when value is a non-empty invalid date string', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    const out = asDateISO('not-a-date', fallback, 'posts/foo.md date');
    expect(out).toBe(fallback);
    expect(getWarningCount()).toBe(1);
  });

  test('warns when value is an unexpected non-string type', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    const out = asDateISO({ year: 2026 } as unknown, fallback);
    expect(out).toBe(fallback);
    expect(getWarningCount()).toBe(1);
  });
});
